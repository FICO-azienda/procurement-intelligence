/**
 * Deep research, the pure part. Every company, site and page here is a MOCK
 * (example.test): none is a real supplier, and none ships in the app.
 */
import { describe, expect, it } from "vitest";
import { analyze } from "../intel/engine";
import { decisionFor } from "../intel/decision";
import { dataset, product, purchase, quote, supplier } from "../intel/fixtures";
import { said, translator } from "../i18n";
import { searchQueries } from "../sourcing/discovery";
import { marketView } from "../sourcing/market";
import type { MarketBenchmark, SupplierCandidate } from "../sourcing/types";
import { Budget, RESEARCH_LIMITS, limitsFrom, researchPlan } from "./budget";
import { researchSummary } from "./conclusions";
import { parseResearchFile } from "./file";
import { inspectPage, productTerms } from "./inspect";
import { countryCodeOfHost, leadsFromResults } from "./leads";
import { researchStatus } from "./status";
import { STRATEGY, classifyProduct } from "./strategy";

const AS_OF = "2026-10-01";
const NOW = new Date("2026-10-01T10:00:00Z");
let n = 0;

function candidate(over: Partial<SupplierCandidate> = {}): SupplierCandidate {
  n++;
  return { id: `c${n}`, productId: "p", name: `Mock Supplier ${n}`, country: "Germany", website: `https://mock-${n}.example.test`, source: "web_research", sourceLevel: "supplier_official", sourceUrl: `https://mock-${n}.example.test/wax`, sourceDate: "2026-09-20", productMatched: "Refined paraffin wax", matchReason: null, technicalCompatibility: "partial", specifications: null, priceLow: null, priceHigh: null, priceType: null, priceSourceUrl: null, currency: null, unit: null, incoterm: null, moq: null, leadTimeDays: null, paymentTerms: null, certifications: null, shippingOrigin: null, confidence: null, notes: null, status: "discovered", supplierId: null, companyType: "manufacturer", sourceTitle: null, discoveredAt: "2026-10-01", specCheck: { url: `https://mock-${n}.example.test/wax`, checkedAt: "2026-10-01", product: ["paraffin"], confirmed: [], missing: ["52/54"] }, ...over };
}

function benchmark(over: Partial<MarketBenchmark> = {}): MarketBenchmark {
  return { id: `b${++n}`, productId: "p", type: "direct_benchmark", label: "Mock paraffin, Europe", low: 1.39, high: 1.39, unit: "kg", currency: "EUR", fxRate: null, fxDate: null, changePct: null, period: null, sourceName: "Mock Price Report", sourceUrl: "https://report.example.test", sourceDate: "2026-09-21", sourceLevel: "external", comparability: "partial", notes: null, provider: "mock", ...over };
}

function paraffin(quotes: number[] = []) {
  const current = supplier({ name: "Current Supplier", country: "Italy" });
  const p = product({ name: "Paraffina 52/54 (XXF)", unit: "kg", currentSupplierId: current.id });
  const purchases = [["2026-03-10", 1.5], ["2026-06-10", 1.49], ["2026-09-10", 1.48]].map(([date, unitPrice]) => purchase({ productId: p.id, supplierId: current.id, date: date as string, quantity: 90_000, unitPrice: unitPrice as number }));
  const others = quotes.map((_, i) => supplier({ name: `Mock Quote ${i + 1}`, country: "Italy" }));
  const qs = quotes.map((price, i) => quote({ productId: p.id, supplierId: others[i].id, date: "2026-09-20", unitPrice: price, moq: 20_000, incoterm: "DAP", paymentTermsDays: 30 }));
  const intel = analyze(dataset({ suppliers: [current, ...others], products: [p], purchases, quotes: qs }), [], [], AS_OF);
  return { intel: intel.products[0], decision: decisionFor(intel, p.id)! };
}
const view = (x: ReturnType<typeof paraffin>, candidates: SupplierCandidate[] = [], benchmarks: MarketBenchmark[] = []) => marketView({ intel: x.intel, decision: x.decision, candidates, benchmarks, homeCountry: "Italy", asOf: AS_OF });
const lines = (v: ReturnType<typeof view>) => researchSummary(v).map((l) => l.message);

describe("what kind of product it is decides what is looked for", () => {
  const base = { companyName: "Mock Candle Co.", specifications: {} };
  it("a material bought by weight is a commodity: benchmarks and trade data make sense", () => {
    const c = classifyProduct({ ...base, name: "Paraffina 52/54 (XXF)", kind: "direct_material", unit: "kg" });
    expect(c).toMatchObject({ productClass: "commodity", chosen: false });
    expect(STRATEGY[c.productClass]).toMatchObject({ benchmarks: true, trade: true });
  });
  it("a product carrying the company's own name is made for it: manufacturers and quotes, no public price", () => {
    const c = classifyProduct({ ...base, companyName: "Mock Candle S.r.l.", name: "Tealight 18x12 Mock Candle", kind: "direct_material", unit: "box" });
    expect(c.productClass).toBe("private_label");
    expect(STRATEGY.private_label).toMatchObject({ benchmarks: false, trade: false, publicPrices: false });
  });
  it("a part known only by a supplier's article code is custom; with measurable specifications it is standard", () => {
    expect(classifyProduct({ ...base, name: "ART. LC TR. Contenitori per ceri", kind: "component", unit: "pcs" }).productClass).toBe("custom");
    expect(classifyProduct({ ...base, name: "Fondelli diam.60", kind: "component", unit: "pcs", specifications: { diameter: "60" } }).productClass).toBe("standard");
  });
  it("finished goods bought by weight are not a raw material; services are services; the user's choice wins", () => {
    expect(classifyProduct({ ...base, name: "Candele da chiesa D13", kind: "direct_material", unit: "kg" }).productClass).toBe("standard");
    expect(classifyProduct({ ...base, name: "Trasporto", kind: "logistics", unit: "pcs" }).productClass).toBe("service");
    expect(classifyProduct({ ...base, name: "Paraffina 52/54", kind: "direct_material", unit: "kg", override: "custom" })).toMatchObject({ productClass: "custom", chosen: true });
  });
  it("a private-label product is searched as such, and the current supplier is never in a search", () => {
    const queries = searchQueries({ name: "Tealight MOCKSUP 18x12", category: null, subcategory: null, family: null, specifications: {}, deliveryCountry: "Italy", knownSuppliers: ["Mocksup S.p.A."], productClass: "private_label" });
    expect(queries[0]).toContain("private label manufacturer");
    expect(queries.join(" ").toLowerCase()).not.toContain("mocksup");
  });
});

describe("a search result is a page, not a supplier", () => {
  const searches = [
    { query: "paraffin 52/54 supplier", results: [
      { title: "Mock Wax GmbH – paraffin", url: "https://www.mock-wax.example.test/", snippet: null },
      { title: "Paraffin 52/54 on a marketplace", url: "https://www.alibaba.com/paraffin", snippet: null },
      { title: "Paraffin wax", url: "https://en.wikipedia.org/wiki/Paraffin_wax", snippet: null },
      { title: "Current Supplier", url: "https://www.currentsupplier.example.test/", snippet: null },
    ] },
    { query: "paraffin manufacturer Europe", results: [
      { title: "Mock Wax – products", url: "https://mock-wax.example.test/products/paraffin-52-54", snippet: "Fully refined" },
      { title: "Mock Trader", url: "https://mock-trader.example.test/", snippet: null },
      { title: "Already on file", url: "https://known.example.test/wax", snippet: null },
    ] },
  ];
  it("marketplaces and encyclopedias are left out, a site is one lead, known ones are not opened as new", () => {
    const { leads, dropped } = leadsFromResults(searches, { knownHosts: ["known.example.test"], knownSuppliers: ["Current Supplier S.p.A."], max: 8 });
    expect(leads.map((l) => l.host)).toEqual(["mock-wax.example.test", "mock-trader.example.test"]);
    // The product page is opened rather than the home page; both searches found it.
    expect(leads[0]).toMatchObject({ url: "https://mock-wax.example.test/products/paraffin-52-54", queries: ["paraffin 52/54 supplier", "paraffin manufacturer Europe"] });
    expect(dropped).toEqual(expect.arrayContaining([{ host: "alibaba.com", reason: "not_a_supplier_site" }, { host: "en.wikipedia.org", reason: "not_a_supplier_site" }, { host: "known.example.test", reason: "already_known" }, { host: "currentsupplier.example.test", reason: "already_known" }]));
  });
  it("no more sites than the limit are kept", () => {
    const { leads, dropped } = leadsFromResults(searches, { knownHosts: [], knownSuppliers: [], max: 1 });
    expect(leads).toHaveLength(1);
    expect(dropped.filter((d) => d.reason === "over_limit").length).toBeGreaterThan(0);
  });
  it("a country is read from a national domain only", () => {
    expect(countryCodeOfHost("mock.example.pl")).toBe("PL");
    expect(countryCodeOfHost("mock.co.uk")).toBe("GB");
    expect(countryCodeOfHost("mock.com")).toBeNull();
    expect(countryCodeOfHost("mock.io")).toBeNull();
  });
});

describe("reading a supplier's own page", () => {
  const terms = productTerms({ name: "Paraffina MOCKSUP 52/54 (XXF)", knownSuppliers: ["Mocksup S.p.A."] });
  it("what to look for comes from the product's name: its word, and figures that can't be mistaken", () => {
    expect(terms.words).toContain("paraffin");
    expect(terms.specs).toEqual(["52/54"]);
    // An article code is not a specification, and a single number proves nothing.
    expect(productTerms({ name: "F60/8N - Fondelli diam.60" }).specs).toEqual([]);
    // A name made of codes and the buyer's own brand says nothing to look for.
    expect(productTerms({ name: "TL 10 15 A 1 0 P 30 CC 12 Mockbrand Best 30X12", companyName: "Mockbrand S.r.l." }).words).toEqual([]);
    expect(productTerms({ name: "Mockbrand 30X12", companyName: "Mockbrand S.r.l." }).words).toEqual([]);
    // Without a known word, a name opens with what the thing is.
    expect(productTerms({ name: "Viti zincate 8x40" })).toEqual({ words: ["viti"], specs: ["8x40"] });
  });
  it("product stated, grade not stated: a possible supplier whose exact grade must be confirmed", () => {
    const found = inspectPage({ url: "https://mock-wax.example.test/", title: "Mock Wax GmbH | Waxes", siteName: null, text: "Mock Wax is a manufacturer of refined paraffin wax for the candle industry. We produce pastilles and slabs." }, terms);
    expect(found).toMatchObject({ fit: "partial", confirmed: [], missing: ["52/54"], companyType: "manufacturer", companyName: "Mock Wax GmbH" });
    expect(found.excerpt).toContain("refined paraffin wax");
  });
  it("product and grade stated: highly comparable — still a statement on a page, to verify", () => {
    const found = inspectPage({ url: "https://mock-trader.example.test/p", title: "Paraffin", siteName: "Mock Trader", text: "Distributor of fully refined paraffin 52-54 °C in slabs. Wholesale distribution of waxes; distributor since 1990." }, terms);
    expect(found).toMatchObject({ fit: "high", confirmed: ["52/54"], missing: [], companyType: "distributor", companyName: "Mock Trader" });
  });
  it("a page that does not name the product proves nothing, whatever numbers it shows", () => {
    expect(inspectPage({ url: "https://mock.example.test/", title: "Mock", siteName: null, text: "Opening hours 52/54. Contact us." }, terms)).toMatchObject({ fit: null, product: [], confirmed: [] });
  });
});

describe("what a research may spend", () => {
  it("searches stop at the limit per product, and at the daily spending limit", () => {
    const budget = new Budget({ ...RESEARCH_LIMITS, maxSearchesPerProduct: 2, dailyCostLimit: 0.01 }, 0.004);
    expect(budget.canSearch(0.005)).toBe(true);
    budget.search(0.005, false);
    // 0.004 spent before + 0.005 now + 0.005 more would pass 0.01.
    expect(budget.canSearch(0.005)).toBe(false);
    const free = new Budget({ ...RESEARCH_LIMITS, maxSearchesPerProduct: 2 });
    free.search(null, false);
    free.search(null, true);
    expect(free.canSearch(null)).toBe(false);
  });
  it("pages opened are counted too", () => {
    const budget = new Budget({ ...RESEARCH_LIMITS, maxPagesPerProduct: 1 });
    budget.page();
    expect(budget.canOpenPage()).toBe(false);
  });
  it("the plan says the cost when it can be known — and says it can't when the price per search is not set", () => {
    const products = [{ productId: "a", name: "A", queries: 5, cached: 2, pages: 8 }, { productId: "b", name: "B", queries: 5, cached: 0, pages: 8 }];
    expect(researchPlan(products, 0.005, true, RESEARCH_LIMITS, 0)).toMatchObject({ queries: 10, cachedQueries: 2, overDailyLimit: false });
    expect(researchPlan(products, 0.005, true, RESEARCH_LIMITS, 0).estimatedCost).toBeCloseTo(0.04, 6);
    expect(researchPlan(products, null, true, RESEARCH_LIMITS, 0).estimatedCost).toBeNull();
    expect(researchPlan(products, null, false, RESEARCH_LIMITS, 0).estimatedCost).toBe(0);
    expect(researchPlan(products, 0.005, true, { ...RESEARCH_LIMITS, dailyCostLimit: 0.03 }, 0).overDailyLimit).toBe(true);
  });
  it("limits come from the environment, never from code", () => {
    expect(limitsFrom({ RESEARCH_MAX_SEARCHES: "3", RESEARCH_DAILY_LIMIT_EUR: "2" })).toMatchObject({ maxSearchesPerProduct: 3, dailyCostLimit: 2, maxPagesPerProduct: RESEARCH_LIMITS.maxPagesPerProduct });
  });
});

describe("one benchmark is not a market", () => {
  const x = paraffin();
  it("a single external reference gives a gap to read, not a position, not an amount", () => {
    const v = view(x, [candidate(), candidate()], [benchmark()]);
    expect(v.range).toMatchObject({ low: 1.39, high: 1.39, reliable: false, confidence: "low" });
    expect(v.position).toBe("insufficient");
    expect(Math.round(v.gapPct!.high)).toBe(6);
    expect(v.opportunity).toBeNull();
    expect(v.next.kind).toBe("request_quotes");
    const text = lines(v);
    expect(text).toHaveLength(6);
    expect(text[1]).toBe("Potential companies found: 2. After screening what is on file, 2 appear relevant and 2 are recommended for a request for quotation.");
    expect(text[2]).toBe("None of the recommended ones publicly confirms the exact specification (52/54): it has to be asked.");
    expect(text[3]).toBe("One external reference (Mock Price Report) indicates €1,39/kg: your price is about 6% above it, but it does not confirm the same specification and delivery terms.");
    expect(text[4]).toBe("This is not enough to claim a saving.");
    expect(text[5]).toBe("The next useful step is a targeted request for quotation to the recommended suppliers, not a wider search.");
  });
  it("a reference in dollars is compared only once an official rate is on file — and says which", () => {
    const usd = benchmark({ low: 1.56, high: 1.56, currency: "USD" });
    const without = view(x, [], [usd]);
    expect(without.range).toBeNull();
    expect(without.observations.find((o) => o.type === "direct_benchmark")).toMatchObject({ low: null, asWritten: "USD 1,56/kg", used: false });
    const withRate = view(x, [], [{ ...usd, fxRate: 1.1225, fxDate: "2026-10-02" }]);
    expect(withRate.range!.low).toBeCloseTo(1.3898, 4);
    expect(withRate.observations.find((o) => o.type === "direct_benchmark")!.detail).toContain("USD 1,56/kg at the source, converted at the reference rate of 02/10/2026 (1,1225 USD for one euro).");
  });
  it("one real quote next to a partly comparable reference: the quote is the range, the reference steps aside, and there is still no amount", () => {
    const v = view(paraffin([1.39]), [], [benchmark({ low: 1.36, high: 1.36 })]);
    expect(v.range).toMatchObject({ low: 1.39, high: 1.39, observations: 1, reliable: true, confidence: "low" });
    expect(v.observations.find((o) => o.type === "direct_benchmark")).toMatchObject({ used: false });
    expect(v.position).toBe("materially_above");
    expect(v.opportunity).toBeNull();
    expect(v.opportunityNote).toBe("One observation is too thin to put an amount on the gap: get a second comparable quote.");
  });

  it("trade statistics alone are an indication: shown, never a position", () => {
    const v = view(x, [], [benchmark({ type: "trade_benchmark", low: 1.17, high: 1.21, sourceName: "Mock Trade Statistics", sourceLevel: "official_data" })]);
    expect(v.range).toMatchObject({ indirect: true, reliable: false });
    expect(v.position).toBe("insufficient");
    expect(lines(v).join(" ")).toContain("Trade statistics (Mock Trade Statistics) put imports at €1,17–€1,21/kg on average");
  });
  it("two comparable quotes make a range, a position and a theoretical opportunity — still not a saving", () => {
    const v = view(paraffin([1.38, 1.44]));
    expect(v.range).toMatchObject({ reliable: true, confidence: "medium" });
    expect(v.position).toBe("slightly_above");
    expect(v.opportunity!.high).toBeGreaterThan(v.opportunity!.low);
    expect(lines(v).join(" ")).toContain("it becomes a saving only if comparable quotes confirm it");
  });
  it("finding nothing is a result, and it is said plainly — in the reader's language too", () => {
    const v = view(x);
    const summary = researchSummary(v);
    expect(summary.map((l) => l.message)).toEqual(expect.arrayContaining(["No alternative supplier has been identified yet.", "No reliable benchmark was found: there is no public price for this product on file.", "Next step: find alternative suppliers and ask them for a quote."]));
    expect(summary.map((l) => said(translator("it"), l)).join(" ")).toContain("Nessun benchmark affidabile trovato");
  });
});

describe("where a product stands", () => {
  const x = paraffin();
  const run = { status: "completed", startedAt: "2026-10-01T09:00:00Z" };
  const status = (v: ReturnType<typeof view>, r: typeof run | null = run) => researchStatus(v, r, NOW, 10);
  it("from not researched to validated, read from what is on file", () => {
    expect(status(view(x), null)).toBe("not_researched");
    expect(status(view(x))).toBe("no_evidence");
    expect(status(view(x), { status: "running", startedAt: "2026-10-01T09:58:00Z" })).toBe("researching");
    // A run still "running" an hour later was interrupted: it does not block the product.
    expect(status(view(x), { status: "running", startedAt: "2026-10-01T08:00:00Z" })).toBe("no_evidence");
    expect(status(view(x, [], [benchmark()]))).toBe("market_data");
    expect(status(view(x, [candidate()]))).toBe("suppliers_found");
    expect(status(view(x, [candidate({ status: "validated" })]))).toBe("rfq_needed");
    expect(status(view(x, [candidate({ status: "quote_requested" })]))).toBe("awaiting_quotes");
    expect(status(view(x, [candidate({ status: "quote_received" })]))).toBe("quotes_received");
    expect(status(view(paraffin([1.38, 1.4])))).toBe("opportunity");
    expect(status(view(x, [candidate({ status: "rejected" })]))).toBe("no_evidence");
  });
});

describe("research done outside the app", () => {
  it("a file is read only if every candidate has the page it was found on", () => {
    const ok = parseResearchFile(JSON.stringify({ researchedAt: "2026-10-04", candidates: [{ products: ["Paraffina 52/54"], name: "Mock Wax", sourceUrl: "https://mock-wax.example.test/" }] }));
    expect(ok).toMatchObject({ ok: true, file: { source: "Web research", candidates: [{ sourceLevel: "external" }], benchmarks: [] } });
    expect(parseResearchFile(JSON.stringify({ researchedAt: "2026-10-04", candidates: [{ products: ["x"], name: "Mock, no page" }] }))).toMatchObject({ ok: false, error: "invalid", where: "candidates.0.sourceUrl" });
    expect(parseResearchFile("not json")).toEqual({ ok: false, error: "not_json" });
  });
});
