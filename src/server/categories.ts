/**
 * The company's categories on the database: the tree the pages walk
 * (lib/catalog/tree.ts) and what the user decides about it — a new category,
 * another name, a subcategory moved, products filed elsewhere, the order.
 *
 * A product is filed by the names it carries, so reorganising rewrites those
 * names on the products (and on their families) in one go, and every page
 * reads the new hierarchy the next time it is shown. Nothing else is touched:
 * purchases, prices, quantities, suppliers and invoices refer to the same
 * products as before, and no product is ever deleted from here.
 *
 * Places are named by their names, not by ids: a category that only products
 * name has no row until the company decides something about it.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { connection } from "next/server";
import { getDb, type DB } from "@/db";
import { productCategories, productFamilies, products } from "@/db/schema";
import { baseTotal, isPriced } from "@/lib/analytics";
import { isStrategic } from "@/lib/catalog/kinds";
import { TAXONOMY } from "@/lib/catalog/taxonomy";
import { NO_SUB_KEY, SPEND_KEY, UNCLASSIFIED_KEY, buildTree, builtinCategoryKey, builtinSubKey, categoryNaming, keyOf, type CategoryNaming, type CategoryRow, type CategoryTree, type TreeInput } from "@/lib/catalog/tree";
import { getDataset, getLearning, getT, readDataset, readLearning, type Learning } from "@/lib/data";
import type { Dataset } from "@/lib/analytics";
import { en, type T } from "@/lib/i18n";
import { normalizeKey, tidy } from "@/lib/import/normalize/text";

/** Something the user can be told as it is (the message is already in their language). */
export class CategoryError extends Error {}

export async function readCategoryRows(db: DB): Promise<CategoryRow[]> {
  const rows = await db.select().from(productCategories).orderBy(asc(productCategories.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parentId, taxonomyKey: r.taxonomyKey, position: r.position }));
}

/** How many ways of writing a product are handed to the search: the page carries them for every product. */
const MAX_TERMS = 12;

/** The products as the tree needs them: who sells each, what it weighs, and every way it was written. */
export function treeInput(data: Dataset, aliases: Learning["productAliases"]): TreeInput[] {
  const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));
  const spend = new Map<string, number>();
  const bought = new Map<string, Map<string, number>>();
  for (const x of data.purchases) {
    const amount = isPriced(x) ? baseTotal(x) : 0;
    spend.set(x.productId, (spend.get(x.productId) ?? 0) + amount);
    const by = bought.get(x.productId) ?? new Map<string, number>();
    bought.set(x.productId, by.set(x.supplierId, (by.get(x.supplierId) ?? 0) + Math.max(amount, 1)));
  }
  const written = new Map<string, typeof aliases>();
  for (const a of aliases) written.set(a.productId, [...(written.get(a.productId) ?? []), a]);
  return data.products.map((p) => {
    const own = written.get(p.id) ?? [];
    const main = [...(bought.get(p.id) ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? p.currentSupplierId ?? null;
    const codes = [...new Set(own.map((a) => tidy(a.supplierSku)).filter(Boolean))];
    const seen = new Set([normalizeKey(p.name)]);
    const terms: string[] = [];
    // As the documents wrote it first: that is what the user remembers, and what a result found this way is explained with.
    for (const text of [...own.map((a) => a.alias), ...codes, ...own.map((a) => a.ean), p.sku]) {
      const key = normalizeKey(text);
      if (!key || seen.has(key) || terms.length >= MAX_TERMS) continue;
      seen.add(key);
      terms.push(tidy(text));
    }
    return {
      id: p.id,
      name: p.name,
      unit: p.unit,
      kind: p.kind,
      category: p.category,
      subcategory: p.subcategory ?? null,
      supplier: main ? (supplierName.get(main) ?? null) : null,
      // One code says which article it is; several say only that it has been written in several ways.
      code: codes.length === 1 ? codes[0] : null,
      spend: spend.get(p.id) ?? 0,
      terms,
    };
  });
}

export async function readTree(db: DB, t: T = en): Promise<CategoryTree> {
  const [data, learning, rows] = await Promise.all([readDataset(db), readLearning(db), readCategoryRows(db)]);
  return buildTree(treeInput(data, learning.productAliases), rows, t);
}

/** The tree of the request: categories, subcategories and every product on file. */
export const getCategoryTree = cache(async (): Promise<CategoryTree> => {
  const [data, learning, t] = await Promise.all([getDataset(), getLearning(), getT()]);
  return buildTree(treeInput(data, learning.productAliases), await readCategoryRows(await getDb()), t);
});

export const getCategoryRows = cache(async (): Promise<CategoryRow[]> => {
  await connection();
  return readCategoryRows(await getDb());
});

export async function readNaming(db: DB, t: T = en): Promise<CategoryNaming> {
  return categoryNaming(await readCategoryRows(db), t);
}

/**
 * The names to offer when a product is filed by hand: the company's own, then the built-in ones it has not
 * taken over yet — a built-in name the company changed is offered as the company calls it.
 */
export function namesOnOffer(tree: CategoryTree, rows: CategoryRow[], t: T = en): { categories: string[]; subcategories: string[] } {
  const own = tree.categories.filter((c) => c.group === "category");
  const taken = new Set(rows.map((r) => `${r.parentId ? "sub" : "category"}:${r.taxonomyKey ?? ""}`));
  const unique = (names: string[]) => [...new Map(names.map((n) => [keyOf(n), n])).values()];
  return {
    categories: unique([...own.map((c) => c.name), ...TAXONOMY.filter((c) => !taken.has(`category:${c.key}`)).map((c) => t(c.label))]),
    subcategories: unique([...own.flatMap((c) => c.subs.map((s) => s.name)), ...TAXONOMY.flatMap((c) => c.subs.filter((s) => !taken.has(`sub:${s.key}`)).map((s) => t(s.label)))]),
  };
}

// ---------------- What the user decides ----------------

/** A place in the hierarchy, by name: a category, or one of its subcategories. */
export interface CategoryPlace {
  category: string;
  subcategory?: string | null;
}

interface Stored {
  rows: (typeof productCategories.$inferSelect)[];
  items: { id: string; category: string | null; subcategory: string | null; kind: string; mappedAt: Date | null }[];
}
const load = async (db: DB): Promise<Stored> => ({
  rows: await db.select().from(productCategories).orderBy(asc(productCategories.createdAt)),
  items: await db.select({ id: products.id, category: products.category, subcategory: products.subcategory, kind: products.kind, mappedAt: products.mappedAt }).from(products),
});
const reserved = (name: string) => [SPEND_KEY, UNCLASSIFIED_KEY, NO_SUB_KEY].includes(name) || name.startsWith("~");
const filed = (s: Stored) => s.items.filter((p) => isStrategic(p.kind));
const topRow = (s: Stored, category: string) => s.rows.find((r) => !r.parentId && keyOf(r.name) === keyOf(category)) ?? null;
const subRow = (s: Stored, parentId: string, subcategory: string) => s.rows.find((r) => r.parentId === parentId && keyOf(r.name) === keyOf(subcategory)) ?? null;
/** As the products write it, when no row says how: the category exists because they name it. */
const spelling = (s: Stored, category: string, subcategory?: string | null) => {
  const p = filed(s).find((x) => keyOf(x.category) === keyOf(category) && (!subcategory || keyOf(x.subcategory) === keyOf(subcategory)));
  return p ? tidy(subcategory ? p.subcategory : p.category) : null;
};
const exists = (s: Stored, category: string, subcategory?: string | null) => {
  const top = topRow(s, category);
  if (!subcategory) return !!top || !!spelling(s, category);
  return (!!top && !!subRow(s, top.id, subcategory)) || !!spelling(s, category, subcategory);
};

/** The row of a place, written the first time something is decided about it. */
async function ensure(db: DB, s: Stored, place: CategoryPlace): Promise<{ top: Stored["rows"][number]; sub: Stored["rows"][number] | null }> {
  let top = topRow(s, place.category);
  if (!top) {
    const name = spelling(s, place.category) ?? tidy(place.category);
    [top] = await db.insert(productCategories).values({ name, taxonomyKey: builtinCategoryKey(name) }).returning();
    s.rows.push(top);
  }
  if (!keyOf(place.subcategory)) return { top, sub: null };
  let sub = subRow(s, top.id, place.subcategory!);
  if (!sub) {
    const name = spelling(s, place.category, place.subcategory) ?? tidy(place.subcategory);
    [sub] = await db.insert(productCategories).values({ name, parentId: top.id, taxonomyKey: builtinSubKey(name) }).returning();
    s.rows.push(sub);
  }
  return { top, sub };
}

const idsIn = (s: Stored, category: string, subcategory?: string | null) =>
  filed(s)
    .filter((p) => keyOf(p.category) === keyOf(category) && (subcategory == null || keyOf(p.subcategory) === keyOf(subcategory)))
    .map((p) => p.id);

/** The families of a place are filed with it: their own category and subcategory follow. */
async function refileFamilies(db: DB, from: CategoryPlace, to: { category?: string; subcategory?: string }) {
  const all = await db.select().from(productFamilies);
  const ids = all.filter((f) => keyOf(f.category) === keyOf(from.category) && (from.subcategory == null || keyOf(f.subcategory) === keyOf(from.subcategory))).map((f) => f.id);
  if (ids.length) await db.update(productFamilies).set({ ...to, updatedAt: new Date() }).where(inArray(productFamilies.id, ids));
}

function clean(name: string, t: T): string {
  const value = tidy(name);
  if (!keyOf(value) || reserved(value)) throw new CategoryError(t("A category needs a name."));
  return value;
}

/** A new category, or a new subcategory of one: empty until products are moved into it. */
export async function createCategory(db: DB, name: string, parent: string | null = null, t: T = en): Promise<void> {
  const value = clean(name, t);
  const s = await load(db);
  if (!parent) {
    if (exists(s, value)) throw new CategoryError(t("There is already a category called “{name}”.", { name: value }));
    await db.insert(productCategories).values({ name: value, taxonomyKey: builtinCategoryKey(value) });
    return;
  }
  if (!exists(s, parent)) throw new CategoryError(t("This category is no longer there. Reload the page and try again."));
  if (exists(s, parent, value)) throw new CategoryError(t("“{parent}” already has a subcategory called “{name}”.", { parent, name: value }));
  const { top } = await ensure(db, s, { category: parent });
  await db.insert(productCategories).values({ name: value, parentId: top.id, taxonomyKey: builtinSubKey(value) });
}

/** Another name for a category or a subcategory: its products, and what the rules read as it, follow. */
export async function renameCategory(db: DB, place: CategoryPlace, name: string, t: T = en): Promise<void> {
  const value = clean(name, t);
  const s = await load(db);
  if (!exists(s, place.category, place.subcategory)) throw new CategoryError(t("This category is no longer there. Reload the page and try again."));
  const { top, sub } = await ensure(db, s, place);
  if (sub) {
    if (keyOf(value) !== keyOf(sub.name) && exists(s, place.category, value)) throw new CategoryError(t("“{parent}” already has a subcategory called “{name}”.", { parent: top.name, name: value }));
    const ids = idsIn(s, place.category, sub.name);
    await db.update(productCategories).set({ name: value, updatedAt: new Date() }).where(eq(productCategories.id, sub.id));
    if (ids.length) await db.update(products).set({ subcategory: value, updatedAt: new Date() }).where(inArray(products.id, ids));
    await refileFamilies(db, { category: place.category, subcategory: sub.name }, { subcategory: value });
    return;
  }
  if (keyOf(value) !== keyOf(top.name) && exists(s, value)) throw new CategoryError(t("There is already a category called “{name}”.", { name: value }));
  const ids = idsIn(s, place.category);
  await db.update(productCategories).set({ name: value, updatedAt: new Date() }).where(eq(productCategories.id, top.id));
  if (ids.length) await db.update(products).set({ category: value, updatedAt: new Date() }).where(inArray(products.id, ids));
  await refileFamilies(db, { category: place.category }, { category: value });
}

/** A subcategory, with everything in it, under another category. */
export async function moveSubcategory(db: DB, place: CategoryPlace & { subcategory: string }, toCategory: string, t: T = en): Promise<void> {
  const s = await load(db);
  if (!exists(s, place.category, place.subcategory) || !exists(s, toCategory)) throw new CategoryError(t("This category is no longer there. Reload the page and try again."));
  if (keyOf(toCategory) === keyOf(place.category)) return;
  if (exists(s, toCategory, place.subcategory)) throw new CategoryError(t("“{parent}” already has a subcategory called “{name}”.", { parent: toCategory, name: place.subcategory }));
  const { sub } = await ensure(db, s, place);
  const { top: target } = await ensure(db, s, { category: toCategory });
  const ids = idsIn(s, place.category, place.subcategory);
  await db.update(productCategories).set({ parentId: target.id, position: null, updatedAt: new Date() }).where(eq(productCategories.id, sub!.id));
  if (ids.length) await db.update(products).set({ category: target.name, updatedAt: new Date() }).where(inArray(products.id, ids));
  await refileFamilies(db, place, { category: target.name });
}

/**
 * Products filed somewhere else by the user — which is the user saying what they are, so they count as confirmed.
 * To nowhere (`null`): back among the products to classify, where the Product Mapper proposes again.
 */
export async function moveProducts(db: DB, productIds: string[], to: CategoryPlace | null, t: T = en): Promise<{ moved: number }> {
  const s = await load(db);
  const chosen = filed(s).filter((p) => productIds.includes(p.id));
  if (!chosen.length) return { moved: 0 };
  if (!to) {
    await db.update(products).set({ category: null, subcategory: null, familyId: null, mappedAt: null, updatedAt: new Date() }).where(inArray(products.id, chosen.map((p) => p.id)));
    return { moved: chosen.length };
  }
  if (!exists(s, to.category, to.subcategory)) throw new CategoryError(t("This category is no longer there. Reload the page and try again."));
  const { top, sub } = await ensure(db, s, to);
  // What the built-in category is for the spend (a material, a component, packaging), for a product nobody had said it of.
  const kind = TAXONOMY.find((c) => c.key === top.taxonomyKey)?.kind;
  const now = new Date();
  for (const p of chosen) {
    await db
      .update(products)
      .set({ category: top.name, subcategory: sub?.name ?? null, mappedAt: p.mappedAt ?? now, updatedAt: now, ...(p.kind === "needs_review" && kind ? { kind } : {}) })
      .where(eq(products.id, p.id));
  }
  return { moved: chosen.length };
}

/** One place up or down among its own level: the order becomes the company's own. */
export async function reorderCategory(db: DB, place: CategoryPlace, direction: "up" | "down", t: T = en): Promise<void> {
  const tree = await readTree(db, t);
  const s = await load(db);
  const category = tree.categories.find((c) => c.group === "category" && c.key === keyOf(place.category));
  if (!category) throw new CategoryError(t("This category is no longer there. Reload the page and try again."));
  // The order on screen, written down for the whole level: from now on it is the one the user arranged.
  const level: CategoryPlace[] = place.subcategory
    ? category.subs.map((x) => ({ category: category.name, subcategory: x.name }))
    : tree.categories.filter((c) => c.group === "category").map((c) => ({ category: c.name }));
  const at = level.findIndex((x) => keyOf(place.subcategory ? x.subcategory : x.category) === keyOf(place.subcategory ?? place.category));
  const to = at + (direction === "up" ? -1 : 1);
  if (at < 0 || to < 0 || to >= level.length) return;
  [level[at], level[to]] = [level[to], level[at]];
  for (const [position, x] of level.entries()) {
    const { top, sub } = await ensure(db, s, x);
    await db.update(productCategories).set({ position, updatedAt: new Date() }).where(eq(productCategories.id, (sub ?? top).id));
  }
}

/** A category or a subcategory with nothing in it is taken off the list. One with products is never deleted: they are moved first. */
export async function deleteCategory(db: DB, place: CategoryPlace, t: T = en): Promise<void> {
  const s = await load(db);
  if (idsIn(s, place.category, place.subcategory ?? null).length) throw new CategoryError(t("It still has products: move them to another category first."));
  const top = topRow(s, place.category);
  if (!top) return;
  const row = place.subcategory ? subRow(s, top.id, place.subcategory) : top;
  if (row) await db.delete(productCategories).where(eq(productCategories.id, row.id));
}
