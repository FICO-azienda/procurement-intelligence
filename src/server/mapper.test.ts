/**
 * Product Mapper on a real in-memory Postgres: what the user confirms is
 * written — names, categories, families, variants, merges — and nothing about
 * what was bought, at what price and from whom ever changes.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { catalogueOf } from "@/lib/catalog/spend";
import { readDataset, readLearning } from "@/lib/data";
import { productKey } from "@/lib/import/normalize/text";
import { decisionFor } from "@/lib/intel/decision";
import { analyze } from "@/lib/intel/engine";
import { analyzeCatalogue, confirmMappings, confirmVariants, keepSeparate, mergeProducts, mergedInto, readProductMerges, saveMapping, undoProductMerge } from "./mapper";

let db: DB;
const ids: Record<string, string> = {};
const today = todayISO();
const day = (monthsAgo: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
};

async function supplier(name: string) {
  const [row] = await db.insert(schema.suppliers).values({ name, country: "Italy" }).returning();
  return row.id;
}

/** A product as an import leaves it: named as on the invoice, with its description and purchases. */
async function product(key: string, name: string, supplierId: string, kind: string, unit: string, buys: [quantity: number, unitPrice: number][], code?: string) {
  const [row] = await db.insert(schema.products).values({ name, sku: key.toUpperCase(), unit, kind }).returning();
  ids[key] = row.id;
  await db.insert(schema.productAliases).values({ productId: row.id, alias: name.toUpperCase(), normalized: productKey(name), supplierId, supplierSku: code ?? null });
  await db.insert(schema.supplierProducts).values({ supplierId, productId: row.id, supplierSku: code ?? null, supplierProductName: name });
  for (const [i, [quantity, unitPrice]] of buys.entries()) {
    await db.insert(schema.purchases).values({ productId: row.id, supplierId, date: day(i + 1), quantity: String(quantity), unit, unitPrice: String(unitPrice), totalAmount: String(quantity * unitPrice), originalDescription: name.toUpperCase(), source: "csv" });
  }
}

const row = async (key: string) => (await db.select().from(schema.products).where(eq(schema.products.id, ids[key])))[0];
const facts = async () =>
  (await db.select().from(schema.purchases).orderBy(asc(schema.purchases.date), asc(schema.purchases.originalDescription), asc(schema.purchases.unitPrice))).map((x) => [x.date, x.supplierId, x.quantity, x.unit, x.unitPrice, x.totalAmount, x.originalDescription].join("|"));

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [ser, erre, bianchi, screen, xone] = [await supplier("SER S.p.A."), await supplier("ERREPLAST SRL"), await supplier("Cereria Bianchi"), await supplier("SPECIAL SCREEN SRL"), await supplier("XONE S.R.L.")];
  Object.assign(ids, { ser, erre, bianchi, screen, xone });
  await product("par", "Paraffina SER 52/54 (XXF)", ser, "direct_material", "kg", [[20000, 1.5], [20000, 1.52]], "PRP026");
  await product("lc", "ART. LC TR. Contenitori per ceri", erre, "component", "pcs", [[10000, 0.12]]);
  await product("c50", "ART. 50/2 Contenitori per ceri", erre, "component", "pcs", [[5000, 0.2]]);
  await product("a60", "Candela Liturgica Altare Ø 35x200 mm 60 pz. x scat", bianchi, "direct_material", "kg", [[40, 4.25]], "CLA");
  await product("a240", "Candela Liturgica Altare Ø 35x200 mm 240 pz.", bianchi, "direct_material", "kg", [[30, 4.25], [10, 4.25]], "CLA");
  await product("a25", "Candela Liturgica Altare Ø 25x160 mm 240 pz.", bianchi, "direct_material", "kg", [[20, 4.25]], "CLA");
  await product("a40", "Candela Liturgica Altare Ø 40x600 mm 36pz.", bianchi, "direct_material", "kg", [[5, 4.25]], "CLA");
  await product("l1", "50x70 - Best Choice - Articolo 60T", screen, "packaging", "pcs", [[50000, 0.01]], "290622");
  await product("l2", "55x55 - Madonna del Frassino", screen, "packaging", "pcs", [[30000, 0.02]], "290675");
  await product("net", "XONE Rete ombreggiante verde rotolo", xone, "direct_material", "pcs", [[1, 131]]);
  await product("freight", "Trasporto — SER S.p.A.", ser, "logistics", "pcs", [[1, 250]]);
}, 30_000);

describe("the catalogue as the imports left it", () => {
  it("is read without writing: what is sure, what to ask, what may be a duplicate", async () => {
    const a = await analyzeCatalogue(db);
    expect(a.totals).toMatchObject({ analysed: 10, confirmed: 0, high: 3, medium: 2, low: 3, inDuplicates: 2 });
    expect(a.duplicates).toMatchObject([{ productIds: [ids.a240, ids.a60], level: "possible", suggestion: "merge" }]);
    expect(a.cards.map((c) => [c.type, c.supplierName, c.productIds.length])).toEqual([
      ["check", "ERREPLAST SRL", 2],
      ["classify", "SPECIAL SCREEN SRL", 2],
      ["classify", "XONE S.R.L.", 1],
    ]);
    expect(a.products[0]).toMatchObject({ productId: ids.par, spend: 60_400 });
    expect((await row("par")).name).toBe("Paraffina SER 52/54 (XXF)");
  });

  it("shows every product as \"to classify\" until the user confirms what it is", async () => {
    const data = await readDataset(db);
    const intel = analyze(catalogueOf(data), (await readLearning(db)).supplierProducts, [], today);
    expect(decisionFor(intel, ids.par)!.status).toBe("needs_classification");
  });
});

describe("confirming in bulk", () => {
  let before: string[];

  it("writes name, category, family and variant of every sure product, and nothing else", async () => {
    before = await facts();
    expect(await confirmMappings(db)).toEqual({ confirmed: 3 });
    // What only a supplier's article code tells apart is not confirmed in bulk: the user looks at the group and confirms it.
    expect((await row("lc")).mappedAt).toBeNull();
    expect(await confirmMappings(db, { productIds: [ids.lc, ids.c50] })).toEqual({ confirmed: 2 });
    expect(await row("par")).toMatchObject({ name: "Paraffina 52/54", category: "Waxes and paraffin", subcategory: "Paraffin", kind: "direct_material", familyId: null });
    expect((await row("par")).mappedAt).not.toBeNull();
    const lc = await row("lc");
    expect(lc).toMatchObject({ name: "Contenitori per ceri LC TR", category: "Containers", subcategory: "Candle containers", variant: "LC TR" });
    const families = await db.select().from(schema.productFamilies);
    expect(families.map((x) => x.name).sort()).toEqual(["Candela liturgica altare", "Contenitori per ceri"]);
    expect((await row("c50")).familyId).toBe(lc.familyId);
    // Possible duplicates and the products nobody could read wait for the user.
    expect((await row("a60")).mappedAt).toBeNull();
    expect((await row("l1")).mappedAt).toBeNull();
    expect(await facts()).toEqual(before);
  });

  it("keeps the invoice's wording linked to the product, and remembers the name it had", async () => {
    const aliases = (await db.select().from(schema.productAliases).where(eq(schema.productAliases.productId, ids.lc))).map((x) => x.alias);
    expect(aliases).toEqual(["ART. LC TR. CONTENITORI PER CERI"]);
    // The supplier's name was dropped from the product's: the old name is one more way of finding it.
    await db.delete(schema.productAliases).where(eq(schema.productAliases.productId, ids.par));
    await db.update(schema.products).set({ mappedAt: null, name: "Paraffina SER 52/54 (XXF)" }).where(eq(schema.products.id, ids.par));
    await confirmMappings(db, { productIds: [ids.par] });
    expect(await db.select().from(schema.productAliases).where(eq(schema.productAliases.productId, ids.par))).toMatchObject([{ alias: "Paraffina SER 52/54 (XXF)", supplierId: null, source: "rename" }]);
  });

  it("gives a confirmed product a status that says what it needs, not that data is missing", async () => {
    const data = await readDataset(db);
    const intel = analyze(catalogueOf(data), (await readLearning(db)).supplierProducts, [], today);
    expect(decisionFor(intel, ids.par)!.status).toBe("needs_alternative");
    expect(decisionFor(intel, ids.c50)!.status).toBe("ready");
  });

  it("is done once: confirmed products are not proposed again", async () => {
    expect(await confirmMappings(db)).toEqual({ confirmed: 0 });
    expect((await analyzeCatalogue(db)).totals).toMatchObject({ confirmed: 5, high: 0 });
  });
});

describe("the cases only a person can decide", () => {
  it("one answer classifies a supplier's whole group, with the names the user wrote", async () => {
    await confirmMappings(db, { productIds: [ids.l1, ids.l2], answer: "label", names: { [ids.l2]: "Etichetta Madonna del Frassino 55x55" } });
    expect(await row("l1")).toMatchObject({ name: "Label 50x70 - Best Choice - Articolo 60T", category: "Labels and printing", subcategory: "Labels", kind: "packaging", variant: "50x70 - Best Choice - Articolo 60T" });
    expect((await row("l2")).name).toBe("Etichetta Madonna del Frassino 55x55");
    const [family] = await db.select().from(schema.productFamilies).where(eq(schema.productFamilies.id, (await row("l1")).familyId!));
    expect(family).toMatchObject({ name: "Labels", subcategory: "Labels" });
  });

  it("an answer can say it is not a product at all: it leaves the catalogue, its spend stays", async () => {
    await confirmMappings(db, { productIds: [ids.net], answer: "indirect" });
    expect(await row("net")).toMatchObject({ kind: "indirect", category: null, familyId: null, name: "Rete ombreggiante verde rotolo" });
    expect((await analyzeCatalogue(db)).totals.analysed).toBe(9);
    await expect(confirmMappings(db, { productIds: [ids.net], answer: "nonsense" })).rejects.toThrow();
  });

  it("\"keep separate\" is remembered", async () => {
    await keepSeparate(db, [ids.a25, ids.a40]);
    await keepSeparate(db, [ids.a40, ids.a25]);
    expect(await db.select().from(schema.productSeparations)).toHaveLength(1);
  });

  it("merging makes one product of two: every purchase moves, none changes", async () => {
    const before = await facts();
    // A mock benchmark on the product that will be merged: what hangs on it must follow, not disappear.
    await db.insert(schema.marketBenchmarks).values({ productId: ids.a60, type: "direct_benchmark", label: "Mock reference", sourceName: "Mock source" });
    const { productId } = await mergeProducts(db, [ids.a240, ids.a60], "Candela liturgica altare Ø 35x200 mm");
    expect(productId).toBe(ids.a240);
    // Nothing is deleted: the merged product stays on file, read as the other, and is no longer listed.
    expect(await row("a60")).toMatchObject({ mergedIntoId: ids.a240, name: "Candela Liturgica Altare Ø 35x200 mm 60 pz. x scat" });
    expect((await readDataset(db)).products.some((x) => x.id === ids.a60)).toBe(false);
    expect(await mergedInto(db, ids.a60)).toBe(ids.a240);
    expect(await db.select().from(schema.marketBenchmarks).where(eq(schema.marketBenchmarks.productId, ids.a240))).toHaveLength(1);
    expect(await row("a240")).toMatchObject({ name: "Candela liturgica altare Ø 35x200 mm", subcategory: "Candles", variant: "Ø 35x200 mm" });
    expect(await db.select().from(schema.purchases).where(eq(schema.purchases.productId, ids.a240))).toHaveLength(3);
    const aliases = (await db.select().from(schema.productAliases).where(eq(schema.productAliases.productId, ids.a240))).map((x) => x.alias).sort();
    expect(aliases).toEqual(["CANDELA LITURGICA ALTARE Ø 35X200 MM 240 PZ.", "CANDELA LITURGICA ALTARE Ø 35X200 MM 60 PZ. X SCAT"]);
    expect(await db.select().from(schema.supplierProducts).where(eq(schema.supplierProducts.productId, ids.a240))).toHaveLength(1);
    expect(await facts()).toEqual(before);
    expect((await analyzeCatalogue(db)).duplicates).toEqual([]);
  });

  it("a merge can be taken back: what moved goes back where it was, and the name too", async () => {
    const before = await facts();
    const [merge] = await readProductMerges(db);
    expect(merge).toMatchObject({ productId: ids.a240, mergedId: ids.a60 });
    await undoProductMerge(db, merge.id);
    expect(await row("a60")).toMatchObject({ mergedIntoId: null });
    expect(await row("a240")).toMatchObject({ name: "Candela Liturgica Altare Ø 35x200 mm 240 pz." });
    expect(await db.select().from(schema.purchases).where(eq(schema.purchases.productId, ids.a60))).toHaveLength(1);
    expect(await db.select().from(schema.purchases).where(eq(schema.purchases.productId, ids.a240))).toHaveLength(2);
    expect(await db.select().from(schema.marketBenchmarks).where(eq(schema.marketBenchmarks.productId, ids.a60))).toHaveLength(1);
    expect((await db.select().from(schema.productAliases).where(eq(schema.productAliases.productId, ids.a60))).map((x) => x.alias)).toEqual(["CANDELA LITURGICA ALTARE Ø 35X200 MM 60 PZ. X SCAT"]);
    expect((await readDataset(db)).products.some((x) => x.id === ids.a60)).toBe(true);
    expect(await facts()).toEqual(before);
    expect(await readProductMerges(db)).toEqual([]);
    await expect(undoProductMerge(db, merge.id)).rejects.toThrow("no longer in force");
    // The two are proposed as one again, and can be merged again.
    expect((await analyzeCatalogue(db)).duplicates).toHaveLength(1);
    await mergeProducts(db, [ids.a240, ids.a60], "Candela liturgica altare Ø 35x200 mm");
    expect(await readProductMerges(db)).toHaveLength(1);
  });

  it("does not merge products bought in different units", async () => {
    await expect(mergeProducts(db, [ids.par, ids.lc], "x")).rejects.toThrow("different units");
  });
});

describe("the product's page", () => {
  it("takes what the user writes as it is, and creates the family if it is new", async () => {
    await saveMapping(db, ids.a25, { name: "Candela altare 25x160", kind: "direct_material", category: "Candele", subcategory: "Liturgiche", family: "Candele d'altare", variant: "25x160" });
    expect(await row("a25")).toMatchObject({ name: "Candela altare 25x160", category: "Candele", subcategory: "Liturgiche", variant: "25x160" });
    const [family] = await db.select().from(schema.productFamilies).where(eq(schema.productFamilies.id, (await row("a25")).familyId!));
    expect(family.name).toBe("Candele d'altare");
    const a = await analyzeCatalogue(db);
    expect(a.products.find((m) => m.productId === ids.a25)).toMatchObject({ mapped: true, category: "Candele", family: "Candele d'altare" });
  });
});

describe("versions of one product", () => {
  it("are filed under one macro product, each kept as it is, and not asked about again", async () => {
    await product("v0", "ART. 30/2 Contenitori per ceri", ids.erre, "component", "pcs", [[10000, 0.072]]);
    await product("vtr", "ART. 30/2 TR Contenitori per ceri", ids.erre, "component", "pcs", [[10000, 0.082]]);
    await product("vblu", "ART. 30/2 BLU Contenitori per ceri", ids.erre, "component", "pcs", [[5000, 0.094]]);
    const before = await facts();
    const group = (await analyzeCatalogue(db)).macros.find((g) => g.name === "Contenitori per ceri 30/2")!;
    // "BLU" says it is a colour; "TR" next to it is read the same way — proposed, not decided.
    expect(group).toMatchObject({ differs: "colour", differsSure: false, suggestion: "variants", supplierName: "ERREPLAST SRL" });
    expect(group.members.map((m) => m.variant).sort()).toEqual(["BLU", "TR", null].sort());

    await confirmVariants(db, [ids.v0, ids.vtr, ids.vblu], "Contenitori per ceri 30/2", "colour");
    const [family] = (await db.select().from(schema.productFamilies)).filter((x) => x.name === "Contenitori per ceri 30/2");
    expect(family).toMatchObject({ variantBy: "colour", subcategory: "Candle containers" });
    // Three products still, each with its own name, purchases and price: only where they are filed changed.
    expect(await row("vblu")).toMatchObject({ familyId: family.id, variant: "BLU", name: "Contenitori per ceri 30/2 BLU" });
    expect(await row("v0")).toMatchObject({ familyId: family.id, variant: null });
    expect((await row("vtr")).mappedAt).not.toBeNull();
    expect(await facts()).toEqual(before);
    const after = await analyzeCatalogue(db);
    expect(after.macros.some((g) => g.name === "Contenitori per ceri 30/2")).toBe(false);
    expect(after.duplicates.some((d) => d.productIds.includes(ids.vblu))).toBe(false);

    // A new colour of the same article is proposed next to the ones already filed.
    await product("vgia", "ART. 30/2 GIA Contenitori per ceri", ids.erre, "component", "pcs", [[1000, 0.095]]);
    const again = (await analyzeCatalogue(db)).macros.find((g) => g.name === "Contenitori per ceri 30/2")!;
    expect(again.members).toHaveLength(4);
    await expect(confirmVariants(db, [ids.v0], "Contenitori per ceri 30/2", "colour")).rejects.toThrow("at least two products");
  });
});
