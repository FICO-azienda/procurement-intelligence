/**
 * The procurement product dataset on the database. Reading gathers what is
 * already on file for a product and hands it to lib/dataset/profile.ts;
 * writing puts a value where the rest of the app reads it — the neutral name
 * and specification on the product (requests, research), payment terms on
 * the supplier (true cost), minimum order and lead time on the supplier's link
 * to the product (comparison, true cost) — and keeps in product_data_fields
 * who wrote it, when, and what the software had estimated before.
 */
import { and, eq, inArray } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";
import { getDb, type DB } from "@/db";
import { documents, importItems, importSessions, productDataFields, productDocuments, productFamilies, products, purchases, quotes, supplierProducts, suppliers } from "@/db/schema";
import { todayISO, type Dataset } from "@/lib/analytics";
import { catalogueOf } from "@/lib/catalog/spend";
import { getDataset, getFamilies, getIntel, getLearning, getSettings, getT, readDataset, readLearning, readOpportunityStates, readSettings, type CompanySettings, type Learning } from "@/lib/data";
import { DATASET_CONFIG, FIELDS, INCOTERMS, isDocumentType, type FieldKey } from "@/lib/dataset/fields";
import { productProfile, type LedgerRow, type ProductDocumentRef, type ProductProfile } from "@/lib/dataset/profile";
import { en, type T } from "@/lib/i18n";
import { parseNumber } from "@/lib/import/normalize/numbers";
import { analyze, type Intel, type ProductIntel } from "@/lib/intel/engine";
import { addProductDocument } from "./sourcing";

export async function readLedger(db: DB, productIds?: string[]): Promise<Map<string, LedgerRow[]>> {
  const rows = productIds ? (productIds.length ? await db.select().from(productDataFields).where(inArray(productDataFields.productId, productIds)) : []) : await db.select().from(productDataFields);
  const out = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const list = out.get(r.productId) ?? [];
    list.push({ field: r.field, value: r.value, source: r.source, documentId: r.documentId, note: r.note, estimate: r.estimate ?? null, updatedAt: r.updatedAt.toISOString() });
    out.set(r.productId, list);
  }
  return out;
}

async function readProductDocs(db: DB, productIds: string[]): Promise<Map<string, ProductDocumentRef[]>> {
  if (!productIds.length) return new Map();
  const rows = await db
    .select({ id: productDocuments.id, productId: productDocuments.productId, documentId: documents.id, filename: documents.filename, type: productDocuments.type, createdAt: productDocuments.createdAt })
    .from(productDocuments)
    .innerJoin(documents, eq(productDocuments.documentId, documents.id))
    .where(inArray(productDocuments.productId, productIds));
  const out = new Map<string, ProductDocumentRef[]>();
  for (const r of rows) out.set(r.productId, [...(out.get(r.productId) ?? []), { id: r.id, documentId: r.documentId, filename: r.filename, type: r.type, createdAt: r.createdAt.toISOString() }]);
  return out;
}

/**
 * The priority products, in the order of the existing Pareto: the catalogue
 * products that make up the first share of the spend, largest first — the
 * same list and order as the sourcing review.
 */
export function priorityProducts(intel: Intel): ProductIntel[] {
  return intel.products.filter((p) => p.highSpend).sort((a, b) => b.metrics.annualSpend - a.metrics.annualSpend);
}

interface Context {
  intel: Intel;
  data: Dataset;
  learning: Learning;
  families: Map<string, { name: string }>;
  settings: CompanySettings;
}

async function profilesFrom(db: DB, ctx: Context, productIds: string[], t: T): Promise<Map<string, ProductProfile>> {
  const ids = productIds.filter((id) => ctx.intel.products.some((p) => p.product.id === id));
  const [ledger, docs, rows] = await Promise.all([readLedger(db, ids), readProductDocs(db, ids), ids.length ? db.select({ id: products.id, rfqName: products.rfqName, application: products.application, mappedAt: products.mappedAt }).from(products).where(inArray(products.id, ids)) : Promise.resolve([])]);
  const dates = ctx.data.purchases.map((p) => p.date).sort();
  const coverage = dates.length ? { from: dates[0], to: dates.at(-1)! } : null;
  const out = new Map<string, ProductProfile>();
  for (const id of ids) {
    const pi = ctx.intel.products.find((p) => p.product.id === id)!;
    const row = rows.find((r) => r.id === id);
    out.set(
      id,
      productProfile(
        {
          intel: pi,
          extra: { rfqName: row?.rfqName ?? null, application: row?.application ?? null, mapped: !!row?.mappedAt },
          family: pi.product.familyId ? (ctx.families.get(pi.product.familyId)?.name ?? null) : null,
          purchases: ctx.data.purchases.filter((p) => p.productId === id),
          quotes: ctx.data.quotes.filter((q) => q.productId === id),
          suppliers: ctx.data.suppliers,
          supplierLinks: ctx.learning.supplierProducts.filter((l) => l.productId === id),
          aliases: ctx.learning.productAliases.filter((a) => a.productId === id),
          documents: docs.get(id) ?? [],
          ledger: ledger.get(id) ?? [],
          company: { name: ctx.settings.companyName, country: ctx.settings.country },
          coverage,
        },
        t,
      ),
    );
  }
  return out;
}

/** For the pages: the profiles of the given products, from this request's data. */
export async function getProfiles(productIds: string[]): Promise<Map<string, ProductProfile>> {
  await connection();
  const [intel, data, learning, families, settings, t] = await Promise.all([getIntel(), getDataset(), getLearning(), getFamilies(), getSettings(), getT()]);
  return profilesFrom(await getDb(), { intel, data, learning, families, settings }, productIds, t);
}

/** The priority products with their profiles: the dataset page and the Top 5. */
export const getPriorityDataset = cache(async () => {
  const intel = await getIntel();
  const priority = priorityProducts(intel);
  const profiles = await getProfiles(priority.map((p) => p.product.id));
  const total = intel.products.reduce((s, p) => s + p.metrics.annualSpend, 0);
  return {
    total,
    rows: priority.map((p, i) => ({ rank: i + 1, top: i < DATASET_CONFIG.topProducts, intel: p, profile: profiles.get(p.product.id)! })),
  };
});

/** The same, straight from the database (tests, exports, a write that needs the estimate it replaces). */
export async function readProfiles(db: DB, productIds?: string[], t: T = en): Promise<Map<string, ProductProfile>> {
  const [data, learning, states, settings, fams] = await Promise.all([readDataset(db), readLearning(db), readOpportunityStates(db), readSettings(db), db.select().from(productFamilies)]);
  const intel = analyze(catalogueOf(data), learning.supplierProducts, states, todayISO(), undefined, t);
  const families = new Map(fams.map((x) => [x.id, { name: x.name }]));
  return profilesFrom(db, { intel, data, learning, families, settings }, productIds ?? priorityProducts(intel).map((p) => p.product.id), t);
}

export { confirmedQuantities } from "./confirmed";

// ---------------- Writing ----------------

export class DataFieldError extends Error {}

/**
 * Checks and tidies what a person typed for a field. Empty means "clear it".
 * Numbers are read the way the app writes them (1.500 = fifteen hundred,
 * 1,5 = one and a half); one that could be read two ways is refused, not guessed.
 */
export function parseFieldValue(key: FieldKey, raw: string): { value: string | null } | { error: "number" | "days" | "yesno" | "not_editable" } {
  const input = FIELDS[key].input;
  if (!input) return { error: "not_editable" };
  const s = raw.trim();
  if (!s) return { value: null };
  if (input === "number" || input === "days") {
    const n = parseNumber(s, "comma");
    if (n.value == null || n.ambiguous || n.value < 0) return { error: input };
    if (input === "days" && !Number.isInteger(n.value)) return { error: "days" };
    return { value: String(n.value) };
  }
  if (input === "yesno") {
    if (/^(y|yes|si|sì|true)$/i.test(s)) return { value: "yes" };
    if (/^(n|no|false)$/i.test(s)) return { value: "no" };
    return { error: "yesno" };
  }
  if (input === "incoterm") {
    const code = s.toUpperCase();
    return { value: INCOTERMS.includes(code) ? code : s };
  }
  return { value: s };
}

async function currentSupplierOf(db: DB, productId: string): Promise<string | null> {
  const [p] = await db.select({ current: products.currentSupplierId }).from(products).where(eq(products.id, productId));
  if (p?.current) return p.current;
  const [last] = await db.select({ supplierId: purchases.supplierId, date: purchases.date }).from(purchases).where(eq(purchases.productId, productId)).orderBy(purchases.date).then((r) => r.slice(-1));
  return last?.supplierId ?? null;
}

/** Puts the value where the app reads it. */
async function writeHome(db: DB, productId: string, key: FieldKey, value: string | null): Promise<void> {
  const def = FIELDS[key];
  const now = new Date();
  if (def.home === "product") {
    const column = key === "neutral_name" ? { rfqName: value } : key === "technical_spec" ? { technicalSpecifications: value } : { application: value };
    await db.update(products).set({ ...column, updatedAt: now }).where(eq(products.id, productId));
  } else if (def.home === "specs") {
    const [p] = await db.select({ specs: products.specs }).from(products).where(eq(products.id, productId));
    const specs = Object.fromEntries(Object.entries(p?.specs ?? {}).filter(([k]) => k.toLowerCase().replace(/\s+/g, "") !== def.specKey!.toLowerCase().replace(/\s+/g, "")));
    if (value) specs[def.specKey!] = value;
    await db.update(products).set({ specs: Object.keys(specs).length ? specs : null, updatedAt: now }).where(eq(products.id, productId));
  } else if (def.home === "supplier") {
    const supplierId = await currentSupplierOf(db, productId);
    if (!supplierId) throw new DataFieldError("no_supplier");
    await db.update(suppliers).set({ paymentTermsDays: value == null ? null : Number(value), updatedAt: now }).where(eq(suppliers.id, supplierId));
  } else if (def.home === "supplier_product") {
    const supplierId = await currentSupplierOf(db, productId);
    if (!supplierId) throw new DataFieldError("no_supplier");
    const set = key === "moq" ? { moq: value } : { leadTimeDays: value == null ? null : Number(value) };
    await db.insert(supplierProducts).values({ supplierId, productId, ...set }).onConflictDoUpdate({ target: [supplierProducts.supplierId, supplierProducts.productId], set: { ...set, updatedAt: now } });
  }
}

/**
 * A person writes a field: the value goes to its place, the ledger keeps who
 * and when — and, when it replaces an estimate, the estimate and its method.
 */
export async function saveDataField(db: DB, productId: string, key: FieldKey, raw: string | null, opts: { documentId?: string | null; note?: string | null } = {}): Promise<void> {
  const def = FIELDS[key];
  const parsed = parseFieldValue(key, raw ?? "");
  if ("error" in parsed) throw new DataFieldError(parsed.error);
  const value = parsed.value;
  const before = (await readProfiles(db, [productId])).get(productId)?.fields[key] ?? null;
  await writeHome(db, productId, key, value);
  if (value == null) {
    await db.delete(productDataFields).where(and(eq(productDataFields.productId, productId), eq(productDataFields.field, key)));
    return;
  }
  const [existing] = await db.select().from(productDataFields).where(and(eq(productDataFields.productId, productId), eq(productDataFields.field, key)));
  // The estimate replaced is kept once: a later correction does not overwrite what the software first said.
  const estimate = existing?.estimate ?? (before?.status === "estimated" && before.display ? { value: before.display, method: before.method, source: before.source?.label ?? null } : null);
  const values = { value: def.home === "ledger" ? value : null, source: opts.documentId ? "document" : "user", documentId: opts.documentId ?? null, note: opts.note ?? null, estimate, updatedAt: new Date() };
  await db.insert(productDataFields).values({ productId, field: key, ...values }).onConflictDoUpdate({ target: [productDataFields.productId, productDataFields.field], set: values });
}

/** "Confirm": the software's estimate becomes the value, as if typed — and stays on file as the estimate it was. */
export async function confirmDataField(db: DB, productId: string, key: FieldKey): Promise<void> {
  const field = (await readProfiles(db, [productId])).get(productId)?.fields[key];
  if (!field || field.status !== "estimated" || !field.confirmable || field.raw == null) throw new DataFieldError("nothing_to_confirm");
  await saveDataField(db, productId, key, field.raw);
}

/** Documents already in the app that speak about this product: the invoices and quotes it was read from. */
export async function documentsOnFile(db: DB, productId: string): Promise<{ documentId: string; filename: string; recordType: string }[]> {
  const [fromPurchases, fromQuotes] = await Promise.all([
    db.selectDistinct({ documentId: documents.id, filename: documents.filename, recordType: importSessions.recordType }).from(purchases).innerJoin(importItems, eq(purchases.importItemId, importItems.id)).innerJoin(importSessions, eq(importItems.sessionId, importSessions.id)).innerJoin(documents, eq(importSessions.documentId, documents.id)).where(eq(purchases.productId, productId)),
    db.selectDistinct({ documentId: documents.id, filename: documents.filename, recordType: importSessions.recordType }).from(quotes).innerJoin(importItems, eq(quotes.importItemId, importItems.id)).innerJoin(importSessions, eq(importItems.sessionId, importSessions.id)).innerJoin(documents, eq(importSessions.documentId, documents.id)).where(eq(quotes.productId, productId)),
  ]);
  const seen = new Set<string>();
  return [...fromQuotes, ...fromPurchases].filter((d) => (seen.has(d.documentId) ? false : (seen.add(d.documentId), true)));
}

export async function linkedProductDocuments(db: DB, productId: string) {
  return db.select({ id: productDocuments.id, documentId: documents.id, filename: documents.filename, type: productDocuments.type }).from(productDocuments).innerJoin(documents, eq(productDocuments.documentId, documents.id)).where(eq(productDocuments.productId, productId));
}

/** A document already in the app is linked to the product, not copied. */
export async function linkProductDocument(db: DB, productId: string, documentId: string, type: string): Promise<void> {
  if (!isDocumentType(type)) throw new DataFieldError("document_type");
  const linked = await db.select().from(productDocuments).where(and(eq(productDocuments.productId, productId), eq(productDocuments.documentId, documentId)));
  if (linked.length) await db.update(productDocuments).set({ type }).where(eq(productDocuments.id, linked[0].id));
  else await db.insert(productDocuments).values({ productId, documentId, type });
}

/** A new file: stored once (the same file twice is the same document), then linked. */
export async function uploadProductFile(db: DB, productId: string, file: { name: string; bytes: Uint8Array; mimeType: string | null }, type: string): Promise<void> {
  if (!isDocumentType(type)) throw new DataFieldError("document_type");
  const documentId = await addProductDocument(db, productId, file, type);
  // The same file may already have been linked with another type: the type chosen now wins.
  await linkProductDocument(db, productId, documentId, type);
}
