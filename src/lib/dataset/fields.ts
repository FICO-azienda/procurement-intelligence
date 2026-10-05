/**
 * The procurement product dataset: the fields every priority product should
 * have, whatever the company makes. Each field says where its value lives,
 * who can supply it when it is missing (someone in the company, or the
 * current supplier), and whether it matters for the readiness checks.
 *
 * Nothing here knows an industry: a "grade" or a "form" is whatever the
 * company writes; fields that don't apply to a product simply stay optional.
 */
import type { Msg } from "../i18n";

export type FieldStatus = "confirmed" | "estimated" | "missing";
export type Section = "identity" | "technical" | "purchasing" | "commercial" | "quality";
export type Readiness = "ready" | "partial" | "not_ready";

/** Where a value written by a person is kept. "computed": never written, always worked out. */
export type Home = "product" | "specs" | "supplier" | "supplier_product" | "ledger" | "computed";
/** Who can tell us a missing value. */
export type Ask = "internal" | "supplier";
/** How a person writes the value. Null: it can't be typed here (it comes from documents or another page). */
export type InputKind = "text" | "longtext" | "number" | "days" | "yesno" | "incoterm";

export const FIELD_KEYS = [
  // Identity
  "neutral_name",
  "invoice_descriptions",
  "category",
  "family",
  "current_supplier",
  "supplier_code",
  "internal_code",
  // Technical
  "technical_spec",
  "material",
  "grade",
  "dimensions",
  "capacity",
  "form",
  "packaging",
  "application",
  "datasheet",
  // Purchasing
  "current_price",
  "currency",
  "unit",
  "weighted_average",
  "historical_min",
  "historical_max",
  "latest_purchase",
  "total_spend",
  "historical_volume",
  "annual_volume",
  "typical_order",
  "purchase_frequency",
  // Commercial
  "delivery_basis",
  "freight_included",
  "payment_terms",
  "moq",
  "lead_time",
  // Quality / operations
  "quality_issues",
  "returns",
  "reliability",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export const isFieldKey = (v: unknown): v is FieldKey => typeof v === "string" && (FIELD_KEYS as readonly string[]).includes(v);

export interface FieldDef {
  section: Section;
  label: Msg;
  home: Home;
  input: InputKind | null;
  /** Who to ask when it is missing. Null: it comes from the documents already on file. */
  ask: Ask | null;
  /** Counted in "what is missing" and in the readiness of its section. */
  important: boolean;
  /** For fields kept in the product's structured specifications: the key used there (an English text of the dictionary). */
  specKey?: Msg;
}

export const FIELDS: Record<FieldKey, FieldDef> = {
  neutral_name: { section: "identity", label: "Neutral product name", home: "product", input: "text", ask: "internal", important: true },
  invoice_descriptions: { section: "identity", label: "Written on the invoices as", home: "computed", input: null, ask: null, important: false },
  category: { section: "identity", label: "Category", home: "computed", input: null, ask: "internal", important: true },
  family: { section: "identity", label: "Product family", home: "computed", input: null, ask: null, important: false },
  current_supplier: { section: "identity", label: "Current supplier", home: "computed", input: null, ask: null, important: true },
  supplier_code: { section: "identity", label: "Supplier product code", home: "computed", input: null, ask: "supplier", important: false },
  internal_code: { section: "identity", label: "Internal code", home: "ledger", input: "text", ask: "internal", important: false },

  technical_spec: { section: "technical", label: "Technical specification", home: "product", input: "longtext", ask: "internal", important: true },
  material: { section: "technical", label: "Material", home: "specs", input: "text", ask: "internal", important: false, specKey: "Material" },
  grade: { section: "technical", label: "Grade", home: "specs", input: "text", ask: "internal", important: false, specKey: "Grade" },
  dimensions: { section: "technical", label: "Dimensions", home: "specs", input: "text", ask: "internal", important: false, specKey: "Dimensions" },
  capacity: { section: "technical", label: "Weight / capacity", home: "specs", input: "text", ask: "internal", important: false, specKey: "Weight / capacity" },
  form: { section: "technical", label: "Form", home: "specs", input: "text", ask: "internal", important: false, specKey: "Form" },
  packaging: { section: "technical", label: "Packaging", home: "specs", input: "text", ask: "supplier", important: false, specKey: "Packaging" },
  application: { section: "technical", label: "Application", home: "product", input: "text", ask: "internal", important: true },
  datasheet: { section: "technical", label: "Technical data sheet", home: "computed", input: null, ask: "supplier", important: true },

  current_price: { section: "purchasing", label: "Current unit price", home: "computed", input: null, ask: null, important: true },
  currency: { section: "purchasing", label: "Currency", home: "computed", input: null, ask: null, important: false },
  unit: { section: "purchasing", label: "Unit", home: "computed", input: null, ask: null, important: true },
  weighted_average: { section: "purchasing", label: "Weighted average price", home: "computed", input: null, ask: null, important: false },
  historical_min: { section: "purchasing", label: "Lowest price paid", home: "computed", input: null, ask: null, important: false },
  historical_max: { section: "purchasing", label: "Highest price paid", home: "computed", input: null, ask: null, important: false },
  latest_purchase: { section: "purchasing", label: "Latest purchase", home: "computed", input: null, ask: null, important: true },
  total_spend: { section: "purchasing", label: "Spend analysed", home: "computed", input: null, ask: null, important: false },
  historical_volume: { section: "purchasing", label: "Volume on file", home: "computed", input: null, ask: null, important: false },
  annual_volume: { section: "purchasing", label: "Annual volume", home: "ledger", input: "number", ask: "internal", important: true },
  typical_order: { section: "purchasing", label: "Typical order", home: "ledger", input: "number", ask: "internal", important: true },
  purchase_frequency: { section: "purchasing", label: "Purchase frequency", home: "ledger", input: "text", ask: "internal", important: false },

  delivery_basis: { section: "commercial", label: "Delivery basis (Incoterm)", home: "ledger", input: "incoterm", ask: "supplier", important: true },
  freight_included: { section: "commercial", label: "Freight included", home: "ledger", input: "yesno", ask: "supplier", important: true },
  payment_terms: { section: "commercial", label: "Payment terms", home: "supplier", input: "days", ask: "supplier", important: true },
  moq: { section: "commercial", label: "Minimum order", home: "supplier_product", input: "number", ask: "supplier", important: true },
  lead_time: { section: "commercial", label: "Lead time", home: "supplier_product", input: "days", ask: "supplier", important: true },

  quality_issues: { section: "quality", label: "Known quality issues", home: "ledger", input: "longtext", ask: "internal", important: false },
  returns: { section: "quality", label: "Returns and defects", home: "ledger", input: "longtext", ask: "internal", important: false },
  reliability: { section: "quality", label: "Supplier reliability notes", home: "ledger", input: "longtext", ask: "internal", important: false },
};

export const SECTION_LABEL: Record<Section, Msg> = {
  identity: "Identity",
  technical: "Technical",
  purchasing: "Purchasing",
  commercial: "Commercial",
  quality: "Quality and operations",
};

export const STATUS_LABEL: Record<FieldStatus, Msg> = { confirmed: "Confirmed", estimated: "Estimated", missing: "Missing" };
export const READINESS_WORD: Record<Readiness, Msg> = { ready: "Ready|data", partial: "Partial", not_ready: "Not ready|data" };

/** The readiness checks, apart: being able to ask a new supplier for a quote does not wait for the true cost. */
export type Dimension = "identity" | "technical" | "purchasing" | "commercial" | "sourcing" | "true_cost";
export const DIMENSIONS: Dimension[] = ["identity", "technical", "purchasing", "commercial", "sourcing", "true_cost"];
export const DIMENSION_LABEL: Record<Dimension, Msg> = {
  identity: "Identity",
  technical: "Technical",
  purchasing: "Purchasing",
  commercial: "Commercial",
  sourcing: "Sourcing|readiness",
  true_cost: "True cost",
};

/** Kinds of document kept with a product. */
export const DOCUMENT_TYPES = ["technical_datasheet", "supplier_quote", "specification", "certificate", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, Msg> = {
  technical_datasheet: "Technical data sheet",
  supplier_quote: "Current supplier quote",
  specification: "Specification",
  certificate: "Certificate",
  other: "Other|document",
};
export const isDocumentType = (v: unknown): v is DocumentType => typeof v === "string" && (DOCUMENT_TYPES as readonly string[]).includes(v);

/** Thresholds of the dataset, in one place. */
export const DATASET_CONFIG = {
  /** Below this much purchase history (days) a yearly volume is not worked out at all. */
  minDaysToAnnualize: 60,
  /** …and from at least this many purchases. */
  minPurchasesToAnnualize: 2,
  /** A purchase frequency needs this many distinct purchase dates. */
  minDatesForFrequency: 3,
  /** History this long or longer is a real year: the last 12 months are summed, not extrapolated. */
  fullYearDays: 365,
  /** How many of the largest products the first data round works on. */
  topProducts: 5,
};

/** Delivery terms under which the seller pays the transport to the buyer (as in sourcing/true-cost.ts). */
export const DELIVERED_TERMS = new Set(["DAP", "DPU", "DDP", "CPT", "CIP"]);
export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
