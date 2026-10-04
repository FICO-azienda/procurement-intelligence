/**
 * Standard import fields and automatic column mapping.
 * Add a header spelling to `synonyms` to teach the mapper a new file layout.
 */
import type { Msg } from "../i18n";
import { parseNumber } from "../parse";
import { isKnownCurrency, normalizeCurrency } from "./normalize/currency";
import { parseDate } from "./normalize/dates";
import { companyKey, normalizeKey, productKey } from "./normalize/text";
import { normalizeUnit } from "./normalize/units";

export const FIELD_KEYS = [
  "purchase_date",
  "supplier_name",
  "supplier_country",
  "supplier_vat",
  "product_name",
  "sku",
  "supplier_sku",
  "description",
  "category",
  "quantity",
  "unit",
  "unit_price",
  "currency",
  "freight",
  "other_costs",
  "total",
  "invoice_reference",
  "payment_terms",
  "incoterm",
  "moq",
  "lead_time",
  "valid_until",
  "notes",
  "discount",
  "document_type",
  "invoice_line",
  "ean",
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export interface FieldDef {
  key: FieldKey;
  label: Msg;
  synonyms: string[];
  /** Only meaningful for quotes. */
  quoteOnly?: boolean;
}

export const FIELDS: FieldDef[] = [
  { key: "purchase_date", label: "Date", synonyms: ["date", "data", "invoice date", "data fattura", "data documento", "data doc", "document date", "purchase date", "order date", "data ordine", "data acquisto", "quote date", "data offerta", "data registrazione", "datum", "fecha"] },
  { key: "supplier_name", label: "Supplier", synonyms: ["supplier", "fornitore", "vendor", "seller", "ragione sociale", "nome fornitore", "supplier name", "vendor name", "venditore", "ditta", "denominazione fornitore", "fornitore ragione sociale", "lieferant"] },
  { key: "supplier_country", label: "Supplier country", synonyms: ["country", "paese", "nazione", "supplier country", "paese fornitore", "nazione fornitore", "stato"] },
  { key: "supplier_vat", label: "Supplier VAT number", synonyms: ["vat", "p iva", "partita iva", "piva", "vat number", "vat no", "vat id", "tax id", "supplier vat", "supplier vat number", "p iva fornitore", "partita iva fornitore", "codice fiscale"] },
  { key: "product_name", label: "Product", synonyms: ["product", "prodotto", "articolo", "item", "item name", "product name", "nome prodotto", "nome articolo", "materiale", "material", "denominazione", "denominazione articolo", "merce"] },
  { key: "sku", label: "Internal code (SKU)", synonyms: ["sku", "codice", "codice articolo", "cod art", "cod articolo", "item code", "product code", "code", "cod", "codice interno", "internal code", "our code", "nostro codice"] },
  { key: "supplier_sku", label: "Supplier's product code", synonyms: ["supplier sku", "codice fornitore", "cod fornitore", "codice articolo fornitore", "vendor code", "vendor item code", "supplier code", "supplier item code", "part number", "part no", "rif fornitore", "vostro codice", "your code", "manufacturer code"] },
  { key: "description", label: "Description", synonyms: ["description", "descrizione", "descrizione articolo", "descrizione prodotto", "item description", "product description", "desc", "dettaglio", "details", "descrizione merce"] },
  { key: "category", label: "Category", synonyms: ["category", "categoria", "famiglia", "gruppo", "group", "family", "classe", "tipologia", "product category"] },
  { key: "quantity", label: "Quantity", synonyms: ["quantity", "qty", "quantita", "q ta", "qta", "qt", "qte", "quantita fatturata", "q ty", "qty ordered", "quantity ordered", "pezzi", "menge", "cantidad"] },
  { key: "unit", label: "Unit", synonyms: ["unit", "um", "u m", "unita", "unita di misura", "uom", "unit of measure", "misura", "units", "unit measure"] },
  { key: "unit_price", label: "Unit price", synonyms: ["unit price", "price", "prezzo", "prezzo unitario", "prezzo unit", "pr unit", "prezzo netto", "prezzo netto unitario", "net unit price", "prezzo unitario netto", "costo unitario", "unit cost", "price per unit", "net price", "importo unitario", "prezzo listino", "preis", "precio"] },
  { key: "currency", label: "Currency", synonyms: ["currency", "valuta", "divisa", "curr", "ccy", "cur", "moneta"] },
  { key: "freight", label: "Freight", synonyms: ["freight", "trasporto", "spese trasporto", "spese di trasporto", "shipping", "spedizione", "spese spedizione", "nolo", "delivery cost", "carriage"] },
  { key: "other_costs", label: "Other costs", synonyms: ["other costs", "altri costi", "spese accessorie", "oneri", "surcharge", "supplemento", "extra costs", "dogana", "customs", "duties"] },
  { key: "total", label: "Line total", synonyms: ["total", "totale", "importo", "amount", "line total", "totale riga", "imponibile", "valore", "net amount", "importo totale", "prezzo totale", "total price", "totale imponibile", "importo netto", "line amount", "value"] },
  { key: "invoice_reference", label: "Invoice / reference", synonyms: ["invoice", "invoice reference", "invoice number", "invoice no", "invoice nr", "fattura", "numero fattura", "n fattura", "nr fattura", "num fattura", "fattura n", "documento", "numero documento", "n doc", "num doc", "nr doc", "rif", "riferimento", "reference", "doc no", "document number", "protocollo", "ddt", "ref"] },
  { key: "payment_terms", label: "Payment terms", synonyms: ["payment terms", "pagamento", "condizioni di pagamento", "termini pagamento", "termini di pagamento", "payment", "modalita pagamento", "cond pagamento"] },
  { key: "incoterm", label: "Incoterm", synonyms: ["incoterm", "incoterms", "resa", "porto", "delivery terms", "termini di resa"] },
  { key: "moq", label: "MOQ", synonyms: ["moq", "minimum order", "minimo ordine", "minimo d ordine", "lotto minimo", "min order qty", "minimum order quantity", "quantita minima", "min qty"] },
  { key: "lead_time", label: "Lead time", synonyms: ["lead time", "tempi di consegna", "tempo di consegna", "consegna", "delivery time", "lead time days", "giorni consegna", "delivery"] },
  { key: "valid_until", label: "Valid until", synonyms: ["valid until", "validita", "valida fino", "valido fino", "scadenza offerta", "expiry", "expires", "expiry date", "valid to"], quoteOnly: true },
  { key: "notes", label: "Notes", synonyms: ["notes", "note", "remarks", "osservazioni", "commenti", "comment", "comments", "annotazioni"] },
  // A discount explains why quantity × list price is not the line total; it is never added to the costs.
  { key: "discount", label: "Discount", synonyms: ["discount", "sconto", "sconti", "sconto maggiorazione", "discount surcharge", "sconto riga", "line discount", "sc mg"] },
  { key: "document_type", label: "Document type", synonyms: ["document type", "tipo documento", "tipo doc", "doc type", "tipodocumento", "tipo fattura"] },
  { key: "invoice_line", label: "Invoice line number", synonyms: ["line number", "line no", "numero linea", "numero riga", "n riga", "nr riga", "riga", "invoice line", "numerolinea", "line"] },
  { key: "ean", label: "Barcode (EAN)", synonyms: ["ean", "ean13", "barcode", "gtin", "codice a barre", "codice ean"] },
];

export const FIELD_LABEL: Record<FieldKey, Msg> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, Msg>;

/** file column header → field (null = ignore the column). */
export type ColumnMapping = Record<string, FieldKey | null>;

function headerScore(header: string, synonyms: string[]): number {
  const h = normalizeKey(header);
  if (!h) return 0;
  let best = 0;
  for (const s of synonyms) {
    if (h === s) return 1;
    // Whole-word containment ("Data fattura emissione" contains "data fattura").
    if (` ${h} `.includes(` ${s} `)) best = Math.max(best, 0.5 + 0.4 * (s.length / h.length));
  }
  return best;
}

/**
 * Proposes a mapping from headers (and sample values, to recognise date
 * columns with unusual names). Each field is used at most once.
 */
export function proposeMapping(headers: string[], sampleRows: unknown[][] = []): ColumnMapping {
  const scores: { header: string; field: FieldKey; score: number }[] = [];
  for (const header of headers) {
    for (const f of FIELDS) {
      const score = headerScore(header, f.synonyms);
      if (score > 0) scores.push({ header, field: f.key, score });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const mapping: ColumnMapping = Object.fromEntries(headers.map((h) => [h, null]));
  const usedFields = new Set<FieldKey>();
  for (const s of scores) {
    if (mapping[s.header] || usedFields.has(s.field)) continue;
    mapping[s.header] = s.field;
    usedFields.add(s.field);
  }

  // A date column with an unexpected name: ≥ 80% of samples are dates.
  if (!usedFields.has("purchase_date")) {
    headers.forEach((h, i) => {
      if (mapping[h] || usedFields.has("purchase_date")) return;
      const values = sampleRows.map((r) => r[i]).filter((v) => v != null && v !== "");
      if (values.length && values.filter((v) => parseDate(v as string)).length / values.length >= 0.8) {
        mapping[h] = "purchase_date";
        usedFields.add("purchase_date");
      }
    });
  }
  return mapping;
}

/** Fields required to create a record. */
export function missingRequired(mapping: ColumnMapping, recordType: "purchase" | "quote"): Msg[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const missing: Msg[] = [];
  if (!mapped.has("purchase_date")) missing.push("Date");
  if (!mapped.has("supplier_name") && !mapped.has("supplier_vat")) missing.push("Supplier");
  if (!mapped.has("product_name") && !mapped.has("sku") && !mapped.has("supplier_sku") && !mapped.has("description")) missing.push("Product or description");
  if (!mapped.has("unit_price") && !(mapped.has("total") && mapped.has("quantity"))) missing.push("Unit price");
  if (recordType === "purchase" && !mapped.has("quantity")) missing.push("Quantity");
  return missing;
}

// ---------------- Columns without names ----------------

/** Names the importer already knows, to tell a supplier column from a product column. */
export interface KnownNames {
  suppliers: string[];
  products: string[];
}

const asText = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const asNumber = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /\d/.test(v) && !/[a-zà-ù]/i.test(v.replace(/eur|usd|gbp/gi, "")) ? parseNumber(v) : null);
const share = (values: unknown[], test: (v: unknown) => boolean) => (values.length ? values.filter(test).length / values.length : 0);
const median = (ns: number[]) => [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)];

/**
 * Completes a mapping by looking at the values, for columns the headers did
 * not explain — rows pasted from a spreadsheet usually have no header at all.
 * A proposal for the user to check on the mapping screen, never applied
 * silently: what a number means (quantity or price) is a judgement.
 */
export function inferByContent(headers: string[], rows: unknown[][], mapping: ColumnMapping, known: KnownNames = { suppliers: [], products: [] }): ColumnMapping {
  const out: ColumnMapping = { ...mapping };
  const used = new Set<FieldKey>(Object.values(out).filter((f): f is FieldKey => !!f));
  const sample = rows.slice(0, 50);
  const column = (i: number) => sample.map((r) => r[i]).filter((v) => v != null && asText(v) !== "");
  const free = () => headers.map((h, i) => ({ h, i, values: column(i) })).filter((c) => !out[c.h] && c.values.length > 0);
  const assign = (h: string, field: FieldKey) => {
    if (used.has(field) || out[h]) return false;
    out[h] = field;
    used.add(field);
    return true;
  };

  for (const c of free()) if (share(c.values, (v) => v instanceof Date || (typeof v === "string" && parseDate(v) != null)) >= 0.8) assign(c.h, "purchase_date");
  for (const c of free()) if (share(c.values, (v) => typeof v === "string" && normalizeUnit(v) != null) >= 0.8) assign(c.h, "unit");
  for (const c of free()) if (share(c.values, (v) => typeof v === "string" && isKnownCurrency(normalizeCurrency(v))) >= 0.8) assign(c.h, "currency");

  // ---- Numbers: total = quantity × price when three columns agree; otherwise whole numbers are quantities.
  const numeric = free()
    .filter((c) => share(c.values, (v) => asNumber(v) != null) >= 0.8)
    .map((c) => ({ ...c, at: (r: unknown[]) => asNumber(r[c.i]) }));
  const wholeShare = (c: (typeof numeric)[number]) => share(c.values, (v) => Number.isInteger(asNumber(v)));
  const med = (c: (typeof numeric)[number]) => median(c.values.map((v) => asNumber(v) ?? 0));
  let pair = numeric;
  if (numeric.length >= 3) {
    for (const k of numeric) {
      const others = numeric.filter((c) => c !== k);
      const found = others.flatMap((a, x) => others.slice(x + 1).map((b) => [a, b] as const)).find(([a, b]) =>
        share(sample, (r) => {
          const [x, y, z] = [a.at(r as unknown[]), b.at(r as unknown[]), k.at(r as unknown[])];
          return x != null && y != null && z != null && Math.abs(x * y - z) <= Math.max(0.02, Math.abs(z) * 0.005);
        }) >= 0.8,
      );
      if (found) {
        assign(k.h, "total");
        pair = [...found];
        break;
      }
    }
  }
  if (pair.length >= 2) {
    const [a, b] = pair;
    const aIsQuantity = wholeShare(a) !== wholeShare(b) ? wholeShare(a) > wholeShare(b) : med(a) >= med(b);
    assign((aIsQuantity ? a : b).h, "quantity");
    assign((aIsQuantity ? b : a).h, "unit_price");
  }

  // ---- Text: names we already know decide; otherwise supplier comes before product, as people write it.
  const texts = free().filter((c) => share(c.values, (v) => asNumber(v) == null) >= 0.8);
  const suppliers = new Set(known.suppliers.map((n) => companyKey(n)).filter(Boolean));
  const products = new Set(known.products.map((n) => productKey(n)).filter(Boolean));
  const hits = (c: (typeof texts)[number], names: Set<string>, key: (s: string) => string) => {
    const distinct = [...new Set(c.values.map((v) => key(asText(v))))].filter(Boolean);
    return distinct.length ? distinct.filter((v) => names.has(v) || [...names].some((n) => n.includes(v) || v.includes(n))).length / distinct.length : 0;
  };
  const best = (names: Set<string>, key: (s: string) => string) => {
    const scored = texts.filter((c) => !out[c.h]).map((c) => ({ c, score: hits(c, names, key) })).sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].c : null;
  };
  const supplierColumn = !used.has("supplier_name") ? best(suppliers, companyKey) : null;
  if (supplierColumn) assign(supplierColumn.h, "supplier_name");
  const productColumn = !used.has("product_name") ? best(products, productKey) : null;
  if (productColumn) assign(productColumn.h, "product_name");
  for (const c of texts) {
    if (out[c.h]) continue;
    if (!used.has("supplier_name") && texts.filter((t) => !out[t.h]).length > 1) assign(c.h, "supplier_name");
    else if (!used.has("product_name")) assign(c.h, "product_name");
  }
  return out;
}

/**
 * True when every column a record needs was recognised from an exact, known
 * header name — the mapping screen can then be skipped (and reopened later).
 */
export function isConfidentMapping(mapping: ColumnMapping, recordType: "purchase" | "quote"): boolean {
  if (missingRequired(mapping, recordType).length) return false;
  const needed: FieldKey[] = ["purchase_date", "supplier_name", "supplier_vat", "product_name", "sku", "supplier_sku", "description", "quantity", "unit_price", "total"];
  return Object.entries(mapping).every(([header, field]) => {
    if (!field || !needed.includes(field)) return true;
    return headerScore(header, FIELDS.find((f) => f.key === field)!.synonyms) === 1;
  });
}
