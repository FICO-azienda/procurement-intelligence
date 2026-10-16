/**
 * Suppliers' articles, the memory of what was said of them, relations between
 * products and invoices — on real in-memory Postgres, with mock companies.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { readProductArticles, syncArticles, syncInvoices } from "./articles";
import { readProductRelations, recordProductRelation, withdrawProductRelation } from "./relations";
import { linkOffer, readProductOffers, setOfferCompatibility } from "./replies";

let db: DB;
const ME = { type: "user" as const, id: "Mock Person" };
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [cur] = await db.insert(schema.suppliers).values({ name: "Mock Cere S.p.A.", vatNumber: "IT00000000019", country: "Italy" }).returning();
  const base = { kind: "direct_material", category: "Waxes and paraffin", subcategory: "Paraffin", mappedAt: new Date() } as const;
  const [p1] = await db.insert(schema.products).values({ ...base, name: "Mock paraffin 52/54", sku: "P1", unit: "kg" }).returning();
  const [p2] = await db.insert(schema.products).values({ ...base, name: "Mock paraffin 56/58", sku: "P2", unit: "kg" }).returning();
  const [p3] = await db.insert(schema.products).values({ ...base, name: "Mock paraffin 52/56 blend", sku: "P3", unit: "kg" }).returning();
  await db.insert(schema.supplierProducts).values({ supplierId: cur.id, productId: p1.id, supplierSku: "PRP026", supplierProductName: "PARAFFINA MOCK 52/54 (XXF)" });
  await db.insert(schema.purchases).values([
    { productId: p1.id, supplierId: cur.id, date: "2026-06-02", quantity: "20000", unit: "kg", unitPrice: "1.52", totalAmount: "30400", invoiceReference: "MOCK/101", originalDescription: "PARAFFINA MOCK 52/54" },
    { productId: p1.id, supplierId: cur.id, date: "2026-06-01", quantity: "1000", unit: "kg", unitPrice: "1.52", totalAmount: "1520", invoiceReference: "MOCK/101", invoiceLine: 2, originalDescription: "PARAFFINA MOCK 52/54" },
    { productId: p1.id, supplierId: cur.id, date: "2026-09-21", quantity: "20000", unit: "kg", unitPrice: "1.48", totalAmount: "29600", invoiceReference: "MOCK/207", originalDescription: "PARAFFINA MOCK 52/54" },
  ]);
  const [company] = await db.insert(schema.rfqSuppliers).values({ name: "Mock Wax Kimya A.S.", country: "Turkey" }).returning();
  const [thread] = await db.insert(schema.rfqThreads).values({ supplierId: company.id, status: "price_received" }).returning();
  const [later] = await db.insert(schema.rfqThreads).values({ supplierId: company.id, status: "price_received", reference: "RFQ-2" }).returning();
  const offer = { productName: "MOCK SNOW 1500", productCode: "SNOW1500", category: "Paraffin", currency: "EUR", unit: "kg", specs: { melting_point: "52–56°C" } };
  const [o1] = await db.insert(schema.rfqOffers).values({ ...offer, threadId: thread.id, key: "a", unitPrice: "1.40", validUntil: "2099-12-31" }).returning();
  const [o2] = await db.insert(schema.rfqOffers).values({ ...offer, threadId: later.id, key: "b", unitPrice: "1.38", validUntil: "2099-12-31" }).returning();
  Object.assign(ids, { cur: cur.id, p1: p1.id, p2: p2.id, p3: p3.id, o1: o1.id, o2: o2.id });
}, 60_000);

describe("the articles of the suppliers", () => {
  it("are made once from the invoices' links and the offers: the bought one is the product, an offered one is not a product", async () => {
    const productsBefore = (await db.select().from(schema.products)).length;
    const first = await syncArticles(db);
    expect(first.created).toBe(2);
    expect(await syncArticles(db)).toEqual({ created: 0, tied: 0 });
    // The two offer lines of one company with one code are one article; no product of the buyer was made.
    const [a1, a2] = await Promise.all([ids.o1, ids.o2].map(async (id) => (await db.select().from(schema.rfqOffers).where(eq(schema.rfqOffers.id, id)))[0].articleId));
    expect(a1).toBe(a2);
    expect((await db.select().from(schema.products)).length).toBe(productsBefore);
    const list = await readProductArticles(db, ids.p1);
    expect(list.map((x) => [x.code, x.name, x.type, x.decidedByType, x.purchases])).toEqual([["PRP026", "PARAFFINA MOCK 52/54 (XXF)", "identical", "import", 3]]);
  });

  it("remember what a person said, and propose it again on a new line of the same article — never validated by the app", async () => {
    await linkOffer(db, ids.o1, ids.p1, { compatibility: "possible", note: "Declares 52–56 °C" }, ME);
    await setOfferCompatibility(db, ids.o1, { compatibility: "validated", note: "Sample tested in production, 02/10" }, ME);
    const list = await readProductArticles(db, ids.p1);
    expect(list.find((x) => x.code === "SNOW1500")).toMatchObject({ type: "equivalent_validated", decidedByType: "user", decidedBy: "Mock Person", reason: "Sample tested in production, 02/10", offers: 1 });
    // The second line, not linked: proposed for the product with what was said before — as possible, to say again.
    const view = (await readProductOffers(db, ids.p1))!.toVerify.find((v) => v.offer.id === ids.o2)!;
    expect(view).toMatchObject({ link: "proposed", compatibility: "possible" });
    expect(view.reasons[0]).toContain("Said before of this article: equivalent, validated");
    // Changed: a new version, the earlier kept.
    await setOfferCompatibility(db, ids.o1, { compatibility: "not_equivalent", note: "Failed the burn test" }, ME);
    const links = await db.select().from(schema.articleLinks).where(eq(schema.articleLinks.productId, ids.p1));
    expect(links.filter((l) => l.type !== "identical").map((l) => [l.type, l.state])).toEqual([
      ["possible_equivalent", "superseded"],
      ["equivalent_validated", "superseded"],
      ["not_equivalent", "active"],
    ]);
  });
});

describe("what the buyer's products are to each other", () => {
  it("is proposed by the one engine and decided by a person, for a use and with a reason, its history kept", async () => {
    const r = await readProductRelations(db, ids.p1);
    expect(r.proposed.map((x) => [x.other.name, x.relation])).toEqual([["Mock paraffin 52/56 blend", "possible_equivalent"]]);
    expect(r.family.map((x) => x.other.name)).toEqual(["Mock paraffin 56/58"]);
    await expect(recordProductRelation(db, ids.p1, ids.p3, { type: "equivalent_validated" }, ME)).rejects.toThrow(/which use/);
    await recordProductRelation(db, ids.p1, ids.p3, { type: "possible_equivalent", reason: "Same supplier family" }, ME);
    await recordProductRelation(db, ids.p1, ids.p3, { type: "equivalent_validated", application: "Container candles", reason: "Burn test passed, 03/10" }, ME);
    const after = await readProductRelations(db, ids.p3);
    expect(after.stored).toMatchObject([{ other: { id: ids.p1 }, type: "equivalent_validated", application: "Container candles", history: [{ type: "possible_equivalent", state: "superseded" }] }]);
    expect(after.proposed).toEqual([]);
    await withdrawProductRelation(db, after.stored[0].id, ME);
    expect((await readProductRelations(db, ids.p3)).proposed.map((x) => x.other.id)).toEqual([ids.p1]);
  });
});

describe("invoices", () => {
  it("are one per supplier and number, dated by their earliest line, and change no figure of a purchase", async () => {
    const before = await db.select().from(schema.purchases);
    expect(await syncInvoices(db)).toEqual({ created: 2, tied: 3 });
    expect(await syncInvoices(db)).toEqual({ created: 0, tied: 0 });
    const list = await db.select().from(schema.invoices);
    expect(list.map((i) => [i.number, String(i.date)]).sort()).toEqual([["MOCK/101", "2026-06-01"], ["MOCK/207", "2026-09-21"]]);
    const after = await db.select().from(schema.purchases);
    const strip = (rows: typeof before) => rows.map((r) => ({ ...r, invoiceId: null, updatedAt: null }));
    expect(strip(after)).toEqual(strip(before));
    expect(after.every((p) => p.invoiceId)).toBe(true);
  });
});
