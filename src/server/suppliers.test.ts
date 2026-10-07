/**
 * Supplier entity resolution on a real in-memory Postgres: the same company
 * under several names, merged, read as one, and taken apart again. "Mock Wax"
 * and its VAT numbers are MOCKS that exist only in this file.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { catalogueOf } from "@/lib/catalog/spend";
import { readDataset, readLearning } from "@/lib/data";
import { readNegotiations } from "./negotiation";
import { saveDataField } from "./product-data";
import { autoMergeSuppliers, canonicalSupplierId, keepSuppliersSeparate, matchOf, mergeSuppliers, readResolution, supplierIdentity, supplierRelationship, undoSupplierMerge } from "./suppliers";

let db: DB;
const id: Record<string, string> = {};

const monthsAgo = (n: number) => {
  const d = new Date(`${todayISO()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};
const snapshot = async () => (await db.select().from(schema.purchases)).map((p) => `${p.id}:${p.supplierId}:${p.unitPrice}`).sort();

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.settings).values({ id: 1, companyName: "Mock Candle Co.", country: "Italy" });
  // One company written three ways, and a different company with a similar name.
  for (const [key, values] of Object.entries({
    main: { name: "Mock Wax S.p.A.", country: "Italy", vatNumber: "01234567890" },
    sameVat: { name: "MOCK WAX SPA", country: "Italy", vatNumber: "IT 01234567890" },
    sameName: { name: "Mock Wax SpA", country: "Italy" },
    other: { name: "Mock Wax Industries SpA", country: "Italy", vatNumber: "09876543210" },
  })) id[key] = (await db.insert(schema.suppliers).values(values).returning())[0].id;
  const products = { paraffin: "main", wax: "sameVat", wick: "sameName", glass: "other" } as const;
  for (const [sku, supplier] of Object.entries(products)) {
    const [p] = await db.insert(schema.products).values({ name: `Mock ${sku}`, sku, unit: "kg", kind: sku === "wick" ? "component" : "direct_material", mappedAt: new Date() }).returning();
    id[sku] = p.id;
    for (const i of [1, 2, 3]) {
      const quantity = sku === "paraffin" ? 20_000 : 1_000;
      await db.insert(schema.purchases).values({ productId: p.id, supplierId: id[supplier], date: monthsAgo(i), quantity: String(quantity), unit: "kg", unitPrice: "1.5", totalAmount: String(quantity * 1.5), source: "csv" });
    }
  }
}, 30_000);

describe("recognising one company under several names", () => {
  it("finds what a VAT number proves, what a name suggests, and leaves a different VAT number alone", async () => {
    const r = await readResolution(db);
    expect(r.automatic.map((m) => [m.merge, m.keep])).toEqual([[id.sameVat, id.main]]);
    expect(r.automatic[0]).toMatchObject({ confidence: "high", basis: ["vat", "name"] });
    expect(r.suggestions.map((m) => m.merge)).toEqual([id.sameName, id.sameName]);
    // "Mock Wax Industries" has another VAT number: it is not proposed against the two that have one.
    expect([...r.suggestions, ...r.weak].some((m) => [m.keep, m.merge].includes(id.other) && [m.keep, m.merge].includes(id.main))).toBe(false);
  });

  it("merges by itself only on the strong identifier — and moves no purchase", async () => {
    const before = await snapshot();
    expect(await autoMergeSuppliers(db)).toEqual([{ merged: id.sameVat, into: id.main }]);
    expect(await autoMergeSuppliers(db)).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(await db.select().from(schema.suppliers)).toHaveLength(4);
    expect(await canonicalSupplierId(db, id.sameVat)).toBe(id.main);
    const [row] = await db.select().from(schema.supplierResolutions);
    expect(row).toMatchObject({ supplierId: id.sameVat, otherId: id.main, decision: "merged", decidedBy: "auto", confidence: "high", undoneAt: null });
  });

  it("reads every purchase on the company, not on the spelling", async () => {
    const data = await readDataset(db);
    expect(data.suppliers.map((s) => s.name).sort()).toEqual(["Mock Wax Industries SpA", "Mock Wax S.p.A.", "Mock Wax SpA"]);
    expect(data.purchases.filter((p) => p.supplierId === id.main)).toHaveLength(6);
    expect(data.purchases.some((p) => p.supplierId === id.sameVat)).toBe(false);
    const rel = await supplierRelationship(db, id.main, data, catalogueOf(data));
    expect(rel.totalSpend).toBeCloseTo(3 * 20_000 * 1.5 + 3 * 1_000 * 1.5, 2);
    expect(rel.products.map((p) => p.name)).toEqual(["Mock paraffin", "Mock wax"]);
    expect(rel.leverage).toMatchObject({ productName: "Mock paraffin" });
    expect(rel.leverage!.onFile.cross).toBeCloseTo(4_500, 2);
  });
});

describe("what the user decides", () => {
  it("a name alone is merged only by the user — and the leverage then counts the whole relationship", async () => {
    const before = (await readNegotiations(db, undefined, [id.paraffin])).get(id.paraffin)!.relationship!;
    expect(before.facts.products).toBe(2);
    const match = (await matchOf(db, id.sameName, id.main))!;
    expect(match).toMatchObject({ confidence: "medium", automatic: false, keep: id.main, merge: id.sameName });
    await mergeSuppliers(db, id.sameName, id.main, { basis: match.basis, confidence: match.confidence, decidedBy: "user" });
    const after = (await readNegotiations(db, undefined, [id.paraffin])).get(id.paraffin)!.relationship!;
    expect(after.facts.products).toBe(3);
    expect(after.onFile.cross).toBeCloseTo(9_000, 2);
    expect(after.onFile.total).toBeCloseTo(99_000, 2);
    expect(after.facts.groups.map((g) => g.name).sort()).toEqual(["component", "direct_material"]);
    // The wick, bought under another spelling, is now negotiated with the weight of the whole account.
    expect((await readNegotiations(db, undefined, [id.wick])).get(id.wick)!.relationship!.onFile.total).toBeCloseTo(99_000, 2);
  });

  it("shows who the company is: every name, every identifier, every record behind it", async () => {
    const who = (await supplierIdentity(db, id.sameVat))!;
    expect(who).toMatchObject({ canonicalId: id.main, canonicalName: "Mock Wax S.p.A.", vatNumbers: ["01234567890"], purchases: 9 });
    expect(who.aliases.map((a) => [a.name, a.source, a.lines])).toEqual([
      ["MOCK WAX SPA", "record", 3],
      ["Mock Wax SpA", "record", 3],
    ]);
    expect(who.merged.map((m) => [m.name, m.decidedBy, m.confidence])).toEqual([
      ["MOCK WAX SPA", "auto", "high"],
      ["Mock Wax SpA", "user", "medium"],
    ]);
  });

  it("writes what is learned about a merged record on the company", async () => {
    // Payment terms asked for a product bought under the old spelling land on the company's record.
    await saveDataField(db, id.wick, "payment_terms", "60");
    const rows = await db.select().from(schema.suppliers);
    expect(rows.find((r) => r.id === id.main)!.paymentTermsDays).toBe(60);
    expect(rows.find((r) => r.id === id.sameName)!.paymentTermsDays).toBeNull();
    expect((await readLearning(db)).supplierProducts.every((l) => l.supplierId !== id.sameName && l.supplierId !== id.sameVat)).toBe(true);
  });

  it("a merge can be taken back: the record stands for itself again, and is not merged again by itself", async () => {
    await undoSupplierMerge(db, id.sameVat);
    const data = await readDataset(db);
    expect(data.suppliers).toHaveLength(3);
    expect(data.purchases.filter((p) => p.supplierId === id.sameVat)).toHaveLength(3);
    expect(data.purchases.filter((p) => p.supplierId === id.main)).toHaveLength(6);
    const rows = await db.select().from(schema.supplierResolutions);
    expect(rows.find((r) => r.supplierId === id.sameVat)!.undoneAt).not.toBeNull();
    // Same VAT number, but the user said no: it comes back as a suggestion.
    expect(await autoMergeSuppliers(db)).toEqual([]);
    const r = await readResolution(db);
    expect(r.suggestions.some((m) => m.merge === id.sameVat && m.keep === id.main && m.confidence === "high")).toBe(true);
    expect((await supplierIdentity(db, id.main))!.history).toMatchObject([{ name: "MOCK WAX SPA", decision: "merged" }]);
  });

  it("two records kept separate are not proposed again", async () => {
    await keepSuppliersSeparate(db, id.sameVat, id.main, { basis: ["vat"], confidence: "high" });
    const r = await readResolution(db);
    expect([...r.automatic, ...r.suggestions, ...r.weak].some((m) => [m.keep, m.merge].includes(id.sameVat) && [m.keep, m.merge].includes(id.main))).toBe(false);
  });

  it("no purchase, quote or supplier record was ever rewritten or deleted", async () => {
    const purchases = await db.select().from(schema.purchases);
    expect(purchases).toHaveLength(12);
    expect(new Set(purchases.map((p) => p.supplierId))).toEqual(new Set([id.main, id.sameVat, id.sameName, id.other]));
    expect((await db.select().from(schema.suppliers)).map((s) => s.name).sort()).toEqual(["MOCK WAX SPA", "Mock Wax Industries SpA", "Mock Wax S.p.A.", "Mock Wax SpA"]);
  });
});
