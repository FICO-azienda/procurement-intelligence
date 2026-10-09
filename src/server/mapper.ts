/**
 * Product Mapper on the database: reads the catalogue, hands it to the pure
 * engine (lib/catalog/mapper.ts) and writes what the user confirms — a name,
 * a category, a family and a variant; two products made one; two products
 * declared different. Purchases, prices, quantities, suppliers and dates are
 * never rewritten: a merge only moves them under the product that stays.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { importItems, marketBenchmarks, productAliases, productDataFields, productDocuments, productFamilies, productMerges, productSeparations, products, purchases, quotes, researchEvidence, researchRuns, supplierCandidates, supplierProducts } from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { isProductKind, isStrategic, type ProductKind } from "@/lib/catalog/kinds";
import { apartAmong, boughtSameDay, pairKey, type SameDay } from "@/lib/catalog/apart";
import { variantOf, type VariantBy } from "@/lib/catalog/macro";
import { mapCatalogue, toMapInput, type MapAnalysis, type MapInput, type Mapping } from "@/lib/catalog/mapper";
import { subByKey } from "@/lib/catalog/taxonomy";
import { readDataset, readLearning } from "@/lib/data";
import * as f from "@/lib/format";
import { en, type T } from "@/lib/i18n";
import { normalizeKey, productKey, tidy } from "@/lib/import/normalize/text";

export async function readMapInput(db: DB, asOf = todayISO()): Promise<{ input: MapInput[]; separated: [string, string][] }> {
  const [data, learning, families, pairs] = await Promise.all([readDataset(db), readLearning(db), db.select().from(productFamilies), db.select().from(productSeparations)]);
  return { input: toMapInput(data, learning.productAliases, new Map(families.map((f) => [f.id, f.name])), asOf, new Set(families.filter((f) => f.variantBy).map((f) => f.id))), separated: pairs.map((x) => [x.productA, x.productB]) };
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

/** The tables whose rows follow a product into the one it is merged with. Each row keeps everything it says: only whose product it is changes. */
const FOLLOWERS = [
  ["purchases", purchases],
  ["quotes", quotes],
  ["import_items", importItems],
  ["product_aliases", productAliases],
  ["supplier_candidates", supplierCandidates],
  ["market_benchmarks", marketBenchmarks],
  ["research_runs", researchRuns],
  ["research_evidence", researchEvidence],
  ["product_documents", productDocuments],
] as const;
/** One table is enough to type the moves: every follower has an id and a product_id. */
type Follower = typeof purchases;

/**
 * Several products are one: the first stays, and the others' purchases,
 * quotes, descriptions, candidates, benchmarks, research and documents move
 * under it. Nothing is deleted: a merged product stays on file, hidden, with
 * what could not move, and the rows that moved are logged (product_merges) so
 * the merge can be taken back. Every purchase keeps its own price, quantity,
 * date, supplier and original text.
 */
export async function mergeProducts(db: DB, productIds: string[], name: string, t: T = en): Promise<{ productId: string }> {
  const ids = [...new Set(productIds)];
  const rows = await db.select().from(products).where(inArray(products.id, ids));
  if (rows.length < 2 || rows.length !== ids.length || rows.some((r) => r.mergedIntoId)) throw new Error("Nothing to merge");
  if (new Set(rows.map((r) => r.unit)).size > 1) throw new MapperError(t("These products are bought in different units: they can't be merged."));
  // One supplier, one day, two prices: two products. No resemblance overrules what the invoice says.
  const lines = await db.select({ productId: purchases.productId, supplierId: purchases.supplierId, date: purchases.date, price: purchases.unitPrice }).from(purchases).where(inArray(purchases.productId, ids));
  const apart = apartAmong(ids, boughtSameDay(lines.map((x) => ({ ...x, price: Number(x.price) }))));
  if (apart?.evidence.different) {
    const name = (id: string) => rows.find((r) => r.id === id)!.name;
    throw new MapperError(t("“{a}” and “{b}” were billed by the same supplier on the same day at different prices ({date}): they are different products and cannot be merged. If they are versions of one product, file them as variants.", { a: name(apart.a), b: name(apart.b), date: f.date(apart.evidence.date) }));
  }
  const analysis = await analyzeCatalogue(db, t);
  const ordered = ids.map((id) => rows.find((r) => r.id === id)!);
  const [keep, ...others] = ordered;
  const finalName = tidy(name) || keep.name;

  for (const o of others) {
    const moved: Record<string, string[]> = {};
    for (const [key, table] of FOLLOWERS) {
      const done = await db.update(table as Follower).set({ productId: keep.id }).where(eq((table as Follower).productId, o.id)).returning({ id: (table as Follower).id });
      if (done.length) moved[key] = done.map((x) => x.id);
    }
    // One link per supplier, one value per field: the product that stays keeps its own and takes the other's only where it had none. The rest stays with the merged product.
    const links = await db.select().from(supplierProducts).where(inArray(supplierProducts.productId, [keep.id, o.id]));
    const linked = new Set(links.filter((l) => l.productId === keep.id).map((l) => l.supplierId));
    const freeLinks = links.filter((l) => l.productId === o.id && !linked.has(l.supplierId)).map((l) => l.id);
    if (freeLinks.length) await db.update(supplierProducts).set({ productId: keep.id }).where(inArray(supplierProducts.id, freeLinks));
    const fields = await db.select().from(productDataFields).where(inArray(productDataFields.productId, [keep.id, o.id]));
    const filled = new Set(fields.filter((f) => f.productId === keep.id).map((f) => f.field));
    const freeFields = fields.filter((f) => f.productId === o.id && !filled.has(f.field)).map((f) => f.id);
    if (freeFields.length) await db.update(productDataFields).set({ productId: keep.id }).where(inArray(productDataFields.id, freeFields));
    if (freeLinks.length) moved.supplier_products = freeLinks;
    if (freeFields.length) moved.product_data_fields = freeFields;
    await keepOldName(db, keep.id, o.name);
    await db.update(products).set({ mergedIntoId: keep.id, updatedAt: new Date() }).where(eq(products.id, o.id));
    await db.insert(productMerges).values({ productId: keep.id, mergedId: o.id, moved, nameBefore: keep.name, nameAfter: finalName });
  }

  // The product that stays takes the name chosen and, if it was not confirmed yet, what the engine read of it.
  const m = analysis.products.find((x) => x.productId === keep.id);
  if (m && !m.mapped) await write(db, { ...m, variant: m.family ? tidy(finalName.replace(new RegExp(`^${m.family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")) || m.variant : null }, finalName);
  else {
    if (normalizeKey(finalName) !== normalizeKey(keep.name)) await keepOldName(db, keep.id, keep.name);
    await db.update(products).set({ name: finalName, updatedAt: new Date() }).where(eq(products.id, keep.id));
  }
  return { productId: keep.id };
}

/** The product a merged one is read as. Null: the product stands for itself, or does not exist. */
export async function mergedInto(db: DB, productId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return null;
  const [row] = await db.select({ into: products.mergedIntoId }).from(products).where(eq(products.id, productId));
  return row?.into ?? null;
}

export interface ProductMergeRow {
  id: string;
  productId: string;
  productName: string;
  mergedId: string;
  mergedName: string;
  createdAt: string;
  /**
   * What the invoices say against the merge: lines that came with the merged product and lines of the product it was
   * merged into, billed by one supplier on the same day. At different prices they are two products.
   */
  sameDay: SameDay | null;
}

/** The merges in force, the latest first: what can be taken back — each checked against what the invoices say. */
export async function readProductMerges(db: DB): Promise<ProductMergeRow[]> {
  const [merges, all] = await Promise.all([db.select().from(productMerges).where(isNull(productMerges.undoneAt)).orderBy(desc(productMerges.createdAt)), db.select({ id: products.id, name: products.name, mergedIntoId: products.mergedIntoId }).from(products)]);
  const byId = new Map(all.map((p) => [p.id, p]));
  const live = merges.filter((m) => byId.get(m.mergedId)?.mergedIntoId === m.productId);
  const kept = [...new Set(live.map((m) => m.productId))];
  const lines = kept.length ? await db.select({ id: purchases.id, productId: purchases.productId, supplierId: purchases.supplierId, date: purchases.date, price: purchases.unitPrice }).from(purchases).where(inArray(purchases.productId, kept)) : [];
  return live.map((m) => {
    // The lines as they were before the merge: the ones that moved stand for the merged product, the rest for the other.
    const moved = new Set(m.moved.purchases ?? []);
    const own = lines.filter((x) => x.productId === m.productId).map((x) => ({ productId: moved.has(x.id) ? m.mergedId : m.productId, supplierId: x.supplierId, date: x.date, price: Number(x.price) }));
    return { id: m.id, productId: m.productId, productName: byId.get(m.productId)?.name ?? "", mergedId: m.mergedId, mergedName: byId.get(m.mergedId)?.name ?? "", createdAt: m.createdAt.toISOString(), sameDay: boughtSameDay(own).get(pairKey(m.mergedId, m.productId)) ?? null };
  });
}

/** Several merges taken back at once: the ones the invoices contradict, on the user's word. */
export async function undoProductMerges(db: DB, mergeIds: string[], t: T = en): Promise<{ undone: number }> {
  let undone = 0;
  for (const id of [...new Set(mergeIds)]) {
    await undoProductMerge(db, id, t);
    undone++;
  }
  return { undone };
}

/**
 * Takes a merge back: the rows that moved go back under the product they
 * came from, which is listed again with the name it had. What was bought or
 * recorded under the product that stayed after the merge stays there.
 */
export async function undoProductMerge(db: DB, mergeId: string, t: T = en): Promise<{ productId: string }> {
  const [m] = await db.select().from(productMerges).where(eq(productMerges.id, mergeId));
  const [merged] = m ? await db.select().from(products).where(eq(products.id, m.mergedId)) : [];
  if (!m || m.undoneAt || !merged || merged.mergedIntoId !== m.productId) throw new MapperError(t("This merge is no longer in force."));
  for (const [key, table] of [...FOLLOWERS, ["supplier_products", supplierProducts], ["product_data_fields", productDataFields]] as const) {
    const ids = m.moved[key] ?? [];
    if (ids.length) await db.update(table as Follower).set({ productId: m.mergedId }).where(inArray((table as Follower).id, ids));
  }
  // The merged product's name had been added to the other as one more way of writing it.
  await db.delete(productAliases).where(and(eq(productAliases.productId, m.productId), eq(productAliases.normalized, productKey(merged.name)), eq(productAliases.source, "rename"), isNull(productAliases.supplierId)));
  await db.update(products).set({ mergedIntoId: null, updatedAt: new Date() }).where(eq(products.id, m.mergedId));
  await db.update(productMerges).set({ undoneAt: new Date() }).where(eq(productMerges.id, m.id));
  // The name goes back too, when the merge changed it, nobody changed it since, and nothing else is merged into the product.
  const [kept] = await db.select().from(products).where(eq(products.id, m.productId));
  const still = await db.select({ id: productMerges.id }).from(productMerges).where(and(eq(productMerges.productId, m.productId), isNull(productMerges.undoneAt)));
  if (kept && !still.length && kept.name === m.nameAfter && m.nameBefore !== m.nameAfter) await db.update(products).set({ name: m.nameBefore, updatedAt: new Date() }).where(eq(products.id, m.productId));
  return { productId: m.mergedId };
}

/**
 * "They are versions of one product": the products stay apart, each with its
 * own purchases and price, and are filed under the same macro product (their
 * family) with what tells each one apart as its variant. What changes between
 * them — size, colour, material… — is what the user said, kept on the family.
 * Nothing is merged and no name is changed.
 */
export async function confirmVariants(db: DB, productIds: string[], name: string, variantBy: VariantBy, t: T = en): Promise<{ familyId: string }> {
  const ids = [...new Set(productIds)];
  const macro = tidy(name);
  if (ids.length < 2 || !macro) throw new MapperError(t("A macro product needs a name and at least two products."));
  const analysis = await analyzeCatalogue(db, t);
  const members = ids.map((id) => analysis.products.find((m) => m.productId === id));
  if (members.some((m) => !m)) throw new Error("Unknown product");
  const first = members[0]!;
  const all = await db.select().from(productFamilies);
  let family = all.find((x) => normalizeKey(x.name) === normalizeKey(macro) && normalizeKey(x.subcategory) === normalizeKey(first.subcategory));
  if (family) await db.update(productFamilies).set({ variantBy, updatedAt: new Date() }).where(eq(productFamilies.id, family.id));
  else [family] = await db.insert(productFamilies).values({ name: macro, category: first.category, subcategory: first.subcategory, variantBy }).returning();
  const group = analysis.macros.find((g) => ids.every((id) => g.members.some((x) => x.productId === id)));
  for (const m of members as Mapping[]) {
    const variant = group ? (group.members.find((x) => x.productId === m.productId)!.variant ?? null) : variantOf(m.name, macro);
    // A product nobody had confirmed yet is confirmed here, with the name it was read with: saying what it is a version of says what it is.
    if (m.mapped) await db.update(products).set({ familyId: family.id, variant, updatedAt: new Date() }).where(eq(products.id, m.productId));
    else await write(db, { ...m, family: macro, variant }, m.name);
  }
  // Versions of one product are not the same product: they are not proposed as duplicates again.
  await keepSeparate(db, ids);
  return { familyId: family.id };
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
    originals: [],
    supplierTerms: [],
    supplierCodes: [],
    identity: "named",
    options: [],
    group: "confident",
  };
  await write(db, m, edit.name);
}
