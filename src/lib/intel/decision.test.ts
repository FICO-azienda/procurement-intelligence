import { describe, expect, it } from "vitest";
import type { Dataset, ProductData, PurchaseData, QuoteData, SupplierData } from "../analytics";
import type { SupplierLink } from "./comparison";
import { INTEL_CONFIG } from "./config";
import { byPriority, decisionFor, filterDecisions, purchasingOverview, type ProductDecision } from "./decision";
import { analyze, type OpportunityState } from "./engine";
import { dataset, link, product, purchase, quote, supplier } from "./fixtures";

const AS_OF = "2026-10-01";

/**
 * A company with one dominant product ("Bulk", two suppliers, ~90% of spend)
 * so that the product under test is neither high-spend nor affected by it,
 * unless a test wants it to be.
 */
function company() {
  const main = supplier({ name: "Alpha" });
  const other = supplier({ name: "Omega" });
  const bulk = product({ name: "Bulk", currentSupplierId: main.id, unit: "kg" });
  const bulkPurchases = [
    purchase({ productId: bulk.id, supplierId: main.id, date: "2026-02-01", quantity: 50_000, unitPrice: 2 }),
    purchase({ productId: bulk.id, supplierId: other.id, date: "2026-05-01", quantity: 50_000, unitPrice: 2 }),
    purchase({ productId: bulk.id, supplierId: main.id, date: "2026-08-01", quantity: 50_000, unitPrice: 2 }),
  ];
  return { main, other, bulk, bulkPurchases };
}

interface Case {
  suppliers?: SupplierData[];
  products?: ProductData[];
  purchases?: PurchaseData[];
  quotes?: QuoteData[];
  links?: SupplierLink[];
  states?: OpportunityState[];
}

function run(c: Case, withBulk = true) {
  const base = company();
  const data: Dataset = dataset({
    suppliers: [...(withBulk ? [base.main, base.other] : []), ...(c.suppliers ?? [])],
    products: [...(withBulk ? [base.bulk] : []), ...(c.products ?? [])],
    purchases: [...(withBulk ? base.bulkPurchases : []), ...(c.purchases ?? [])],
    quotes: c.quotes ?? [],
  });
  const intel = analyze(data, c.links ?? [], c.states ?? [], AS_OF);
  return { intel, overview: purchasingOverview(intel), of: (p: ProductData) => decisionFor(intel, p.id)! };
}

/** Widget bought from A: 4 × 5.000 kg, price rising or flat. */
function widget(prices = [1.42, 1.45, 1.52, 1.58]) {
  const a = supplier({ name: "Acme", country: "Italy", paymentTermsDays: 60, defaultLeadTimeDays: 12 });
  const p = product({ name: "Widget", category: "Parts", currentSupplierId: a.id });
  const dates = ["2026-01-10", "2026-03-10", "2026-06-12", "2026-09-15"];
  const purchases = prices.map((unitPrice, i) => purchase({ productId: p.id, supplierId: a.id, date: dates[i], quantity: 5000, unitPrice }));
  return { a, p, purchases };
}

const text = (d: ProductDecision) => d.summary.join(" ");

describe("product with a good opportunity", () => {
  const { a, p, purchases } = widget();
  const b = supplier({ name: "Beta", country: "Italy" });
  const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-10", unitPrice: 1.49, moq: 2000, leadTimeDays: 12, paymentTermsDays: 60, incoterm: "DAP" });
  const d = run({ suppliers: [a, b], products: [p], purchases, quotes: [q] }).of(p);

  it("is an Action with the engine's own saving and confidence", () => {
    expect(d.status).toBe("action");
    expect(d.best?.supplierName).toBe("Beta");
    expect(d.potentialSaving).toBeCloseTo(1800, 6);
    expect(d.savingConfidence).toBe("high");
    expect(d.priority.tier).toBe(1);
  });

  it("shows the money view: same volume at both prices", () => {
    expect(d.money?.currentAnnualCost).toBeCloseTo(31_600, 6);
    expect(d.money?.alternativeAnnualCost).toBeCloseTo(29_800, 6);
    expect(d.money!.currentAnnualCost - d.money!.alternativeAnnualCost).toBeCloseTo(d.money!.difference, 6);
  });

  it("never claims a true cost it has not computed", () => {
    expect(d.alternatives.every((x) => x.estimatedTrueCost === null)).toBe(true);
    expect(text(d)).toContain("This is a price comparison only");
  });

  it("explains itself in plain words, in the order an owner asks", () => {
    expect(d.summary[0]).toBe("You pay €1,58/kg to Acme, 11,3% more than at your first purchase on record (Jan 2026).");
    expect(d.summary[1]).toBe("That is above the one comparable quote on file (€1,49/kg).");
    expect(d.summary[2]).toBe("The best comparable alternative on file is Beta (Italy) at €1,49/kg — about 5,7% less, or roughly €1.800 a year at your current volume.");
    expect(d.summary.length).toBeLessThanOrEqual(5);
  });

  it("suggests checks, each with its reasons — never a decision", () => {
    expect(d.nextActions[0].kind).toBe("negotiate");
    expect(d.nextActions[0].label).toBe("Ask Acme to review their price");
    expect(d.nextActions[0].why.map((w) => w.value)).toEqual(["€1,58/kg (Acme)", "€1,49/kg (Beta)", "€0,09/kg · 5,7%", "20.000 kg"]);
    expect(d.nextActions.every((x) => x.why.length > 0)).toBe(true);
    expect(d.nextActions.length).toBeLessThanOrEqual(INTEL_CONFIG.overview.maxActions);
  });

  it("flags what is fine and what is open on the alternative", () => {
    const flags = d.best!.flags;
    expect(flags.filter((x) => x.tone === "ok").map((x) => x.key)).toEqual(expect.arrayContaining(["recent", "moq_ok", "same_currency", "delivered"]));
    expect(flags.filter((x) => x.tone === "warn").map((x) => x.key)).toEqual(["specs_unknown", "quality"]);
  });
});

describe("product without an opportunity", () => {
  it("is Good when a recent comparable quote is not below a stable price", () => {
    const { a, p, purchases } = widget([1.5, 1.5, 1.5, 1.52]);
    const b = supplier({ name: "Beta" });
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-10", unitPrice: 1.55, moq: 2000, incoterm: "DAP" });
    const d = run({ suppliers: [a, b], products: [p], purchases, quotes: [q] }).of(p);
    expect(d.status).toBe("good");
    expect(d.potentialSaving).toBeNull();
    expect(d.nextActions).toEqual([]);
    expect(d.market).toMatchObject({ type: "internal_quotes", count: 1, position: "below" });
    expect(text(d)).toContain("No meaningful price opportunity has been identified at current volumes.");
    expect(d.priority.tier).toBe(5);
  });

  it("a saving too small to matter changes no status", () => {
    const a = supplier({ name: "Acme" });
    const b = supplier({ name: "Beta" });
    const p = product({ name: "Screw", currentSupplierId: a.id, unit: "pcs" });
    const purchases = ["2026-03-01", "2026-06-01", "2026-09-01"].map((date) => purchase({ productId: p.id, supplierId: a.id, date, quantity: 1000, unitPrice: 1, unit: "pcs" }));
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-10", unitPrice: 0.95, moq: 500, incoterm: "DAP" });
    const d = run({ suppliers: [a, b], products: [p], purchases, quotes: [q] }).of(p);
    expect(d.potentialSaving).toBeCloseTo(150, 6); // below the €250/year materiality threshold
    expect(d.savingMaterial).toBe(false);
    expect(d.status).toBe("good");
    expect(text(d)).toContain("not a meaningful opportunity at current volumes");
    expect(d.nextActions.find((x) => x.kind === "negotiate")).toBeUndefined();
  });
});

describe("product with insufficient data", () => {
  it("no alternative on file → Data needed, and it says what is known and what is not", () => {
    const { a, p, purchases } = widget([1.5, 1.5, 1.5, 1.52]);
    const d = run({ suppliers: [a], products: [p], purchases }).of(p);
    expect(d.status).toBe("data_needed");
    expect(d.market.type).toBe("not_available");
    expect(d.alternatives).toEqual([]);
    expect(d.potentialSaving).toBeNull();
    expect(text(d)).toContain("there are no comparable quotes from other suppliers yet, so we cannot say whether a saving is possible");
    expect(d.nextActions.map((x) => x.kind)).toEqual(["request_quote"]);
    expect(d.missingData).toContain("A comparable quote from another supplier");
  });

  it("no purchases → nothing to assess", () => {
    const p = product({ name: "New part" });
    const d = run({ products: [p] }).of(p);
    expect(d.status).toBe("data_needed");
    expect(d.currentPrice).toBeNull();
    expect(d.nextActions[0].kind).toBe("add_purchases");
    expect(d.summary).toHaveLength(1);
  });

  it("a single purchase gives a price but no history", () => {
    const a = supplier({ name: "Acme" });
    const p = product({ name: "Once", currentSupplierId: a.id });
    const d = run({ suppliers: [a], products: [p], purchases: [purchase({ productId: p.id, supplierId: a.id, date: "2026-09-01", quantity: 100, unitPrice: 3 })] }).of(p);
    expect(d.priceTrend.pct).toBeNull();
    expect(d.summary[0]).toBe("You pay €3,00/kg to Acme. There is only one purchase on record, so no price history yet.");
    expect(d.dataConfidence).toBe("low");
  });

  it("last purchase over six months ago → the price may be outdated", () => {
    const a = supplier({ name: "Acme" });
    const p = product({ name: "Rare", currentSupplierId: a.id });
    const purchases = ["2025-11-01", "2026-01-15"].map((date) => purchase({ productId: p.id, supplierId: a.id, date, quantity: 100, unitPrice: 3 }));
    const d = run({ suppliers: [a], products: [p], purchases }).of(p);
    expect(d.status).toBe("data_needed");
    expect(d.nextActions.map((x) => x.kind)).toContain("confirm_price");
  });

  it("only old quotes on file → not enough to call the price good", () => {
    const { a, p, purchases } = widget([1.5, 1.5, 1.5, 1.52]);
    const b = supplier({ name: "Beta" });
    const q = quote({ productId: p.id, supplierId: b.id, date: "2025-12-01", unitPrice: 1.6, moq: 2000 });
    const d = run({ suppliers: [a, b], products: [p], purchases, quotes: [q] }).of(p);
    expect(d.status).toBe("data_needed");
    expect(d.market).toMatchObject({ count: 1, recent: 0, confidence: "low" });
    expect(text(d)).toContain("too old");
  });
});

describe("product with a foreign supplier", () => {
  const { a, p, purchases } = widget();
  const far = supplier({ name: "Farwax", country: "Turkey", currency: "USD", paymentTermsDays: 0, defaultLeadTimeDays: 30 });

  it("a foreign-currency quote without an exchange rate is not compared and claims nothing", () => {
    const q = quote({ productId: p.id, supplierId: far.id, date: "2026-09-10", unitPrice: 1.2, currency: "USD", fxRate: null, moq: 2000, incoterm: "FOB" });
    const d = run({ suppliers: [a, far], products: [p], purchases, quotes: [q] }).of(p);
    expect(d.potentialSaving).toBeNull();
    expect(d.market.type).toBe("not_available");
    expect(d.alternatives[0]).toMatchObject({ comparability: "not", priceEUR: null, potentialSaving: null });
    expect(d.alternatives[0].notComparableReason).toContain("FX conversion required");
    expect(d.nextActions.map((x) => x.kind)).toContain("record_fx");
    expect(text(d)).toContain("can't be compared yet");
  });

  it("with a recorded rate it is compared, at medium confidence, with its open costs listed", () => {
    const q = quote({ productId: p.id, supplierId: far.id, date: "2026-09-10", unitPrice: 1.4, currency: "USD", fxRate: 0.9, moq: 2000, leadTimeDays: 30, paymentTermsDays: 0, incoterm: "FOB" });
    const d = run({ suppliers: [a, far], products: [p], purchases, quotes: [q] }).of(p);
    expect(d.best?.priceEUR).toBeCloseTo(1.26, 6);
    expect(d.savingConfidence).toBe("medium");
    expect(d.status).toBe("review");
    const warnings = d.best!.flags.filter((x) => x.tone === "warn").map((x) => x.key);
    expect(warnings).toEqual(["currency", "freight", "import", "lead_time", "payment", "specs_unknown", "quality"]);
    expect(d.summary.at(-1)).toBe("This is a price comparison only: before treating it as a saving, add the cost of transport and check import costs.");
    expect(d.nextActions.map((x) => x.kind)).toEqual(["negotiate", "get_freight", "check_import"]);
  });
});

describe("single-source product", () => {
  it("keeps supply risk apart from cost: fairly priced and still risky", () => {
    const { a, p, purchases } = widget([1.5, 1.5, 1.5, 1.52]);
    const b = supplier({ name: "Beta" });
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-10", unitPrice: 1.55, moq: 2000, incoterm: "DAP" });
    // Without the dominant product, the widget is all of the spend.
    const d = run({ suppliers: [a, b], products: [p], purchases, quotes: [q] }, false).of(p);
    expect(d.status).toBe("good");
    expect(d.supplyRisk).toMatchObject({ level: "high", label: "Single source", suppliers: 1, alternativesQuoted: 1 });
    expect(d.priority.tier).toBe(2);
    expect(d.nextActions.map((x) => x.kind)).toEqual(["second_source"]);
    expect(d.summary.at(-1)).toBe("Everything is bought from one supplier, and this product is 100,0% of your purchasing spend.");
  });

  it("a low-spend single source is a moderate risk, a product with two suppliers a low one", () => {
    const { a, p, purchases } = widget([1.5, 1.5, 1.5, 1.52]);
    const { of, intel } = run({ suppliers: [a], products: [p], purchases });
    expect(of(p).supplyRisk.level).toBe("moderate");
    const bulk = intel.products.find((x) => x.product.name === "Bulk")!;
    expect(decisionFor(intel, bulk.product.id)!.supplyRisk).toMatchObject({ level: "low", label: "2 suppliers" });
  });
});

describe("lowest quote is not the first alternative", () => {
  const { a, p, purchases } = widget();
  const b = supplier({ name: "Beta", country: "Italy" });
  const c = supplier({ name: "Cheapo", country: "China", paymentTermsDays: 0 });
  const quotes = [
    quote({ productId: p.id, supplierId: b.id, date: "2026-09-10", unitPrice: 1.49, moq: 2000, incoterm: "DAP", leadTimeDays: 12, paymentTermsDays: 60 }),
    quote({ productId: p.id, supplierId: c.id, date: "2026-09-18", unitPrice: 1.12, moq: 20_000, incoterm: "FOB", leadTimeDays: 55, paymentTermsDays: 0 }),
  ];
  const d = run({ suppliers: [a, b, c], products: [p], purchases, quotes }).of(p);

  it("orders by reliability of the comparison, not by quoted price", () => {
    expect(d.alternatives.map((x) => x.supplierName)).toEqual(["Beta", "Cheapo"]);
    expect(d.best?.supplierName).toBe("Beta");
    expect(d.alternatives[1]).toMatchObject({ comparability: "partial", confidence: "medium" });
  });

  it("says why the cheapest quote is not first", () => {
    expect(d.cheapestNotFirst?.explanation).toBe(
      "Cheapo has the lowest quoted price (€1,12/kg), but it is not listed first: higher MOQ (20.000 kg), freight not included (FOB) and import costs not assessed. Its true cost has not been estimated yet.",
    );
    expect(d.summary).toContain("Cheapo quotes even less (€1,12/kg), but that offer is harder to compare and its true cost is not estimated yet.");
    expect(d.summary.length).toBeLessThanOrEqual(5);
  });

  it("the range of quotes on file is a comparison, not a market price", () => {
    expect(d.market).toMatchObject({ type: "internal_quotes", count: 2, recent: 2, confidence: "medium", position: "above" });
    expect(d.market.low).toBe(1.12);
    expect(d.market.high).toBe(1.49);
  });

  it("shows at most three alternatives and counts the rest", () => {
    const more = ["D", "E", "F"].map((name) => supplier({ name }));
    const extra = more.map((s, i) => quote({ productId: p.id, supplierId: s.id, date: "2026-09-12", unitPrice: 1.5 + i / 100, moq: 2000, incoterm: "DAP" }));
    const x = run({ suppliers: [a, b, c, ...more], products: [p], purchases, quotes: [...quotes, ...extra] }).of(p);
    expect(x.alternatives).toHaveLength(3);
    expect(x.alternativesTotal).toBe(5);
  });
});

describe("price movements and anomalies", () => {
  it("an increase with nothing to compare against is a Review with two checks", () => {
    const { a, p, purchases } = widget();
    const d = run({ suppliers: [a], products: [p], purchases }).of(p);
    expect(d.status).toBe("review");
    expect(d.statusReason).toBe("Price up 11,3% since your first purchase on record.");
    expect(d.nextActions.map((x) => x.kind)).toEqual(["explain_increase", "request_quote"]);
    expect(d.priority.tier).toBe(3);
    expect(d.priority.value).toBeCloseTo(3200, 6); // 20.000 kg × (1,58 − 1,42)
  });

  it("a price flagged as a possible data error comes before any opportunity", () => {
    const a = supplier({ name: "Acme" });
    const b = supplier({ name: "Beta" });
    const p = product({ name: "Odd", currentSupplierId: a.id });
    const purchases = ([["2026-03-01", 1.42], ["2026-05-01", 1.44], ["2026-07-01", 1.45], ["2026-09-01", 3.9]] as const).map(([date, unitPrice]) =>
      purchase({ productId: p.id, supplierId: a.id, date, quantity: 1000, unitPrice }),
    );
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-10", unitPrice: 1.5, moq: 500, incoterm: "DAP" });
    const d = run({ suppliers: [a, b], products: [p], purchases, quotes: [q] }).of(p);
    expect(d.currentPriceFlagged).toBe(true);
    expect(d.status).toBe("review");
    expect(d.nextActions[0].kind).toBe("check_price");
    expect(d.nextActions.find((x) => x.kind === "negotiate")).toBeUndefined();
    expect(d.summary[1]).toContain("may be a data error");
  });

  it("an opportunity the user rejected no longer leads the product", () => {
    const { a, p, purchases } = widget();
    const b = supplier({ name: "Beta" });
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-10", unitPrice: 1.49, moq: 2000, incoterm: "DAP" });
    const open = run({ suppliers: [a, b], products: [p], purchases, quotes: [q] });
    const key = open.of(p).opportunityKey!;
    const states: OpportunityState[] = [{ key, status: "rejected", note: null, snapshot: null, updatedAt: AS_OF }];
    const d = run({ suppliers: [a, b], products: [p], purchases, quotes: [q], states }).of(p);
    expect(d.best).toBeNull();
    expect(d.potentialSaving).toBeNull();
    expect(d.status).toBe("review"); // the price increase is still there
    expect(d.alternatives[0].setAside).toBe(true);
    expect(d.alternatives[0].flags[0].key).toBe("set_aside");
  });
});

describe("the whole page", () => {
  // Five products, one per situation.
  const s = (name: string, over: Partial<SupplierData> = {}) => supplier({ name, ...over });
  const buy = (p: ProductData, sup: SupplierData, prices: number[], quantity: number) =>
    prices.map((unitPrice, i) => purchase({ productId: p.id, supplierId: sup.id, date: ["2026-01-10", "2026-03-10", "2026-06-12", "2026-09-15"][i], quantity, unitPrice, unit: p.unit }));

  const [sa, sb, sc, sd, se, alt1, alt2] = [s("A"), s("B"), s("C"), s("D"), s("E"), s("Alt One"), s("Alt Two", { country: "Poland" })];
  const act = product({ name: "Actionable", category: "Wax", currentSupplierId: sa.id });
  const rev = product({ name: "Reviewable", category: "Glass", currentSupplierId: sb.id });
  const risk = product({ name: "Risky", category: "Boxes", currentSupplierId: sc.id });
  const need = product({ name: "Needy", category: "Wicks", currentSupplierId: sd.id });
  const good = product({ name: "Goodie", category: "Labels", currentSupplierId: se.id });
  const c: Case = {
    suppliers: [sa, sb, sc, sd, se, alt1, alt2],
    products: [good, need, risk, rev, act],
    purchases: [
      ...buy(act, sa, [1.42, 1.45, 1.52, 1.58], 5000),
      ...buy(rev, sb, [1.06, 1.09, 1.13, 1.18], 2500),
      ...buy(risk, sc, [4, 4, 4, 4], 20_000),
      ...buy(need, sd, [0.5, 0.5, 0.5, 0.5], 2000),
      ...buy(good, se, [0.5, 0.5, 0.5, 0.5], 1000),
      // Goodie is also bought elsewhere: two suppliers.
      purchase({ productId: good.id, supplierId: sd.id, date: "2026-08-01", quantity: 1000, unitPrice: 0.5 }),
    ],
    quotes: [
      quote({ productId: act.id, supplierId: alt1.id, date: "2026-09-10", unitPrice: 1.49, moq: 2000, incoterm: "DAP" }),
      // MOQ above the typical order (2.500) but within the annual volume (10.000): partly comparable.
      quote({ productId: rev.id, supplierId: alt2.id, date: "2026-09-12", unitPrice: 1.02, moq: 6000, incoterm: "FCA" }),
      quote({ productId: good.id, supplierId: alt1.id, date: "2026-09-20", unitPrice: 0.52, moq: 500, incoterm: "DAP" }),
    ],
  };
  const { overview, intel } = run(c, false);

  it("orders products by where to look first, not alphabetically", () => {
    expect(overview.products.map((d) => [d.name, d.status, d.priority.tier])).toEqual([
      ["Actionable", "action", 1],
      ["Risky", "data_needed", 2],
      ["Reviewable", "review", 3],
      ["Needy", "data_needed", 4],
      ["Goodie", "good", 5],
    ]);
    expect([...overview.products].reverse().sort(byPriority)).toEqual(overview.products);
  });

  it("separates potential from high-confidence, and counts nothing twice", () => {
    expect(overview.totals.potentialSavings).toBeCloseTo(1800 + 1600, 6);
    expect(overview.totals.potentialSavings).toBe(intel.totals.potentialSavings);
    expect(overview.totals.highConfidenceSavings).toBeCloseTo(1800, 6);
    expect(overview.totals.validatedSavings).toBe(0);
    expect(overview.totals).toMatchObject({ productsTotal: 5, productsAnalyzed: 5, productsToReview: 2, byStatus: { action: 1, review: 1, data_needed: 2, good: 1 } });
  });

  it("validated means the user said so", () => {
    const key = overview.products[0].opportunityKey!;
    const states: OpportunityState[] = [{ key, status: "validated", note: null, snapshot: null, updatedAt: AS_OF }];
    expect(run({ ...c, states }, false).overview.totals.validatedSavings).toBeCloseTo(1800, 6);
  });

  it("lists the top opportunities with a reason anyone can read", () => {
    expect(overview.topOpportunities.map((x) => [x.productName, Math.round(x.amount), x.isSaving])).toEqual([
      ["Actionable", 1800, true],
      ["Reviewable", 1600, true],
    ]);
    expect(overview.topOpportunities[0].reason).toBe("A comparable quote from Alt One is below what you pay.");
    expect(overview.topOpportunities[1].reason).toBe("A partly comparable quote from Alt Two is below what you pay.");
  });

  it("shows supply risks even where there is no saving", () => {
    expect(overview.supplyRisks.map((x) => x.name)).toEqual(["Risky"]);
    expect(overview.supplyRisks[0]).toMatchObject({ annualSpend: 320_000, supplierName: "C", alternativesQuoted: 0 });
    expect(overview.concentration.singleSourceProducts).toBe(4);
    expect(overview.concentration.topSupplier).toMatchObject({ name: "C" });
    expect(overview.concentration.topProductsShare).toBeCloseTo(1, 6);
  });

  it("tells what changed in the last 30 days", () => {
    expect(overview.recentChanges.map((x) => `${x.productName}: ${x.text}`)).toEqual([
      "Goodie: Quote received from Alt One",
      "Actionable: A price up",
      "Reviewable: B price up",
      "Reviewable: Quote received from Alt Two",
      "Actionable: Quote received from Alt One",
    ]);
    expect(overview.recentChanges[1].pct).toBeCloseTo(3.947, 2);
  });

  it("names three things to check first, one per product", () => {
    expect(overview.checkFirst.map((x) => [x.productName, x.action.kind])).toEqual([
      ["Actionable", "negotiate"],
      ["Risky", "request_quote"],
      ["Reviewable", "negotiate"],
    ]);
  });

  it("writes an executive summary that stands on its own", () => {
    expect(overview.executiveSummary).toEqual([
      "You spent €367.500 on purchases in the last 12 months, across 5 products and 5 suppliers.",
      "2 products show a price opportunity or a price increase worth a look; 2 products have nothing to be compared with yet; 1 product looks fairly priced.",
      "About €3.400 a year of potential savings has been identified, of which €1.800 is supported by high-confidence comparable quotes. These compare prices only: transport, duties and quality checks are not included.",
      "The largest opportunities are in wax and glass.",
      "1 high-spend product is bought from a single supplier.",
      "First thing to look at: Actionable — ask A to review their price.",
    ]);
  });

  it("filters by status, supplier, category and text, and sorts on request", () => {
    const names = (q: Parameters<typeof filterDecisions>[1]) => filterDecisions(overview.products, q).map((d) => d.name);
    expect(names({})).toEqual(["Actionable", "Risky", "Reviewable", "Needy", "Goodie"]);
    expect(names({ status: "data_needed" })).toEqual(["Risky", "Needy"]);
    expect(names({ status: "nonsense" })).toHaveLength(5);
    expect(names({ supplierId: alt1.id })).toEqual(["Actionable", "Goodie"]); // as an alternative
    expect(names({ supplierId: sc.id })).toEqual(["Risky"]); // as the current supplier
    expect(names({ category: "glass" })).toEqual(["Reviewable"]);
    expect(names({ search: "  good " })).toEqual(["Goodie"]);
    expect(names({ sort: "spend" })).toEqual(["Risky", "Actionable", "Reviewable", "Needy", "Goodie"]);
    expect(names({ sort: "saving" }).slice(0, 2)).toEqual(["Actionable", "Reviewable"]);
  });

  it("keeps the vocabulary honest and the numbers plain", () => {
    const all = [...overview.executiveSummary, ...overview.products.flatMap((d) => [...d.summary, d.statusReason, ...d.nextActions.map((x) => x.label)])].join(" ");
    expect(all).not.toMatch(/switch|best supplier|cheapest supplier|saving realised|realized saving|verified saving/i);
    expect(all).not.toMatch(/\d,\d{4,}/); // no false precision
  });
});

describe("edge cases", () => {
  it("an empty company has an overview with nothing in it", () => {
    const ov = purchasingOverview(analyze(dataset({}), [], [], AS_OF));
    expect(ov.products).toEqual([]);
    expect(ov.totals).toMatchObject({ annualSpend: 0, productsAnalyzed: 0, potentialSavings: 0, productsToReview: 0 });
    expect(ov.executiveSummary).toHaveLength(1);
    expect(ov.concentration.topSupplier).toBeNull();
  });

  it("specifications that differ are flagged on the alternative", () => {
    const { a, p: base, purchases } = widget();
    const p = { ...base, specs: { Weight: "210 g" } };
    const b = supplier({ name: "Beta" });
    const q = quote({ productId: p.id, supplierId: b.id, date: "2026-09-10", unitPrice: 1.49, moq: 2000, incoterm: "DAP" });
    const l = link({ supplierId: b.id, productId: p.id, specs: { Weight: "180 g" } });
    const d = run({ suppliers: [a, b], products: [p], purchases, quotes: [q], links: [l] }).of(p);
    expect(d.best?.comparability).toBe("partial");
    expect(d.status).toBe("review");
    expect(d.best!.flags.map((x) => x.key)).toContain("specs_differ");
    expect(d.summary.find((x) => x.startsWith("The most relevant alternative"))).toBeDefined();
    expect(d.nextActions.map((x) => x.kind)).toContain("check_specs");
  });

  it("summarises 1.000 products quickly", () => {
    const suppliers = Array.from({ length: 200 }, (_, i) => supplier({ name: `S${i}` }));
    const products: ProductData[] = [];
    const purchases: PurchaseData[] = [];
    const quotes: QuoteData[] = [];
    for (let i = 0; i < 1000; i++) {
      const sup = suppliers[i % suppliers.length];
      const p = product({ name: `P${i}`, currentSupplierId: sup.id });
      products.push(p);
      for (let m = 1; m <= 9; m++) purchases.push(purchase({ productId: p.id, supplierId: sup.id, date: `2026-0${m}-10`, quantity: 100 + i, unitPrice: 1 + m / 50 }));
      if (i % 2 === 0) quotes.push(quote({ productId: p.id, supplierId: suppliers[(i + 7) % suppliers.length].id, date: "2026-09-12", unitPrice: 1.05, moq: 50, incoterm: "DAP" }));
    }
    const intel = analyze(dataset({ suppliers, products, purchases, quotes }), [], [], AS_OF);
    const t = performance.now();
    const ov = purchasingOverview(intel);
    expect(performance.now() - t).toBeLessThan(500);
    expect(ov.products).toHaveLength(1000);
  });
});
