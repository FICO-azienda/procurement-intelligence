/**
 * Category › subcategory › product: the catalogue as a tree to walk, so that
 * a product is found in a few clicks instead of a list of two hundred.
 *
 * The tree is read, never stored. A product is filed by the names it carries
 * (its category and subcategory, as text); the company's own decisions about
 * the hierarchy — a name it changed, a subcategory it moved, the order, a
 * category with no product yet — come from `product_categories`. Nothing here
 * files a product: one with no category is "to classify" and stays there
 * until the user (or the Product Mapper, confirmed by the user) says what it is.
 *
 * What is not a product of the catalogue — transport, services, utilities —
 * is kept apart under one node, by kind: it is spend to know about, and it is
 * never mixed with materials.
 */
import { en, translator, type Msg, type T } from "../i18n";
import { normalizeKey } from "../import/normalize/text";
import { KIND_GROUP_LABEL, isProductKind, isStrategic } from "./kinds";
import { TAXONOMY, allSubs, subByKey } from "./taxonomy";

/** A row of `product_categories`. */
export interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  taxonomyKey: string | null;
  position: number | null;
}

export interface TreeInput {
  id: string;
  name: string;
  unit: string;
  kind?: string | null;
  category: string | null;
  subcategory?: string | null;
  /** Who it is bought from, to tell two products of the same name apart. */
  supplier?: string | null;
  /** A code that says something to the user: the supplier's own article code. */
  code?: string | null;
  /** What it weighs on the spend: the largest come first. */
  spend?: number;
  /** Every other way it is written — descriptions on documents, codes. Read by the search only. */
  terms?: string[];
}

export interface TreeProduct {
  id: string;
  name: string;
  unit: string;
  supplier: string | null;
  code: string | null;
  spend: number;
  terms: string[];
}

export interface TreeSub {
  /** What it is called in an address: its name without capitals and accents, or a kind of spend. */
  key: string;
  name: string;
  /** Its row in `product_categories`, when the company has decided something about it. */
  id: string | null;
  products: TreeProduct[];
}

export type TreeGroup = "category" | "spend" | "unclassified";

export interface TreeCategory {
  key: string;
  name: string;
  id: string | null;
  group: TreeGroup;
  subs: TreeSub[];
  /** Products filed under the category with no subcategory. */
  direct: TreeProduct[];
  count: number;
  spend: number;
}

export interface CategoryTree {
  categories: TreeCategory[];
  /** Every product on file. */
  count: number;
}

/** Keys no name can produce: a name's key is made of letters, digits and spaces only. */
export const SPEND_KEY = "~spend";
export const UNCLASSIFIED_KEY = "~unclassified";
/** The products of a category that have no subcategory, when they are asked for on their own. */
export const NO_SUB_KEY = "~none";

export const keyOf = (name: string | null | undefined) => normalizeKey(name);
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const sum = <X>(xs: X[], f: (x: X) => number) => xs.reduce((s, x) => s + f(x), 0);

export function buildTree(products: TreeInput[], rows: CategoryRow[] = [], t: T = en): CategoryTree {
  const nodes = new Map<string, TreeCategory>();
  const subs = new Map<string, TreeSub>();
  /** The company's own order, for the places it arranged. */
  const position = new Map<object, number>();
  const node = (key: string, name: string, group: TreeGroup) => {
    let n = nodes.get(key);
    if (!n) nodes.set(key, (n = { key, name, id: null, group, subs: [], direct: [], count: 0, spend: 0 }));
    return n;
  };
  const sub = (parent: TreeCategory, key: string, name: string) => {
    const id = `${parent.key}|${key}`;
    let s = subs.get(id);
    if (!s) {
      subs.set(id, (s = { key, name, id: null, products: [] }));
      parent.subs.push(s);
    }
    return s;
  };
  const decided = <X extends TreeCategory | TreeSub>(place: X, row: CategoryRow) => {
    Object.assign(place, { id: row.id, name: row.name });
    if (row.position != null) position.set(place, row.position);
  };

  // The company's own hierarchy first: its names are the ones shown, and a category may have no product yet.
  const top = rows.filter((r) => !r.parentId && keyOf(r.name));
  for (const r of top) decided(node(keyOf(r.name), r.name, "category"), r);
  for (const r of rows.filter((x) => x.parentId && keyOf(x.name))) {
    const parent = top.find((x) => x.id === r.parentId);
    if (parent) decided(sub(nodes.get(keyOf(parent.name))!, keyOf(r.name), r.name), r);
  }

  for (const p of products) {
    const item: TreeProduct = { id: p.id, name: p.name, unit: p.unit, supplier: p.supplier ?? null, code: p.code ?? null, spend: p.spend ?? 0, terms: p.terms ?? [] };
    if (!isStrategic(p.kind)) {
      const kind = isProductKind(p.kind) ? p.kind : "other";
      sub(node(SPEND_KEY, t("Other spend"), "spend"), kind, t(KIND_GROUP_LABEL[kind])).products.push(item);
    } else if (!keyOf(p.category)) {
      node(UNCLASSIFIED_KEY, t("To classify"), "unclassified").direct.push(item);
    } else {
      const n = node(keyOf(p.category), p.category!.trim(), "category");
      if (keyOf(p.subcategory)) sub(n, keyOf(p.subcategory), p.subcategory!.trim()).products.push(item);
      else n.direct.push(item);
    }
  }

  const largest = (a: TreeProduct, b: TreeProduct) => b.spend - a.spend || byName.compare(a.name, b.name);
  // What the company arranged, in its order; then the rest, the largest spend first.
  const ordered = <X extends TreeCategory | TreeSub>(xs: X[], spend: (x: X) => number) =>
    [...xs].sort((a, b) => (position.get(a) ?? Infinity) - (position.get(b) ?? Infinity) || spend(b) - spend(a) || byName.compare(a.name, b.name));
  const GROUPS: TreeGroup[] = ["category", "spend", "unclassified"];
  for (const n of nodes.values()) {
    for (const s of n.subs) s.products.sort(largest);
    n.direct.sort(largest);
    n.subs = ordered(n.subs, (s) => sum(s.products, (p) => p.spend));
    n.count = n.direct.length + sum(n.subs, (s) => s.products.length);
    n.spend = sum(n.direct, (p) => p.spend) + sum(n.subs, (s) => sum(s.products, (p) => p.spend));
  }
  return { categories: GROUPS.flatMap((g) => ordered([...nodes.values()].filter((n) => n.group === g), (n) => n.spend)), count: products.length };
}

// ---------------- What the user picked ----------------

/** A place in the tree, by keys: a category, one of its subcategories, a product. Each level is optional. */
export interface Selection {
  category: string | null;
  subcategory: string | null;
  product: string | null;
}
export const NO_SELECTION: Selection = { category: null, subcategory: null, product: null };

export interface Resolved {
  category: TreeCategory | null;
  sub: TreeSub | null;
  product: TreeProduct | null;
  /** The products the selection stands for. Null: every product. Empty: the address names nothing on file. */
  productIds: Set<string> | null;
  /** The path in words, to show: "Wax › Paraffin › Paraffin 52/54". */
  path: string[];
  /** The selection as the tree reads it: a product's own category and subcategory, whatever the address said. */
  selection: Selection;
}

export const productsOf = (c: TreeCategory): TreeProduct[] => [...c.subs.flatMap((s) => s.products), ...c.direct];
/** The tree without the other spend: for a page that works on the catalogue only (compare, sourcing, requests). */
export function catalogueTree(tree: CategoryTree): CategoryTree {
  const categories = tree.categories.filter((c) => c.group !== "spend");
  return { categories, count: categories.reduce((n, c) => n + c.count, 0) };
}
export const allProducts = (tree: CategoryTree): TreeProduct[] => tree.categories.flatMap(productsOf);

/** Where a product is filed. */
export function placeOf(tree: CategoryTree, productId: string): { category: TreeCategory; sub: TreeSub | null; product: TreeProduct } | null {
  for (const category of tree.categories) {
    const direct = category.direct.find((p) => p.id === productId);
    if (direct) return { category, sub: null, product: direct };
    for (const sub of category.subs) {
      const product = sub.products.find((p) => p.id === productId);
      if (product) return { category, sub, product };
    }
  }
  return null;
}

export function resolve(tree: CategoryTree, selection: Selection, t: T = en): Resolved {
  const none: Resolved = { category: null, sub: null, product: null, productIds: null, path: [], selection: NO_SELECTION };
  if (selection.product) {
    const place = placeOf(tree, selection.product);
    // A product is its own address: its category is read from where it is filed today.
    if (!place) return { ...none, productIds: new Set(), selection: { ...NO_SELECTION, product: selection.product } };
    return {
      category: place.category,
      sub: place.sub,
      product: place.product,
      productIds: new Set([place.product.id]),
      path: [place.category.name, ...(place.sub ? [place.sub.name] : []), place.product.name],
      selection: { category: place.category.key, subcategory: place.sub?.key ?? null, product: place.product.id },
    };
  }
  if (!selection.category) return none;
  const category = tree.categories.find((c) => c.key === selection.category) ?? null;
  if (!category) return { ...none, productIds: new Set(), path: [selection.category], selection: { ...NO_SELECTION, category: selection.category } };
  if (!selection.subcategory) return { ...none, category, productIds: new Set(productsOf(category).map((p) => p.id)), path: [category.name], selection: { ...NO_SELECTION, category: category.key } };
  if (selection.subcategory === NO_SUB_KEY) {
    return { ...none, category, productIds: new Set(category.direct.map((p) => p.id)), path: [category.name, t("No subcategory")], selection: { category: category.key, subcategory: NO_SUB_KEY, product: null } };
  }
  const sub = category.subs.find((s) => s.key === selection.subcategory) ?? null;
  if (!sub) return { ...none, category, productIds: new Set(), path: [category.name, selection.subcategory], selection: { category: category.key, subcategory: selection.subcategory, product: null } };
  return { ...none, category, sub, productIds: new Set(sub.products.map((p) => p.id)), path: [category.name, sub.name], selection: { category: category.key, subcategory: sub.key, product: null } };
}

// ---------------- Built-in names and the company's own ----------------

const it = translator("it");
const same = (label: Msg, key: string) => keyOf(label) === key || keyOf(it(label)) === key;

/** The built-in category a name is, in either language ("Packaging", "Imballaggio"). */
export const builtinCategoryKey = (name: string | null | undefined): string | null => {
  const key = keyOf(name);
  return key ? (TAXONOMY.find((c) => same(c.label, key))?.key ?? null) : null;
};
/** The built-in subcategory a name is, in either language ("Paraffin", "Paraffina"). */
export const builtinSubKey = (name: string | null | undefined): string | null => {
  const key = keyOf(name);
  return key ? (allSubs().find((r) => same(r.sub.label, key))?.sub.key ?? null) : null;
};

/**
 * How the company names what the rules know by a built-in key. The Product
 * Mapper reads "paraffin" from a description; where paraffin is filed is the
 * company's choice — renamed, or moved under another category — and a new
 * product follows it there instead of re-creating the built-in names.
 */
export interface CategoryNaming {
  /** Where the company files a built-in subcategory. Null: under the built-in names. */
  of(subKey: string): { category: string; subcategory: string } | null;
  /** The built-in subcategory a product's own category and subcategory stand for. */
  subKeyOf(category: string | null | undefined, subcategory: string | null | undefined): string | null;
}

export function categoryNaming(rows: CategoryRow[] = [], t: T = en): CategoryNaming {
  const top = rows.filter((r) => !r.parentId);
  const parentOf = (r: CategoryRow) => top.find((x) => x.id === r.parentId) ?? null;
  return {
    of(subKey) {
      const ref = subByKey(subKey);
      if (!ref) return null;
      const own = rows.find((r) => r.parentId && r.taxonomyKey === subKey && parentOf(r));
      if (own) return { category: parentOf(own)!.name, subcategory: own.name };
      const category = top.find((r) => r.taxonomyKey === ref.category.key);
      return category ? { category: category.name, subcategory: t(ref.sub.label) } : null;
    },
    subKeyOf(category, subcategory) {
      const key = keyOf(subcategory);
      if (!key) return null;
      const named = rows.filter((r) => r.parentId && r.taxonomyKey && keyOf(r.name) === key);
      const own = named.find((r) => keyOf(parentOf(r)?.name) === keyOf(category)) ?? (named.length === 1 ? named[0] : null);
      return own?.taxonomyKey ?? builtinSubKey(subcategory);
    },
  };
}
