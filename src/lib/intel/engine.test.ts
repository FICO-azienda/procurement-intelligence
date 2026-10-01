import { describe, expect, it } from "vitest";
import { normalizePurchases } from "../analytics";
import { compareSuppliers, specDifferences } from "./comparison";
import { INTEL_CONFIG } from "./config";
import { analyze, topOpportunities, type OpportunityState } from "./engine";
import { dataset, link, product, purchase, quote, supplier } from "./fixtures";
import { estimateSaving } from "./opportunities";
import { alertLevel, concentration, pareto, spendBreakdown, supplierPriceChange } from "./portfolio";
import { priceMetrics } from "./price-metrics";
import { dataQuality } from "./quality";

const AS_OF = "2026-10-01";

/** A product bought from one supplier, with 20.000 kg/year at the given prices. */
function world(prices: [string, number, number][] = [["2026-01-10", 5000, 1.42], ["2026-03-10", 5000, 1.45], ["2026-06-12", 5000, 1.52], ["2026-09-15", 5000, 1.58]]) {
  const a = supplier({ name: "Alpha" });
  const b = supplier({ name: "Beta" });
  const p = product({ currentSupplierId: a.id });
  const purchases = prices.map(([date, quantity, unitPrice]) => purchase({ productId: p.id, supplierId: a.id, date, quantity, unitPrice }));
  return { a, b, p, purchases };
}

describe("scenario A — price increase", () => {
  it("€1,42 → €1,58 is +11,27%", () => {
    const { p, purchases } = world();
    const m = priceMetrics(purchases, AS_OF, p.currentSupplierId);
    expect(m.current?.price).toBe(1.58);
    expect(m.previous?.price).toBe(1.52);
    expect(m.changes.m12.pct).toBeCloseTo(11.27, 2);
    expect(m.changes.all.pct).toBeCloseTo(11.27, 2);
    expect(m.totalChangePct).toBeCloseTo(11.27, 2);
  });

  it("builds a readable timeline of price levels", () => {
    const { purchases } = world();
    const t = priceMetrics(purchases, AS_OF).timeline;
    expect(t.map((e) => e.price)).toEqual([1.42, 1.45, 1.52, 1.58]);
    expect(t[0].pct).toBeNull();
    expect(t[1].pct).toBeCloseTo(2.11, 2);
    expect(t[3].pct).toBeCloseTo(3.95, 2);
  });

  it("computes 3 and 6 month changes against the price in force then", () => {
    const { purchases } = world();
    const m = priceMetrics(purchases, AS_OF);
    expect(m.changes.m3.referencePrice).toBe(1.52); // last price on/before 1 Jul
    expect(m.changes.m6.referencePrice).toBe(1.45); // last price on/before 1 Apr
    expect(m.changes.m3.partial).toBe(false);
    expect(m.changes.m12.partial).toBe(true); // history starts in January: shorter than 12 months
  });
});

describe("scenario B — weighted average", () => {
  it("weights by quantity, unlike the simple average", () => {
    const { a, p } = world([]);
    const m = priceMetrics(
      [
        purchase({ productId: p.id, supplierId: a.id, date: "2026-05-01", quantity: 1000, unitPrice: 1.4 }),
        purchase({ productId: p.id, supplierId: a.id, date: "2026-06-01", quantity: 5000, unitPrice: 1.6 }),
      ],
      AS_OF,
    );
    expect(m.averagePrice).toBeCloseTo(1.5);
    expect(m.weightedAveragePrice).toBeCloseTo((1000 * 1.4 + 5000 * 1.6) / 6000);
    expect(m.weightedAveragePrice).not.toBeCloseTo(m.averagePrice!, 3);
    expect(m.low?.price).toBe(1.4);
    expect(m.high?.price).toBe(1.6);
  });
});

describe("scenario C — alternative quote", () => {
  it("€1,58 vs €1,49 on 20.000 kg is €1.800/year, high confidence", () => {
    const { a, b, p, purchases } = world();
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.49, moq: 5000 });
    const intel = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] }), [], [], AS_OF);
    const pi = intel.products[0];
    expect(pi.metrics.annualQuantity).toBe(20000);
    const o = pi.bestSaving!;
    expect(o.type).toBe("lower_quote");
    expect(o.priceDifference).toBeCloseTo(0.09);
    expect(o.priceDifferencePct).toBeCloseTo(5.7, 1);
    expect(o.potentialSaving).toBeCloseTo(1800);
    expect(o.confidence).toBe("high");
    expect(o.missing).toContain("Landed cost not calculated");
    expect(intel.totals.potentialSavings).toBeCloseTo(1800);
    // Supplier raised prices > 10% and a recent lower quote exists
    expect(o.negotiation).toBe(true);
  });
});

describe("scenario D — unit normalization", () => {
  it("€1.500/t becomes €1,50/kg", () => {
    const { a, p } = world([]);
    const tonnes = purchase({ productId: p.id, supplierId: a.id, date: "2026-09-01", quantity: 2, unitPrice: 1500, unit: "t" });
    const { comparable, unitMismatch } = normalizePurchases(p, [tonnes]);
    expect(unitMismatch).toHaveLength(0);
    expect(comparable[0]).toMatchObject({ unit: "kg", quantity: 2000, unitPrice: 1.5 });
  });

  it("keeps apart purchases in a unit that can't be converted", () => {
    const { a, b, p, purchases } = world();
    const boxes = purchase({ productId: p.id, supplierId: b.id, date: "2026-09-20", quantity: 10, unitPrice: 30, unit: "box" });
    const intel = analyze(dataset({ suppliers: [a, b], products: [p], purchases: [...purchases, boxes] }), [], [], AS_OF);
    const pi = intel.products[0];
    expect(pi.price.current?.price).toBe(1.58);
    expect(pi.metrics.unitMismatchCount).toBe(1);
    expect(pi.metrics.annualQuantity).toBe(20000); // boxes not added to kilograms
    const row = pi.comparison.find((r) => r.supplier.id === b.id)!;
    expect(row.comparability).toBe("not");
    expect(pi.bestSaving).toBeNull();
    expect(pi.quality.level).toBe("low");
  });
});

describe("scenario E — currency mismatch", () => {
  it("does not compare a USD quote without an exchange rate, and claims no saving", () => {
    const { a, b, p, purchases } = world();
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.2, currency: "USD", fxRate: null, moq: 5000 });
    const pi = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] }), [], [], AS_OF).products[0];
    const row = pi.comparison.find((r) => r.supplier.id === b.id)!;
    expect(row.fxRequired).toBe(true);
    expect(row.comparability).toBe("not");
    expect(row.comparabilityReasons[0]).toMatch(/FX conversion required/);
    expect(row.difference).toBeNull();
    expect(pi.opportunities.filter((o) => o.type === "lower_quote")).toHaveLength(0);
  });

  it("uses an exchange rate recorded on the quote, with medium confidence", () => {
    const { a, b, p, purchases } = world();
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.6, currency: "USD", fxRate: 0.9, moq: 5000 });
    const pi = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] }), [], [], AS_OF).products[0];
    expect(pi.bestSaving?.comparePrice).toBeCloseTo(1.44);
    expect(pi.bestSaving?.confidence).toBe("medium");
    expect(pi.bestSaving?.factors.find((x) => x.key === "currency")?.state).toBe("caution");
  });

  it("cannot be overridden into comparable", () => {
    const { a, b, p, purchases } = world();
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.2, currency: "USD", fxRate: null });
    const l = link({ supplierId: b.id, productId: p.id, comparabilityOverride: "comparable" });
    const pi = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] }), [l], [], AS_OF).products[0];
    expect(pi.comparison.find((r) => r.supplier.id === b.id)!.comparability).toBe("not");
  });
});

describe("scenario F — old quote", () => {
  it("an 8-month-old quote gives low confidence and stays out of the headline", () => {
    const { a, b, p, purchases } = world();
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-02-01", unitPrice: 1.3, moq: 5000 });
    const intel = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] }), [], [], AS_OF);
    const o = intel.products[0].bestSaving!;
    expect(o.confidence).toBe("low");
    expect(o.factors.find((x) => x.key === "age")?.state).toBe("poor");
    expect(o.negotiation).toBe(false);
    expect(intel.totals.potentialSavings).toBe(0);
    expect(topOpportunities(intel).some((x) => x.key === o.key)).toBe(false);
  });

  it("an expired quote is low confidence even if recent", () => {
    const { a, b, p, purchases } = world();
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.3, moq: 5000, validUntil: "2026-09-20" });
    const o = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] }), [], [], AS_OF).products[0].bestSaving!;
    expect(o.confidence).toBe("low");
  });
});

describe("scenario G — specification mismatch", () => {
  it("glass 180 g vs 210 g is partially comparable, medium confidence", () => {
    const { a, b, purchases, p: base } = world();
    const p = { ...base, specs: { capacity: "300 ml", weight: "210 g", color: "transparent" } };
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.4, moq: 5000 });
    const l = link({ supplierId: b.id, productId: p.id, specs: { Capacity: "300ml", Weight: "180 g" } });
    const pi = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] }), [l], [], AS_OF).products[0];
    const row = pi.comparison.find((r) => r.supplier.id === b.id)!;
    expect(row.specDifferences).toEqual([{ name: "weight", ours: "210 g", theirs: "180 g" }]);
    expect(row.comparability).toBe("partial");
    expect(pi.bestSaving?.confidence).toBe("medium");
    expect(pi.bestSaving?.reason).toMatch(/partially comparable/);
  });

  it("ignores formatting differences in specification values", () => {
    expect(specDifferences({ capacity: "300 ml" }, { Capacity: "300ML" })).toEqual([]);
  });
});

describe("scenario H — single source", () => {
  it("flags 100% of spend with one supplier on a high-spend product", () => {
    const { a, p, purchases } = world();
    const intel = analyze(dataset({ suppliers: [a], products: [p], purchases }), [], [], AS_OF);
    const pi = intel.products[0];
    expect(pi.concentration.sourcing).toBe("single");
    expect(pi.concentration.shares).toEqual([expect.objectContaining({ supplierId: a.id, share: 1 })]);
    expect(pi.opportunities.some((o) => o.type === "single_source")).toBe(true);
    expect(intel.totals.singleSourceHighSpend).toBe(1);
  });

  it("shows the split when two suppliers are used", () => {
    const { a, b, p } = world([]);
    const c = concentration(
      [
        purchase({ productId: p.id, supplierId: a.id, date: "2026-05-01", quantity: 700, unitPrice: 1 }),
        purchase({ productId: p.id, supplierId: b.id, date: "2026-06-01", quantity: 300, unitPrice: 1 }),
      ],
      AS_OF,
    );
    expect(c.sourcing).toBe("dual");
    expect(c.shares.map((s) => s.share)).toEqual([0.7, 0.3]);
  });
});

describe("incomplete and missing data", () => {
  it("a product with no purchases has no price, no change, no saving", () => {
    const p = product();
    const pi = analyze(dataset({ products: [p] }), [], [], AS_OF).products[0];
    expect(pi.price.current).toBeNull();
    expect(pi.price.changes.m12.pct).toBeNull();
    expect(pi.opportunities).toEqual([]);
    expect(pi.quality.level).toBe("low");
    expect(pi.summary[0]).toMatch(/No purchases/);
  });

  it("a product with a single purchase has a price but no change or trend", () => {
    const { a, p } = world([["2026-09-01", 100, 2]]);
    const one = purchase({ productId: p.id, supplierId: a.id, date: "2026-09-01", quantity: 100, unitPrice: 2 });
    const m = priceMetrics([one], AS_OF);
    expect(m.current?.price).toBe(2);
    expect(m.previous).toBeNull();
    expect(m.changes.m3.pct).toBeNull();
    expect(m.trend).toBeNull();
    expect(m.distribution).toBeNull();
    expect(m.outliers).toEqual([]);
  });

  it("no alternatives → no price gap, and it says so", () => {
    const { a, p, purchases } = world();
    const pi = analyze(dataset({ suppliers: [a], products: [p], purchases }), [], [], AS_OF).products[0];
    expect(pi.bestSaving).toBeNull();
    expect(pi.summary.join(" ")).toMatch(/No alternative quotes on file/);
  });

  it("no saving when the alternative is not cheaper, or there is no annual volume", () => {
    const { a, b, p, purchases } = world();
    const dearer = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.7, moq: 100 });
    const pi = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [dearer] }), [], [], AS_OF).products[0];
    expect(pi.bestSaving).toBeNull();

    // Same cheaper quote, but purchases are older than 12 months → no annual quantity to multiply.
    const old = world([["2024-01-10", 5000, 1.58], ["2024-06-10", 5000, 1.58]]);
    const cheap = quote({ productId: old.p.id, supplierId: old.b.id, date: "2026-09-12", unitPrice: 1.2, moq: 100 });
    const stale = analyze(dataset({ suppliers: [old.a, old.b], products: [old.p], purchases: old.purchases, quotes: [cheap] }), [], [], AS_OF).products[0];
    expect(stale.metrics.annualQuantity).toBe(0);
    expect(stale.bestSaving).toBeNull();
  });

  it("missing MOQ lowers confidence to medium; MOQ above annual volume to low", () => {
    const { a, b, p, purchases } = world();
    const run = (moq: number | null) =>
      analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.49, moq })] }), [], [], AS_OF)
        .products[0].bestSaving!.confidence;
    expect(run(null)).toBe("medium");
    expect(run(9000)).toBe("medium"); // above typical order (5.000 × 1,5)
    expect(run(25000)).toBe("low");
  });

  it("purchases without an exchange rate are left out of prices and flagged", () => {
    const { a, p, purchases } = world();
    const usd = purchase({ productId: p.id, supplierId: a.id, date: "2026-09-28", quantity: 100, unitPrice: 9, currency: "USD", fxRate: null });
    const pi = analyze(dataset({ suppliers: [a], products: [p], purchases: [...purchases, usd] }), [], [], AS_OF).products[0];
    expect(pi.price.current?.price).toBe(1.58);
    expect(pi.metrics.unpricedCount).toBe(1);
    expect(pi.quality.factors.find((x) => x.label === "Currency")?.state).toBe("caution");
  });
});

describe("user decisions", () => {
  it("an offer marked not comparable produces no saving", () => {
    const { a, b, p, purchases } = world();
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.49, moq: 5000 });
    const l = link({ supplierId: b.id, productId: p.id, comparabilityOverride: "not", comparabilityNote: "Different grade" });
    const pi = analyze(dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] }), [l], [], AS_OF).products[0];
    expect(pi.comparison.find((r) => r.supplier.id === b.id)).toMatchObject({ comparability: "not", overridden: true });
    expect(pi.bestSaving).toBeNull();
  });

  it("rejected opportunities leave the headline; the status is kept", () => {
    const { a, b, p, purchases } = world();
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.49, moq: 5000 });
    const data = dataset({ suppliers: [a, b], products: [p], purchases, quotes: [q] });
    const key = analyze(data, [], [], AS_OF).products[0].bestSaving!.key;
    const state: OpportunityState = { key, status: "rejected", note: null, snapshot: null, updatedAt: AS_OF };
    const intel = analyze(data, [], [state], AS_OF);
    expect(intel.products[0].bestSaving).toBeNull();
    expect(intel.products[0].dismissedSavings).toBe(1);
    expect(intel.products[0].opportunities.find((o) => o.key === key)?.status).toBe("rejected");
    expect(intel.totals.potentialSavings).toBe(0);
    expect(topOpportunities(intel).some((o) => o.key === key)).toBe(false);
  });

  it("counts one alternative per product in the headline, not all of them", () => {
    const { a, b, p, purchases } = world();
    const c = supplier({ name: "Gamma" });
    const quotes = [
      quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.49, moq: 5000 }),
      quote({ productId: p.id, supplierId: c.id, date: "2026-09-14", unitPrice: 1.45, moq: 5000 }),
    ];
    const intel = analyze(dataset({ suppliers: [a, b, c], products: [p], purchases, quotes }), [], [], AS_OF);
    expect(intel.opportunities.filter((o) => o.type === "lower_quote")).toHaveLength(2);
    expect(intel.totals.potentialSavings).toBeCloseTo(20000 * 0.13);
    expect(intel.products[0].comparison.find((r) => r.isLowest)?.supplier.id).toBe(c.id);
  });
});

describe("which saving represents a product", () => {
  it("prefers a smaller high-confidence saving over a larger medium-confidence one", () => {
    const { a, b, p, purchases } = world();
    const c = supplier({ name: "Gamma", country: "Turkey" });
    const quotes = [
      quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.49, moq: 5000 }), // fits orders → high
      quote({ productId: p.id, supplierId: c.id, date: "2026-09-18", unitPrice: 1.31, moq: 12000 }), // MOQ above typical order → medium
    ];
    const intel = analyze(dataset({ suppliers: [a, b, c], products: [p], purchases, quotes }), [], [], AS_OF);
    const pi = intel.products[0];
    expect(pi.bestSaving).toMatchObject({ alternativeSupplierId: b.id, confidence: "high" });
    expect(intel.totals.potentialSavings).toBeCloseTo(1800);
    expect(topOpportunities(intel)[0].alternativeSupplierId).toBe(b.id);
    // The larger, less comparable gap is still listed and still marked as the lowest price.
    expect(pi.opportunities.find((o) => o.alternativeSupplierId === c.id)?.potentialSaving).toBeCloseTo(5400);
    expect(pi.comparison.find((r) => r.isLowest)?.supplier.id).toBe(c.id);
  });
});

describe("anomalous data", () => {
  const { a, p } = world([]);
  const series = (review: (null | "confirmed" | "excluded")[] = [null, null, null, null]) =>
    [1.42, 1.45, 1.47, 3.9].map((unitPrice, i) =>
      purchase({ productId: p.id, supplierId: a.id, date: `2026-0${i + 5}-10`, quantity: 1000, unitPrice, priceReview: review[i] }),
    );

  it("flags €3,90 among €1,42–1,47 without removing it", () => {
    const m = priceMetrics(series(), AS_OF);
    expect(m.outliers.map((o) => o.price)).toEqual([3.9]);
    expect(m.current?.price).toBe(3.9); // still there until the user decides
  });

  it("stops flagging a price the user confirmed", () => {
    expect(priceMetrics(series([null, null, null, "confirmed"]), AS_OF).outliers).toEqual([]);
  });

  it("leaves an excluded price out of every price metric", () => {
    const m = priceMetrics(series([null, null, null, "excluded"]), AS_OF);
    expect(m.current?.price).toBe(1.47);
    expect(m.high?.price).toBe(1.47);
    expect(m.observations).toBe(3);
  });

  it("does not look for outliers with too few prices", () => {
    expect(priceMetrics(series().slice(1), AS_OF).outliers).toEqual([]);
  });

  it("a saving against an unreviewed outlier price is low confidence", () => {
    const b = supplier({ name: "Beta" });
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.5, moq: 1000 });
    const pi = analyze(dataset({ suppliers: [a, b], products: [{ ...p, currentSupplierId: a.id }], purchases: series(), quotes: [q] }), [], [], AS_OF).products[0];
    expect(pi.bestSaving?.confidence).toBe("low");
    expect(pi.currentPriceFlagged).toBe(true);
    expect(pi.summary[0]).toMatch(/may be a data error/);
  });
});

describe("trend, distribution, alerts", () => {
  const { a, p } = world([]);
  const at = (prices: number[]) => prices.map((unitPrice, i) => purchase({ productId: p.id, supplierId: a.id, date: `2026-${String(i + 1).padStart(2, "0")}-10`, quantity: 100, unitPrice }));

  it("classifies the trend against the previous purchases", () => {
    expect(priceMetrics(at([1, 1, 1, 1.05]), AS_OF).trend).toBe("increasing");
    expect(priceMetrics(at([1, 1, 1, 1.01]), AS_OF).trend).toBe("stable");
    expect(priceMetrics(at([1, 1, 1, 0.9]), AS_OF).trend).toBe("decreasing");
    expect(priceMetrics(at([1, 1.2]), AS_OF).trend).toBeNull(); // one previous purchase is not a trend
  });

  it("shows a distribution only with enough prices", () => {
    expect(priceMetrics(at([1, 2, 3, 4, 5, 6, 7]), AS_OF).distribution).toBeNull();
    expect(priceMetrics(at([1, 2, 3, 4, 5, 6, 7, 8, 9]), AS_OF).distribution).toEqual({ min: 1, p25: 3, median: 5, p75: 7, max: 9 });
  });

  it("grades alerts at +5 / +10 / +20%", () => {
    expect(alertLevel(4.9)).toBeNull();
    expect(alertLevel(5.0)).toBeNull();
    expect(alertLevel(5.1)).toBe("moderate");
    expect(alertLevel(10)).toBe("high");
    expect(alertLevel(20)).toBe("critical");
    expect(alertLevel(-30)).toBeNull();
    expect(alertLevel(null)).toBeNull();
    expect(alertLevel(12, { ...INTEL_CONFIG, alerts: { moderate: 15, high: 30, critical: 50 } })).toBeNull(); // thresholds are configurable
  });
});

describe("portfolio", () => {
  it("breaks spend down with shares that add to 100%", () => {
    const s = spendBreakdown([
      { key: "a", label: "A", spend: 60 },
      { key: "b", label: "B", spend: 30 },
      { key: "a", label: "A", spend: 10 },
    ]);
    expect(s).toEqual([
      { key: "a", label: "A", spend: 70, share: 0.7 },
      { key: "b", label: "B", spend: 30, share: 0.3 },
    ]);
  });

  it("pareto: marks the products that make up 80% of spend", () => {
    const par = pareto([
      { key: "a", spend: 50 },
      { key: "b", spend: 25 },
      { key: "c", spend: 15 },
      { key: "d", spend: 10 },
      { key: "e", spend: 0 },
    ]);
    expect(par.items.map((x) => [x.key, x.highSpend])).toEqual([["a", true], ["b", true], ["c", true], ["d", false]]);
    expect(par.itemsForShare).toBe(3);
    expect(par.topNShare).toBe(1);
  });

  it("weights a supplier's price change by spend", () => {
    const { a } = world([]);
    const big = product();
    const small = product();
    const by = new Map([
      [big.id, [purchase({ productId: big.id, supplierId: a.id, date: "2025-12-01", quantity: 1000, unitPrice: 10 }), purchase({ productId: big.id, supplierId: a.id, date: "2026-06-01", quantity: 900, unitPrice: 11 })]],
      [small.id, [purchase({ productId: small.id, supplierId: a.id, date: "2026-02-01", quantity: 100, unitPrice: 1 }), purchase({ productId: small.id, supplierId: a.id, date: "2026-07-01", quantity: 100, unitPrice: 1 })]],
    ]);
    const c = supplierPriceChange(by, AS_OF);
    // big: +10% on €9.900 YTD; small: 0% on €200 YTD
    expect(c.weightedPct).toBeCloseTo((10 * 9900 + 0 * 200) / 10100, 4);
    expect(c.products[0].productId).toBe(big.id);
    expect(supplierPriceChange(new Map(), AS_OF).weightedPct).toBeNull();
  });

  it("rates data quality from count, recency and consistency", () => {
    const base = { observations: 8, lastPurchaseDate: "2026-09-20", unitMismatch: 0, fxMissing: 0, quantityMissing: 0, openOutliers: 0, hasSupplier: true, asOf: AS_OF };
    expect(dataQuality(base).level).toBe("high");
    expect(dataQuality({ ...base, observations: 4 }).level).toBe("medium");
    expect(dataQuality({ ...base, observations: 1 }).level).toBe("low");
    expect(dataQuality({ ...base, lastPurchaseDate: "2025-12-01" }).level).toBe("low");
    expect(dataQuality({ ...base, fxMissing: 2 }).level).toBe("medium");
  });
});

describe("saving estimate guards", () => {
  it("returns nothing for the current supplier or a non-comparable row", () => {
    const { a, b, p, purchases } = world();
    const rows = compareSuppliers({
      product: p,
      suppliers: [a, b],
      purchases,
      unitMismatch: [],
      quotes: [quote({ productId: p.id, supplierId: b.id, date: "2026-09-12", unitPrice: 1.49, moq: 5000 })],
      links: [],
      currentSupplierId: a.id,
      currentPrice: 1.58,
      typicalOrderQuantity: 5000,
      asOf: AS_OF,
    });
    const ctx = { currentPrice: 1.58, currentCurrency: "EUR", annualQuantity: 20000, typicalOrderQuantity: 5000, currentPriceIsOutlier: false, dataQuality: "high" as const, unit: "kg" };
    expect(estimateSaving(rows.find((r) => r.isCurrent)!, ctx)).toBeNull();
    const alt = rows.find((r) => !r.isCurrent)!;
    expect(estimateSaving(alt, ctx)?.potentialSaving).toBeCloseTo(1800);
    expect(estimateSaving({ ...alt, comparability: "not" }, ctx)).toBeNull();
    expect(estimateSaving(alt, { ...ctx, annualQuantity: 0 })).toBeNull();
    expect(estimateSaving(alt, { ...ctx, currentPrice: null })).toBeNull();
  });
});

describe("scale", () => {
  it("analyses 10.000 purchases, 1.000 products and 500 suppliers quickly", () => {
    const suppliers = Array.from({ length: 500 }, (_, i) => supplier({ name: `S${i}` }));
    const products = Array.from({ length: 1000 }, (_, i) => product({ name: `P${i}`, category: `C${i % 12}`, currentSupplierId: suppliers[i % 500].id }));
    const purchases = Array.from({ length: 10000 }, (_, i) => {
      const p = products[i % 1000];
      const month = String((i % 12) + 1).padStart(2, "0");
      return purchase({ productId: p.id, supplierId: suppliers[(i % 1000) % 500].id, date: `2026-${month}-${String((i % 27) + 1).padStart(2, "0")}`, quantity: 100 + (i % 7) * 10, unitPrice: 1 + (i % 13) / 100 });
    });
    const quotes = Array.from({ length: 1500 }, (_, i) => quote({ productId: products[i % 1000].id, supplierId: suppliers[(i * 7 + 3) % 500].id, date: "2026-09-10", unitPrice: 1 + (i % 9) / 100, moq: 100 }));
    const t0 = performance.now();
    const intel = analyze(dataset({ suppliers, products, purchases, quotes }), [], [], AS_OF);
    const ms = performance.now() - t0;
    expect(intel.products).toHaveLength(1000);
    expect(intel.suppliers).toHaveLength(500);
    expect(ms).toBeLessThan(2000);
  });
});
