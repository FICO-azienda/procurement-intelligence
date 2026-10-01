/**
 * Standard import fields and automatic column mapping.
 * Add a header spelling to `synonyms` to teach the mapper a new file layout.
 */
import { parseDate } from "./normalize/dates";
import { normalizeKey } from "./normalize/text";

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
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export interface FieldDef {
  key: FieldKey;
  label: string;
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
  { key: "unit_price", label: "Unit price", synonyms: ["unit price", "price", "prezzo", "prezzo unitario", "prezzo unit", "pr unit", "prezzo netto", "prezzo netto unitario", "costo unitario", "unit cost", "price per unit", "net price", "importo unitario", "prezzo listino", "preis", "precio"] },
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
];

export const FIELD_LABEL: Record<FieldKey, string> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;

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
export function missingRequired(mapping: ColumnMapping, recordType: "purchase" | "quote"): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const missing: string[] = [];
  if (!mapped.has("purchase_date")) missing.push("Date");
  if (!mapped.has("supplier_name") && !mapped.has("supplier_vat")) missing.push("Supplier");
  if (!mapped.has("product_name") && !mapped.has("sku") && !mapped.has("supplier_sku") && !mapped.has("description")) missing.push("Product or description");
  if (!mapped.has("unit_price") && !(mapped.has("total") && mapped.has("quantity"))) missing.push("Unit price");
  if (recordType === "purchase" && !mapped.has("quantity")) missing.push("Quantity");
  return missing;
}
