/**
 * Sourcing on a real in-memory Postgres. The discovery provider used here is
 * a MOCK that exists only in this file: its suppliers ("Mock Wax GmbH",
 * example.test) are not real companies, and nothing like it ships in the app.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import type { DiscoveryRequest, SupplierDiscoveryProvider } from "@/lib/sourcing/providers";
import { benchmarkInput, candidateInput } from "@/lib/validation";
import { addBenchmark, addCandidate, deleteCandidate, discoveryRequest, markRequestsSent, readRfqLines, readSourcing, recordCandidateQuote, runDiscovery, setCandidatesStatus, updateCandidate } from "./sourcing";

let db: DB;
let productId: string;
const asked: DiscoveryRequest[] = [];

const mockProvider: SupplierDiscoveryProvider = {
  key: "mock",
  name: "Mock discovery (tests only)",
  async search(request) {
    asked.push(request);
    return [
      { name: "Mock Wax GmbH", country: "Germany", website: "https://mock-wax.example.test", sourceUrl: "https://mock-wax.example.test/paraffin-52-54", sourceDate: "2026-09-20", sourceLevel: "supplier_official", productMatched: "Fully refined paraffin 52/54", technicalCompatibility: "high", moq: 20_000, query: request.queries[0] },
      { name: "Mock Trader Ltd", country: "Turkey", sourceUrl: "https://directory.example.test/mock-trader", sourceLevel: "external", price: { low: 1450, high: 1520, currency: "USD", unit: "t", type: "indicative", sourceUrl: "https://directory.example.test/mock-trader#price", incoterm: "FOB" }, query: request.queries[0] },
      // No page behind it: refused, whatever it claims.
      { name: "Mock Invented Supplier", sourceUrl: "", sourceLevel: "estimate", price: { low: 1, high: 1.1, currency: "EUR", unit: "kg", type: "estimate", sourceUrl: "" } },
      // The company's own supplier is not an alternative.
      { name: "SER SpA", sourceUrl: "https://ser.example.test", sourceLevel: "supplier_official" },
    ];
  },
};

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.settings).values({ id: 1, companyName: "Mock Candle Co.", country: "Italy" });
  const [ser] = await db.insert(schema.suppliers).values({ name: "SER S.p.A.", country: "Italy" }).returning();
  const [p] = await db.insert(schema.products).values({ name: "Paraffina 52/54 (XXF)", sku: "PAR", unit: "kg", kind: "direct_material", category: "Waxes and paraffin", subcategory: "Paraffin", mappedAt: new Date() }).returning();
  productId = p.id;
  await db.insert(schema.productAliases).values({ productId, alias: "PARAFFINA SER 52/54 (XXF)", normalized: "paraffina ser 52 54 xxf", supplierId: ser.id, supplierSku: "PRP026" });
  for (const [i, quantity] of [20_000, 20_000, 24_000].entries()) {
    const d = new Date(`${todayISO()}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i - 1);
    await db.insert(schema.purchases).values({ productId, supplierId: ser.id, date: d.toISOString().slice(0, 10), quantity: String(quantity), unit: "kg", unitPrice: "1.48", totalAmount: String(quantity * 1.48), source: "csv" });
  }
}, 30_000);

describe("discovery", () => {
  it("tells a provider what the product is and how much is needed — never the price paid", async () => {
    const built = await discoveryRequest(db, productId);
    expect(built!.request).toMatchObject({ productName: "Paraffina 52/54 (XXF)", unit: "kg", annualQuantity: 64_000, typicalOrderQuantity: 20_000, deliveryCountry: "Italy", knownSuppliers: ["SER S.p.A."], supplierCodes: ["PRP026"] });
    expect(built!.request.queries).toContain("paraffin 52/54 supplier Europe");
    expect(JSON.stringify(built!.request)).not.toContain("1.48");
  });

  it("with no provider connected nothing is searched and nothing is made up", async () => {
    const run = await runDiscovery(db, productId);
    expect(run).toMatchObject({ configured: false, added: 0, skipped: [] });
    expect(run.queries.length).toBeGreaterThan(2);
    expect((await readSourcing(db)).candidates).toEqual([]);
  });

  it("with a provider, keeps what has a source — as \"discovered\", for the user to review — and says what it left out", async () => {
    const run = await runDiscovery(db, productId, { discovery: [mockProvider] });
    expect(run).toMatchObject({ configured: true, added: 2 });
    expect(run.skipped).toEqual([
      { name: "Mock Invented Supplier", reason: "no_source" },
      { name: "SER SpA", reason: "known_supplier" },
    ]);
    expect(run.tried[0]).toMatchObject({ results: 2 });
    expect(asked[0].knownSuppliers).toEqual(["SER S.p.A."]);
    const { candidates } = await readSourcing(db);
    expect(candidates).toMatchObject([
      { name: "Mock Wax GmbH", status: "discovered", source: "mock", sourceLevel: "supplier_official", sourceUrl: "https://mock-wax.example.test/paraffin-52-54", technicalCompatibility: "high", moq: 20_000, priceLow: null },
      { name: "Mock Trader Ltd", status: "discovered", priceLow: 1450, priceHigh: 1520, currency: "USD", unit: "t", priceType: "indicative", incoterm: "FOB", technicalCompatibility: null },
    ]);
  });

  it("does not add twice what was found before", async () => {
    const run = await runDiscovery(db, productId, { discovery: [mockProvider] });
    expect(run.added).toBe(0);
    expect(run.skipped.filter((s) => s.reason === "already_found")).toHaveLength(2);
  });
});

describe("what the user adds and decides", () => {
  it("a supplier added by hand needs a name and where it was found", () => {
    expect(candidateInput.safeParse({ name: "", sourceUrl: "x.example.test" }).success).toBe(false);
    const noSource = candidateInput.safeParse({ name: "Mock Cera Srl" });
    expect(noSource.success).toBe(false);
    expect(candidateInput.safeParse({ name: "Mock Cera Srl", notes: "Met at a trade fair" }).success).toBe(true);
    expect(candidateInput.safeParse({ name: "Mock Cera Srl", sourceUrl: "mock-cera.example.test", priceLow: "1,40" }).success).toBe(false); // a price needs its unit
  });

  it("is recorded to review, with its source and — if any — a price marked as indicative", async () => {
    const parsed = candidateInput.parse({ name: "Mock Cera Srl", country: "Italia", sourceUrl: "mock-cera.example.test/paraffine", sourceLevel: "supplier_official", technicalCompatibility: "high", priceLow: "1,39", priceHigh: "1,44", unit: "kg", incoterm: "DAP" });
    const { id } = await addCandidate(db, productId, parsed);
    const added = (await readSourcing(db)).candidates.find((c) => c.id === id)!;
    expect(added).toMatchObject({ source: "manual", status: "to_review", sourceUrl: "https://mock-cera.example.test/paraffine", priceLow: 1.39, priceHigh: 1.44, priceType: "indicative", currency: "EUR", priceSourceUrl: "https://mock-cera.example.test/paraffine", sourceDate: todayISO() });
  });

  it("moves through the statuses, one supplier or a whole basket at a time", async () => {
    const { candidates } = await readSourcing(db);
    await setCandidatesStatus(db, candidates.slice(0, 2).map((c) => c.id), "quote_requested");
    await updateCandidate(db, candidates[1].id, { technicalCompatibility: "partial", notes: "Different grade" });
    const after = (await readSourcing(db)).candidates;
    expect(after.map((c) => c.status)).toEqual(["quote_requested", "quote_requested", "to_review"]);
    expect(after[1]).toMatchObject({ technicalCompatibility: "partial", notes: "Different grade" });
    await deleteCandidate(db, candidates[1].id);
    expect((await readSourcing(db)).candidates).toHaveLength(2);
  });

  it("a market reference needs who published it and when; a cost driver is a movement, not a price", async () => {
    expect(benchmarkInput.safeParse({ label: "Paraffin", low: "1,30", sourceDate: "2026-09-15" }).success).toBe(false);
    expect(benchmarkInput.safeParse({ label: "Paraffin", sourceName: "Mock Report", sourceDate: "2026-09-15" }).success).toBe(false);
    await addBenchmark(db, productId, benchmarkInput.parse({ type: "direct_benchmark", label: "Mock paraffin 52/54", low: "1,30", high: "1,40", sourceName: "Mock Price Report", sourceDate: "2026-09-15", sourceLevel: "licensed_data", comparability: "comparable" }), "kg");
    await addBenchmark(db, productId, benchmarkInput.parse({ type: "cost_driver", label: "Mock crude index", changePct: "-6,5", period: "last 3 months", sourceName: "Mock Exchange", sourceDate: "2026-09-30" }), "kg");
    expect((await readSourcing(db)).benchmarks).toMatchObject([
      { type: "direct_benchmark", low: 1.3, high: 1.4, unit: "kg", sourceName: "Mock Price Report", sourceLevel: "licensed_data", comparability: "comparable", provider: "manual" },
      { type: "cost_driver", low: null, high: null, changePct: -6.5, period: "last 3 months" },
    ]);
  });

  it("remembers a request the user says they sent — once per supplier — and what a request says about the product", async () => {
    const [first, second] = (await readSourcing(db)).candidates;
    await markRequestsSent(db, [{ supplierName: first.name, candidateIds: [first.id], productIds: [productId] }], "request", "2026-09-28");
    await markRequestsSent(db, [{ supplierName: first.name, candidateIds: [first.id], productIds: [productId] }], "follow_up", "2026-10-09");
    const { requests, candidates } = await readSourcing(db);
    expect(requests).toMatchObject([{ supplierName: first.name, kind: "request", sentAt: "2026-09-28", productIds: [productId] }, { kind: "follow_up", sentAt: "2026-10-09" }]);
    expect(candidates.find((c) => c.id === first.id)!.status).toBe("quote_requested");
    expect(candidates.find((c) => c.id === second.id)!.status).toBe("to_review");
    // The request names the product without the current supplier, and carries quantities — never a price.
    const line = (await readRfqLines(db, [productId])).get(productId)!;
    // 64.000 kg in about two months of invoices: a year is said as an estimate scaled to twelve months, never as the sum on file.
    expect(line).toMatchObject({ productName: "Paraffina 52/54", unit: "kg", annualQuantity: 370_794, annualConfirmed: false, typicalOrderQuantity: 20_000, category: "wax" });
    expect(JSON.stringify(line)).not.toMatch(/SER|1\.48/);
  });

  it("an answer recorded by the user becomes a quote on file, and only then the candidate becomes a supplier", async () => {
    const suppliers = await db.select().from(schema.suppliers);
    const [first] = (await readSourcing(db)).candidates;
    const { supplierId } = await recordCandidateQuote(db, first.id, { date: "2026-10-10", unitPrice: 1.42, currency: "EUR", fxRate: 1, moq: 20_000, leadTimeDays: 21, paymentTermsDays: 30, incoterm: "DAP", validUntil: "2026-10-31", notes: "Samples available", original: "We can offer at EUR 1420/t DAP…" });
    expect(await db.select().from(schema.suppliers)).toHaveLength(suppliers.length + 1);
    const [quote] = await db.select().from(schema.quotes);
    expect(quote).toMatchObject({ productId, supplierId, date: "2026-10-10", currency: "EUR", incoterm: "DAP", leadTimeDays: 21, paymentTermsDays: 30, validUntil: "2026-10-31", source: "email", originalDescription: "We can offer at EUR 1420/t DAP…" });
    expect(Number(quote.unitPrice)).toBe(1.42);
    expect((await readSourcing(db)).candidates.find((c) => c.id === first.id)).toMatchObject({ status: "quote_received", supplierId });
    // The same company answering again does not become a second supplier.
    await recordCandidateQuote(db, first.id, { date: "2026-10-12", unitPrice: 1.41, currency: "EUR", fxRate: 1, moq: null, leadTimeDays: null, paymentTermsDays: null, incoterm: null, validUntil: null, notes: null, original: null });
    expect(await db.select().from(schema.suppliers)).toHaveLength(suppliers.length + 1);
  });

  it("never touches what was bought", async () => {
    const rows = await db.select().from(schema.purchases);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => Number(r.unitPrice) === 1.48)).toBe(true);
  });
});
