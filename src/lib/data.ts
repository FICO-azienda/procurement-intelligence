/**
 * Read layer: loads rows from the database and hands plain, typed data to
 * src/lib/analytics.ts. An SME has thousands of purchases, not millions, so
 * loading the dataset per request keeps the code simple. When that stops being
 * true, push the aggregations into SQL behind these same functions.
 */
import { eq } from "drizzle-orm";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getDb, type DB } from "@/db";
import {
  importItems,
  importSessions,
  opportunities,
  productAliases,
  productFamilies,
  productSeparations,
  products,
  purchases,
  quotes,
  settings,
  supplierAliases,
  supplierProducts,
  suppliers,
} from "@/db/schema";
import { supplierMetrics, todayISO, type Dataset, type SourceDoc } from "./analytics";
import { COMPANY_NAME, OWN_COMPANY_NAMES, OWN_VAT_NUMBERS } from "./config";
import { DEFAULT_LOCALE, en, isLocale, translator, type Locale, type T } from "./i18n";
import { purchasingOverview, type PurchasingOverview } from "./intel/decision";
import { analyze, type Intel, type OpportunityState } from "./intel/engine";
import { mapCatalogue, toMapInput, type MapAnalysis } from "./catalog/mapper";
import { catalogueOf, companySpend, type CompanySpend } from "./catalog/spend";
import { canonicalIds } from "./suppliers/resolve";

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

  // Supplier records recognised as the same company are read as one (lib/suppliers/resolve.ts): the merged record
  // keeps its rows, and everything that hangs on it is counted under the record it points to.
  const canon = canonicalIds(s);
  const one = (id: string) => canon.get(id) ?? id;
  const members = (id: string) => s.filter((r) => canon.get(r.id) === id);
  return {
    suppliers: s
      .filter((r) => canon.get(r.id) === r.id)
      .map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      city: r.city,
      // What a merged record knew of the company, the company knows.
      vatNumber: r.vatNumber ?? members(r.id).map((m) => m.vatNumber).find(Boolean) ?? null,
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
      kind: r.kind,
      subcategory: r.subcategory,
      familyId: r.familyId,
      variant: r.variant,
      mapped: r.mappedAt != null,
      unit: r.unit,
      technicalSpecifications: r.technicalSpecifications,
      specs: r.specs ?? null,
      currentSupplierId: r.currentSupplierId ? one(r.currentSupplierId) : null,
    })),
    purchases: pu.map(({ row: r, ...src }) => ({
      id: r.id,
      productId: r.productId,
      supplierId: one(r.supplierId),
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
      invoiceLine: r.invoiceLine,
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
      supplierId: one(r.supplierId),
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
  const [pa, sa, sp, rows] = await Promise.all([
    db.select().from(productAliases).orderBy(productAliases.createdAt),
    db.select().from(supplierAliases).orderBy(supplierAliases.createdAt),
    db.select().from(supplierProducts),
    db.select({ id: suppliers.id, mergedIntoId: suppliers.mergedIntoId }).from(suppliers),
  ]);
  // What was learned about a merged supplier record belongs to the company it is read as.
  const canon = canonicalIds(rows);
  const one = <V extends string | null>(id: V) => (id ? (canon.get(id) ?? id) : id) as V;
  // One link per company and product: the company's own record first, then what a merged one knew.
  const links = [...sp].sort((a, b) => Number(canon.get(b.supplierId) === b.supplierId) - Number(canon.get(a.supplierId) === a.supplierId));
  const linked = new Set<string>();
  return {
    productAliases: pa.map((a) => ({
      id: a.id,
      productId: a.productId,
      alias: a.alias,
      normalized: a.normalized,
      supplierId: one(a.supplierId),
      supplierSku: a.supplierSku,
      ean: a.ean,
      confidence: a.confidence,
      confirmedByUser: a.confirmedByUser,
      sourceSessionId: a.sourceSessionId,
    })),
    supplierAliases: sa.map((a) => ({ id: a.id, supplierId: one(a.supplierId), alias: a.alias, normalized: a.normalized })),
    supplierProducts: links
      .filter((l) => {
        const key = `${one(l.supplierId)}|${l.productId}`;
        return linked.has(key) ? false : (linked.add(key), true);
      })
      .map((l) => ({
      id: l.id,
      supplierId: one(l.supplierId),
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

/**
 * The whole intelligence picture, computed once per request — on the
 * catalogue: the products that are compared and negotiated. Transport,
 * services and the rest of the company's spend are counted by `getSpend()`.
 */
export const getIntel = cache(async (): Promise<Intel> => {
  const [data, learning, states, t] = await Promise.all([getDataset(), getLearning(), getOpportunityStates(), getT()]);
  const catalogue = catalogueOf(data);
  const intel = analyze(catalogue, learning.supplierProducts, states, todayISO(), undefined, t);
  if (catalogue !== data) {
    // A supplier is who the company pays: its spend, dates and status count every purchase, not only the catalogue's.
    const full = new Map(data.suppliers.map((s) => [s.id, supplierMetrics(s, data, intel.asOf)]));
    const total = [...full.values()].reduce((sum, m) => sum + m.annualSpend, 0);
    for (const s of intel.suppliers) {
      const m = full.get(s.supplier.id);
      if (!m) continue;
      s.metrics = { ...s.metrics, annualSpend: m.annualSpend, purchaseCount: m.purchaseCount, firstPurchaseDate: m.firstPurchaseDate, lastPurchaseDate: m.lastPurchaseDate, status: m.status };
      s.spendShare = total > 0 ? m.annualSpend / total : 0;
    }
  }
  return intel;
});

/** The company's whole spend of the last 12 months: catalogue and everything else. */
export const getSpend = cache(async (): Promise<CompanySpend> => companySpend(await getDataset(), todayISO()));

/** Product families, by id. */
export const getFamilies = cache(async () => {
  await connection();
  const rows = await (await getDb()).select().from(productFamilies).orderBy(productFamilies.name);
  return new Map(rows.map((f) => [f.id, { id: f.id, name: f.name, category: f.category, subcategory: f.subcategory }]));
});

/** The Product Mapper's reading of the catalogue: what each product is, families, possible duplicates, what to ask. */
export const getMapAnalysis = cache(async (): Promise<MapAnalysis> => {
  const [data, learning, families, t] = await Promise.all([getDataset(), getLearning(), getFamilies(), getT()]);
  const pairs = await (await getDb()).select().from(productSeparations);
  const names = new Map([...families.values()].map((f) => [f.id, f.name]));
  return mapCatalogue(toMapInput(data, learning.productAliases, names, todayISO()), { separated: pairs.map((x) => [x.productA, x.productB]), t });
});

/** The Overview page's decision summaries: one pass over the intelligence, once per request. */
export const getOverview = cache(async (): Promise<PurchasingOverview> => purchasingOverview(await getIntel(), await getT()));

// ---------------- Company settings ----------------

export interface CompanySettings {
  companyName: string;
  country: string | null;
  vatNumber: string | null;
  userName: string | null;
  /** What money costs the company and what holding stock costs, % a year. Null: the app's starting assumptions are used. */
  financingRatePct: number | null;
  holdingRatePct: number | null;
  /** Language of the interface. */
  language: Locale;
  /** False until the company has been named in Settings (the name then comes from the app defaults). */
  configured: boolean;
}

export async function readSettings(db: DB): Promise<CompanySettings> {
  const [row] = await db.select().from(settings).limit(1);
  return {
    companyName: row?.companyName?.trim() || COMPANY_NAME,
    country: row?.country ?? null,
    vatNumber: row?.vatNumber ?? null,
    userName: row?.userName ?? null,
    financingRatePct: row?.financingRatePct ?? null,
    holdingRatePct: row?.holdingRatePct ?? null,
    language: isLocale(row?.language) ? row.language : DEFAULT_LOCALE,
    configured: !!row?.companyName?.trim(),
  };
}

/** Our own names and VAT numbers, so a document never takes us for the supplier. */
export function ownCompany(s: CompanySettings) {
  return {
    names: [...new Set([s.companyName, ...OWN_COMPANY_NAMES])],
    vats: [...new Set([...(s.vatNumber ? [s.vatNumber] : []), ...OWN_VAT_NUMBERS])],
  };
}

export const getSettings = cache(async (): Promise<CompanySettings> => {
  await connection();
  return readSettings(await getDb());
});

// ---------------- Language ----------------

/**
 * The translator for this request: the language chosen in Settings. Pages,
 * route handlers and server actions all ask here. A database that can't be
 * read must not take the words away too, so it falls back to English.
 */
export const getT = cache(async (): Promise<T> => {
  try {
    return translator((await getSettings()).language);
  } catch (err) {
    // Next's own signals (a page that must be rendered per request) are not failures.
    unstable_rethrow(err);
    console.error("[language]", err);
    return en;
  }
});
