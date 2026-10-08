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
  type AnyPgColumn,
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
import type { Said } from "../lib/i18n";
import type { EstimateSnapshot } from "../lib/negotiation/history";
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
  /** Tax code or company registration number, when a document gives one besides the VAT number. */
  taxCode: text("tax_code"),
  /**
   * The supplier this record is read as, once the two were recognised as the
   * same company (lib/suppliers/resolve.ts). The record stays as it is — its
   * name, its purchases, its quotes — so the merge can be taken back by
   * clearing this. Null: the record stands for itself.
   */
  mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => suppliers.id, { onDelete: "set null" }),
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

/**
 * A family of products: the same thing in several sizes, colours or types
 * ("Trecciolino" → TG 1204, TG 1206, ST 18/08). The products are its variants;
 * every variant keeps its own purchases, prices and suppliers.
 */
export const productFamilies = pgTable("product_families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category"),
  subcategory: text("subcategory"),
  /**
   * What tells its products apart, when the user said they are versions of one product: size, colour, material, grade,
   * capacity, other (lib/catalog/macro.ts). Null: a family the mapper proposed and nobody was asked about.
   */
  variantBy: text("variant_by"),
  ...timestamps,
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: text("sku").notNull().unique(),
  /** The name people read. What the documents wrote is kept in product_aliases. */
  name: text("name").notNull(),
  description: text("description"),
  /** Category and subcategory, as text: the Product Mapper proposes them (lib/catalog/taxonomy.ts), the company can write its own. */
  category: text("category"),
  subcategory: text("subcategory"),
  familyId: uuid("family_id").references(() => productFamilies.id, { onDelete: "set null" }),
  /** What tells this product from the others of its family: "TG 1204", "LC TR". */
  variant: text("variant"),
  /** When the user confirmed what the product is. Null: its name and category are still what the import wrote. */
  mappedAt: timestamp("mapped_at", { withTimezone: true }),
  /**
   * What it is for the company's spend (lib/catalog/kinds.ts): a material, a
   * component, packaging — the catalogue Procurement Intelligence works on —
   * or transport, a service, a utility, an office purchase: spend that counts
   * in the totals but is not compared and negotiated as a product.
   */
  kind: text("kind").notNull().default("needs_review"),
  /** Unit of measure used for prices and quantities (kg, pcs, l, m…). */
  unit: text("unit").notNull(),
  technicalSpecifications: text("technical_specifications"),
  /** Structured specifications (name → value), compared against supplier offers. */
  specs: jsonb("specs").$type<Record<string, string>>(),
  currentSupplierId: uuid("current_supplier_id").references(() => suppliers.id, {
    onDelete: "set null",
  }),
  /** HS/CN customs code, for trade statistics. Not confirmed: a suggestion nobody has checked yet. */
  customsCode: text("customs_code"),
  customsCodeConfirmed: boolean("customs_code_confirmed").notNull().default(false),
  /** How to research it (lib/research/strategy.ts), when the user says otherwise than the rules. */
  researchClass: text("research_class"),
  /** What the product is called to someone who is not the current supplier: no supplier name, no supplier code. Written or confirmed by the user. */
  rfqName: text("rfq_name"),
  /** What it is used for, as told to a supplier asked to quote it. */
  application: text("application"),
  /** One of the products of the live pilot: the first real round of requests. */
  inPilot: boolean("in_pilot").notNull().default(false),
  /**
   * Set when the user said this product is the same as another: it stays on file with everything it had that could not
   * move, and is no longer listed. Clearing it (with the merge's log) takes the merge back.
   */
  mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => products.id, { onDelete: "set null" }),
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
    /** The line's number on the invoice: two equal lines of one invoice are two purchases, the same line read twice is one. */
    invoiceLine: integer("invoice_line"),
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

/**
 * How suppliers write a product: every description found on a document, kept
 * as written and linked to the product it means. A product has many; the next
 * import recognises them by themselves.
 */
export const productAliases = pgTable(
  "product_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** The description exactly as written on the document. */
    alias: text("alias").notNull(),
    /** Normalized form used for lookups (see lib/import/normalize/text.ts). One per supplier. */
    normalized: text("normalized").notNull(),
    /** Who writes it this way. */
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** The supplier's article code and the barcode found with this description. */
    supplierSku: text("supplier_sku"),
    ean: text("ean"),
    /** How sure the link was when it was proposed: high | medium | low. */
    confidence: text("confidence"),
    /** False while the link is only the system's proposal. */
    confirmedByUser: boolean("confirmed_by_user").notNull().default(true),
    /** The import in which the description was first found. */
    sourceSessionId: uuid("source_session_id").references(() => importSessions.id, { onDelete: "set null" }),
    source: text("source").notNull().default("import"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_aliases_normalized_idx").on(t.normalized), index("product_aliases_product_idx").on(t.productId)],
);

/** Two products that look alike and that the user said are not the same one: not asked again. */
/**
 * A merge of two products, kept so that it can be taken back: which rows were moved under the product that stays
 * (purchases, quotes, descriptions, candidates, benchmarks…), table by table, and the name it had before.
 */
export const productMerges = pgTable(
  "product_merges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The product that stays. */
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** The product read as the other one from now on. */
    mergedId: uuid("merged_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Rows moved from the merged product to the one that stays: table name → row ids. */
    moved: jsonb("moved").$type<Record<string, string[]>>().notNull(),
    /** The name of the product that stays, before and after the merge: restored on undo if nobody changed it since. */
    nameBefore: text("name_before").notNull(),
    nameAfter: text("name_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("product_merges_product_idx").on(t.productId)],
);

export const productSeparations = pgTable(
  "product_separations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productA: uuid("product_a")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    productB: uuid("product_b")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("product_separations_pair_idx").on(t.productA, t.productB)],
);

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

// ---------------- Sourcing: alternative suppliers and market evidence ----------------

/**
 * A company that may sell a comparable product: found by a discovery provider
 * or added by the user, always with the page where it was seen. It is not a
 * supplier yet: it becomes one (`supplierId`) when a quote is recorded. A
 * price here is what the supplier or a marketplace publishes — never an offer.
 */
export const supplierCandidates = pgTable(
  "supplier_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    country: text("country"),
    website: text("website"),
    /** Who found it: a provider's key, or "manual". */
    source: text("source").notNull().default("manual"),
    /** How trustworthy the source is (lib/sourcing/types.ts: SOURCE_LEVELS). */
    sourceLevel: text("source_level").notNull().default("external"),
    sourceUrl: text("source_url"),
    sourceDate: date("source_date"),
    productMatched: text("product_matched"),
    matchReason: text("match_reason"),
    /** high | partial | not; null until someone checks the specification. */
    technicalCompatibility: text("technical_compatibility"),
    specifications: jsonb("specifications").$type<Record<string, string>>(),
    priceLow: money("price_low"),
    priceHigh: money("price_high"),
    priceType: text("price_type"),
    priceSourceUrl: text("price_source_url"),
    currency: text("currency"),
    unit: text("unit"),
    incoterm: text("incoterm"),
    moq: qty("moq"),
    leadTimeDays: integer("lead_time_days"),
    paymentTerms: text("payment_terms"),
    certifications: text("certifications"),
    shippingOrigin: text("shipping_origin"),
    confidence: text("confidence"),
    notes: text("notes"),
    status: text("status").notNull().default("discovered"),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** manufacturer | distributor | wholesaler; null: the source does not say. */
    companyType: text("company_type"),
    /** The title of the page it was found on. */
    sourceTitle: text("source_title"),
    /** When the research found it (the source's own date is `sourceDate`). */
    discoveredAt: date("discovered_at"),
    /** What its own page confirms of the product's specification, and what it does not (lib/research/inspect.ts). */
    specCheck: jsonb("spec_check").$type<{ url: string; checkedAt: string; email?: string | null; product: string[]; confirmed: string[]; missing: string[] }>(),
    ...timestamps,
  },
  (t) => [index("supplier_candidates_product_idx").on(t.productId)],
);

/**
 * An external reference for a product's price — a published benchmark, trade
 * statistics, the movement of a cost driver — with its source and date.
 * Written by a provider or typed by the user from a report they have.
 */
export const marketBenchmarks = pgTable(
  "market_benchmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** direct_benchmark | trade_benchmark | cost_driver | estimate */
    type: text("type").notNull(),
    label: text("label").notNull(),
    /** Per product unit, in `currency`. */
    low: money("low"),
    high: money("high"),
    unit: text("unit"),
    currency: text("currency").notNull().default("EUR"),
    /** Units of `currency` for one EUR on `fxDate`, from an exchange-rate provider. Null with a foreign currency: not converted, shown as written. */
    fxRate: numeric("fx_rate", { precision: 16, scale: 6 }),
    fxDate: date("fx_date"),
    /** The month the reference is about ("2026-09"), when it is an average of a period: its exchange rate is then the average of that month. */
    periodMonth: text("period_month"),
    /** How the rate was taken: "day" (the reference rate of fxDate) or "month_average". */
    fxMethod: text("fx_method"),
    /** Cost drivers: the movement, in %, over `period`. */
    changePct: real("change_pct"),
    period: text("period"),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url"),
    sourceDate: date("source_date"),
    sourceLevel: text("source_level").notNull().default("external"),
    comparability: text("comparability").notNull().default("partial"),
    notes: text("notes"),
    provider: text("provider").notNull().default("manual"),
    ...timestamps,
  },
  (t) => [index("market_benchmarks_product_idx").on(t.productId)],
);

/**
 * A request for quotation the user says they sent: to which company, for
 * which products, when. Nothing is sent by the app — this is the memory that
 * keeps a supplier from being written to twice for the same thing, and that
 * tells when an answer is overdue.
 */
export const rfqRequests = pgTable(
  "rfq_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The company, by its normalised name: one supplier is one outreach, whatever the number of products. */
    supplierKey: text("supplier_key").notNull(),
    supplierName: text("supplier_name").notNull(),
    candidateIds: jsonb("candidate_ids").$type<string[]>().notNull(),
    productIds: jsonb("product_ids").$type<string[]>().notNull(),
    /** request | update (products added to an earlier request) | follow_up */
    kind: text("kind").notNull().default("request"),
    sentAt: date("sent_at").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rfq_requests_supplier_idx").on(t.supplierKey)],
);

/** A document kept with a product — its technical data sheet above all — to attach to a request for quotation. */
export const productDocuments = pgTable(
  "product_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** technical_datasheet | supplier_quote | specification | certificate | image | other */
    type: text("type").notNull().default("technical_datasheet"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_documents_product_idx").on(t.productId)],
);

/**
 * Procurement product dataset: what a person confirmed or wrote about a
 * product, field by field, with when and from what. Most values live in their
 * own place (the neutral name and specification on the product, payment terms
 * on the supplier, minimum order and lead time on the supplier's link to the
 * product) and the row here only keeps the provenance; fields with no other
 * place (delivery basis, freight, quality notes, a confirmed volume) keep
 * their value here. What the software computes is never stored: an estimate
 * is copied in `estimate` only when someone confirms or corrects it, so the
 * original figure and its method stay readable.
 */
export const productDataFields = pgTable(
  "product_data_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** A key of lib/dataset/fields.ts — or a judgement a person corrected for the negotiation estimate (lib/negotiation/engine.ts: JUDGEMENT_KEYS), with its reason in `note` and the software's own estimate in `estimate`. */
    field: text("field").notNull(),
    /** The value, for fields kept here. Null: the value lives in its own column. */
    value: text("value"),
    /** user (typed or confirmed in the app) | document (read from a document the user pointed to). */
    source: text("source").notNull().default("user"),
    /** The document it comes from, when there is one. */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    note: text("note"),
    /** What the software had estimated when the user confirmed or corrected it: { value, method, source }. */
    estimate: jsonb("estimate").$type<{ value: string; method: string | null; source: string | null }>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("product_data_fields_product_field_idx").on(t.productId, t.field)],
);

/**
 * What a quote does not say but its true cost needs: transport, duty, other
 * import costs — as the user knows or estimates them, each with where the
 * figure comes from. Inputs only: the true cost itself is computed
 * (lib/sourcing/true-cost.ts), never stored.
 */
export const trueCostScenarios = pgTable("true_cost_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .unique()
    .references(() => quotes.id, { onDelete: "cascade" }),
  /** EUR per product unit. Null: not known. */
  freightPerUnit: money("freight_per_unit"),
  /** quote | manual | estimate */
  freightBasis: text("freight_basis"),
  dutyRatePct: real("duty_rate_pct"),
  dutyBasis: text("duty_basis"),
  /** Other import and customs costs, EUR per product unit. */
  customsPerUnit: money("customs_per_unit"),
  otherPerUnit: money("other_per_unit"),
  notes: text("notes"),
  ...timestamps,
});

// ---------------- Supplier entity resolution ----------------

/**
 * What was decided about two supplier records that may be the same company:
 * merged (by a strong identifier, or by the user) or kept separate. It is the
 * history of the merges — a merge taken back keeps its row, with the date —
 * and the memory of the pairs not to propose again. The records themselves
 * are never deleted or rewritten: a merge is `suppliers.merged_into_id`.
 */
export const supplierResolutions = pgTable(
  "supplier_resolutions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The record merged (or one of the two kept separate). */
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    /** The record it was merged into (or the other of the two). */
    otherId: uuid("other_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    /** merged | separate */
    decision: text("decision").notNull(),
    /** What the match rested on: vat, tax_code, domain, name, alias, similar_name, phone, city. */
    basis: jsonb("basis").$type<string[]>().notNull().default([]),
    /** high | medium | low */
    confidence: text("confidence"),
    /** auto (a strong identifier) | user */
    decidedBy: text("decided_by").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When a merge was taken back. */
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("supplier_resolutions_supplier_idx").on(t.supplierId), index("supplier_resolutions_other_idx").on(t.otherId)],
);

// ---------------- Negotiation intelligence ----------------

/**
 * The history of the achievable price range of a product: what the software
 * estimated, each time its answer changed (lib/negotiation/history.ts). The
 * estimate itself is never read from here — it is worked out fresh from the
 * evidence on file; a row only records what was said then, so the estimate
 * can be seen firming up as quotes and references come in.
 *
 * A row rests on the buyer's own purchase prices: it is private to the
 * account that owns them (`data_class`, lib/negotiation/data-class.ts) and is
 * never a price to show about a supplier to anyone else.
 */
export const negotiationEstimates = pgTable(
  "negotiation_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** range | no_upside | not_enough_data */
    status: text("status").notNull(),
    /** What kind of price fact a row is: always a model estimate, built on private prices. */
    dataClass: text("data_class").notNull().default("model_estimate"),
    /** EUR per product unit, at the precision the estimate was given. */
    currentPrice: money("current_price"),
    low: money("low"),
    high: money("high"),
    target: money("target"),
    /** low | medium | high */
    confidence: text("confidence"),
    /** low | medium | high | very_high */
    strength: text("strength").notNull(),
    /** The visible answer as one string: a new row is written only when it changes. */
    signature: text("signature").notNull(),
    /** Upside, scores, the evidence used with its class, the factors corrected, and what changed. */
    snapshot: jsonb("snapshot").$type<EstimateSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("negotiation_estimates_product_idx").on(t.productId, t.createdAt)],
);

// ---------------- Deep research ----------------

/**
 * One research on a product: what was looked for, how far it went, what it
 * concluded. Runs are kept: the history says when each thing was learned.
 * A run never changes a purchase, a price or a supplier.
 */
export const researchRuns = pgTable(
  "research_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** running | completed | partial | failed */
    status: text("status").notNull().default("running"),
    /** standard | imported (research done outside the app and loaded with its sources). */
    depth: text("depth").notNull().default("standard"),
    /** commodity | standard | custom | private_label | service | other */
    productClass: text("product_class"),
    sourcesChecked: integer("sources_checked").notNull().default(0),
    resultsFound: integer("results_found").notNull().default(0),
    confidence: text("confidence"),
    /** The conclusion in plain words: stored messages (say()), shown in the reader's language. */
    summary: jsonb("summary").$type<Said[]>(),
    /** What each step did. */
    steps: jsonb("steps").$type<{ key: string; status: string; count?: number; note?: Said }[]>(),
    queries: jsonb("queries").$type<{ query: string; results: number; cached: boolean }[]>(),
    errors: jsonb("errors").$type<{ step: string; message: string }[]>(),
  },
  (t) => [index("research_runs_product_idx").on(t.productId)],
);

/** One thing a research found, with where and when: every conclusion leads back to rows here. */
export const researchEvidence = pgTable(
  "research_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").references(() => supplierCandidates.id, { onDelete: "set null" }),
    /** supplier | product | price | specification | benchmark | trade | freight | tariff | fx | other */
    type: text("type").notNull(),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: date("published_at"),
    /** What was found, as a stored message. */
    finding: jsonb("finding").$type<Said>().notNull(),
    /** The words of the source the finding rests on. */
    excerpt: text("excerpt"),
    /** Source level (lib/sourcing/types.ts: SOURCE_LEVELS). */
    reliability: text("reliability").notNull().default("external"),
    comparability: text("comparability"),
    confidence: text("confidence"),
  },
  (t) => [index("research_evidence_product_idx").on(t.productId), index("research_evidence_run_idx").on(t.runId)],
);

/** What an external source answered, kept until it expires: the same search or page is not paid for twice. */
export const researchCache = pgTable("research_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  /** search | page | fx | trade */
  kind: text("kind").notNull(),
  request: text("request").notNull(),
  response: jsonb("response").$type<unknown>(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Every call to an external source, answered from the cache or not, with what it is estimated to cost. */
export const researchUsage = pgTable(
  "research_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    calls: integer("calls").notNull().default(0),
    cached: integer("cached").notNull().default(0),
    /** EUR. Null: the provider's price per call is not known. */
    estimatedCost: numeric("estimated_cost", { precision: 12, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("research_usage_created_idx").on(t.createdAt)],
);

// ---------------- Company settings ----------------

/**
 * Who is using the app: one row. Not purchasing data — "Clear all data"
 * leaves it alone, so the company does not have to introduce itself twice.
 * The base currency is not here: every calculation is in EUR for now.
 */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  companyName: text("company_name"),
  country: text("country"),
  /** Our own VAT number: on invoices it identifies the customer, never the supplier. */
  vatNumber: text("vat_number"),
  /** Who is at the keyboard — only used to say good morning. */
  userName: text("user_name"),
  /** What money costs the company, % a year: values a difference in payment terms. Null: the default in SOURCING_CONFIG. */
  financingRatePct: real("financing_rate_pct"),
  /** What holding stock costs, % of its value a year: values a minimum order larger than the usual one. */
  holdingRatePct: real("holding_rate_pct"),
  /** Language of the interface: "en" or "it". */
  language: text("language").notNull().default("en"),
  ...timestamps,
});

export type Supplier = typeof suppliers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductFamily = typeof productFamilies.$inferSelect;
export type PurchaseRecord = typeof purchases.$inferSelect;
export type QuoteRecord = typeof quotes.$inferSelect;
export type ImportSession = typeof importSessions.$inferSelect;
export type ImportItemRecord = typeof importItems.$inferSelect;
export type DocumentRecord = typeof documents.$inferSelect;
