/**
 * Data model — single source of truth for the database.
 *
 * Design rules:
 * - Purchases and quotes are the raw facts. Everything else (current price,
 *   price history, price changes, annual spend, supplier spend) is DERIVED in
 *   src/lib/analytics.ts, so editing or deleting a purchase updates every
 *   number in the app with nothing to keep in sync.
 * - Money is stored in the document currency (as on the invoice/quote) with an
 *   fx_rate to the base currency (EUR). A missing fx_rate means "not known yet":
 *   the amount stays in its original currency and is left out of EUR totals.
 * - Every fact carries a `source`; imported facts also link to the import item
 *   they came from (→ session → original document), so any number can be
 *   traced back to the file it was read from.
 * - Imports never write facts directly: files become import items, which the
 *   user reviews and approves.
 *
 * Postgres dialect: runs on local PGlite today, on Supabase/Postgres by
 * setting DATABASE_URL — same schema, same migrations (./drizzle).
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from "../lib/intel/statuses";

/** Where a record came from. Extend here when a new ingestion channel ships. */
export const SOURCES = ["manual", "csv", "excel", "invoice", "quote", "email", "erp", "demo"] as const;
export type Source = (typeof SOURCES)[number];

// numeric columns come back as strings; we convert in the query layer.
const money = (name: string) => numeric(name, { precision: 16, scale: 6 });
const qty = (name: string) => numeric(name, { precision: 16, scale: 4 });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  country: text("country"),
  city: text("city"),
  vatNumber: text("vat_number"),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  currency: text("currency").notNull().default("EUR"),
  /** Days after invoice. 0 = advance / payment on order. */
  paymentTermsDays: integer("payment_terms_days"),
  defaultLeadTimeDays: integer("default_lead_time_days"),
  notes: text("notes"),
  ...timestamps,
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  /** Unit of measure used for prices and quantities (kg, pcs, l, m…). */
  unit: text("unit").notNull(),
  technicalSpecifications: text("technical_specifications"),
  /** Structured specifications (name → value), compared against supplier offers. */
  specs: jsonb("specs").$type<Record<string, string>>(),
  currentSupplierId: uuid("current_supplier_id").references(() => suppliers.id, {
    onDelete: "set null",
  }),
  ...timestamps,
});

// ---------------- Import pipeline ----------------

/** An uploaded original file (invoice, quote, spreadsheet). */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes").notNull(),
  /** Content hash: the same file uploaded twice is the same document. */
  sha256: text("sha256").notNull().unique(),
  /** Key in the file storage (local folder or Supabase Storage). */
  storagePath: text("storage_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const IMPORT_STATUSES = ["uploaded", "processing", "needs_review", "completed", "failed"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** One upload of one file, from extraction to approval. */
export const importSessions = pgTable("import_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  /** csv | xlsx | xls | ods | pdf */
  fileType: text("file_type").notNull(),
  /** Channel written to purchases/quotes.source: csv | excel | invoice | quote */
  sourceType: text("source_type", { enum: SOURCES }).notNull(),
  /** What the rows become: purchase | quote */
  recordType: text("record_type").notNull().default("purchase"),
  status: text("status", { enum: IMPORT_STATUSES }).notNull().default("uploaded"),
  recordsDetected: integer("records_detected").notNull().default(0),
  recordsImported: integer("records_imported").notNull().default(0),
  recordsReview: integer("records_review").notNull().default(0),
  recordsRejected: integer("records_rejected").notNull().default(0),
  newSuppliers: integer("new_suppliers").notNull().default(0),
  newProducts: integer("new_products").notNull().default(0),
  /** Spreadsheets: detected headers + sample rows. PDFs: document-level fields. */
  extraction: jsonb("extraction"),
  /** Spreadsheets: file column → standard field, plus file-level defaults. */
  mapping: jsonb("mapping"),
  /** Set when the same file or invoice was imported before. */
  duplicateOfSessionId: uuid("duplicate_of_session_id"),
  /** Result shown after approval: counts, price changes, annual impact. */
  summary: jsonb("summary"),
  /** Plain-language reason when status = failed. */
  errorMessage: text("error_message"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ITEM_STATUSES = ["ready", "attention", "imported", "skipped"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * One extracted line, waiting for review. Keeps three versions of the data:
 * raw (as in the file) → extracted (normalized) → data (after user edits).
 */
export const importItems = pgTable(
  "import_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => importSessions.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    recordType: text("record_type").notNull().default("purchase"),
    raw: jsonb("raw").notNull(),
    extracted: jsonb("extracted").notNull(),
    data: jsonb("data").notNull(),
    /** Extraction confidence 0–1 (PDFs); null when read from a spreadsheet cell. */
    confidence: real("confidence"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** { status: exact|probable|none, confidence, suggestedId, reason } */
    supplierMatch: jsonb("supplier_match"),
    /** How supplierId was decided: auto | confirmed | chosen | created */
    supplierResolution: text("supplier_resolution"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productMatch: jsonb("product_match"),
    productResolution: text("product_resolution"),
    /** Problems and flags found by validation + anomaly rules. */
    issues: jsonb("issues").notNull().default([]),
    /** User confirmed the review flags ("looks right"). */
    acknowledged: boolean("acknowledged").notNull().default(false),
    /** For possible duplicates: skip | import */
    duplicateDecision: text("duplicate_decision"),
    status: text("status", { enum: ITEM_STATUSES }).notNull().default("attention"),
    ...timestamps,
  },
  (t) => [index("import_items_session_idx").on(t.sessionId), index("import_items_status_idx").on(t.status)],
);

// ---------------- Facts ----------------

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    quantity: qty("quantity").notNull(),
    unit: text("unit").notNull(),
    unitPrice: money("unit_price").notNull(),
    currency: text("currency").notNull().default("EUR"),
    /** Base-currency (EUR) per 1 unit of `currency`. 1 for EUR, null if unknown. */
    fxRate: money("fx_rate").default("1"),
    freightCost: money("freight_cost").notNull().default("0"),
    otherCosts: money("other_costs").notNull().default("0"),
    /** quantity × unit_price + freight + other costs, in document currency. */
    totalAmount: money("total_amount").notNull(),
    invoiceReference: text("invoice_reference"),
    paymentTermsDays: integer("payment_terms_days"),
    incoterm: text("incoterm"),
    /** Product text exactly as written on the source document. */
    originalDescription: text("original_description"),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    importItemId: uuid("import_item_id").references(() => importItems.id, { onDelete: "set null" }),
    /**
     * User decision on a price flagged as a possible anomaly:
     * confirmed = the price is real · excluded = leave it out of price analysis.
     */
    priceReview: text("price_review", { enum: ["confirmed", "excluded"] }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    index("purchases_product_date_idx").on(t.productId, t.date),
    index("purchases_supplier_date_idx").on(t.supplierId, t.date),
  ],
);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Quantity the price refers to, if the quote is volume-specific. */
    quantity: qty("quantity"),
    unitPrice: money("unit_price").notNull(),
    currency: text("currency").notNull().default("EUR"),
    fxRate: money("fx_rate").default("1"),
    moq: qty("moq"),
    leadTimeDays: integer("lead_time_days"),
    /** Days after invoice. 0 = advance / payment on order. */
    paymentTermsDays: integer("payment_terms_days"),
    /** EXW, FCA, FOB, DAP, DDP… — tells whether the price includes transport. */
    incoterm: text("incoterm"),
    freightCost: money("freight_cost"),
    validUntil: date("valid_until"),
    originalDescription: text("original_description"),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    importItemId: uuid("import_item_id").references(() => importItems.id, { onDelete: "set null" }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("quotes_product_idx").on(t.productId, t.date)],
);

// ---------------- Learning: aliases and supplier codes ----------------

/** Other names a product is known by. Saved when the user confirms a match. */
export const productAliases = pgTable("product_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  alias: text("alias").notNull(),
  /** Normalized form used for lookups (see lib/import/normalize/text.ts). */
  normalized: text("normalized").notNull().unique(),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  source: text("source").notNull().default("import"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Other names a supplier is known by (e.g. "ABC S.r.l." for "ABC Srl"). */
export const supplierAliases = pgTable("supplier_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id, { onDelete: "cascade" }),
  alias: text("alias").notNull(),
  normalized: text("normalized").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * How a supplier sells one of our products: their code and name, MOQ, lead
 * time. Prices are NOT stored here — they come from purchases and quotes.
 */
export const supplierProducts = pgTable(
  "supplier_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    supplierSku: text("supplier_sku"),
    supplierProductName: text("supplier_product_name"),
    moq: qty("moq"),
    leadTimeDays: integer("lead_time_days"),
    /** The supplier's version of the product specifications (name → value). */
    specs: jsonb("specs").$type<Record<string, string>>(),
    /** User decision on whether this offer can be compared with what we buy. */
    comparabilityOverride: text("comparability_override", { enum: ["comparable", "partial", "not"] }),
    comparabilityNote: text("comparability_note"),
    ...timestamps,
  },
  (t) => [uniqueIndex("supplier_products_pair_idx").on(t.supplierId, t.productId)],
);

// ---------------- Opportunities ----------------

export { OPPORTUNITY_STATUSES, type OpportunityStatus };

/**
 * Opportunities are computed by the intelligence engine (src/lib/intel), so
 * their numbers always follow the data. This table only stores what the user
 * decided about one: its status, a note, and a snapshot of the figures at
 * that moment (so a validated/rejected opportunity stays readable even when
 * the engine no longer detects it). A later landed-cost phase adds to the
 * snapshot, not to this structure.
 */
export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable identity from the engine: type:productId[:alternativeSupplierId]. */
  key: text("key").notNull().unique(),
  type: text("type").notNull(),
  productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
  alternativeSupplierId: uuid("alternative_supplier_id").references(() => suppliers.id, { onDelete: "cascade" }),
  status: text("status", { enum: OPPORTUNITY_STATUSES }).notNull().default("open"),
  note: text("note"),
  snapshot: jsonb("snapshot"),
  ...timestamps,
});

export type Supplier = typeof suppliers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type PurchaseRecord = typeof purchases.$inferSelect;
export type QuoteRecord = typeof quotes.$inferSelect;
export type ImportSession = typeof importSessions.$inferSelect;
export type ImportItemRecord = typeof importItems.$inferSelect;
export type DocumentRecord = typeof documents.$inferSelect;
