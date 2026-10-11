/**
 * Category › subcategory › product: the tree the pages walk, built from the
 * names the products carry and from what the company decided about its own
 * hierarchy. Generic cases: no company's products are assumed.
 */
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { NO_SELECTION, NO_SUB_KEY, SPEND_KEY, UNCLASSIFIED_KEY, allProducts, buildTree, builtinCategoryKey, catalogueTree, builtinSubKey, categoryNaming, placeOf, resolve, type CategoryRow, type TreeInput } from "./tree";

const p = (id: string, name: string, category: string | null, subcategory: string | null, more: Partial<TreeInput> = {}): TreeInput => ({ id, name, unit: "pcs", kind: "direct_material", category, subcategory, spend: 0, ...more });

const PRODUCTS: TreeInput[] = [
  p("steel-2", "Steel sheet 2 mm", "Metals", "Sheet", { spend: 9000, unit: "kg" }),
  p("steel-3", "Steel sheet 3 mm", "Metals", "Sheet", { spend: 4000, unit: "kg" }),
  p("bar", "Brass bar 20", "Metals", "Bars", { spend: 12000, unit: "kg" }),
  p("alloy", "Alloy X", "Metals", null, { spend: 100 }),
  p("box", "Carton 40x30", "Packaging", "Boxes", { spend: 800 }),
  p("tape", "Tape 50 mm", "packaging", "Tape", { spend: 50 }),
  p("mystery", "ART 77", null, null, { spend: 300, kind: "needs_review" }),
  p("freight", "Freight — Carrier Ltd", null, null, { kind: "logistics", spend: 5000 }),
  p("audit", "Audit — Firm LLP", null, null, { kind: "service", spend: 700 }),
];

describe("the tree", () => {
  const tree = buildTree(PRODUCTS);

  it("files every product once, under the names it carries", () => {
    expect(tree.count).toBe(PRODUCTS.length);
    expect(allProducts(tree).map((x) => x.id).sort()).toEqual(PRODUCTS.map((x) => x.id).sort());
    const metals = tree.categories.find((c) => c.name === "Metals")!;
    expect(metals.count).toBe(4);
    expect(metals.subs.map((s) => [s.name, s.products.length])).toEqual([
      ["Sheet", 2],
      ["Bars", 1],
    ]);
    expect(metals.direct.map((x) => x.id)).toEqual(["alloy"]);
  });

  it("reads two spellings of a name as one category", () => {
    const packaging = tree.categories.filter((c) => c.key === "packaging");
    expect(packaging).toHaveLength(1);
    expect(packaging[0].count).toBe(2);
  });

  it("puts the largest spend first, at every level", () => {
    expect(tree.categories.filter((c) => c.group === "category").map((c) => c.name)).toEqual(["Metals", "Packaging"]);
    expect(tree.categories.find((c) => c.name === "Metals")!.subs[0].products.map((x) => x.id)).toEqual(["steel-2", "steel-3"]);
  });

  it("never files a product by itself: one with no category is to classify", () => {
    const open = tree.categories.find((c) => c.key === UNCLASSIFIED_KEY)!;
    expect(open.group).toBe("unclassified");
    expect(open.direct.map((x) => x.id)).toEqual(["mystery"]);
  });

  it("keeps transport and services apart from the catalogue, each under its own kind", () => {
    const spend = tree.categories.find((c) => c.key === SPEND_KEY)!;
    expect(spend.group).toBe("spend");
    expect(spend.subs.map((s) => [s.key, s.products.map((x) => x.id)])).toEqual([
      ["logistics", ["freight"]],
      ["service", ["audit"]],
    ]);
    // …and after the categories, whatever it weighs.
    expect(tree.categories.map((c) => c.group)).toEqual(["category", "category", "spend", "unclassified"]);
  });

  it("can be read without the other spend, for the pages that work on the catalogue", () => {
    const catalogue = catalogueTree(tree);
    expect(catalogue.categories.map((c) => c.group)).toEqual(["category", "category", "unclassified"]);
    expect(catalogue.count).toBe(7);
  });

  it("names the special places in the reader's language", () => {
    const it_ = buildTree(PRODUCTS, [], translator("it"));
    expect(it_.categories.find((c) => c.key === SPEND_KEY)!.name).toBe("Altre spese");
    expect(it_.categories.find((c) => c.key === UNCLASSIFIED_KEY)!.name).toBe("Da classificare");
    expect(it_.categories.find((c) => c.key === SPEND_KEY)!.subs[0].name).toBe("Trasporti e logistica");
  });
});

describe("the company's own hierarchy", () => {
  const rows: CategoryRow[] = [
    { id: "c1", name: "Packaging", parentId: null, taxonomyKey: null, position: 0 },
    { id: "c2", name: "METALS", parentId: null, taxonomyKey: null, position: 1 },
    { id: "c3", name: "Chemicals", parentId: null, taxonomyKey: null, position: null },
    { id: "s1", name: "Bars", parentId: "c2", taxonomyKey: null, position: 0 },
    { id: "s2", name: "Tubes", parentId: "c2", taxonomyKey: null, position: null },
  ];
  const tree = buildTree(PRODUCTS, rows);

  it("shows the order the company gave, then the largest spend", () => {
    expect(tree.categories.filter((c) => c.group === "category").map((c) => c.name)).toEqual(["Packaging", "METALS", "Chemicals"]);
    expect(tree.categories.find((c) => c.key === "metals")!.subs.map((s) => s.name)).toEqual(["Bars", "Sheet", "Tubes"]);
  });

  it("shows a name as the company wrote it", () => {
    expect(tree.categories.find((c) => c.key === "metals")!.name).toBe("METALS");
  });

  it("keeps a category and a subcategory that have no product yet", () => {
    const chemicals = tree.categories.find((c) => c.name === "Chemicals")!;
    expect(chemicals.count).toBe(0);
    expect(tree.categories.find((c) => c.key === "metals")!.subs.find((s) => s.name === "Tubes")!.products).toEqual([]);
  });

  it("says which places have a row and which only products name", () => {
    expect(tree.categories.find((c) => c.key === "metals")!.id).toBe("c2");
    expect(tree.categories.find((c) => c.key === "metals")!.subs.find((s) => s.name === "Sheet")!.id).toBeNull();
  });
});

describe("what the user picked", () => {
  const tree = buildTree(PRODUCTS);
  const ids = (selection: Parameters<typeof resolve>[1]) => [...(resolve(tree, selection).productIds ?? [])].sort();

  it("nothing picked is every product", () => {
    expect(resolve(tree, NO_SELECTION).productIds).toBeNull();
    expect(resolve(tree, NO_SELECTION).path).toEqual([]);
  });

  it("a category is all its products, with or without a subcategory", () => {
    expect(ids({ category: "metals", subcategory: null, product: null })).toEqual(["alloy", "bar", "steel-2", "steel-3"]);
    expect(resolve(tree, { category: "metals", subcategory: null, product: null }).path).toEqual(["Metals"]);
  });

  it("a subcategory is only its own products", () => {
    expect(ids({ category: "metals", subcategory: "sheet", product: null })).toEqual(["steel-2", "steel-3"]);
    expect(resolve(tree, { category: "metals", subcategory: "sheet", product: null }).path).toEqual(["Metals", "Sheet"]);
  });

  it("the products of a category that have no subcategory can be asked for on their own", () => {
    expect(ids({ category: "metals", subcategory: NO_SUB_KEY, product: null })).toEqual(["alloy"]);
  });

  it("a product is one product, and says where it is filed", () => {
    const r = resolve(tree, { category: null, subcategory: null, product: "steel-3" });
    expect([...r.productIds!]).toEqual(["steel-3"]);
    expect(r.path).toEqual(["Metals", "Sheet", "Steel sheet 3 mm"]);
    expect(r.selection).toEqual({ category: "metals", subcategory: "sheet", product: "steel-3" });
  });

  it("a product is read where it is filed today, whatever the address says", () => {
    const r = resolve(tree, { category: "packaging", subcategory: "boxes", product: "bar" });
    expect(r.path).toEqual(["Metals", "Bars", "Brass bar 20"]);
  });

  it("the other spend can be picked whole or one kind at a time", () => {
    expect(ids({ category: SPEND_KEY, subcategory: null, product: null })).toEqual(["audit", "freight"]);
    expect(ids({ category: SPEND_KEY, subcategory: "logistics", product: null })).toEqual(["freight"]);
  });

  it("an address that names nothing on file matches nothing, instead of everything", () => {
    expect(ids({ category: "gone", subcategory: null, product: null })).toEqual([]);
    expect(ids({ category: "metals", subcategory: "gone", product: null })).toEqual([]);
    expect(ids({ category: null, subcategory: null, product: "gone" })).toEqual([]);
  });

  it("finds where a product is", () => {
    expect(placeOf(tree, "alloy")).toMatchObject({ category: { name: "Metals" }, sub: null });
    expect(placeOf(tree, "nope")).toBeNull();
  });
});

describe("built-in names and the company's own", () => {
  it("recognises a built-in name in either language", () => {
    expect(builtinCategoryKey("Packaging")).toBe("packaging");
    expect(builtinCategoryKey("imballaggio")).toBe("packaging");
    expect(builtinSubKey("Paraffina")).toBe("paraffin");
    expect(builtinSubKey("Cardboard boxes")).toBe("cardboard");
    expect(builtinSubKey("Whatever")).toBeNull();
  });

  it("with nothing decided, the built-in names stand", () => {
    const naming = categoryNaming([]);
    expect(naming.of("paraffin")).toBeNull();
    expect(naming.subKeyOf("Waxes and paraffin", "Paraffin")).toBe("paraffin");
    expect(naming.subKeyOf("Cere e paraffine", "Paraffina")).toBe("paraffin");
  });

  it("a renamed category takes its built-in subcategories with it", () => {
    const naming = categoryNaming([{ id: "c", name: "Wax", parentId: null, taxonomyKey: "wax", position: null }]);
    expect(naming.of("paraffin")).toEqual({ category: "Wax", subcategory: "Paraffin" });
    expect(categoryNaming([{ id: "c", name: "Cera", parentId: null, taxonomyKey: "wax", position: null }], translator("it")).of("paraffin")).toEqual({ category: "Cera", subcategory: "Paraffina" });
  });

  it("a subcategory renamed and moved is found where the company put it", () => {
    const rows: CategoryRow[] = [
      { id: "c1", name: "Wicks", parentId: null, taxonomyKey: "wick", position: null },
      { id: "c2", name: "Metal parts", parentId: null, taxonomyKey: null, position: null },
      { id: "s", name: "Sustainers", parentId: "c2", taxonomyKey: "wick_holder", position: null },
    ];
    const naming = categoryNaming(rows);
    expect(naming.of("wick_holder")).toEqual({ category: "Metal parts", subcategory: "Sustainers" });
    // …and its own name still stands for the built-in subcategory the rules know.
    expect(naming.subKeyOf("Metal parts", "Sustainers")).toBe("wick_holder");
    expect(naming.subKeyOf("Metal parts", "Something else")).toBeNull();
  });
});
