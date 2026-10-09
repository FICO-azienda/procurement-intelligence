/**
 * Sourcing, the pure part. Every supplier, price and benchmark in this file
 * is a MOCK made up for the tests ("Mock Wax GmbH", example.test): none is a
 * real company or a real price.
 */
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { decisionFor } from "../intel/decision";
import { analyze } from "../intel/engine";
import { dataset, product, purchase, quote, supplier } from "../intel/fixtures";
import { acceptDiscovered, candidateComparability, rankCandidates, refineQueries, searchQueries, topCandidates } from "./discovery";
import { marketView, sourcingReview } from "./market";
import { KNOWN_SOURCES, NO_PROVIDERS, connected } from "./providers";
import { crossesCustoms, regionOf } from "./regions";
import { readReply, readReplyFor } from "./reply";
import { rfqSpec } from "./rfq-spec";
import { quoteOpportunity, trueCost, type TrueCost, type TrueCostInput } from "./true-cost";
import { rfqCategoryOf, rfqDraft, rfqText } from "./rfq";
import { contactHistory, screenCandidates, supplierOpportunities, type ScreeningContext } from "./screening";
import type { MarketBenchmark, SupplierCandidate } from "./types";

const AS_OF = "2026-10-01";
let n = 0;

function candidate(over: Partial<SupplierCandidate> = {}): SupplierCandidate {
  return {
    id: `c${++n}`,
    productId: "p",
    name: `Mock Supplier ${n}`,
    country: "Germany",
    website: `https://mock-${n}.example.test`,
    source: "mock",
    sourceLevel: "supplier_official",
    sourceUrl: `https://mock-${n}.example.test/products/wax`,
    sourceDate: "2026-09-20",
    productMatched: "Fully refined paraffin 52/54",
    matchReason: null,
    technicalCompatibility: "high",
    specifications: null,
    priceLow: null,
    priceHigh: null,
    priceType: null,
    priceSourceUrl: null,
    currency: null,
    unit: null,
    incoterm: null,
    moq: null,
    leadTimeDays: null,
    paymentTerms: null,
    certifications: null,
    shippingOrigin: null,
    confidence: null,
    notes: null,
    status: "discovered",
    supplierId: null,
    companyType: null,
    sourceTitle: null,
    discoveredAt: null,
    specCheck: null,
    ...over,
  };
}

function benchmark(over: Partial<MarketBenchmark> = {}): MarketBenchmark {
  return { id: `b${++n}`, productId: "p", type: "direct_benchmark", label: "Mock paraffin index", low: 1.3, high: 1.4, unit: "kg", currency: "EUR", fxRate: null, fxDate: null, periodMonth: null, fxMethod: null, changePct: null, period: null, sourceName: "Mock Price Report", sourceUrl: "https://report.example.test", sourceDate: "2026-09-15", sourceLevel: "licensed_data", comparability: "comparable", notes: null, provider: "mock", ...over };
}

/** A product bought four times from one supplier at 1.48 today, 20 t each time. */
function paraffin(quotes: { price: number; date?: string; name?: string }[] = []) {
  const ser = supplier({ name: "Current Supplier", country: "Italy" });
  const p = product({ name: "Paraffina 52/54 (XXF)", unit: "kg", currentSupplierId: ser.id, category: "Waxes and paraffin", subcategory: "Paraffin" });
  const purchases = [["2026-03-10", 1.42], ["2026-05-10", 1.45], ["2026-07-10", 1.47], ["2026-09-10", 1.48]].map(([date, unitPrice]) => purchase({ productId: p.id, supplierId: ser.id, date: date as string, quantity: 20_000, unitPrice: unitPrice as number }));
  const others = quotes.map((q, i) => supplier({ name: q.name ?? `Mock Quote ${i + 1}`, country: "Italy" }));
  const qs = quotes.map((q, i) => quote({ productId: p.id, supplierId: others[i].id, date: q.date ?? "2026-09-20", unitPrice: q.price, moq: 20_000, incoterm: "DAP", paymentTermsDays: 30 }));
  const intel = analyze(dataset({ suppliers: [ser, ...others], products: [p], purchases, quotes: qs }), [], [], AS_OF);
  return { p, intel: intel.products[0], decision: decisionFor(intel, p.id)! };
}

const view = (x: ReturnType<typeof paraffin>, candidates: SupplierCandidate[] = [], benchmarks: MarketBenchmark[] = []) => marketView({ intel: x.intel, decision: x.decision, candidates, benchmarks, homeCountry: "Italy", asOf: AS_OF });

describe("internal history first", () => {
  const v = view(paraffin());

  it("says what is paid, to whom, and how the price moved — before anything external", () => {
    expect(v.currentPrice).toBe(1.48);
    expect(v.currentSupplier?.name).toBe("Current Supplier");
    expect(v.history).toMatchObject({ observations: 4, low: { price: 1.42 }, high: { price: 1.48 }, annualQuantity: 80_000 });
    expect(v.history.weightedAverage).toBeCloseTo(1.455, 6);
    expect(v.history.annualSpend).toBeCloseTo(116_400, 6);
    expect(v.observations).toMatchObject([{ type: "actual", low: 1.48, sourceLevel: "invoice", used: false }]);
  });

  it("with nothing else on file there is no market range, no position and no amount — and it says so", () => {
    expect(v.range).toBeNull();
    expect(v.position).toBe("insufficient");
    expect(v.opportunity).toBeNull();
    expect(v.status).toBe("no_market_data");
    expect(v.next.kind).toBe("find_suppliers");
    expect(v.summary.join(" ")).toContain("no market range is shown: nothing is estimated in its place");
    expect(v.summary.join(" ")).toContain("No alternative supplier has been identified yet.");
  });
});

describe("the range the evidence supports", () => {
  it("three recent comparable quotes: a range with high confidence, the price above it, a theoretical gap as a range", () => {
    const v = view(paraffin([{ price: 1.34 }, { price: 1.39 }, { price: 1.42 }]));
    expect(v.range).toMatchObject({ low: 1.34, high: 1.42, confidence: "high", observations: 3, comparable: 3, indirect: false, sources: [{ type: "quote", count: 3 }] });
    // 1.48 against 1.42 is 4% above the top of the range: "slightly above", not "overpaying".
    expect(v.position).toBe("slightly_above");
    expect(v.gapPct!.low).toBeCloseTo(4.2254, 3);
    expect(v.gapPct!.high).toBeCloseTo(10.4478, 3);
    expect(v.opportunity!.low).toBeCloseTo(4_800, 4);
    expect(v.opportunity!.high).toBeCloseTo(11_200, 4);
    expect(v.status).toBe("opportunity");
    expect(v.next.kind).toBe("validate");
    const text = v.summary.join(" ");
    expect(text).toContain("3 × quote");
    expect(text).toContain("between 4% and 10% above it");
    expect(text).toContain("It becomes a saving only when a comparable quote confirms it");
    expect(text).not.toMatch(/saving of|overpay/i);
  });

  it("more than 5% above the top of the range is \"materially above\"", () => {
    expect(view(paraffin([{ price: 1.3 }, { price: 1.36 }])).position).toBe("materially_above");
  });

  it("a price inside the range is in line; below it, below", () => {
    expect(view(paraffin([{ price: 1.44 }, { price: 1.52 }]))).toMatchObject({ position: "in_line", status: "opportunity" });
    const below = view(paraffin([{ price: 1.52 }, { price: 1.6 }]));
    expect(below).toMatchObject({ position: "below", opportunity: null, status: "benchmark_available", next: { kind: "keep_updated" } });
  });

  it("one quote is one quote, not a market: no range, no position, no amount", () => {
    const v = view(paraffin([{ price: 1.36 }]));
    expect(v.range).toMatchObject({ kind: "single_quote", reliable: false, confidence: "low", observations: 1, low: 1.36, high: 1.36 });
    expect(v.position).toBe("insufficient");
    expect(v.opportunity).toBeNull();
    expect(v.opportunityNote).toBe("One quote is not a market: a second comparable quote is needed before a range, and an amount, can be given.");
    // …but the quote itself says how far the current price is from it.
    expect(Math.round(v.observations.find((o) => o.type === "quote")!.gapPct!)).toBe(9);
  });

  it("an old quote is listed, not used", () => {
    const v = view(paraffin([{ price: 1.2, date: "2025-11-01" }]));
    expect(v.range).toBeNull();
    expect(v.observations.find((o) => o.type === "quote")).toMatchObject({ recent: false, used: false });
  });

  it("benchmarks are never mixed with quotes: each is read on its own, and trade data only says something when there is nothing better", () => {
    const direct = view(paraffin([{ price: 1.4 }]), [], [benchmark({ low: 1.32, high: 1.38 })]);
    // One quote and one benchmark are not a range of two: the quote stands alone, the benchmark stays visible with its own gap.
    expect(direct.range).toMatchObject({ low: 1.4, high: 1.4, kind: "single_quote", reliable: false, sources: [{ type: "quote", count: 1 }] });
    expect(direct.observations.find((o) => o.type === "direct_benchmark")).toMatchObject({ low: 1.32, high: 1.38, used: false });
    expect(Math.round(direct.observations.find((o) => o.type === "direct_benchmark")!.gapPct!)).toBe(10);

    const trade = benchmark({ type: "trade_benchmark", low: 1.1, high: 1.2, comparability: "partial", sourceLevel: "official_data" });
    const mixed = view(paraffin([{ price: 1.4 }, { price: 1.42 }]), [], [trade]);
    expect(mixed.range).toMatchObject({ low: 1.4, high: 1.42, kind: "quotes", reliable: true, confidence: "medium" });
    expect(mixed.observations.find((o) => o.type === "trade_benchmark")!.used).toBe(false);

    const only = view(paraffin(), [], [trade]);
    expect(only.range).toMatchObject({ low: 1.1, high: 1.2, confidence: "low", indirect: true });
    expect(only.opportunity).toBeNull();
    expect(only.opportunityNote).toContain("indirect");
    expect(only.status).toBe("benchmark_available");
  });

  it("a cost driver is a movement, never a price level; an estimate never enters the range", () => {
    const v = view(paraffin(), [], [benchmark({ type: "cost_driver", low: null, high: null, changePct: -6.5, period: "last 3 months", label: "Mock crude index" }), benchmark({ type: "estimate", low: 1, high: 1.1 })]);
    expect(v.range).toBeNull();
    expect(v.observations.find((o) => o.type === "cost_driver")).toMatchObject({ low: null, asWritten: "-6,5% · last 3 months", used: false });
  });
});

describe("alternative suppliers", () => {
  const ctx = { unit: "kg", typicalOrderQuantity: 20_000, annualQuantity: 80_000, homeCountry: "Italy" };

  it("are comparable only once the specification is checked, and say what stands in the way", () => {
    expect(candidateComparability(candidate({ technicalCompatibility: null }), ctx)).toEqual({ level: null, reasons: ["Specification not checked yet"] });
    expect(candidateComparability(candidate({ technicalCompatibility: "not" }), ctx).level).toBe("not");
    expect(candidateComparability(candidate(), ctx)).toEqual({ level: "comparable", reasons: [] });
    const far = candidateComparability(candidate({ country: "China", priceLow: 1100, priceHigh: 1200, currency: "USD", unit: "t", incoterm: "FOB", moq: 25_000 }), ctx);
    expect(far.level).toBe("partial");
    expect(far.reasons).toEqual(["Price in USD: exchange rate to apply", "Transport not included in the price", "Duties and import costs to add"]);
    expect(candidateComparability(candidate({ moq: 100_000 }), ctx).reasons).toEqual(["Minimum order above your annual volume"]);
  });

  it("are grouped by where they are, seen from the company — never ranked by distance alone", () => {
    expect(["Italia", "DE", "Turkey", "China", "United States", "Atlantis", null].map((c) => regionOf(c, "Italy"))).toEqual(["home", "eu", "nearby", "asia", "other", "unknown", "unknown"]);
    expect(regionOf("Italy", "Germany")).toBe("eu");
    expect([crossesCustoms("Germany", "Italy"), crossesCustoms("Turkey", "Italy"), crossesCustoms("Italy", "Italy"), crossesCustoms(null, "Italy")]).toEqual([false, true, false, null]);
  });

  it("are shown the most relevant first: specification, source, proximity and what is known — not the price, not the search order", () => {
    const cheapFar = candidate({ name: "Mock Far Trading", country: "China", sourceLevel: "external", technicalCompatibility: null, priceLow: 0.9, priceHigh: 0.95, currency: "EUR", unit: "kg" });
    const strong = candidate({ name: "Mock Wax GmbH" });
    const partial = candidate({ name: "Mock Cera Srl", country: "Italy", technicalCompatibility: "partial" });
    const rejected = candidate({ name: "Mock Rejected", status: "rejected" });
    const ranked = rankCandidates([cheapFar, rejected, partial, strong], ctx);
    expect(ranked.map((r) => [r.candidate.name, r.strength, r.region])).toEqual([
      ["Mock Wax GmbH", "strong", "eu"],
      ["Mock Cera Srl", "possible", "home"],
      ["Mock Far Trading", "needs_validation", "asia"],
      ["Mock Rejected", "strong", "eu"],
    ]);
    const many = Array.from({ length: 9 }, () => candidate());
    expect(topCandidates(rankCandidates([...many, rejected], ctx))).toHaveLength(5);
  });

  it("with suppliers found and no price, the product says so — and asks for quotes", () => {
    const x = paraffin();
    const stated = { companyType: "manufacturer" as const, specCheck: { url: "https://mock.example.test", checkedAt: "2026-09-20", product: ["paraffin"], confirmed: ["52/54"], missing: [] } };
    const found = [candidate(stated), candidate(stated), candidate({ technicalCompatibility: null })];
    const v = view(x, found);
    expect(v.counts).toMatchObject({ active: 3, strong: 2, withPrice: 0 });
    expect(v).toMatchObject({ status: "suppliers_found", range: null, opportunity: null, next: { kind: "request_quotes", label: "Review the 3 recommended suppliers and prepare the request for quotation" } });
    expect(v.summary.join(" ")).toContain("3 possible alternative suppliers have been identified, 2 of them a strong match; none has given a quote yet.");
    expect(view(x, [candidate({ status: "quote_requested" }), candidate()]).status).toBe("quotes_needed");
    // Validating a candidate says it is worth asking: it does not validate the product's price.
    expect(view(x, [candidate({ status: "validated" })]).status).toBe("suppliers_found");
    expect(view(x, [candidate({ status: "rejected" })])).toMatchObject({ status: "no_market_data", counts: { active: 0, rejected: 1 } });
  });

  it("a published price is an indication: used only when comparable and on our basis, and never for an amount", () => {
    const x = paraffin();
    const perTonne = candidate({ priceLow: 1350, priceHigh: 1420, currency: "EUR", unit: "t", incoterm: "DAP", priceType: "indicative", priceSourceUrl: "https://mock.example.test/prices", country: "Italy" });
    const v = view(x, [perTonne]);
    expect(v.observations.find((o) => o.type === "indicative")).toMatchObject({ low: 1.35, high: 1.42, comparability: "comparable", used: false });
    expect(v.range).toMatchObject({ low: 1.35, high: 1.42, confidence: "low", indirect: true });
    expect(v.opportunity).toBeNull();
    const dollars = view(x, [candidate({ priceLow: 1450, priceHigh: 1520, currency: "USD", unit: "t" })]);
    expect(dollars.range).toBeNull();
    expect(dollars.observations.find((o) => o.type === "indicative")).toMatchObject({ low: null, asWritten: "USD 1.450–1.520/t", used: false });
  });
});

describe("what a provider returns", () => {
  const ctx = { productId: "p", provider: "mock", knownSuppliers: ["SER S.p.A."], existing: [{ name: "Mock Wax GmbH", website: "https://www.mock-wax.example.test" }] };
  const found = { name: "Mock Paraffin BV", sourceUrl: "https://mock-paraffin.example.test/wax", sourceLevel: "supplier_official" as const };

  it("is kept only with a name and the page it was found on", () => {
    expect(acceptDiscovered({ ...found, name: " " }, ctx)).toEqual({ ok: false, reason: "no_name" });
    expect(acceptDiscovered({ ...found, sourceUrl: "" }, ctx)).toEqual({ ok: false, reason: "no_source" });
    expect(acceptDiscovered({ ...found, sourceUrl: "the model says so" }, ctx)).toEqual({ ok: false, reason: "no_source" });
    expect(acceptDiscovered(found, ctx)).toMatchObject({ ok: true, candidate: { name: "Mock Paraffin BV", status: "discovered", source: "mock", priceLow: null, technicalCompatibility: null } });
  });

  it("leaves out who the company buys from already, and what was found before", () => {
    expect(acceptDiscovered({ ...found, name: "SER SpA" }, ctx)).toEqual({ ok: false, reason: "known_supplier" });
    expect(acceptDiscovered({ ...found, name: "Mock Wax G.m.b.H." }, ctx)).toEqual({ ok: false, reason: "already_found" });
    expect(acceptDiscovered({ ...found, name: "Another name", website: "https://mock-wax.example.test/en" }, ctx)).toEqual({ ok: false, reason: "already_found" });
  });

  it("keeps a price only when a page shows it, and never lets an outside source pass for an invoice or a quote", () => {
    const price = { low: 1.3, high: 1.4, currency: "EUR", unit: "kg", type: "indicative" as const };
    const noPage = acceptDiscovered({ ...found, price: { ...price, sourceUrl: "" } }, ctx);
    expect(noPage).toMatchObject({ ok: true, candidate: { priceLow: null, priceType: null } });
    const withPage = acceptDiscovered({ ...found, sourceLevel: "quote", price: { ...price, sourceUrl: "https://mock-paraffin.example.test/prices" } }, ctx);
    expect(withPage).toMatchObject({ ok: true, candidate: { priceLow: 1.3, priceHigh: 1.4, priceType: "indicative", sourceLevel: "external" } });
  });
});

describe("searches and requests", () => {
  const input = { name: "Paraffina 52/54 (XXF)", category: "Cere e paraffine", subcategory: "Paraffina", family: null, specifications: {}, deliveryCountry: "Italy" };

  it("builds the searches from the product, in the user's language and in English, with nothing confidential in them", () => {
    const it_ = searchQueries(input, translator("it"));
    expect(it_).toEqual(["Paraffina 52/54 fornitore", "Paraffina 52/54 produttore Italia", "Paraffina ingrosso", "paraffin 52/54 supplier Europe", "paraffin 52/54 manufacturer bulk"]);
    expect(searchQueries({ ...input, subcategory: "Paraffin", category: "Waxes and paraffin" })).toContain("Paraffina 52/54 supplier");
    // A product not filed yet, still named as the invoice wrote it: the supplier's name stays out, and the name says what it is.
    const raw = searchQueries({ ...input, name: "Paraffina SER 52/54 (XXF)", category: null, subcategory: null, knownSuppliers: ["SER S.p.A."] }, translator("it"));
    expect(raw).toEqual(["Paraffina 52/54 fornitore", "Paraffina 52/54 produttore Italia", "Paraffina ingrosso", "paraffin 52/54 supplier Europe", "paraffin 52/54 manufacturer bulk"]);
    const sized = searchQueries({ ...input, name: "Scatola americana C12 - 420x310x240", subcategory: null, family: "Scatola americana", specifications: { size: "420 x 310 x 240", material: "cartone" } }, translator("it"));
    expect(sized).toContain("Scatola americana cartone 420 x 310 x 240 ingrosso");
  });

  it("broadens a search that found nothing, and does not repeat one already tried", () => {
    const next = refineQueries(input, [{ query: "Paraffina 52/54 fornitore", results: 0 }, { query: "paraffin supplier", results: 3 }], translator("it"));
    expect(next).toEqual(["Paraffina fornitore", "Paraffina produttore", "paraffin manufacturer Europe"]);
    expect(refineQueries(input, [{ query: "x", results: 5 }])).toEqual([]);
  });

  it("writes a request for quotation that asks what makes an offer comparable — and gives away neither price nor supplier", () => {
    const draft = rfqDraft({ productName: "Paraffina 52/54 (XXF)", specifications: { Size: "52/54" }, description: null, unit: "kg", annualQuantity: 80_000, typicalOrderQuantity: 20_000, deliveryCountry: "Italy", companyName: "Mock Candle Co.", userName: "Anna", supplierName: "Mock Wax GmbH" });
    expect(draft.subject).toBe("Request for quotation: Paraffina 52/54 (XXF)");
    for (const line of ["Dear Mock Wax GmbH team,", "Annual requirement: about 80.000 kg", "Typical order: about 20.000 kg", "Delivery: DAP our plant in Italy (Incoterms 2020); the exact address on request", "net prices, VAT excluded", "FCA price from your plant", "- minimum order quantity", "- lead time from order, and current availability", "- payment terms", "- delivery terms (Incoterm), the cost of transport, and packaging or pallet costs", "- country of origin of the product", "- technical data sheet"]) expect(draft.body).toContain(line);
    expect(draft.body).not.toMatch(/1[.,]48|Current Supplier/);
    // By material: the questions that belong to it; the quantities every supplier prices are the orders really placed.
    const wax = rfqText({ lines: [{ productName: "Paraffina 52/54", specifications: {}, description: null, unit: "kg", annualQuantity: 780_000, annualConfirmed: false, typicalOrderQuantity: 27_930, tiers: { small: 24_000, standard: 27_930, large: 29_500 } }], deliveryCountry: "Italy", deliveryPlace: "Mocktown (MK)", companyName: "Mock Candle Co.", userName: null, supplierName: "Mock Wax GmbH", category: "wax" });
    for (const line of ["Annual requirement: about 780.000 kg (indicative estimate, not a commitment)", "Quantities to quote: 24.000 kg (smaller order) · 27.930 kg (usual order) · 29.500 kg (larger order)", "Delivery: DAP Mocktown (MK), Italy (Incoterms 2020)", "- the price revision formula, if the price follows an index", "- melting point, oil content"]) expect(wax.body).toContain(line);
    expect(wax.body).not.toContain("Typical order");
    // One order on file: no smaller or larger quantity is made up.
    const one = rfqText({ lines: [{ productName: "Mock label 50x70", specifications: {}, description: null, unit: "pcs", annualQuantity: null, typicalOrderQuantity: 50_000, tiers: { small: null, standard: 50_000, large: null } }], deliveryCountry: "Italy", companyName: "Mock Candle Co.", userName: null, supplierName: "Mock Labels Srl", category: "labels" }, translator("it"));
    expect(one.body).toContain("Ordine tipico: circa 50.000 pcs");
    expect(one.body).not.toContain("Quantità da quotare");
    expect(one.body).toContain("- costi di impianto stampa e fustella, indicati a parte rispetto al prezzo unitario");
    expect(one.body).toContain("Consegna: DAP nostro stabilimento in Italia (Incoterms 2020); indirizzo esatto su richiesta");
    expect(rfqCategoryOf("Paraffina")).toBe("wax");
    expect(rfqCategoryOf("Candle containers")).toBe("containers");
    expect(rfqCategoryOf("Fondelli e fermagli")).toBe("sustainers");
    expect(rfqCategoryOf("Qualcos'altro")).toBeNull();
    expect(rfqDraft({ productName: "X", specifications: {}, description: null, unit: "kg", annualQuantity: null, typicalOrderQuantity: null, deliveryCountry: null, companyName: "Mock", userName: null, supplierName: "Mock" }, translator("it")).body).toContain("Vi chiediamo di indicare nell'offerta:");
  });
});

describe("the review of the priority products", () => {
  it("orders by theoretical gap, then by spend, and adds up only what could be estimated", () => {
    const a = view(paraffin([{ price: 1.34 }, { price: 1.39 }, { price: 1.42 }]));
    const b = view(paraffin());
    const review = sourcingReview([b, a], 300_000);
    expect(review.products[0]).toBe(a);
    expect(review.byStatus).toMatchObject({ opportunity: 1, no_market_data: 1 });
    expect(review.opportunity).toMatchObject({ products: 1 });
    expect(review.opportunity.high).toBeCloseTo(11_200, 4);
    expect(review.share).toBeCloseTo(232_800 / 300_000, 6);
  });

  it("with nothing connected nothing is listed as connected, and no premium source has an adapter yet", () => {
    expect(connected(NO_PROVIDERS)).toEqual([]);
    expect(KNOWN_SOURCES.filter((s) => s.access === "premium").every((s) => !s.ready && !!s.env)).toBe(true);
  });
});

describe("from many companies found to the few worth writing to", () => {
  const ctx: ScreeningContext = { unit: "kg", annualQuantity: 270_000, typicalOrderQuantity: 20_000, homeCountry: "Italy", materiality: "focus", priceAboveEvidence: true, asOf: AS_OF };
  const page = (product: string[], confirmed: string[] = [], missing: string[] = ["52/54"]) => ({ url: "https://mock.example.test", checkedAt: "2026-09-25", email: null, product, confirmed, missing });
  const maker = (over: Partial<SupplierCandidate> = {}) => candidate({ technicalCompatibility: null, companyType: "manufacturer", specCheck: page(["paraffin"]), ...over });

  it("places every candidate, technical fit first — and deletes nothing", () => {
    const s = screenCandidates(
      [
        maker({ name: "Mock Maker DE" }),
        maker({ name: "Mock Maker Exact", specCheck: page(["paraffin"], ["52/54"], []) }),
        candidate({ name: "Mock Unread", technicalCompatibility: null, specCheck: null, productMatched: "Refined paraffin", companyType: "distributor" }),
        candidate({ name: "Mock Other Product", technicalCompatibility: null, specCheck: page([]) }),
        candidate({ name: "Mock Directory Entry", technicalCompatibility: null, specCheck: null, productMatched: null, sourceLevel: "external" }),
        maker({ name: "Mock Judged Different", technicalCompatibility: "not" }),
        maker({ name: "Mock Rejected", status: "rejected" }),
        maker({ name: "Mock Far Maker", country: "China" }),
        maker({ name: "Mock Huge Minimum", moq: 500_000 }),
      ],
      ctx,
    );
    const stage = (name: string) => s.all.find((x) => x.candidate.name === name)!;
    expect(stage("Mock Maker DE")).toMatchObject({ stage: "strong", fit: "Product stated; exact specification (52/54) to confirm", logistics: "simple", evidence: "checked" });
    expect(stage("Mock Maker Exact")).toMatchObject({ stage: "strong", fit: "Product and specification stated on its site" });
    expect(stage("Mock Unread")).toMatchObject({ stage: "plausible", evidence: "official" });
    expect(stage("Mock Other Product")).toMatchObject({ stage: "low_priority", reason: "The page read on its site does not state the product." });
    expect(stage("Mock Directory Entry")).toMatchObject({ stage: "discovered", contactValue: "low" });
    expect(stage("Mock Judged Different")).toMatchObject({ stage: "not_suitable", reason: "Judged a different product." });
    expect(stage("Mock Rejected")).toMatchObject({ stage: "not_suitable", reason: "Rejected by you." });
    // Far away: the product is stated, but customs and long transport keep it out of the strong ones.
    expect(stage("Mock Far Maker")).toMatchObject({ stage: "plausible", logistics: "complex" });
    expect(stage("Mock Huge Minimum")).toMatchObject({ stage: "low_priority", reason: "Its minimum order is above what you buy in a year." });
    expect(s.all).toHaveLength(9);
    expect(s.counts).toMatchObject({ found: 9, plausible: 4, strong: 2, recommended: 3, notSuitable: 2 });
  });

  it("recommends three: the strong ones first, a plausible one only to fill — never one put aside", () => {
    const s = screenCandidates([maker({ name: "Mock A" }), maker({ name: "Mock B", specCheck: page(["paraffin"], ["52/54"], []) }), candidate({ name: "Mock C", technicalCompatibility: null, specCheck: null, companyType: "distributor" }), candidate({ name: "Mock D", technicalCompatibility: null, specCheck: page([]) })], ctx);
    expect(s.shortlist.map((x) => x.candidate.name)).toEqual(["Mock B", "Mock A", "Mock C"]);
    expect(s.shortlist.map((x) => x.contactValue)).toEqual(["high", "high", "possible"]);
    expect(s.shortlist[0].why).toBe("Manufacturer in Germany; states the exact specification.");
    expect(s.all.find((x) => x.candidate.name === "Mock D")).toMatchObject({ shortlisted: false, contactValue: "low" });
  });

  it("a low price never lifts a candidate that does not supply the product: it is a market signal, not someone to contact", () => {
    const cheap = candidate({ name: "Mock Cheap Shop", technicalCompatibility: null, specCheck: page([]), priceLow: 0.9, priceHigh: 0.9, currency: "EUR", unit: "kg" });
    const s = screenCandidates([cheap, maker({ name: "Mock Maker" })], ctx);
    expect(s.shortlist.map((x) => x.candidate.name)).toEqual(["Mock Maker"]);
    expect(s.all.find((x) => x.candidate.name === "Mock Cheap Shop")).toMatchObject({ stage: "low_priority", role: "market_signal", shortlisted: false });
  });

  it("with many strong candidates five are recommended, never more; the user's own picks are always among them", () => {
    const many = Array.from({ length: 9 }, (_, i) => maker({ name: `Mock Maker ${i}` }));
    expect(screenCandidates(many, ctx).shortlist).toHaveLength(5);
    const picked = screenCandidates([...Array.from({ length: 4 }, (_, i) => maker({ name: `Mock Maker ${i}` })), candidate({ name: "Mock Picked", technicalCompatibility: "partial", specCheck: null, status: "validated" })], ctx);
    expect(picked.shortlist.map((x) => x.candidate.name)).toContain("Mock Picked");
    expect(picked.shortlist).toHaveLength(3);
  });

  it("how much a product weighs decides how much a contact is worth", () => {
    const value = (materiality: ScreeningContext["materiality"]) => screenCandidates([maker()], { ...ctx, materiality, priceAboveEvidence: false }).shortlist[0].contactValue;
    expect([value("focus"), value("priority"), value("minor")]).toEqual(["high", "possible", "possible"]);
  });

  it("one supplier able to cover several products is one request, with the spend it could cover", () => {
    const on = (productId: string, name: string, annualSpend: number, materiality: ScreeningContext["materiality"], names: string[]) => ({ productId, name, annualSpend, materiality, screening: screenCandidates(names.map((n) => maker({ name: n, productId })), { ...ctx, materiality }) });
    const out = supplierOpportunities([on("p1", "Mock Paraffin", 400_000, "focus", ["Mock Wax GmbH", "Mock Refinery S.A."]), on("p2", "Mock Blend", 30_000, "focus", ["Mock Wax GmbH"]), on("p3", "Mock Minor", 3_000, "priority", ["Mock Wax GmbH", "Mock Small Srl"])]);
    expect(out.map((o) => o.name)).toEqual(["Mock Wax GmbH", "Mock Refinery S.A.", "Mock Small Srl"]);
    expect(out[0]).toMatchObject({ combinedSpend: 433_000, recommended: true });
    expect(out[0].lines.map((l) => l.productName)).toEqual(["Mock Paraffin", "Mock Blend", "Mock Minor"]);
    // Recommended only for a product outside the first round: on file, not in the round.
    expect(out[2]).toMatchObject({ recommended: false });
  });

  it("remembers who was asked: a recent contact is extended, a silence is followed up after a while", () => {
    const requests = [{ id: "r1", supplierKey: "mock wax", supplierName: "Mock Wax GmbH", candidateIds: ["c1"], productIds: ["p1"], kind: "request" as const, sentAt: "2026-09-15" }];
    expect(contactHistory(requests, "mock wax", false, "2026-09-20")).toMatchObject({ times: 1, last: "2026-09-15", daysSinceLast: 5, recent: true, followUpDue: false });
    expect(contactHistory(requests, "mock wax", false, AS_OF)).toMatchObject({ daysSinceLast: 16, recent: true, followUpDue: true });
    // An answer on file: nothing to chase.
    expect(contactHistory(requests, "mock wax", true, AS_OF).followUpDue).toBe(false);
    expect(contactHistory(requests, "mock other", false, AS_OF)).toMatchObject({ times: 0, last: null, recent: false, followUpDue: false });
  });
});

describe("requests and answers", () => {
  const line = (productName: string) => ({ productName, specifications: {}, description: null, unit: "kg", annualQuantity: 270_000, typicalOrderQuantity: 20_000 });
  const base = { deliveryCountry: "Italy", companyName: "Mock Candle Co.", userName: "Mock Buyer", supplierName: "Mock Wax GmbH" };

  it("one request can carry several products, asks once for the terms, and never says what is paid or to whom", () => {
    const draft = rfqText({ ...base, lines: [line("Paraffin 52/54"), line("Wax blend")] });
    expect(draft.subject).toBe("Request for quotation: 2 products");
    expect(draft.body).toContain("1. Paraffin 52/54");
    expect(draft.body).toContain("2. Wax blend");
    expect(draft.body.match(/payment terms/g)).toHaveLength(1);
    expect(draft.body).toContain("whether samples are available");
    expect(draft.body).not.toMatch(/1[.,]48|Current Supplier|saving/i);
  });

  it("a follow-up is two lines; an update extends the earlier request instead of starting again", () => {
    const followUp = rfqText({ ...base, lines: [line("Paraffin 52/54")], kind: "follow_up", previousDate: "2026-09-15" });
    expect(followUp.subject).toBe("Following up: request for quotation, Paraffin 52/54");
    expect(followUp.body).toContain("On 15/09/2026 we sent you a request for quotation for:");
    expect(followUp.body).not.toContain("Please include");
    expect(rfqText({ ...base, lines: [line("Wax blend")], kind: "update", previousDate: "2026-09-15" }).body).toContain("Further to our request of 15/09/2026, we would also like your quotation for the following.");
  });

  it("an answer becomes quote fields: read from its words, each with the sentence it came from", () => {
    const r = readReply("Dear Mr Buyer,\nwe can offer fully refined paraffin 52/54 at EUR 1420/t DAP Milan.\nMOQ: 20 t. Lead time 2-3 weeks from order.\nPayment: 30 days net. The offer is valid until 31/10/2026.\nSamples are available on request.", { unit: "kg", today: "2026-10-05" });
    expect(r).toMatchObject({ price: 1.42, currency: "EUR", moq: 20_000, leadTimeDays: 21, incoterm: "DAP", paymentTermsDays: 30, validUntil: "2026-10-31", doubts: [] });
    expect(r.from.price).toContain("EUR 1420/t");
    expect(r.notes).toEqual(["Samples are available on request."]);
  });

  it("what could be read two ways is left for the user, with what was found", () => {
    const tiers = readReply("Price 1,45 €/kg for 20 t, 1,42 €/kg for 40 t.", { unit: "kg", today: "2026-10-05" });
    expect(tiers.price).toBeNull();
    expect(tiers.doubts).toEqual([{ message: "Several prices in the text: write the one that applies to your quantity.", detail: "1,45 €/kg · 1,42 €/kg" }]);
    const noUnit = readReply("Our best offer is 1,40 EUR.", { unit: "kg", today: "2026-10-05" });
    expect(noUnit).toMatchObject({ price: 1.4, doubts: [{ message: "No unit next to the price: check that it is per {unit}." }] });
    // 1.420 a tonne: one thousand four hundred and twenty, or one point four two?
    expect(readReply("We offer at EUR 1.420/t.", { unit: "kg", today: "2026-10-05" })).toMatchObject({ price: null, doubts: [{ message: "A price that can be read two ways (thousands or decimals): write it per {unit}.", detail: "EUR 1.420/t" }] });
    expect(readReply("Thank you, we will come back to you.", { unit: "kg", today: "2026-10-05" })).toMatchObject({ price: null, moq: null, doubts: [] });
  });
});

describe("the product, as described to a supplier who does not know it", () => {
  const base = { rfqName: null, technical: null, application: null, specs: null, supplierCodes: [] as string[], knownSuppliers: ["Mocksup S.p.A."], companyName: "Mock Candle Co.", unit: "kg", annualQuantity: 270_000, typicalOrderQuantity: 20_000, deliveryCountry: "Italy", documents: 0 };

  it("a name that says what the thing is and carries its grade is ready, without the supplier's name", () => {
    const spec = rfqSpec({ ...base, name: "Paraffina MOCKSUP 52/54 (XXF)" });
    expect(spec).toMatchObject({ neutralName: "Paraffina 52/54", neutralSource: "suggested", readiness: "ready", missing: [] });
  });

  it("a supplier's own code is never sent: the product is not ready until someone describes it", () => {
    const spec = rfqSpec({ ...base, name: "WAX MOCKSUP 14581 (FXF)", supplierCodes: ["14581"] });
    expect(spec).toMatchObject({ neutralName: null, neutralSource: "missing", readiness: "not_ready", suggestedName: "WAX", supplierCodes: ["14581"] });
    expect(spec.missing).toHaveLength(2);
    expect(spec.missing[0]).toContain("“WAX MOCKSUP 14581 (FXF)” is how the current supplier writes it");
    // Nothing technical is made up: what is known is what the user wrote.
    expect(spec.technical).toBeNull();
    const described = rfqSpec({ ...base, name: "WAX MOCKSUP 14581 (FXF)", supplierCodes: ["14581"], rfqName: "Paraffin wax blend for container candles", technical: "Congealing point 50-52 °C, oil content max 0,5%", application: "Candle manufacturing" });
    expect(described).toMatchObject({ neutralName: "Paraffin wax blend for container candles", neutralSource: "yours", readiness: "ready", application: "Candle manufacturing" });
    expect(JSON.stringify([described.neutralName, described.technical])).not.toMatch(/14581|MOCKSUP/);
  });

  it("a described product with something missing is partially ready, and says exactly what", () => {
    const spec = rfqSpec({ ...base, name: "Paraffina 52/54", annualQuantity: null, deliveryCountry: null });
    expect(spec.readiness).toBe("partial");
    expect(spec.missing).toEqual(["The annual volume: there are no purchases in the last 12 months.", "Where it has to be delivered: set your country in Settings."]);
    expect(rfqSpec({ ...base, name: "ART. LC TR. Contenitori per ceri" }).readiness).toBe("not_ready");
    // A data sheet attached counts as the specification.
    expect(rfqSpec({ ...base, name: "ART. LC TR. Contenitori per ceri", rfqName: "Plastic container for votive candles", documents: 1 }).readiness).toBe("ready");
  });
});

describe("true cost", () => {
  const quote: TrueCostInput = { price: 1.34, currency: "EUR", fxRate: 1, fxNote: null, incoterm: "FCA", sameCustomsArea: true, freightPerUnit: 0.05, freightBasis: "manual", dutyRatePct: null, customsPerUnit: null, otherPerUnit: null, moq: 20_000, typicalOrder: 20_000, annualVolume: 270_000, paymentDays: 30, baselinePaymentDays: 60, financingRatePct: 6, holdingRatePct: 12, technicalConfirmed: false };
  const part = (c: TrueCost, key: string) => c.components.find((x) => x.key === key)!;

  it("adds what stands between a quoted price and the goods at the door, each part with its origin", () => {
    const c = trueCost(quote);
    expect(part(c, "price")).toMatchObject({ perUnit: 1.34, basis: "quote" });
    expect(part(c, "freight")).toMatchObject({ perUnit: 0.05, basis: "manual" });
    expect(part(c, "duty")).toMatchObject({ perUnit: 0, basis: "none", note: "Same customs area: no duty." });
    // Paying 30 days sooner than today costs money: 1.39 × 6% × 30/365.
    expect(part(c, "payment").perUnit).toBeCloseTo((1.39 * 0.06 * 30) / 365, 6);
    expect(part(c, "payment").basis).toBe("estimate");
    expect(part(c, "moq")).toMatchObject({ perUnit: 0, basis: "none" });
    expect(c.complete).toBe(true);
    expect(c.perUnit).toBeCloseTo(1.39 + (1.39 * 0.06 * 30) / 365, 6);
    expect(c.annual).toBeCloseTo(c.perUnit! * 270_000, 4);
    expect(c.confidence).toBe("medium");
  });

  it("an ex-works price with no freight is incomplete: no total, and it says what to add", () => {
    const c = trueCost({ ...quote, freightPerUnit: null, freightBasis: null });
    expect(c).toMatchObject({ complete: false, perUnit: null, annual: null, confidence: null, missing: ["A freight estimate"] });
    expect(part(c, "freight")).toMatchObject({ perUnit: null, basis: "missing", note: "FCA: transport to you is not in the price." });
    // Delivered: transport is in the price.
    expect(trueCost({ ...quote, incoterm: "DAP", freightPerUnit: null }).perUnit).not.toBeNull();
    expect(part(trueCost({ ...quote, incoterm: "DAP", freightPerUnit: null }), "freight")).toMatchObject({ perUnit: 0, basis: "included" });
  });

  it("unknown delivery terms lower the confidence and are said out loud", () => {
    const c = trueCost({ ...quote, incoterm: null });
    expect(c.warnings).toEqual(["Delivery terms unknown: it is not known whether transport is in the price."]);
    expect(c.confidence).toBe("low");
    expect(trueCost({ ...quote, incoterm: null, freightPerUnit: null }).complete).toBe(false);
  });

  it("from outside the customs area duty and import costs have to be given; a foreign currency needs a rate", () => {
    const far = trueCost({ ...quote, sameCustomsArea: false });
    expect(far).toMatchObject({ complete: false, missing: ["The duty rate", "Customs and import costs"] });
    const given = trueCost({ ...quote, sameCustomsArea: false, dutyRatePct: 2, customsPerUnit: 0.01 });
    expect(part(given, "duty").perUnit).toBeCloseTo(1.39 * 0.02, 6);
    expect(given.complete).toBe(true);
    expect(trueCost({ ...quote, currency: "USD", fxRate: null })).toMatchObject({ complete: false, missing: ["The exchange rate for USD"] });
    expect(part(trueCost({ ...quote, price: 1.5, currency: "USD", fxRate: 0.9 }), "price").perUnit).toBeCloseTo(1.35, 6);
  });

  it("a minimum order above the usual one costs stock; longer payment terms are worth money", () => {
    const big = trueCost({ ...quote, moq: 60_000 });
    // 20.000 more held on average × 1.39 × 12% ÷ 270.000 a year.
    expect(part(big, "moq").perUnit).toBeCloseTo((20_000 * 1.39 * 0.12) / 270_000, 6);
    expect(part(big, "moq").basis).toBe("estimate");
    expect(part(trueCost({ ...quote, paymentDays: 90 }), "payment").perUnit).toBeLessThan(0);
    // Terms not stated: left out, and said — not guessed.
    expect(part(trueCost({ ...quote, paymentDays: null }), "payment")).toMatchObject({ perUnit: null, basis: "missing", note: "Payment terms of the offer not stated." });
  });

  it("an opportunity is validated only with the specification confirmed; before that it is an opportunity to validate", () => {
    const c = trueCost(quote);
    const open = quoteOpportunity(1.48, c, { annualVolume: 270_000, technicalConfirmed: false, moq: 20_000, comparable: true })!;
    expect(open).toMatchObject({ level: "to_validate", confidence: "medium", pending: ["Technical specification confirmation still required."] });
    expect(open.perUnit).toBeCloseTo(1.48 - c.perUnit!, 6);
    expect(open.annual).toBeCloseTo((1.48 - c.perUnit!) * 270_000, 2);
    const confirmed = trueCost({ ...quote, technicalConfirmed: true });
    expect(quoteOpportunity(1.48, confirmed, { annualVolume: 270_000, technicalConfirmed: true, moq: 20_000, comparable: true })).toMatchObject({ level: "validated", pending: [] });
    // No opportunity on a true cost that is incomplete, or not below what is paid.
    expect(quoteOpportunity(1.48, trueCost({ ...quote, freightPerUnit: null, freightBasis: null }), { annualVolume: 270_000, technicalConfirmed: true, moq: null, comparable: true })).toBeNull();
    expect(quoteOpportunity(1.3, c, { annualVolume: 270_000, technicalConfirmed: true, moq: null, comparable: true })).toBeNull();
  });
});

describe("reading an answer, without guessing", () => {
  const ctx = { unit: "kg", today: "2026-10-05", anchor: 1.48 };
  it("thousands and decimals are told apart only when today's price makes one reading absurd", () => {
    for (const text of ["We offer at 1.420 €/t.", "We offer at 1,420 €/t.", "Price: €1.420 per ton", "Our price is 1.42 €/kg", "EUR 1420/MT"]) expect(readReply(text, ctx).price, text).toBeCloseTo(1.42, 6);
    expect(readReply("USD 1,500/MT FOB", ctx)).toMatchObject({ price: 1.5, currency: "USD", incoterm: "FOB" });
    // Without anything to compare with, the same text is left for the user.
    expect(readReply("We offer at 1.420 €/t.", { unit: "kg", today: "2026-10-05" })).toMatchObject({ price: null, doubts: [{ message: "A price that can be read two ways (thousands or decimals): write it per {unit}." }] });
  });

  it("transport is read apart from the price, not mistaken for a second price", () => {
    const r = readReply("Price: 1,34 €/kg FCA Hamburg.\nFreight to Milan: 0,05 €/kg.\nPayment 30 days.", ctx);
    expect(r).toMatchObject({ price: 1.34, freightPerUnit: 0.05, incoterm: "FCA", paymentTermsDays: 30, doubts: [] });
    expect(r.from.freight).toContain("Freight to Milan");
    // A lump sum is not a cost per unit: said, not converted.
    expect(readReply("Price 1,34 €/kg. Transport cost: € 850 per delivery.", ctx)).toMatchObject({ price: 1.34, freightPerUnit: null, doubts: [{ message: "A transport cost is mentioned, but not per {unit}: add it to the true cost yourself." }] });
  });

  it("an answer about several products gives each its own line, and guesses none", () => {
    const text = "Dear buyer,\n1. Paraffin 52/54: 1,39 €/kg\n2. Wax blend for containers: 1,52 €/kg\nFreight to Milano: 0,05 €/kg.\nMOQ 24 t. Payment 30 days. FCA Hamburg.";
    const paraffin = { id: "a", name: "Paraffin 52/54", line: 1 };
    const blend = { id: "b", name: "Wax blend for containers", line: 2 };
    expect(readReplyFor(text, paraffin, [blend], ctx)).toMatchObject({ price: 1.39, moq: 24_000, incoterm: "FCA", paymentTermsDays: 30, freightPerUnit: 0.05 });
    expect(readReplyFor(text, blend, [paraffin], ctx)).toMatchObject({ price: 1.52, moq: 24_000 });
    // Prices on lines that name no product: not assigned to anyone.
    const unclear = readReplyFor("We can offer 1,39 €/kg and 1,52 €/kg.", paraffin, [blend], ctx);
    expect(unclear.price).toBeNull();
    expect(unclear.doubts[0].message).toBe("The answer covers several products and it is not clear which price is this one's: write it per {unit}.");
  });
});
