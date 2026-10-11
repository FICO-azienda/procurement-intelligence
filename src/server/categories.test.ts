/**
 * The company's categories on a real in-memory Postgres: the hierarchy is
 * rearranged — renamed, moved, reordered — and the products follow, while
 * nothing about what was bought, at what price and from whom ever changes.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { SPEND_KEY, UNCLASSIFIED_KEY, resolve } from "@/lib/catalog/tree";
import { productKey } from "@/lib/import/normalize/text";
import { CategoryError, createCategory, deleteCategory, moveProducts, moveSubcategory, namesOnOffer, readCategoryRows, readTree, renameCategory, reorderCategory } from "./categories";
import { analyzeCatalogue } from "./mapper";
import { readRfqLines } from "./sourcing";

let db: DB;
const ids: Record<string, string> = {};

async function product(key: string, name: string, supplierId: string, kind: string, place: [string, string | null] | null, price: number, mapped = true) {
  const [row] = await db
    .insert(schema.products)
    .values({ name, sku: key.toUpperCase(), unit: "kg", kind, category: place?.[0] ?? null, subcategory: place?.[1] ?? null, mappedAt: mapped ? new Date() : null })
    .returning();
  ids[key] = row.id;
  await db.insert(schema.productAliases).values({ productId: row.id, alias: name.toUpperCase(), normalized: productKey(name), supplierId });
  await db.insert(schema.purchases).values({ productId: row.id, supplierId, date: "2026-06-10", quantity: "100", unit: "kg", unitPrice: String(price), totalAmount: String(100 * price), originalDescription: name.toUpperCase() });
}

const row = async (key: string) => (await db.select().from(schema.products).where(eq(schema.products.id, ids[key])))[0];
const facts = async () => (await db.select().from(schema.purchases).orderBy(asc(schema.purchases.originalDescription))).map((x) => [x.productId, x.supplierId, x.date, x.quantity, x.unitPrice, x.totalAmount, x.originalDescription].join("|"));
const names = async () => (await readTree(db)).categories.map((c) => `${c.name}: ${[...c.subs.map((s) => `${s.name} ${s.products.length}`), ...(c.direct.length ? [`– ${c.direct.length}`] : [])].join(", ")}`);
const proposal = async (key: string) => {
  const m = (await analyzeCatalogue(db)).products.find((x) => x.productId === ids[key])!;
  return [m.category, m.subcategory];
};
let before: string[] = [];

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [acme] = await db.insert(schema.suppliers).values({ name: "ACME Chemicals", country: "Italy" }).returning();
  const [carrier] = await db.insert(schema.suppliers).values({ name: "Carrier Ltd", country: "Italy" }).returning();
  await product("par", "Paraffin 52/54", acme.id, "direct_material", ["Waxes and paraffin", "Paraffin"], 1.5);
  await product("blend", "Candle compound B", acme.id, "direct_material", ["Waxes and paraffin", "Candle wax blend"], 1.4);
  await product("box", "Box 40x30x20", acme.id, "packaging", ["Packaging", "Cardboard boxes"], 0.4);
  await product("clip", "Wick holder 60", acme.id, "component", ["Wicks and wick parts", "Wick holders and clips"], 0.03);
  await product("odd", "ART 77", acme.id, "needs_review", null, 2, false);
  await product("freight", "Freight — Carrier Ltd", carrier.id, "logistics", null, 250);
  // As an import leaves them: named by the invoice, not confirmed, with no category yet.
  await product("par2", "PARAFFINA ACME 58/60", acme.id, "direct_material", null, 1.6, false);
  await product("clip2", "FONDELLI ACME D.70", acme.id, "component", null, 0.04, false);
  const [family] = await db.insert(schema.productFamilies).values({ name: "Paraffin", category: "Waxes and paraffin", subcategory: "Paraffin" }).returning();
  await db.update(schema.products).set({ familyId: family.id }).where(eq(schema.products.id, ids.par));
  before = await facts();
}, 30_000);

describe("the tree, read from what the products carry", () => {
  it("needs nothing written about the hierarchy", async () => {
    expect(await readCategoryRows(db)).toEqual([]);
    expect(await names()).toEqual(["Waxes and paraffin: Paraffin 1, Candle wax blend 1", "Packaging: Cardboard boxes 1", "Wicks and wick parts: Wick holders and clips 1", "Other spend: Transport and logistics 1", "To classify: – 3"]);
  });

  it("a purchases filter is a set of products at each of the three levels", async () => {
    const tree = await readTree(db);
    const bought = await db.select().from(schema.purchases);
    const count = (selection: Parameters<typeof resolve>[1]) => {
      const { productIds } = resolve(tree, selection);
      return bought.filter((x) => !productIds || productIds.has(x.productId)).length;
    };
    expect(count({ category: null, subcategory: null, product: null })).toBe(8);
    expect(count({ category: "waxes and paraffin", subcategory: null, product: null })).toBe(2);
    expect(count({ category: "waxes and paraffin", subcategory: "paraffin", product: null })).toBe(1);
    expect(count({ category: null, subcategory: null, product: ids.box })).toBe(1);
    expect(count({ category: SPEND_KEY, subcategory: "logistics", product: null })).toBe(1);
    expect(count({ category: UNCLASSIFIED_KEY, subcategory: null, product: null })).toBe(3);
  });

  it("the rules read new products under the built-in names", async () => {
    expect(await proposal("par2")).toEqual(["Waxes and paraffin", "Paraffin"]);
    expect(await proposal("clip2")).toEqual(["Wicks and wick parts", "Wick holders and clips"]);
  });
});

describe("renaming", () => {
  it("a category takes another name, and its products and families follow", async () => {
    await renameCategory(db, { category: "Waxes and paraffin" }, "Wax");
    expect((await row("par")).category).toBe("Wax");
    expect((await row("blend")).category).toBe("Wax");
    expect((await row("box")).category).toBe("Packaging");
    expect((await db.select().from(schema.productFamilies))[0]).toMatchObject({ category: "Wax", subcategory: "Paraffin" });
    expect((await names())[0]).toBe("Wax: Paraffin 1, Candle wax blend 1");
  });

  it("remembers what the category was, so that new products are filed with the others", async () => {
    expect(await readCategoryRows(db)).toMatchObject([{ name: "Wax", parentId: null, taxonomyKey: "wax" }]);
    expect(await proposal("par2")).toEqual(["Wax", "Paraffin"]);
  });

  it("a subcategory takes another name, and is still the material the rules know", async () => {
    await renameCategory(db, { category: "Wax", subcategory: "Paraffin" }, "Refined paraffin");
    expect(await row("par")).toMatchObject({ category: "Wax", subcategory: "Refined paraffin" });
    expect((await db.select().from(schema.productFamilies))[0]).toMatchObject({ category: "Wax", subcategory: "Refined paraffin" });
    expect(await proposal("par2")).toEqual(["Wax", "Refined paraffin"]);
    // A request for quotation still asks what is asked of a wax.
    expect((await readRfqLines(db, [ids.par])).get(ids.par)!.category).toBe("wax");
  });

  it("only the spelling may change", async () => {
    await renameCategory(db, { category: "Wax" }, "WAX");
    expect((await row("par")).category).toBe("WAX");
    await renameCategory(db, { category: "wax" }, "Wax");
    expect((await readCategoryRows(db)).filter((r) => !r.parentId)).toHaveLength(1);
  });

  it("refuses a name another category has: two categories are never folded into one by a rename", async () => {
    await expect(renameCategory(db, { category: "Packaging" }, "wax")).rejects.toBeInstanceOf(CategoryError);
    await expect(renameCategory(db, { category: "Wax", subcategory: "Candle wax blend" }, "Refined Paraffin")).rejects.toBeInstanceOf(CategoryError);
    await expect(renameCategory(db, { category: "Packaging" }, "  ")).rejects.toBeInstanceOf(CategoryError);
    await expect(renameCategory(db, { category: "Nowhere" }, "Somewhere")).rejects.toBeInstanceOf(CategoryError);
    expect((await row("box")).category).toBe("Packaging");
  });
});

describe("new categories", () => {
  it("a category with no product yet is on the list, empty", async () => {
    await createCategory(db, "Metal parts");
    await createCategory(db, "Sustainers", "Metal parts");
    expect(await names()).toContain("Metal parts: Sustainers 0");
  });

  it("refuses a name already there, at either level", async () => {
    await expect(createCategory(db, "metal parts")).rejects.toBeInstanceOf(CategoryError);
    await expect(createCategory(db, "Packaging")).rejects.toBeInstanceOf(CategoryError);
    await expect(createCategory(db, "sustainers", "Metal parts")).rejects.toBeInstanceOf(CategoryError);
    await expect(createCategory(db, "Cardboard Boxes", "Packaging")).rejects.toBeInstanceOf(CategoryError);
    await expect(createCategory(db, "Anything", "Nowhere")).rejects.toBeInstanceOf(CategoryError);
  });

  it("offers the company's names before the built-in ones it has not taken over", async () => {
    const offer = namesOnOffer(await readTree(db), await readCategoryRows(db));
    expect(offer.categories.slice(0, 4)).toEqual(["Wax", "Packaging", "Wicks and wick parts", "Metal parts"]);
    expect(offer.categories).not.toContain("Waxes and paraffin");
    expect(offer.subcategories).toContain("Refined paraffin");
    expect(offer.subcategories).not.toContain("Paraffin");
    expect(offer.subcategories).toContain("Glass");
  });
});

describe("moving", () => {
  it("a subcategory goes under another category with everything in it", async () => {
    await moveSubcategory(db, { category: "Wicks and wick parts", subcategory: "Wick holders and clips" }, "Metal parts");
    expect(await row("clip")).toMatchObject({ category: "Metal parts", subcategory: "Wick holders and clips" });
    expect(await names()).toContain("Metal parts: Wick holders and clips 1, Sustainers 0");
    // The category it left stays on the list, empty, until the user takes it off: nothing is tidied away by itself.
    expect(await names()).toContain("Wicks and wick parts: ");
    await deleteCategory(db, { category: "Wicks and wick parts" });
    expect((await names()).some((n) => n.startsWith("Wicks and wick parts"))).toBe(false);
  });

  it("…and what the rules read as it is filed there from now on", async () => {
    expect(await proposal("clip2")).toEqual(["Metal parts", "Wick holders and clips"]);
  });

  it("refuses to move it where there is one of the same name", async () => {
    await createCategory(db, "Wick holders and clips", "Packaging");
    await expect(moveSubcategory(db, { category: "Metal parts", subcategory: "Wick holders and clips" }, "Packaging")).rejects.toBeInstanceOf(CategoryError);
    await deleteCategory(db, { category: "Packaging", subcategory: "Wick holders and clips" });
  });

  it("products filed by the user are the user's answer: confirmed, where the user put them", async () => {
    expect((await row("odd")).mappedAt).toBeNull();
    expect(await moveProducts(db, [ids.odd], { category: "Metal parts", subcategory: "Sustainers" })).toEqual({ moved: 1 });
    const odd = await row("odd");
    expect(odd).toMatchObject({ category: "Metal parts", subcategory: "Sustainers", name: "ART 77" });
    expect(odd.mappedAt).not.toBeNull();
    // …and the Product Mapper keeps it there.
    expect(await proposal("odd")).toEqual(["Metal parts", "Sustainers"]);
  });

  it("a product moved into a built-in category is the kind of thing that category holds", async () => {
    await db.update(schema.products).set({ category: null, subcategory: null, mappedAt: null }).where(eq(schema.products.id, ids.odd));
    await moveProducts(db, [ids.odd], { category: "Packaging" });
    expect(await row("odd")).toMatchObject({ category: "Packaging", subcategory: null, kind: "packaging" });
  });

  it("back among the products to classify, the rules propose again", async () => {
    await moveProducts(db, [ids.odd], null);
    expect(await row("odd")).toMatchObject({ category: null, subcategory: null, mappedAt: null });
    expect((await names()).at(-1)).toBe("To classify: – 3");
  });

  it("never files transport or a service among the products", async () => {
    expect(await moveProducts(db, [ids.freight], { category: "Packaging" })).toEqual({ moved: 0 });
    expect((await row("freight")).category).toBeNull();
  });

  it("refuses a place that is not there", async () => {
    await expect(moveProducts(db, [ids.box], { category: "Nowhere" })).rejects.toBeInstanceOf(CategoryError);
    await expect(moveProducts(db, [ids.box], { category: "Packaging", subcategory: "Nowhere" })).rejects.toBeInstanceOf(CategoryError);
  });
});

describe("the order", () => {
  const order = async () => (await readTree(db)).categories.filter((c) => c.group === "category").map((c) => c.name);

  it("is the largest spend first, until the company arranges it", async () => {
    expect(await order()).toEqual(["Wax", "Packaging", "Metal parts"]);
  });

  it("moves one place at a time and stays as arranged", async () => {
    await reorderCategory(db, { category: "Metal parts" }, "up");
    expect(await order()).toEqual(["Wax", "Metal parts", "Packaging"]);
    await reorderCategory(db, { category: "Metal parts" }, "up");
    expect(await order()).toEqual(["Metal parts", "Wax", "Packaging"]);
    await reorderCategory(db, { category: "Metal parts" }, "up");
    expect(await order()).toEqual(["Metal parts", "Wax", "Packaging"]);
  });

  it("orders the subcategories of a category the same way", async () => {
    const subs = async () => (await readTree(db)).categories.find((c) => c.name === "Metal parts")!.subs.map((s) => s.name);
    expect(await subs()).toEqual(["Wick holders and clips", "Sustainers"]);
    await reorderCategory(db, { category: "Metal parts", subcategory: "Sustainers" }, "up");
    expect(await subs()).toEqual(["Sustainers", "Wick holders and clips"]);
  });
});

describe("taking a category off the list", () => {
  it("never with products in it", async () => {
    await expect(deleteCategory(db, { category: "Wax" })).rejects.toBeInstanceOf(CategoryError);
    await expect(deleteCategory(db, { category: "Metal parts", subcategory: "Wick holders and clips" })).rejects.toBeInstanceOf(CategoryError);
    expect((await row("par")).category).toBe("Wax");
  });

  it("an empty one goes, with its empty subcategories", async () => {
    await deleteCategory(db, { category: "Metal parts", subcategory: "Sustainers" });
    await createCategory(db, "Spare");
    await createCategory(db, "Bits", "Spare");
    await deleteCategory(db, { category: "Spare" });
    const rows = await readCategoryRows(db);
    expect(rows.some((r) => r.name === "Spare" || r.name === "Bits" || r.name === "Sustainers")).toBe(false);
  });
});

describe("whatever was rearranged", () => {
  it("every purchase is of the same product, at the same price, from the same supplier", async () => {
    expect(await facts()).toEqual(before);
  });

  it("no product was deleted or renamed", async () => {
    const all = await db.select().from(schema.products);
    expect(all).toHaveLength(8);
    expect(all.map((p) => p.name).sort()).toEqual(["ART 77", "Box 40x30x20", "Candle compound B", "FONDELLI ACME D.70", "Freight — Carrier Ltd", "PARAFFINA ACME 58/60", "Paraffin 52/54", "Wick holder 60"]);
  });
});
