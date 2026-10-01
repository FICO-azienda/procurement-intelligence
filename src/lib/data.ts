/**
 * Read layer: loads rows from the database and hands plain, typed data to
 * src/lib/analytics.ts. An SME has thousands of purchases, not millions, so
 * loading the dataset per request keeps the code simple. When that stops being
 * true, push the aggregations into SQL behind these same functions.
 */
import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";
import { getDb, type DB } from "@/db";
import {
  importItems,
  importSessions,
  opportunities,
  productAliases,
  products,
  purchases,
  quotes,
  supplierAliases,
  supplierProducts,
  suppliers,
} from "@/db/schema";
import { todayISO, type Dataset, type SourceDoc } from "./analytics";
import { analyze, type Intel, type OpportunityState } from "./intel/engine";

const num = (v: string) => Number(v);
const numOrNull = (v: string | null) => (v == null ? null : Number(v));

function sourceDoc(r: { sessionId: string | null; documentId: string | null; filename: string | null; importedAt: Date | null }): SourceDoc | null {
  return r.sessionId && r.filename
    ? { sessionId: r.sessionId, documentId: r.documentId, filename: r.filename, importedAt: (r.importedAt ?? new Date()).toISOString() }
    : null;
}

const sourceCols = {
  sessionId: importSessions.id,
  documentId: importSessions.documentId,
  filename: importSessions.filename,
  importedAt: importSessions.completedAt,
};

/** Everything the analytics need, from any database handle (also used in tests). */
export async function readDataset(db: DB): Promise<Dataset> {
  const [s, p, pu, q] = await Promise.all([
    db.select().from(suppliers).orderBy(suppliers.name),
    db.select().from(products).orderBy(products.name),
    db
      .select({ row: purchases, ...sourceCols })
      .from(purchases)
      .leftJoin(importItems, eq(purchases.importItemId, importItems.id))
      .leftJoin(importSessions, eq(importItems.sessionId, importSessions.id))
      .orderBy(purchases.date, purchases.createdAt),
    db
      .select({ row: quotes, ...sourceCols })
      .from(quotes)
      .leftJoin(importItems, eq(quotes.importItemId, importItems.id))
      .leftJoin(importSessions, eq(importItems.sessionId, importSessions.id))
      .orderBy(quotes.date, quotes.createdAt),
  ]);

  return {
    suppliers: s.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      city: r.city,
      vatNumber: r.vatNumber,
      contactName: r.contactName,
      email: r.email,
      phone: r.phone,
      website: r.website,
      currency: r.currency,
      paymentTermsDays: r.paymentTermsDays,
      defaultLeadTimeDays: r.defaultLeadTimeDays,
      notes: r.notes,
    })),
    products: p.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      description: r.description,
      category: r.category,
      unit: r.unit,
      technicalSpecifications: r.technicalSpecifications,
      specs: r.specs ?? null,
      currentSupplierId: r.currentSupplierId,
    })),
    purchases: pu.map(({ row: r, ...src }) => ({
      id: r.id,
      productId: r.productId,
      supplierId: r.supplierId,
      date: r.date,
      quantity: num(r.quantity),
      unit: r.unit,
      unitPrice: num(r.unitPrice),
      currency: r.currency,
      fxRate: numOrNull(r.fxRate),
      freightCost: num(r.freightCost),
      otherCosts: num(r.otherCosts),
      totalAmount: num(r.totalAmount),
      invoiceReference: r.invoiceReference,
      paymentTermsDays: r.paymentTermsDays,
      incoterm: r.incoterm,
      originalDescription: r.originalDescription,
      source: r.source,
      sourceDoc: sourceDoc(src),
      priceReview: r.priceReview,
      notes: r.notes,
    })),
    quotes: q.map(({ row: r, ...src }) => ({
      id: r.id,
      productId: r.productId,
      supplierId: r.supplierId,
      date: r.date,
      quantity: numOrNull(r.quantity),
      unitPrice: num(r.unitPrice),
      currency: r.currency,
      fxRate: numOrNull(r.fxRate),
      moq: numOrNull(r.moq),
      leadTimeDays: r.leadTimeDays,
      paymentTermsDays: r.paymentTermsDays,
      incoterm: r.incoterm,
      freightCost: numOrNull(r.freightCost),
      validUntil: r.validUntil,
      originalDescription: r.originalDescription,
      source: r.source,
      sourceDoc: sourceDoc(src),
      notes: r.notes,
    })),
  };
}

/** Aliases and supplier codes: what the system has learned from confirmations. */
export async function readLearning(db: DB) {
  const [pa, sa, sp] = await Promise.all([
    db.select().from(productAliases).orderBy(productAliases.createdAt),
    db.select().from(supplierAliases).orderBy(supplierAliases.createdAt),
    db.select().from(supplierProducts),
  ]);
  return {
    productAliases: pa.map((a) => ({ id: a.id, productId: a.productId, alias: a.alias, normalized: a.normalized, supplierId: a.supplierId })),
    supplierAliases: sa.map((a) => ({ id: a.id, supplierId: a.supplierId, alias: a.alias, normalized: a.normalized })),
    supplierProducts: sp.map((l) => ({
      id: l.id,
      supplierId: l.supplierId,
      productId: l.productId,
      supplierSku: l.supplierSku,
      supplierProductName: l.supplierProductName,
      moq: numOrNull(l.moq),
      leadTimeDays: l.leadTimeDays,
      specs: l.specs ?? null,
      comparabilityOverride: l.comparabilityOverride,
      comparabilityNote: l.comparabilityNote,
    })),
  };
}
export type Learning = Awaited<ReturnType<typeof readLearning>>;

export const getDataset = cache(async (): Promise<Dataset> => {
  await connection(); // always read fresh data at request time
  return readDataset(await getDb());
});

export const getLearning = cache(async (): Promise<Learning> => {
  await connection();
  return readLearning(await getDb());
});

/** What the user decided about opportunities (status, note, snapshot). */
export async function readOpportunityStates(db: DB): Promise<OpportunityState[]> {
  const rows = await db.select().from(opportunities);
  return rows.map((r) => ({ key: r.key, status: r.status, note: r.note, snapshot: r.snapshot, updatedAt: r.updatedAt.toISOString() }));
}

export const getOpportunityStates = cache(async () => {
  await connection();
  return readOpportunityStates(await getDb());
});

/** The whole intelligence picture, computed once per request. */
export const getIntel = cache(async (): Promise<Intel> => {
  const [data, learning, states] = await Promise.all([getDataset(), getLearning(), getOpportunityStates()]);
  return analyze(data, learning.supplierProducts, states, todayISO());
});
