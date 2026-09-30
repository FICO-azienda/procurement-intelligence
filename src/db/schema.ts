/**
 * Data model — single source of truth for the database.
 *
 * Design rules:
 * - Purchases and quotes are the raw facts. Everything else (current price,
 *   price history, price changes, annual spend, supplier spend) is DERIVED in
 *   src/lib/analytics.ts, so editing or deleting a purchase updates every
 *   number in the app with nothing to keep in sync.
 * - Money is stored in the document currency (as on the invoice/quote) with an
 *   fx_rate to the base currency (EUR). Reports always use amount × fx_rate.
 * - Every fact carries a `source` so future importers (CSV, invoice AI, email
 *   AI, ERP sync) can be told apart and audited.
 *
 * Postgres dialect: runs on local PGlite today, on Supabase/Postgres by
 * setting DATABASE_URL — same schema, same migrations (./drizzle).
 */
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Where a record came from. Extend here when a new ingestion channel ships. */
export const SOURCES = ["manual", "csv", "invoice", "email", "erp", "demo"] as const;
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
  currentSupplierId: uuid("current_supplier_id").references(() => suppliers.id, {
    onDelete: "set null",
  }),
  ...timestamps,
});

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
    /** Base-currency (EUR) per 1 unit of `currency`. 1 for EUR. */
    fxRate: money("fx_rate").notNull().default("1"),
    freightCost: money("freight_cost").notNull().default("0"),
    otherCosts: money("other_costs").notNull().default("0"),
    /** quantity × unit_price + freight + other costs, in document currency. */
    totalAmount: money("total_amount").notNull(),
    invoiceReference: text("invoice_reference"),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
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
    fxRate: money("fx_rate").notNull().default("1"),
    moq: qty("moq"),
    leadTimeDays: integer("lead_time_days"),
    /** Days after invoice. 0 = advance / payment on order. */
    paymentTermsDays: integer("payment_terms_days"),
    /** EXW, FCA, FOB, DAP, DDP… — tells whether the price includes transport. */
    incoterm: text("incoterm"),
    validUntil: date("valid_until"),
    source: text("source", { enum: SOURCES }).notNull().default("manual"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("quotes_product_idx").on(t.productId, t.date)],
);

export type Supplier = typeof suppliers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type PurchaseRecord = typeof purchases.$inferSelect;
export type QuoteRecord = typeof quotes.$inferSelect;
