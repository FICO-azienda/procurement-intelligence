/**
 * Deep research on a real in-memory Postgres. Every external source used
 * here is a MOCK that exists only in this file: the search engine, the
 * websites ("Mock Wax GmbH", example.test), the exchange rate and the trade
 * statistics are made up for the test. Nothing like them ships in the app.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { RESEARCH_LIMITS } from "@/lib/research/budget";
import { researchFile } from "@/lib/research/file";
import { NO_PROVIDERS, type PageContent, type Providers } from "@/lib/sourcing/providers";
import { WEB_RESEARCH, convertCandidate, importResearch, planResearch, readResearch, readUsage, runResearch, type ResearchDeps } from "./research";

let db: DB;
let paraffin: string;
let container: string;
const calls = { search: [] as string[], page: [] as string[], fx: 0, trade: 0 };

const PAGES: Record<string, PageContent | Error> = {
  "https://mock-wax.example.test/products/paraffin": { url: "https://mock-wax.example.test/products/paraffin", title: "Mock Wax GmbH | Paraffin", siteName: null, text: "Mock Wax is a manufacturer of fully refined paraffin wax 52/54 for the candle industry. We produce slabs and pastilles." },
  "https://mock-refinery.example.test/": { url: "https://mock-refinery.example.test/", title: "Mock Refinery", siteName: "Mock Refinery S.A.", text: "Producer of refined paraffin and waxes for candles. Our production plant is in Mockville." },
  "https://mock-hotel.example.test/": { url: "https://mock-hotel.example.test/", title: "Mock Hotel", siteName: null, text: "Rooms, breakfast and candles on every table." },
  "https://mock-down.example.test/": new Error("Website: HTTP 503"),
};

const mockProviders = (over: Partial<Providers> = {}): Providers => ({
  ...NO_PROVIDERS,
  webSearch: [
    {
      key: "mock_search",
      name: "Mock search (tests only)",
      costPerQuery: 0.005,
      async search(query) {
        calls.search.push(query);
        return [
          { title: "Mock Wax – paraffin 52/54", url: "https://mock-wax.example.test/products/paraffin", snippet: null },
          { title: "Mock Refinery", url: "https://mock-refinery.example.test/", snippet: null },
          { title: "Mock Hotel", url: "https://mock-hotel.example.test/", snippet: null },
          { title: "Mock site that is down", url: "https://mock-down.example.test/", snippet: null },
          { title: "Paraffin on a marketplace", url: "https://www.alibaba.com/mock-paraffin", snippet: null },
          // The company's own supplier is never an alternative.
          { title: "SER", url: "https://www.ser.example.test/", snippet: null },
        ];
      },
    },
  ],
  pages: [
    {
      key: "mock_pages",
      name: "Mock websites (tests only)",
      async read(url) {
        calls.page.push(url);
        const page = PAGES[url];
        if (!page) throw new Error(`Website: no mock page for ${url}`);
        if (page instanceof Error) throw page;
        return page;
      },
    },
  ],
  fx: [
    {
      key: "mock_fx",
      name: "Mock rates (tests only)",
      async rate(currency, date) {
        calls.fx++;
        return currency === "USD" ? { rate: 1.12, date, sourceName: "Mock central bank", sourceUrl: "https://rates.example.test" } : null;
      },
    },
  ],
  trade: [
    {
      key: "mock_trade",
      name: "Mock trade statistics (tests only)",
      async imports({ code, reporter }) {
        calls.trade++;
        return { code, description: "Mock paraffin heading", reporter, months: [{ period: "2026-05", valueEUR: 2_400_000, quantityKg: 2_000_000 }, { period: "2026-06", valueEUR: 2_300_000, quantityKg: 2_000_000 }], sourceName: "Mock Trade Statistics", sourceUrl: "https://trade.example.test", updated: "2026-09-15" };
      },
    },
  ],
  ...over,
});

const deps = (over: Partial<ResearchDeps> = {}): ResearchDeps => ({ providers: mockProviders(), limits: RESEARCH_LIMITS, now: () => new Date(), ...over });
const candidates = (productId: string) => db.select().from(schema.supplierCandidates).where(eq(schema.supplierCandidates.productId, productId));

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.settings).values({ id: 1, companyName: "Mock Candle Co.", country: "Italy" });
  const [ser] = await db.insert(schema.suppliers).values({ name: "SER S.p.A.", country: "Italy" }).returning();
  const [maker] = await db.insert(schema.suppliers).values({ name: "Mock Plast S.r.l.", country: "Italy" }).returning();
  const [p] = await db.insert(schema.products).values({ name: "Paraffina SER 52/54 (XXF)", sku: "PAR", unit: "kg", kind: "direct_material" }).returning();
  const [c] = await db.insert(schema.products).values({ name: "ART. LC TR. Contenitori per ceri", sku: "CON", unit: "pcs", kind: "component" }).returning();
  paraffin = p.id;
  container = c.id;
  for (const [productId, supplierId, unit, price] of [[p.id, ser.id, "kg", "1.48"], [c.id, maker.id, "pcs", "0.075"]] as const) {
    for (const i of [1, 2, 3]) {
      const d = new Date(`${todayISO()}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i);
      await db.insert(schema.purchases).values({ productId, supplierId, date: d.toISOString().slice(0, 10), quantity: "20000", unit, unitPrice: price, totalAmount: String(20000 * Number(price)), source: "csv" });
    }
  }
}, 30_000);

describe("a research on a raw material", () => {
  it("finds candidates only where a site's own page states the product, and keeps every source", async () => {
    await db.insert(schema.marketBenchmarks).values({ productId: paraffin, type: "direct_benchmark", label: "Mock paraffin, Europe", low: "1.56", high: "1.56", unit: "kg", currency: "USD", sourceName: "Mock Price Report", sourceUrl: "https://report.example.test", sourceDate: "2026-09-21", sourceLevel: "external", comparability: "partial", provider: "mock" });
    const before = { purchases: await db.select().from(schema.purchases), suppliers: await db.select().from(schema.suppliers) };

    const outcome = await runResearch(db, paraffin, deps());
    // One site was down: the research goes on and says so.
    expect(outcome).toMatchObject({ status: "partial", added: 2 });
    expect(outcome.errors).toEqual([{ step: "inspect", message: expect.stringContaining("mock-down.example.test") }]);

    const found = await candidates(paraffin);
    expect(found.map((c) => c.name).sort()).toEqual(["Mock Refinery S.A.", "Mock Wax GmbH"]);
    const wax = found.find((c) => c.name === "Mock Wax GmbH")!;
    // Product and grade on its page: highly comparable. Still "discovered": nobody validated it.
    expect(wax).toMatchObject({ source: WEB_RESEARCH, status: "discovered", sourceLevel: "supplier_official", sourceUrl: "https://mock-wax.example.test/products/paraffin", technicalCompatibility: "high", companyType: "manufacturer", discoveredAt: todayISO(), supplierId: null });
    expect(wax.specCheck).toMatchObject({ confirmed: ["52/54"], missing: [] });
    // Product without the grade: a possible supplier, grade to confirm.
    expect(found.find((c) => c.name === "Mock Refinery S.A.")).toMatchObject({ technicalCompatibility: "partial", specCheck: { confirmed: [], missing: ["52/54"] } });
    // Nothing commercial is made up: no price, no minimum order, no lead time.
    for (const c of found) expect(c).toMatchObject({ priceLow: null, moq: null, leadTimeDays: null, paymentTerms: null, certifications: null });

    // The reference in dollars got the official rate of its date; trade statistics came in as a trade benchmark.
    const references = await db.select().from(schema.marketBenchmarks).where(eq(schema.marketBenchmarks.productId, paraffin));
    expect(references.find((b) => b.currency === "USD")).toMatchObject({ fxDate: "2026-09-21" });
    expect(Number(references.find((b) => b.currency === "USD")!.fxRate)).toBe(1.12);
    const trade = references.find((b) => b.type === "trade_benchmark")!;
    expect(trade).toMatchObject({ provider: "mock_trade", sourceLevel: "official_data", comparability: "partial", period: "2026-05 – 2026-06", label: "271220 — Mock paraffin heading" });
    expect([Number(trade.low), Number(trade.high)]).toEqual([1.15, 1.2]);

    const { runs, evidence } = await readResearch(db);
    const run = runs.find((r) => r.id === outcome.runId)!;
    expect(run).toMatchObject({ productId: paraffin, status: "partial", productClass: "commodity", depth: "standard", confidence: "low" });
    expect(run.steps.map((s) => [s.key, s.status])).toEqual([["understand", "done"], ["queries", "done"], ["discover", "done"], ["inspect", "done"], ["pricing", "done"], ["trade", "done"], ["conclude", "done"]]);
    // The customs code came from the product's category: it is said to be a suggestion.
    expect(run.steps.find((s) => s.key === "trade")!.note!.message).toBe("Customs code 271220 is a suggestion from the product's category: confirm it.");
    expect(run.summary.map((l) => l.message).join(" ")).toContain("This is not enough to claim a saving.");
    const mine = evidence.filter((e) => e.runId === run.id);
    expect(mine.map((e) => e.type).sort()).toEqual(["fx", "supplier", "supplier", "trade"]);
    expect(mine.every((e) => !!e.sourceUrl && !!e.sourceName)).toBe(true);

    // What the company buys is untouched, and no supplier was created.
    expect(await db.select().from(schema.purchases)).toEqual(before.purchases);
    expect(await db.select().from(schema.suppliers)).toEqual(before.suppliers);
    // The marketplace and the company's own supplier were never opened.
    expect(calls.page.some((u) => u.includes("alibaba") || u.includes("ser.example"))).toBe(false);
    expect(JSON.stringify(calls.search)).not.toMatch(/SER|1[.,]48/);
  }, 30_000);

  it("a second research reuses what was answered: no search is paid for twice, no candidate is doubled", async () => {
    const searches = calls.search.length;
    const outcome = await runResearch(db, paraffin, deps());
    expect(calls.search.length).toBe(searches);
    expect(outcome.added).toBe(0);
    expect(await candidates(paraffin)).toHaveLength(2);
    const usage = await readUsage(db);
    expect(usage.total.cached).toBeGreaterThan(0);
    // 5 searches at the mock's 0.005 each, paid once.
    expect(usage.byProvider.find((u) => u.provider === "mock_search")!.cost).toBeCloseTo(0.025, 6);
    expect((await readResearch(db)).runs.filter((r) => r.productId === paraffin)).toHaveLength(2);
  }, 30_000);

  it("before starting, the plan says what it takes — and that the searches are already on file", async () => {
    const plan = await planResearch(db, [paraffin, container], deps());
    expect(plan).toMatchObject({ searchProvider: "Mock search (tests only)", costPerQuery: 0.005 });
    const [first, second] = plan.products;
    expect(first).toMatchObject({ productId: paraffin, queries: 5, cached: 5 });
    expect(second.cached).toBe(0);
    expect(plan.estimatedCost).toBeCloseTo(second.queries * 0.005, 6);
  });
});

describe("limits and missing sources", () => {
  it("no more searches and pages than the limits allow", async () => {
    calls.search.length = 0;
    calls.page.length = 0;
    // A product that weighs little on the spend is researched more lightly: 2 of the 5 searches, 3 of the 8 pages.
    const outcome = await runResearch(db, container, deps());
    expect(calls.search).toHaveLength(2);
    expect(calls.search[0]).toBe("Contenitori custom manufacturer");
    expect(outcome.checked).toBe(3);
    // All three pages were already on file from the earlier research: nothing was fetched again.
    expect(calls.page).toHaveLength(0);
    const [run] = (await readResearch(db)).runs.filter((r) => r.productId === container);
    // A part known by its article code: suppliers and a specification to match, no trade data.
    expect(run.productClass).toBe("custom");
    expect(run.steps.find((s) => s.key === "trade")).toMatchObject({ status: "skipped" });
    expect(run.steps.find((s) => s.key === "inspect")!.note!.message).toBe("The limit of pages per product was reached: the rest was not opened.");
  }, 30_000);

  it("with no search engine configured nothing is invented: the step says so, and the candidates on file are checked", async () => {
    const [p] = await db.insert(schema.products).values({ name: "Paraffina 56/58", sku: "PAR2", unit: "kg", kind: "direct_material" }).returning();
    await db.insert(schema.supplierCandidates).values({ productId: p.id, name: "Mock Refinery S.A.", source: "manual", sourceLevel: "supplier_official", sourceUrl: "https://mock-refinery.example.test/", website: "https://mock-refinery.example.test/", status: "to_review", technicalCompatibility: "not" });
    const outcome = await runResearch(db, p.id, deps({ providers: mockProviders({ webSearch: [] }) }));
    expect(outcome).toMatchObject({ status: "completed", added: 0, checked: 1 });
    const [run] = (await readResearch(db)).runs.filter((r) => r.productId === p.id);
    expect(run.steps.find((s) => s.key === "discover")).toMatchObject({ status: "not_configured" });
    const [c] = await candidates(p.id);
    expect(c.specCheck).toMatchObject({ product: expect.arrayContaining(["paraffin"]), missing: ["56/58"] });
    // The user had judged it "different product": the research does not overrule them.
    expect(c).toMatchObject({ technicalCompatibility: "not", status: "to_review", source: "manual" });
  }, 30_000);

  it("the daily spending limit stops the searches, not the rest", async () => {
    const [p] = await db.insert(schema.products).values({ name: "Stearina 5 kg", sku: "STE", unit: "kg", kind: "direct_material" }).returning();
    calls.search.length = 0;
    await runResearch(db, p.id, deps({ limits: { ...RESEARCH_LIMITS, dailyCostLimit: 0.001 } }));
    expect(calls.search).toHaveLength(0);
    const [run] = (await readResearch(db)).runs.filter((r) => r.productId === p.id);
    expect(run.steps.find((s) => s.key === "discover")!.note!.message).toBe("Stopped at the spending limit: not every search was run.");
    expect(run.steps.find((s) => s.key === "conclude")).toMatchObject({ status: "done" });
  }, 30_000);
});

describe("research done outside the app", () => {
  const file = researchFile.parse({
    source: "Mock web research",
    researchedAt: "2026-10-04",
    candidates: [
      { products: ["ART. LC TR. Contenitori per ceri", "Not in the catalogue"], name: "Mock Moulding S.r.l.", country: "Italy", website: "https://mock-moulding.example.test/", sourceUrl: "https://mock-moulding.example.test/", sourceLevel: "supplier_official", companyType: "manufacturer", matchedProduct: "Plastic moulding", notes: "To check whether they make candle containers" },
      { products: ["CON"], name: "Mock Plast", sourceUrl: "https://mock-plast.example.test/" },
    ],
    benchmarks: [{ product: "CON", label: "Mock container index", low: 0.07, unit: "pcs", sourceName: "Mock Report", sourceDate: "2026-09-01" }],
  });

  it("a dry run says what would be loaded and writes nothing", async () => {
    const before = await candidates(container);
    const preview = await importResearch(db, file, { dryRun: true }, deps());
    expect(preview).toMatchObject({ candidates: 1, benchmarks: 1, unknown: ["Not in the catalogue"], skipped: [{ name: "Mock Plast", reason: "known_supplier" }] });
    expect(preview.products).toEqual([{ id: container, name: "ART. LC TR. Contenitori per ceri", candidates: 1, benchmarks: 1 }]);
    expect(await candidates(container)).toEqual(before);
  });

  it("loaded, its suppliers are candidates to review with their source and date — never suppliers", async () => {
    const suppliers = await db.select().from(schema.suppliers);
    await importResearch(db, file, { dryRun: false }, deps());
    const loaded = (await candidates(container)).find((c) => c.name === "Mock Moulding S.r.l.")!;
    expect(loaded).toMatchObject({ source: WEB_RESEARCH, status: "discovered", discoveredAt: "2026-10-04", sourceDate: "2026-10-04", companyType: "manufacturer", supplierId: null, notes: "To check whether they make candle containers" });
    expect(await db.select().from(schema.suppliers)).toEqual(suppliers);
    const { runs, evidence } = await readResearch(db);
    const run = runs.find((r) => r.productId === container && r.depth === "imported")!;
    expect(run).toMatchObject({ status: "completed", resultsFound: 2, sourcesChecked: 1 });
    expect(evidence.filter((e) => e.runId === run.id).map((e) => e.type).sort()).toEqual(["benchmark", "supplier"]);
    // Loading the same file again adds nothing.
    expect(await importResearch(db, file, { dryRun: true }, deps())).toMatchObject({ candidates: 0, benchmarks: 0 });
  });
});

describe("a candidate becomes a supplier only when the user says so", () => {
  it("converting creates the supplier once, and links every candidate of that company", async () => {
    const [c] = (await candidates(paraffin)).filter((x) => x.name === "Mock Wax GmbH");
    const first = await convertCandidate(db, c.id);
    expect(first.created).toBe(true);
    expect((await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, first.supplierId)))[0]).toMatchObject({ name: "Mock Wax GmbH", website: "https://mock-wax.example.test" });
    expect((await candidates(paraffin)).find((x) => x.id === c.id)).toMatchObject({ status: "converted", supplierId: first.supplierId });
    expect((await convertCandidate(db, c.id)).created).toBe(false);
  });
});
