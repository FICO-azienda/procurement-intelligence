/**
 * Market directories on a real in-memory Postgres: a research file is checked,
 * then loaded; the same company is one record; nothing becomes a supplier by
 * itself; and the workbook says "missing" where a page said nothing.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { MarketError, countryCoverage, importMarketFile, makeCandidate, marketWorkbook, readDirectory, readMarketResearch, readReferences, setMarketStatus, summary } from "./markets";

let db: DB;
const M = "plastic_candle_containers";
const ids: Record<string, string> = {};
const file = (suppliers: unknown[], coverage: unknown = undefined, researchedAt = "2026-10-11") => JSON.stringify({ kind: "market_suppliers", market: M, researchedAt, source: "test", cycle: "one", coverage, suppliers });
const tubes = { name: "Tube Works sp. z o.o.", country: "Poland", city: "Lodz", role: "manufacturer", status: "technical_match_to_review", website: "https://tubeworks.example", email: "office@tubeworks.example", evidenceUrl: "https://tubeworks.example/tubes", evidence: "«producent tub»", materials: ["PP"], technologies: ["blow"], productTypes: ["votive_container"], doubts: "sizes to ask", reliability: "high" };
const moulder = { name: "Stampi Rossi S.r.l.", country: "Italy", role: "contract_moulder", status: "discovered", evidenceUrl: "https://stampirossi.example/", productTypes: ["custom"] };
const incumbent = { name: "ACME PLAST SRL", country: "Italy", role: "manufacturer", status: "manufacturer_confirmed", evidenceUrl: "https://acmeplast.example/prodotti" };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [acme] = await db.insert(schema.suppliers).values({ name: "Acme Plast S.r.l.", country: "Italy" }).returning();
  const [cup] = await db.insert(schema.products).values({ name: "Container LC", sku: "LC", unit: "pcs", kind: "component", category: "Containers", subcategory: "Candle containers", mappedAt: new Date() }).returning();
  const [wax] = await db.insert(schema.products).values({ name: "Paraffin 52/54", sku: "PAR", unit: "kg", kind: "direct_material", category: "Waxes and paraffin", subcategory: "Paraffin", mappedAt: new Date() }).returning();
  Object.assign(ids, { acme: acme.id, cup: cup.id, wax: wax.id });
  for (const [quantity, price, date] of [[10000, 0.08, "2026-06-10"], [30000, 0.075, "2026-08-10"]] as const) {
    await db.insert(schema.purchases).values({ productId: cup.id, supplierId: acme.id, date, quantity: String(quantity), unit: "pcs", unitPrice: String(price), totalAmount: String(quantity * price), originalDescription: "ART. LC CONTENITORI" });
  }
  await db.insert(schema.productAliases).values({ productId: cup.id, alias: "ART. LC CONTENITORI", normalized: "art lc contenitori", supplierId: acme.id });
}, 30_000);

describe("loading a research file", () => {
  it("is first a check that writes nothing", async () => {
    const out = await importMarketFile(db, file([tubes, moulder, incumbent, { name: "No page" }]), { confirm: false });
    expect(out).toMatchObject({ added: ["Tube Works sp. z o.o.", "Stampi Rossi S.r.l.", "ACME PLAST SRL"], updated: [], loaded: false });
    expect(out.rejected).toMatchObject([{ name: "No page" }]);
    expect(await readDirectory(db, M)).toEqual([]);
  });

  it("then loads, on confirmation, with its coverage", async () => {
    await importMarketFile(db, file([tubes, moulder, incumbent, { ...tubes, name: "TUBE WORKS (trade listing)" }], { countries: [{ country: "Poland", depth: "preliminary", queries: ["q1"], sources: [], found: 1 }], gaps: ["directories"], leads: [{ name: "Maybe Ltd", where: "a list" }] }), { confirm: true, file: "one.json" });
    const rows = await readDirectory(db, M);
    expect(rows.map((r) => r.name).sort()).toEqual(["ACME PLAST SRL", "Stampi Rossi S.r.l.", "Tube Works sp. z o.o."]);
    expect(rows.find((r) => r.name.startsWith("Tube"))).toMatchObject({ email: "office@tubeworks.example", materials: ["PP"], profile: { evidence: "«producent tub»", doubts: "sizes to ask" } });
    expect((await readMarketResearch(db, M))[0]).toMatchObject({ file: "one.json", coverage: { gaps: ["directories"] } });
  });

  it("never writes a supplier", async () => {
    expect(await db.select().from(schema.suppliers)).toHaveLength(1);
    expect(await db.select().from(schema.supplierCandidates)).toHaveLength(0);
  });

  it("refuses a file of another kind, or about a market it does not know", async () => {
    await expect(importMarketFile(db, "{}", { confirm: true })).rejects.toBeInstanceOf(MarketError);
    await expect(importMarketFile(db, JSON.stringify({ kind: "market_suppliers", market: "unknown", researchedAt: "2026-10-11", source: "x", suppliers: [] }), { confirm: true })).rejects.toBeInstanceOf(MarketError);
  });
});

describe("the same company, found again", () => {
  it("is refreshed, not duplicated, and keeps the address it had when the new reading has none", async () => {
    const out = await importMarketFile(db, file([{ ...tubes, email: undefined, city: "Łódź", materials: ["PP", "PVC"] }], { countries: [{ country: "Poland", depth: "deep", queries: ["q2"], sources: ["an association"], found: 0 }] }, "2026-10-12"), { confirm: true, file: "two.json" });
    expect(out).toMatchObject({ added: [], updated: ["Tube Works sp. z o.o."] });
    const rows = await readDirectory(db, M);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.name.startsWith("Tube"))).toMatchObject({ city: "Łódź", materials: ["PP", "PVC"], email: "office@tubeworks.example" });
  });

  it("keeps the status the user recorded: research never takes it back", async () => {
    const id = (await readDirectory(db, M)).find((r) => r.name.startsWith("Tube"))!.id;
    await setMarketStatus(db, id, "contacted");
    await importMarketFile(db, file([tubes]), { confirm: true, file: "three.json" });
    expect((await readDirectory(db, M)).find((r) => r.id === id)!.status).toBe("contacted");
    await expect(setMarketStatus(db, id, "sold")).rejects.toBeInstanceOf(MarketError);
  });

  it("the latest, deepest word on a country stands, with every search made", async () => {
    const [poland] = countryCoverage(await readMarketResearch(db, M));
    expect(poland).toMatchObject({ country: "Poland", depth: "deep", queries: ["q1", "q2"] });
  });
});

describe("what the buyer's own records say", () => {
  it("a company that is a supplier already is said to be, by its name", async () => {
    const rows = await readDirectory(db, M);
    expect(rows.find((r) => r.name === "ACME PLAST SRL")!.links).toMatchObject({ current: true, rfq: "none" });
    expect(rows.find((r) => r.name.startsWith("Stampi"))!.links).toMatchObject({ current: false, candidateFor: [], rfq: "none" });
  });

  it("the buyer's products the market serves come with what is known, and what is not", async () => {
    const refs = await readReferences(db, M);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: "Container LC", original: "ART. LC CONTENITORI", supplier: "Acme Plast S.r.l.", lastPrice: 0.075, spend: 3050, specs: {}, technical: null, documents: 0 });
    expect(refs[0].averagePrice).toBeCloseTo(3050 / 40000, 6);
  });

  it("a company becomes a candidate for a product only on the user's click, with its page", async () => {
    const id = (await readDirectory(db, M)).find((r) => r.name.startsWith("Tube"))!.id;
    await makeCandidate(db, id, ids.cup);
    const [candidate] = await db.select().from(schema.supplierCandidates);
    expect(candidate).toMatchObject({ productId: ids.cup, name: "Tube Works sp. z o.o.", sourceUrl: "https://tubeworks.example/tubes", supplierId: null, priceLow: null });
    expect((await readDirectory(db, M)).find((r) => r.id === id)!.links).toMatchObject({ candidateFor: [{ productId: ids.cup, name: "Container LC" }], rfq: "candidate" });
    await expect(makeCandidate(db, id, ids.cup)).rejects.toBeInstanceOf(MarketError);
    expect(await db.select().from(schema.suppliers)).toHaveLength(1);
  });

  it("the figures count each company once, by what it is", async () => {
    expect(summary(await readDirectory(db, M))).toMatchObject({ total: 3, makers: 2, oem: 1, distributors: 0, withContact: 1 });
  });
});

describe("the workbook", () => {
  it("has the eight sheets asked for, and the references, with nothing made up", async () => {
    const book = XLSX.read(await marketWorkbook(db, M), { type: "array" });
    expect(book.SheetNames).toEqual(["GLOBAL MASTER LIST", "ITALY", "EUROPE", "CHINA & ASIA", "REST OF WORLD", "PRIORITY SHORTLIST", "RFQ CONTACTS", "SOURCES & GAPS", "REFERENCES"]);
    const rows = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name]);
    expect(rows("GLOBAL MASTER LIST")).toHaveLength(3);
    expect(rows("ITALY").map((r) => r.Company).sort()).toEqual(["ACME PLAST SRL", "Stampi Rossi S.r.l."]);
    expect(rows("EUROPE").map((r) => r.Company)).toEqual(["Tube Works sp. z o.o."]);
    expect(rows("CHINA & ASIA")).toEqual([]);
    const moulderRow = rows("ITALY").find((r) => r.Company === "Stampi Rossi S.r.l.")!;
    expect(moulderRow).toMatchObject({ Email: "MISSING", Materials: "MISSING", "Intended use": "Technical validation required" });
    expect(rows("PRIORITY SHORTLIST").map((r) => r.Company)).toEqual(["Tube Works sp. z o.o."]);
    expect(rows("PRIORITY SHORTLIST")[0]).toMatchObject({ Reliability: "High" });
    expect(moulderRow).toMatchObject({ Reliability: "MISSING" });
    expect(rows("RFQ CONTACTS")).toMatchObject([{ Company: "Tube Works sp. z o.o.", Email: "office@tubeworks.example", "Product of interest": "Container LC" }]);
    expect(rows("SOURCES & GAPS").map((r) => r.Kind)).toEqual(expect.arrayContaining(["Country", "Gap", "Name still to verify", "Company to look into"]));
    expect(rows("REFERENCES")[0]).toMatchObject({ Product: "Container LC", Material: "MISSING", Diameter: "MISSING", "Last unit price": 0.075 });
  });

  it("left every purchase and every supplier as it was", async () => {
    expect(await db.select().from(schema.purchases)).toHaveLength(2);
    expect((await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, ids.acme)))[0].name).toBe("Acme Plast S.r.l.");
  });
});
