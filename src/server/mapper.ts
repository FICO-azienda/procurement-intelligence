/**
 * Product Mapper on the database: reads the catalogue, hands it to the pure
 * engine (lib/catalog/mapper.ts) and writes what the user confirms — a name,
 * a category, a family and a variant; two products made one; two products
 * declared different. Purchases, prices, quantities, suppliers and dates are
 * never rewritten: a merge only moves them under the product that stays.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { importItems, opportunities, productAliases, productFamilies, productSeparations, products, purchases, quotes, supplierProducts } from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { isProductKind, isStrategic, type ProductKind } from "@/lib/catalog/kinds";
import { mapCatalogue, toMapInput, type MapAnalysis, type MapInput, type Mapping } from "@/lib/catalog/mapper";
import { subByKey } from "@/lib/catalog/taxonomy";
import { readDataset, readLearning } from "@/lib/data";
import { en, type T } from "@/lib/i18n";
import { normalizeKey, productKey, tidy } from "@/lib/import/normalize/text";

export async function readMapInput(db: DB, asOf = todayISO()): Promise<{ input: MapInput[]; separated: [string, string][] }> {
  const [data, learning, families, pairs] = await Promise.all([readDataset(db), readLearning(db), db.select().from(productFamilies), db.select().from(productSeparations)]);
  return { input: toMapInput(data, learning.productAliases, new Map(families.map((f) => [f.id, f.name])), asOf), separated: pairs.map((x) => [x.productA, x.productB]) };
}

export async function analyzeCatalogue(db: DB, t: T = en, answers?: Map<string, string>): Promise<MapAnalysis> {
  const { input, separated } = await readMapInput(db);
  return mapCatalogue(input, { separated, answers, t });
}

async function familyId(db: DB, m: Pick<Mapping, "family" | "category" | "subcategory">): Promise<string | null> {
  const name = tidy(m.family);
  if (!name) return null;
  const all = await db.select().from(productFamilies);
  const found = all.find((f) => normalizeKey(f.name) === normalizeKey(name) && normalizeKey(f.subcategory) === normalizeKey(m.subcategory));
  if (found) return found.id;
  const [created] = await db.insert(productFamilies).values({ name, category: m.category, subcategory: m.subcategory }).returning();
  return created.id;
}

/** Something the user can be told as it is (the message is already in their language). */
export class MapperError extends Error {}

/** The name a product had is kept as one more way of writing it, so nothing that used it stops matching. */
async function keepOldName(db: DB, productId: string, oldName: string) {
  const normalized = productKey(oldName);
  if (!normalized) return;
  const [same] = await db.select({ id: productAliases.id }).from(productAliases).where(and(eq(productAliases.productId, productId), eq(productAliases.normalized, normalized)));
  if (!same) await db.insert(productAliases).values({ productId, alias: oldName, normalized, supplierId: null, confidence: "high", source: "rename" });
}

async function write(db: DB, m: Mapping, name: string) {
  const clean = tidy(name) || m.current;
  if (normalizeKey(clean) !== normalizeKey(m.current)) await keepOldName(db, m.productId, m.current);
  const catalogue = isStrategic(m.kind);
  await db
    .update(products)
    .set({
      name: clean,
      kind: m.kind,
      category: catalogue ? m.category : null,
      subcategory: catalogue ? m.subcategory : null,
      familyId: catalogue ? await familyId(db, m) : null,
      variant: catalogue ? m.variant : null,
      mappedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(products.id, m.productId));
}

export interface ConfirmOptions {
  /** Which products; left out = every product classified with high confidence that is not a possible duplicate. */
  productIds?: string[];
  /** What the user says they are: a subcategory of the taxonomy, or a kind of spend that is not a product. */
  answer?: string;
  /** Names the user wrote. */
  names?: Record<string, string>;
  t?: T;
}

/** Confirm what the engine proposes: in bulk for the sure ones, or a group at a time with the user's answer. */
export async function confirmMappings(db: DB, opts: ConfirmOptions = {}): Promise<{ confirmed: number }> {
  const t = opts.t ?? en;
  if (opts.answer && !subByKey(opts.answer) && !(isProductKind(opts.answer) && opts.answer !== "needs_review")) throw new Error("Unknown answer");
  const answers = opts.answer && opts.productIds ? new Map(opts.productIds.map((id) => [id, opts.answer!])) : undefined;
  const analysis = await analyzeCatalogue(db, t, answers);
  const inDuplicates = new Set(analysis.duplicates.flatMap((d) => d.productIds));
  const chosen = opts.productIds
    ? analysis.products.filter((m) => !m.mapped && opts.productIds!.includes(m.productId))
    : analysis.products.filter((m) => !m.mapped && m.level === "high" && !inDuplicates.has(m.productId));
  for (const m of chosen) await write(db, m, opts.names?.[m.productId] ?? m.name);
  return { confirmed: chosen.length };
}

/**
 * Several products are one: the first stays, the others' purchases, quotes,
 * descriptions and supplier codes move under it, and they are removed. Every
 * purchase keeps its own price, quantity, date, supplier and original text.
 */
export async function mergeProducts(db: DB, productIds: string[], name: string, t: T = en): Promise<{ productId: string }> {
  const ids = [...new Set(productIds)];
  const rows = await db.select().from(products).where(inArray(products.id, ids));
  if (rows.length < 2 || rows.length !== ids.length) throw new Error("Nothing to merge");
  if (new Set(rows.map((r) => r.unit)).size > 1) throw new MapperError(t("These products are bought in different units: they can't be merged."));
  const analysis = await analyzeCatalogue(db, t);
  const ordered = ids.map((id) => rows.find((r) => r.id === id)!);
  const [keep, ...others] = ordered;
  const gone = others.map((o) => o.id);

  await db.update(purchases).set({ productId: keep.id }).where(inArray(purchases.productId, gone));
  await db.update(quotes).set({ productId: keep.id }).where(inArray(quotes.productId, gone));
  await db.update(importItems).set({ productId: keep.id }).where(inArray(importItems.productId, gone));
  await db.update(productAliases).set({ productId: keep.id }).where(inArray(productAliases.productId, gone));
  // One link per supplier: the product that stays keeps its own, and takes the others' where it had none.
  const links = await db.select().from(supplierProducts).where(inArray(supplierProducts.productId, [keep.id, ...gone]));
  const linked = new Set(links.filter((l) => l.productId === keep.id).map((l) => l.supplierId));
  for (const l of links.filter((x) => x.productId !== keep.id)) {
    if (linked.has(l.supplierId)) await db.delete(supplierProducts).where(eq(supplierProducts.id, l.id));
    else {
      await db.update(supplierProducts).set({ productId: keep.id }).where(eq(supplierProducts.id, l.id));
      linked.add(l.supplierId);
    }
  }
  await db.delete(opportunities).where(inArray(opportunities.productId, gone));
  for (const o of others) await keepOldName(db, keep.id, o.name);
  await db.delete(products).where(inArray(products.id, gone));

  // The product that stays takes the name chosen and, if it was not confirmed yet, what the engine read of it.
  const m = analysis.products.find((x) => x.productId === keep.id);
  const finalName = tidy(name) || keep.name;
  if (m && !m.mapped) await write(db, { ...m, variant: m.family ? tidy(finalName.replace(new RegExp(`^${m.family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")) || m.variant : null }, finalName);
  else {
    if (normalizeKey(finalName) !== normalizeKey(keep.name)) await keepOldName(db, keep.id, keep.name);
    await db.update(products).set({ name: finalName, updatedAt: new Date() }).where(eq(products.id, keep.id));
  }
  return { productId: keep.id };
}

/** "They are different products": remembered pair by pair, so the question is not asked again. */
export async function keepSeparate(db: DB, productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds)].sort();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      await db.insert(productSeparations).values({ productA: ids[i], productB: ids[j] }).onConflictDoNothing();
    }
  }
}

export interface MappingEdit {
  name: string;
  kind: ProductKind;
  category: string | null;
  subcategory: string | null;
  family: string | null;
  variant: string | null;
}

/** What the user writes on the product's page: taken as it is, and marked as confirmed. */
export async function saveMapping(db: DB, productId: string, edit: MappingEdit): Promise<void> {
  const [row] = await db.select().from(products).where(eq(products.id, productId));
  if (!row) throw new Error("Product not found");
  const m: Mapping = {
    productId,
    current: row.name,
    name: edit.name,
    category: tidy(edit.category) || null,
    subcategory: tidy(edit.subcategory) || null,
    subKey: null,
    kind: edit.kind,
    family: tidy(edit.family) || null,
    variant: tidy(edit.variant) || null,
    level: "high",
    by: "user",
    reason: null,
    mapped: false,
    spend: 0,
    supplierId: null,
    supplierName: null,
  };
  await write(db, m, edit.name);
}
