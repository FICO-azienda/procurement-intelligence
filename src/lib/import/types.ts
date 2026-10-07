/** Shared types of the import pipeline. */
import type { Params } from "../i18n";

export type RecordType = "purchase" | "quote";

/** Normalized content of one extracted line (purchase or quote). */
export interface ItemData {
  date: string | null;
  supplierName: string | null;
  supplierCountry: string | null;
  supplierVat: string | null;
  /** Tax code or company registration number, when the document gives one besides the VAT number. */
  supplierTaxCode?: string | null;
  productName: string | null;
  sku: string | null;
  supplierSku: string | null;
  description: string | null;
  category: string | null;
  quantity: number | null;
  /** Canonical unit (see normalize/units.ts); null if absent or unrecognised. */
  unit: string | null;
  /** Unit text as written, when it was not recognised. */
  unitRaw: string | null;
  unitPrice: number | null;
  currency: string | null;
  /** EUR per 1 unit of currency. 1 for EUR; null = not known (no guessing). */
  fxRate: number | null;
  freight: number | null;
  otherCosts: number | null;
  total: number | null;
  invoiceReference: string | null;
  paymentTermsDays: number | null;
  incoterm: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  validUntil: string | null;
  notes: string | null;
  /** Barcode (EAN / GTIN) of the product, when the file has one. Absent on lines read before this field existed. */
  ean?: string | null;
  /** What kind of document the line comes from, as written ("TD01", "TD04", "Credit note"). */
  documentType?: string | null;
  /** The line's number on the invoice: tells two equal lines of one invoice from the same line read twice. */
  invoiceLine?: number | null;
}

export const EMPTY_ITEM: ItemData = {
  date: null,
  supplierName: null,
  supplierCountry: null,
  supplierVat: null,
  productName: null,
  sku: null,
  supplierSku: null,
  description: null,
  category: null,
  quantity: null,
  unit: null,
  unitRaw: null,
  unitPrice: null,
  currency: null,
  fxRate: null,
  freight: null,
  otherCosts: null,
  total: null,
  invoiceReference: null,
  paymentTermsDays: null,
  incoterm: null,
  moq: null,
  leadTimeDays: null,
  validUntil: null,
  notes: null,
  ean: null,
  documentType: null,
  invoiceLine: null,
};

/** As stored in import_items.extracted: data + problems found while reading. */
export type ExtractedData = ItemData & { parseIssues: Issue[] };
/** As stored in import_items.data: current values + fields the user corrected. */
export type CurrentData = ItemData & { corrected: (keyof ItemData)[] };

/**
 * blocking → the line cannot be imported until fixed
 * review   → the line can be imported once the user confirms it looks right
 * info     → shown for transparency, never blocks
 */
export type Severity = "blocking" | "review" | "info";

export type IssueCode =
  | "missing_field"
  | "invalid_number"
  | "invalid_date"
  | "number_format_uncertain"
  | "date_format_uncertain"
  | "total_mismatch"
  | "unit_price_derived"
  | "unit_unknown"
  | "unit_assumed"
  | "unit_converted"
  | "unit_changed"
  | "currency_missing"
  | "currency_unknown"
  | "currency_changed"
  | "fx_missing"
  | "supplier_unmatched"
  | "supplier_probable"
  | "product_unmatched"
  | "product_probable"
  | "new_supplier"
  | "new_supplier_for_product"
  | "duplicate"
  | "duplicate_in_file"
  | "price_increase"
  | "price_decrease"
  | "price_vs_median"
  | "price_vs_quote"
  | "quantity_high"
  | "low_confidence"
  | "freight_allocated"
  | "other_costs_allocated"
  | "discount_not_applied"
  | "document_type"
  | "quantity_assumed"
  | "excluded"
  | "terms_not_understood";

export interface Issue {
  code: IssueCode;
  severity: Severity;
  /** Plain English. Shown through `said()`, which uses `msg` + `params` to say it in the reader's language. */
  message: string;
  msg?: string;
  params?: Params;
  field?: keyof ItemData;
  /**
   * The line is not a purchase (a credit note, a line with no amount): it is
   * set aside on its own, with this reason. The user can bring it back.
   */
  excludes?: boolean;
  /** Only for price increases above the high threshold. */
  priority?: "high";
  data?: Record<string, number | string | null>;
}

/** A line produced by an extractor, before matching and evaluation. */
export interface DraftItem {
  line: number;
  raw: Record<string, string>;
  extracted: ExtractedData;
  /** 0–1 for PDF extraction; null for values read from their own field (spreadsheet cells, electronic invoices). */
  confidence: number | null;
}
