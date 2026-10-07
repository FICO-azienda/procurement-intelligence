/**
 * Italian electronic invoices (FatturaPA: the XML that travels through SdI).
 *
 * Unlike a PDF, nothing is interpreted here: supplier, VAT number, invoice
 * number, date and every line come from their own field, exactly as the
 * supplier's software wrote them. What the format leaves out (the quantity of
 * a lump-sum line, a unit the app doesn't know) stays empty and is asked.
 *
 * Lines that are not purchases are not turned into purchases: notes without
 * amounts are skipped, transport and accessory charges are spread over the
 * goods (and said), discounts written apart are pointed out, credit notes are
 * left out.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { countryFromIso } from "../../countries";
import { say, type Msg } from "../../i18n";
import { isKnownCurrency, normalizeCurrency } from "../normalize/currency";
import { amountsMatch, round2 } from "../normalize/numbers";
import { companyKey, tidy, vatKey } from "../normalize/text";
import { normalizeUnit } from "../normalize/units";
import { EMPTY_ITEM, type DraftItem, type Issue, type ItemData } from "../types";
import type { OwnCompany } from "./document";
import { ImportError } from "./tabular";

export interface EInvoiceParty {
  name: string | null;
  /** With its country code, as written: "IT01234567890". */
  vat: string | null;
  taxCode: string | null;
  /** English country name when the code is known, else the code. */
  country: string | null;
}

/** "SC" discount · "PR" premium · "AB" rebate · "AC" accessory charge (transport, packing…). */
type LineKind = "SC" | "PR" | "AB" | "AC";

export interface EInvoiceLine {
  number: number | null;
  kind: LineKind | null;
  description: string | null;
  /** The supplier's own article code, when the line has one. */
  code: string | null;
  /** Barcode (EAN / GTIN), when the line has one. */
  ean: string | null;
  quantity: number | null;
  /** As written in the file ("KG", "PZ", "NR"). */
  unit: string | null;
  /** List price, before the discounts written on the line. */
  unitPrice: number | null;
  total: number | null;
  /** Discounts and surcharges on the line, as written: "SC 10.00%". */
  adjustments: string[];
  /** The line's fields as they are in the file. */
  raw: Record<string, string>;
  /** Values that could not be read as numbers. */
  issues: Issue[];
}

export interface EInvoice {
  /** TD01 invoice · TD04 credit note · TD24 deferred invoice… */
  type: string | null;
  number: string | null;
  date: string | null;
  currency: string | null;
  /** The currency as written, when it is not one the app knows. */
  currencyRaw: string | null;
  total: number | null;
  paymentTermsDays: number | null;
  /** A discount or surcharge on the whole document, as written: "SC 3.00%". */
  adjustments: string[];
  lines: EInvoiceLine[];
}

export interface EInvoiceFile {
  supplier: EInvoiceParty;
  customer: EInvoiceParty;
  invoices: EInvoice[];
}

/** Read as ordinary purchase invoices. Anything else is either left out (credit notes) or flagged. */
const ORDINARY = new Set(["TD01", "TD02", "TD03", "TD06", "TD24", "TD25"]);
const CREDIT_NOTES = new Set(["TD04", "TD08"]);

const NOT_AN_INVOICE: Msg = "This XML file is not an electronic invoice.";
const DAMAGED: Msg = "We couldn't read this XML file. It may be damaged.";

const REPEATED = new Set(["FatturaElettronicaBody", "DettaglioLinee", "CodiceArticolo", "ScontoMaggiorazione", "DatiPagamento", "DettaglioPagamento"]);
const PARSER = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Values stay text: numbers and dates are read here, by the rules of the format.
  parseTagValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => REPEATED.has(name),
});

// ---------------- Reading the XML ----------------

type Node = Record<string, unknown>;
const node = (v: unknown): Node | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : null);
const nodes = (v: unknown): Node[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(node).filter((x): x is Node => !!x);
const text = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? tidy(String(v)) || null : null);
const child = (n: Node | null, ...path: string[]): Node | null => path.reduce<Node | null>((x, key) => node(x?.[key]), n);

function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const head = String.fromCharCode(...bytes.subarray(0, 200));
  const declared = /<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1].toLowerCase();
  if (declared && declared !== "utf-8" && declared !== "utf8") {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      // An encoding name we don't know: read it as below.
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The format writes numbers one way only: digits, a point for decimals, no separators. */
const DECIMAL = /^[-+]?\d+(?:\.\d+)?$/;
function isoDate(raw: string | null): string | null {
  const m = raw ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}

function party(n: Node | null): EInvoiceParty {
  const data = child(n, "DatiAnagrafici");
  const id = child(data, "IdFiscaleIVA");
  const names = child(data, "Anagrafica");
  const code = text(id?.IdCodice);
  return {
    name: text(names?.Denominazione) ?? ([text(names?.Nome), text(names?.Cognome)].filter(Boolean).join(" ") || null),
    vat: code ? `${text(id?.IdPaese) ?? ""}${code}` : null,
    taxCode: text(data?.CodiceFiscale),
    country: countryFromIso(text(child(n, "Sede")?.Nazione)),
  };
}

/** "SC 10.00%" / "MG 5.00" — a discount (SC) or surcharge (MG), as a percentage or an amount. */
const adjustments = (n: Node | null): string[] =>
  nodes(n?.ScontoMaggiorazione).map((a) => [text(a.Tipo), text(a.Percentuale) ? `${text(a.Percentuale)}%` : text(a.Importo)].filter(Boolean).join(" "));

/** Codes that classify the goods (barcode, customs) or belong to the buyer: not the supplier's article code. */
const NOT_SUPPLIER_CODE = /^(ean|gtin|taric|cpv|ssc|carb|hs|nc|intrastat|aic)|cli|cust|buyer|acquirente|committente/i;

function readLine(n: Node): EInvoiceLine {
  const issues: Issue[] = [];
  const raw: Record<string, string> = {};
  const number = (field: string, label: Msg, key: keyof ItemData): number | null => {
    const value = text(n[field]);
    if (value == null) return null;
    raw[field] = value;
    if (DECIMAL.test(value)) return Number(value);
    issues.push({ code: "invalid_number", severity: "blocking", field: key, ...say('{~label}: "{value}" is not a valid number', { label, value }) });
    return null;
  };
  const codes = nodes(n.CodiceArticolo).map((c) => ({ type: text(c.CodiceTipo) ?? "", value: text(c.CodiceValore) }));
  if (codes.length) raw.CodiceArticolo = codes.map((c) => [c.type, c.value].filter(Boolean).join(" ")).join(" · ");
  const description = text(n.Descrizione);
  if (description) raw.Descrizione = description;
  const quantity = number("Quantita", "Quantity", "quantity");
  const unit = text(n.UnitaMisura);
  if (unit) raw.UnitaMisura = unit;
  const unitPrice = number("PrezzoUnitario", "Unit price", "unitPrice");
  const discounts = adjustments(n);
  if (discounts.length) raw.ScontoMaggiorazione = discounts.join(" · ");
  const total = number("PrezzoTotale", "Total", "total");
  const kind = text(n.TipoCessionePrestazione);
  if (kind) raw.TipoCessionePrestazione = kind;
  const line = text(n.NumeroLinea);
  return {
    number: line && /^\d+$/.test(line) ? Number(line) : null,
    kind: kind === "SC" || kind === "PR" || kind === "AB" || kind === "AC" ? kind : null,
    description,
    code: codes.find((c) => c.value && !NOT_SUPPLIER_CODE.test(c.type))?.value ?? null,
    ean: codes.find((c) => c.value && /^(ean|gtin)/i.test(c.type))?.value ?? null,
    quantity,
    unit,
    unitPrice,
    total,
    adjustments: discounts,
    raw,
    issues,
  };
}

/**
 * Days between the invoice and when it is due. Only when there is one payment:
 * several instalments are not a single number.
 */
function paymentTerms(body: Node, date: string | null): number | null {
  const blocks = nodes(body.DatiPagamento);
  const payments = blocks.flatMap((b) => nodes(b.DettaglioPagamento));
  if (payments.length !== 1) return null;
  const due = isoDate(text(payments[0].DataScadenzaPagamento));
  if (due && date) {
    const days = Math.round((Date.parse(due) - Date.parse(date)) / 86_400_000);
    return days <= 0 ? 0 : days <= 365 ? days : null;
  }
  const days = text(payments[0].GiorniTerminiPagamento);
  if (days && /^\d{1,3}$/.test(days) && Number(days) <= 365) return Number(days);
  // "TP03": paid in advance.
  return text(blocks[0]?.CondizioniPagamento) === "TP03" ? 0 : null;
}

/** The invoice(s) in an electronic invoice file. Throws `ImportError` when the file is not one. */
export function readEInvoice(bytes: Uint8Array): EInvoiceFile {
  const xml = decodeXml(bytes);
  // The format has no DOCTYPE; a file that declares one is something else.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ImportError(NOT_AN_INVOICE);
  let tree: Node | null;
  try {
    if (XMLValidator.validate(xml) !== true) throw new Error("not well-formed");
    tree = node(PARSER.parse(xml));
  } catch {
    throw new ImportError(DAMAGED);
  }
  if (node(tree?.FatturaElettronicaSemplificata)) {
    throw new ImportError("This is a simplified electronic invoice: it has no quantities or unit prices, so there is nothing to import. Add the purchase by hand.");
  }
  const root = node(tree?.FatturaElettronica);
  const header = child(root, "FatturaElettronicaHeader");
  const bodies = nodes(root?.FatturaElettronicaBody);
  if (!header || !bodies.length) throw new ImportError(NOT_AN_INVOICE);

  return {
    supplier: party(child(header, "CedentePrestatore")),
    customer: party(child(header, "CessionarioCommittente")),
    invoices: bodies.map((body) => {
      const general = child(body, "DatiGenerali", "DatiGeneraliDocumento");
      const date = isoDate(text(general?.Data));
      const currencyRaw = text(general?.Divisa);
      const currency = normalizeCurrency(currencyRaw);
      const total = text(general?.ImportoTotaleDocumento);
      return {
        type: text(general?.TipoDocumento),
        number: text(general?.Numero),
        date,
        currency: currency && isKnownCurrency(currency) ? currency : null,
        currencyRaw,
        total: total && DECIMAL.test(total) ? Number(total) : null,
        paymentTermsDays: paymentTerms(body, date),
        adjustments: adjustments(general),
        lines: nodes(child(body, "DatiBeniServizi")?.DettaglioLinee).map(readLine),
      };
    }),
  };
}

/**
 * True when the seller on the invoice is the company using the app: a sale,
 * not a purchase. Decided on the VAT number when ours is known, on the exact
 * name otherwise — never on a name that only resembles ours.
 */
export function issuedByUs(file: EInvoiceFile, own: OwnCompany): boolean {
  const vats = new Set(own.vats.map(vatKey).filter(Boolean));
  const seller = file.supplier;
  if (vats.size && (seller.vat || seller.taxCode)) return [seller.vat, seller.taxCode].some((v) => !!v && vats.has(vatKey(v)));
  const name = companyKey(seller.name);
  return !!name && own.names.some((n) => companyKey(n) === name);
}

// ---------------- Lines → items ----------------

const FREIGHT = /^(?:(?:addebito|contributo|rimborso|recupero)\s+)?(?:spese\s+(?:di\s+)?)?(?:trasporto|spedizione|nolo)\b|^(?:freight|shipping|carriage)\b/i;
const amount = (n: number) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const price = (n: number) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export interface EInvoiceItems {
  items: DraftItem[];
  /** Transport charged on the invoices that were read. */
  freight: number;
  /** Lines with no amounts: notes, references to orders and delivery notes. */
  notes: number;
  /** The invoices that were read (credit notes are not). */
  read: EInvoice[];
}

/** Electronic invoice → draft items, one per line of goods. Throws `ImportError` when the file holds only credit notes. */
export function eInvoiceToItems(file: EInvoiceFile): EInvoiceItems {
  const read = file.invoices.filter((inv) => !CREDIT_NOTES.has(inv.type ?? ""));
  const creditNotes = file.invoices.filter((inv) => CREDIT_NOTES.has(inv.type ?? ""));
  if (!read.length) throw new ImportError("This is a credit note: it corrects an earlier invoice and is not a purchase, so it is not imported.");

  const out: EInvoiceItems = { items: [], freight: 0, notes: 0, read };
  // The line number printed on the invoice, unless a file with several invoices repeats it.
  const numbers = read.flatMap((inv) => inv.lines.map((l) => l.number));
  const ownNumbers = numbers.every((n) => n != null) && new Set(numbers).size === numbers.length;
  let running = 0;

  for (const inv of read) {
    const zero = (n: number | null) => n == null || n === 0;
    const withAmounts = inv.lines.filter((l) => l.issues.length > 0 || !(zero(l.quantity) && zero(l.unitPrice) && zero(l.total)));
    out.notes += inv.lines.length - withAmounts.length;

    const isReduction = (l: EInvoiceLine) => l.kind === "SC" || l.kind === "PR" || l.kind === "AB" || (l.quantity == null && (l.total ?? 0) < 0);
    const isFreight = (l: EInvoiceLine) => !isReduction(l) && FREIGHT.test(l.description ?? "") && (l.kind === "AC" || l.quantity == null || l.quantity === 1);
    const isAccessory = (l: EInvoiceLine) => !isReduction(l) && l.kind === "AC" && !isFreight(l);
    const goods = withAmounts.filter((l) => !isReduction(l) && !isFreight(l) && !isAccessory(l));
    const goodsTotal = goods.reduce((s, l) => s + (l.total ?? 0), 0);
    // An invoice that is all transport or charges (a carrier's): its lines are what was bought.
    const spread = goods.length > 0 && goodsTotal > 0;
    const lines = spread ? goods : withAmounts.filter((l) => !isReduction(l));
    const sum = (pick: (l: EInvoiceLine) => boolean) => (spread ? withAmounts.filter(pick).reduce((s, l) => s + (l.total ?? 0), 0) : 0);
    const freight = sum(isFreight);
    const other = sum(isAccessory);
    const reductions = withAmounts.filter(isReduction).reduce((s, l) => s + (l.total ?? 0), 0);
    out.freight += freight;

    for (const l of lines) {
      const issues: Issue[] = [...l.issues];
      const data: ItemData = { ...EMPTY_ITEM };
      data.date = inv.date;
      data.supplierName = file.supplier.name;
      data.supplierVat = file.supplier.vat ?? file.supplier.taxCode;
      data.supplierTaxCode = file.supplier.taxCode ?? null;
      data.supplierCountry = file.supplier.country;
      data.productName = l.description;
      data.supplierSku = l.code;
      data.ean = l.ean;
      data.invoiceLine = l.number;
      data.documentType = inv.type;
      data.invoiceReference = inv.number;
      data.paymentTermsDays = inv.paymentTermsDays;
      data.quantity = l.quantity;
      data.total = l.total;
      data.unitPrice = l.unitPrice;

      if (l.unit) {
        data.unit = normalizeUnit(l.unit);
        if (!data.unit) {
          data.unitRaw = l.unit;
          issues.push({ code: "unit_unknown", severity: "blocking", field: "unit", ...say('Unknown unit "{value}" — choose the unit', { value: l.unit }) });
        }
      }

      data.currency = inv.currency;
      if (!inv.currency && inv.currencyRaw) issues.push({ code: "currency_unknown", severity: "blocking", field: "currency", ...say('Unknown currency "{value}"', { value: inv.currencyRaw }) });
      data.fxRate = data.currency === "EUR" ? 1 : null;

      if (l.quantity != null && l.quantity > 0 && l.total != null && l.unitPrice != null) {
        if (l.adjustments.length) {
          // The line total is after its discounts: what one unit really cost is total ÷ quantity.
          data.unitPrice = Math.round((l.total / l.quantity) * 1e6) / 1e6;
          if (data.unitPrice !== l.unitPrice) {
            issues.push({
              code: "unit_price_derived",
              severity: "info",
              field: "unitPrice",
              ...say("Unit price after the discount on the line: {net} (list price {list})", { net: price(data.unitPrice), list: price(l.unitPrice) }),
            });
          }
        } else if (!amountsMatch(l.quantity * l.unitPrice, l.total)) {
          issues.push({
            code: "total_mismatch",
            severity: "review",
            field: "total",
            ...say("Quantity × price is {computed} but the file says {total}", { computed: round2(l.quantity * l.unitPrice).toLocaleString("it-IT"), total: l.total.toLocaleString("it-IT") }),
          });
        }
      }
      if ((data.unitPrice ?? 0) < 0 || (l.total ?? 0) < 0) {
        issues.push({
          code: "invalid_number",
          severity: "blocking",
          field: "unitPrice",
          ...say("This line has a negative amount ({total}): it looks like a return or a correction, not a purchase", { total: amount(l.total ?? data.unitPrice ?? 0) }),
        });
      }

      const share = spread ? (l.total ?? 0) / goodsTotal : 0;
      if (freight > 0) {
        data.freight = round2(freight * share);
        if (lines.length > 1) issues.push({ code: "freight_allocated", severity: "info", field: "freight", ...say("Invoice freight {amount} split across lines by value", { amount: amount(freight) }) });
      }
      if (other > 0) {
        data.otherCosts = round2(other * share);
        issues.push({ code: "other_costs_allocated", severity: "info", field: "otherCosts", ...say("Other charges on the invoice ({amount}) added to the lines by value", { amount: amount(other) }) });
      }
      if (reductions !== 0) {
        issues.push({ code: "discount_not_applied", severity: "review", ...say("Discounts written on separate lines of this invoice ({amount}) are not included in the line prices", { amount: amount(reductions) }) });
      }
      if (inv.adjustments.length) {
        issues.push({
          code: "discount_not_applied",
          severity: "review",
          ...say("A discount or surcharge on the whole invoice ({value}) is not included in the line prices", { value: inv.adjustments.join(", ") }),
        });
      }
      if (inv.type && !ORDINARY.has(inv.type)) {
        issues.push({ code: "document_type", severity: "review", ...say("Document type {code}: not an ordinary invoice — check that these lines are purchases before importing", { code: inv.type }) });
      }
      if (creditNotes.length) {
        issues.push({ code: "document_type", severity: "info", ...say("Credit notes in this file were left out: {numbers}", { numbers: creditNotes.map((c) => c.number ?? "—").join(", ") }) });
      }

      running++;
      out.items.push({ line: ownNumbers && l.number != null ? l.number : running, raw: l.raw, extracted: { ...data, parseIssues: issues }, confidence: null });
    }
  }
  return out;
}
