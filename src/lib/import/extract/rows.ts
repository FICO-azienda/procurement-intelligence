/**
 * Table rows + column mapping → draft items with normalized values and the
 * problems found while reading them. No database access here.
 */
import { say, type Msg } from "../../i18n";
import type { ColumnMapping, FieldKey } from "../fields";
import { readCodes } from "../normalize/codes";
import { currencyInText, isKnownCurrency, normalizeCurrency } from "../normalize/currency";
import { detectDateOrder, parseDate, type DateOrder } from "../normalize/dates";
import { isCreditNote } from "../normalize/documents";
import { amountsMatch, detectDecimalStyle, parseNumber, round2, type DecimalStyle } from "../normalize/numbers";
import { parseIncoterm, parseLeadTime, parsePaymentTerms } from "../normalize/terms";
import { tidy } from "../normalize/text";
import { normalizeUnit, splitQuantityAndUnit } from "../normalize/units";
import { EMPTY_ITEM, type DraftItem, type ExtractedData, type Issue, type ItemData, type RecordType } from "../types";
import { cellText, type Cell, type Table } from "./tabular";

export interface RowOptions {
  recordType: RecordType;
  /** Chosen by the user on the mapping screen when the file has no currency column. */
  defaultCurrency: string | null;
}

const NUMERIC_FIELDS: FieldKey[] = ["quantity", "unit_price", "total", "freight", "other_costs", "moq"];
const LABELS: Partial<Record<keyof ItemData, Msg>> = {
  quantity: "Quantity",
  unitPrice: "Unit price",
  total: "Total",
  freight: "Freight",
  otherCosts: "Other costs",
  moq: "MOQ",
  date: "Date",
  validUntil: "Valid until",
};

export function buildRowItems(table: Table, mapping: ColumnMapping, options: RowOptions): { items: DraftItem[]; skippedRows: number } {
  const col = (f: FieldKey) => {
    const header = Object.keys(mapping).find((h) => mapping[h] === f);
    return header ? table.headers.indexOf(header) : -1;
  };
  const cols = Object.fromEntries(
    (["purchase_date", "supplier_name", "supplier_country", "supplier_vat", "product_name", "sku", "supplier_sku", "description", "category", "quantity", "unit", "unit_price", "currency", "freight", "other_costs", "total", "invoice_reference", "payment_terms", "incoterm", "moq", "lead_time", "valid_until", "notes", "discount", "document_type", "invoice_line", "ean"] as FieldKey[]).map((f) => [f, col(f)]),
  ) as Record<FieldKey, number>;

  // Decimal style per numeric column, falling back to the whole file's evidence.
  const textValues = (i: number) => (i < 0 ? [] : table.rows.map((r) => r[i]).filter((c): c is string => typeof c === "string"));
  const fileStyle = detectDecimalStyle(NUMERIC_FIELDS.flatMap((f) => textValues(cols[f])));
  const styles: Partial<Record<FieldKey, { style: DecimalStyle | null; conflict: boolean }>> = {};
  for (const f of NUMERIC_FIELDS) {
    const s = detectDecimalStyle(textValues(cols[f]));
    styles[f] = { style: s.style ?? (fileStyle.conflict ? null : fileStyle.style), conflict: s.conflict };
  }
  const dateOrder = detectDateOrder(textValues(cols.purchase_date));

  const items: DraftItem[] = [];
  let skippedRows = 0;
  table.rows.forEach((row, idx) => {
    const cell = (f: FieldKey): Cell => (cols[f] >= 0 ? row[cols[f]] : null);
    const text = (f: FieldKey) => {
      const c = cell(f);
      return c == null ? null : tidy(cellText(c)) || null;
    };

    // Skip rows with nothing to import (subtotals, blank separators).
    const hasProduct = ["product_name", "sku", "supplier_sku", "description"].some((f) => text(f as FieldKey));
    const hasNumbers = text("quantity") || text("unit_price") || text("total");
    if (!hasProduct && !hasNumbers) {
      skippedRows++;
      return;
    }

    const issues: Issue[] = [];
    const num = (f: FieldKey, key: keyof ItemData, cellValue: Cell = cell(f)) => {
      if (cellValue == null || cellValue === "") return null;
      if (cellValue instanceof Date) {
        issues.push({ code: "invalid_number", severity: "blocking", field: key, ...say('{~label} "{value}" is a date, not a number', { label: LABELS[key], value: cellText(cellValue) }) });
        return null;
      }
      const s = styles[f];
      const p = parseNumber(cellValue as string | number, s?.style ?? null);
      if (p.error) {
        issues.push({ code: "invalid_number", severity: "blocking", field: key, ...say('{~label}: "{value}" is not a valid number', { label: LABELS[key], value: cellText(cellValue) }) });
        return null;
      }
      if (p.ambiguous || s?.conflict) {
        issues.push({
          code: "number_format_uncertain",
          severity: "review",
          field: key,
          ...say('{~label} "{value}" could be read in two ways — we read it as {read}', { label: LABELS[key], value: cellText(cellValue), read: p.value?.toLocaleString("it-IT") }),
        });
      }
      return p.value;
    };

    const data: ItemData = { ...EMPTY_ITEM };
    data.supplierName = text("supplier_name");
    data.supplierCountry = text("supplier_country");
    data.supplierVat = text("supplier_vat");
    data.productName = text("product_name");
    // Invoices give each code a type ("AswArtFor:…", "EAN:…"): the type says whose code it is.
    const ours = readCodes(text("sku"), "own");
    const theirs = readCodes(text("supplier_sku"), "supplier");
    data.sku = ours.own ?? theirs.own;
    data.supplierSku = theirs.supplier ?? ours.supplier;
    data.ean = text("ean") ?? ours.ean ?? theirs.ean;
    data.documentType = text("document_type");
    const lineText = text("invoice_line");
    data.invoiceLine = lineText && /^\d{1,6}$/.test(lineText) ? Number(lineText) : null;
    data.description = text("description");
    data.category = text("category") ?? ours.commodity ?? theirs.commodity;
    data.invoiceReference = text("invoice_reference");
    data.notes = text("notes");

    // Date
    const dateCell = cell("purchase_date");
    if (dateCell != null && cellText(dateCell) !== "") {
      data.date = parseDate(dateCell, dateOrder.order);
      if (!data.date) issues.push({ code: "invalid_date", severity: "blocking", field: "date", ...say('"{value}" is not a valid date', { value: cellText(dateCell) }) });
      else if (dateOrder.conflict && typeof dateCell === "string") {
        issues.push({ code: "date_format_uncertain", severity: "review", field: "date", ...say('The file mixes day/month orders — check the date "{value}"', { value: dateCell }) });
      }
    }
    const validCell = cell("valid_until");
    if (validCell != null && cellText(validCell) !== "") data.validUntil = parseDate(validCell, dateOrder.order);

    // Quantity (may carry its unit: "2.000 kg")
    const qCell = cell("quantity");
    let unitFromQty: string | null = null;
    if (typeof qCell === "string") {
      const split = splitQuantityAndUnit(qCell);
      unitFromQty = split.unit;
      data.quantity = num("quantity", "quantity", split.numberText);
    } else {
      data.quantity = num("quantity", "quantity");
    }

    // Unit
    const unitText = text("unit");
    if (unitText) {
      data.unit = normalizeUnit(unitText);
      if (!data.unit) {
        data.unitRaw = unitText;
        issues.push({ code: "unit_unknown", severity: "blocking", field: "unit", ...say('Unknown unit "{value}" — choose the unit', { value: unitText }) });
      }
    } else if (unitFromQty) {
      data.unit = unitFromQty;
    }

    // Prices and currency
    const priceCell = cell("unit_price");
    data.unitPrice = num("unit_price", "unitPrice");
    data.total = num("total", "total");
    data.freight = num("freight", "freight");
    data.otherCosts = num("other_costs", "otherCosts");
    const moqCell = cell("moq");
    data.moq = typeof moqCell === "string" ? num("moq", "moq", splitQuantityAndUnit(moqCell).numberText) : num("moq", "moq");

    const blocked = (field: keyof ItemData) => issues.some((i) => i.field === field && i.severity === "blocking");
    // A line with an amount and no quantity is a lump sum (a service, a fee): one item at that amount.
    if (options.recordType === "purchase" && data.quantity == null && data.total != null && !blocked("quantity") && !blocked("unitPrice") && (data.unitPrice == null || amountsMatch(data.unitPrice, data.total))) {
      data.quantity = 1;
      data.unitPrice ??= data.total;
      issues.push({ code: "quantity_assumed", severity: "info", field: "quantity", ...say("No quantity in the file: read as one item at the line total") });
    }
    if (data.unitPrice == null && data.total != null && data.quantity) {
      data.unitPrice = Math.round((data.total / data.quantity) * 1e6) / 1e6;
      issues.push({ code: "unit_price_derived", severity: "info", field: "unitPrice", ...say("Unit price calculated from total ÷ quantity") });
    }
    // A discount on the line: the total is what was charged, so one unit cost total ÷ quantity.
    if (text("discount") && data.quantity && data.total != null && data.unitPrice != null && !amountsMatch(data.quantity * data.unitPrice, data.total)) {
      const list = data.unitPrice;
      data.unitPrice = Math.round((data.total / data.quantity) * 1e6) / 1e6;
      const price = (n: number) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
      issues.push({ code: "unit_price_derived", severity: "info", field: "unitPrice", ...say("Unit price after the discount on the line: {net} (list price {list})", { net: price(data.unitPrice), list: price(list) }) });
    }
    if (data.total != null && data.unitPrice != null && data.quantity != null) {
      const goods = data.quantity * data.unitPrice;
      const all = goods + (data.freight ?? 0) + (data.otherCosts ?? 0);
      if (!amountsMatch(goods, data.total) && !amountsMatch(all, data.total)) {
        issues.push({
          code: "total_mismatch",
          severity: "review",
          field: "total",
          ...say("Quantity × price is {computed} but the file says {total}", { computed: round2(goods).toLocaleString("it-IT"), total: data.total.toLocaleString("it-IT") }),
        });
      }
    }

    const currencyText = text("currency");
    if (currencyText) {
      data.currency = normalizeCurrency(currencyText);
      if (!data.currency || !isKnownCurrency(data.currency)) {
        issues.push({ code: "currency_unknown", severity: "blocking", field: "currency", ...say('Unknown currency "{value}"', { value: currencyText }) });
        data.currency = null;
      }
    } else {
      data.currency =
        currencyInText(typeof priceCell === "string" ? priceCell : null) ??
        currencyInText(text("total")) ??
        options.defaultCurrency;
    }
    data.fxRate = data.currency === "EUR" ? 1 : null;

    // Terms
    const payText = cell("payment_terms");
    if (payText != null && cellText(payText) !== "") {
      data.paymentTermsDays = parsePaymentTerms(typeof payText === "number" ? payText : cellText(payText));
      if (data.paymentTermsDays == null) {
        issues.push({ code: "terms_not_understood", severity: "info", field: "paymentTermsDays", ...say('Payment terms "{value}" kept as written in the file', { value: cellText(payText) }) });
        data.notes = [data.notes, `Payment: ${cellText(payText)}`].filter(Boolean).join(" · ");
      }
    }
    const leadCell = cell("lead_time");
    if (leadCell != null && cellText(leadCell) !== "") data.leadTimeDays = parseLeadTime(typeof leadCell === "number" ? leadCell : cellText(leadCell));
    data.incoterm = parseIncoterm(text("incoterm"));

    // Not purchases: set aside with the reason (the user can bring them back).
    if (isCreditNote(data.documentType)) {
      issues.push({ code: "excluded", severity: "info", excludes: true, ...say("Credit note: it corrects an earlier invoice and is not a purchase") });
    } else if (options.recordType === "purchase" && data.total === 0 && !blocked("total")) {
      issues.push({ code: "excluded", severity: "info", excludes: true, ...say("Line with no amount: nothing was bought") });
    }

    const raw: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      const v = cellText(row[i]);
      if (v) raw[h] = v;
    });

    const extracted: ExtractedData = { ...data, parseIssues: issues };
    items.push({ line: table.headerRowIndex + idx + 2, raw, extracted, confidence: null });
  });

  return { items, skippedRows };
}

export type { DateOrder };
