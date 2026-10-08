import { describe, expect, test } from "vitest";
import { OBJECTIVES, PORTFOLIO_CONFIG, defaultWeights, type Objective } from "./config";
import { NO_CONSTRAINTS, normalizeWeights, sourcingMix, type Constraints, type PortfolioInput, type PortfolioProduct, type Scenario, type SourceOption } from "./engine";

// Mock data, used only by these tests: an invented candle maker with invented suppliers.

const option = (key: string, o: Partial<SourceOption> = {}): SourceOption => ({
  key,
  name: `Mock ${key}`,
  country: "Italy",
  region: "home",
  current: false,
  known: false,
  evidence: "true_cost",
  unitCost: 1,
  level: "to_validate",
  qualification: "possible",
  quality: null,
  certifications: null,
  leadTimeDays: null,
  paymentDays: null,
  moq: null,
  stage: null,
  asked: true,
  missing: [],
  ...o,
});
const current = (key: string, unitCost: number, o: Partial<SourceOption> = {}) => option(key, { current: true, known: true, evidence: "actual", level: null, qualification: "proven", unitCost, ...o });
const candidate = (key: string, o: Partial<SourceOption> = {}) => option(key, { evidence: "none", unitCost: null, level: null, stage: "strong", asked: false, ...o });

const product = (id: string, price: number, quantity: number, options: SourceOption[], o: Partial<PortfolioProduct> = {}): PortfolioProduct => ({
  id,
  name: `Mock product ${id}`,
  unit: "kg",
  group: "Materials",
  annualQuantity: quantity,
  quantityStatus: "confirmed",
  typicalOrder: null,
  currentPrice: price,
  options,
  negotiation: null,
  criticality: null,
  switching: null,
  ...o,
});
const input = (products: PortfolioProduct[], outside: PortfolioInput["outside"] = {}): PortfolioInput => ({ products, outside, scopeShare: 0.8 });
const scenario = (p: ReturnType<typeof sourcingMix>, o: Objective): Scenario => p.scenarios.find((s) => s.objective === o)!;
const supplierOf = (s: Scenario, productId: string) => s.allocation.find((a) => a.productId === productId)!.parts.map((x) => x.key).join("+");
const limits = (c: Partial<Constraints>): Constraints => ({ ...NO_CONSTRAINTS, ...c });

describe("with nothing to compare", () => {
  const data = input([
    product("wax", 1.5, 500_000, [current("alpha", 1.5), candidate("gamma"), candidate("delta")], { negotiation: { status: "range", low: 1.44, high: 1.5, target: 1.46, upsideAnnual: 20_000, confidence: "low" } }),
    product("wick", 2, 10_000, [current("alpha", 2), candidate("gamma")]),
    product("jar", 0.1, 300_000, [current("beta", 0.1)]),
  ]);
  const p = sourcingMix(data);

  test("no scenario moves a product: a candidate nobody asked has no price", () => {
    for (const s of p.scenarios) {
      expect(s.status).not.toBe("changed");
      expect(s.benefit.total).toBe(0);
      expect(s.allocation.every((a) => a.parts.length === 1 && a.parts[0].current)).toBe(true);
    }
    expect(p.suggested).toBeNull();
  });

  test("each objective says what it lacks instead of making something up", () => {
    expect(scenario(p, "lowest_cost").status).toBe("not_enough_data");
    expect(scenario(p, "quality").headline).toMatch(/Insufficient quality data/);
    expect(scenario(p, "delivery").headline).toMatch(/no lead time/);
    expect(scenario(p, "total_value").headline).toMatch(/no real offer/);
    expect(scenario(p, "risk").status).toBe("unchanged");
    expect(scenario(p, "lowest_cost").missing.map((m) => m.kind)).toEqual(expect.arrayContaining(["request_quotes", "find_suppliers"]));
  });

  test("per product: negotiate where the evidence supports a target, more data elsewhere", () => {
    const a = p.today.allocation;
    expect(a.find((x) => x.productId === "wax")).toMatchObject({ decision: "negotiate", target: 1.46 });
    expect(a.find((x) => x.productId === "wick")!.decision).toBe("need_data");
    expect(a.find((x) => x.productId === "jar")!.decision).toBe("need_data");
    expect(p.today.negotiationUpside).toBe(20_000);
    expect(p.next.join(" ")).toMatch(/Negotiate with the current supplier/);
  });

  test("candidates still count as possible coverage: one request for several products", () => {
    const gamma = p.bundles.find((b) => b.key === "gamma")!;
    expect(gamma).toMatchObject({ products: 2, value: null, current: false });
    expect(gamma.spendShare).toBeCloseTo((750_000 + 20_000) / 800_000);
    expect(p.bySupplier.find((s) => s.key === "alpha")!.note).toMatch(/None has a price yet/);
    expect(p.next.join(" ")).toMatch(/quotation/);
  });

  test("today's mix is read for what it is: concentrated, single source", () => {
    expect(p.today.measures.suppliers.map((s) => s.key)).toEqual(["alpha", "beta"]);
    expect(p.today.measures.concentration).toBe("high");
    expect(p.today.measures.risk.level).toBe("high");
    expect(p.today.measures.lead.days).toBeNull();
    expect(p.today.quality.status).toBe("insufficient");
    expect(p.today.confidence).toBe("low");
  });
});

describe("lowest cost, product by product", () => {
  const data = input([
    product("wax", 1.5, 100_000, [current("alpha", 1.5), option("one", { unitCost: 1.4, level: "validated", qualification: "confirmed" }), option("two", { unitCost: 1.45 })]),
    product("wick", 2, 10_000, [current("alpha", 2), option("four", { unitCost: 1.8, evidence: "quoted_price", level: "theoretical", missing: ["A freight estimate"] })]),
    product("jar", 0.1, 300_000, [current("beta", 0.1), option("seven", { unitCost: 0.11 })]),
  ]);
  const p = sourcingMix(data);
  const s = scenario(p, "lowest_cost");

  test("each product goes to its lowest price, however many suppliers that takes", () => {
    expect(supplierOf(s, "wax")).toBe("one");
    expect(supplierOf(s, "wick")).toBe("four");
    expect(supplierOf(s, "jar")).toBe("beta");
    expect(s.measures.suppliers).toHaveLength(3);
    expect(s.tradeoffs.join(" ")).toMatch(/3 suppliers instead of 2/);
  });

  test("the advantage is split by what stands behind it, and never called a saving", () => {
    expect(s.benefit.total).toBeCloseTo(10_000 + 2_000);
    expect(s.benefit.validated).toBeCloseTo(10_000);
    expect(s.benefit.theoretical).toBeCloseTo(2_000);
    expect(s.benefit.level).toBe("theoretical");
    expect(s.confidence).toBe("low");
    expect(s.gains[0]).toMatch(/not a saving/);
    expect(s.allocation.find((a) => a.productId === "wax")!.decision).toBe("switch");
    expect(s.allocation.find((a) => a.productId === "jar")!.decision).toBe("keep");
  });

  test("total economic value takes only prices that are complete", () => {
    const tv = scenario(p, "total_value");
    expect(supplierOf(tv, "wick")).toBe("alpha");
    expect(tv.allocation.find((a) => a.productId === "wick")).toMatchObject({ decision: "negotiate" });
    expect(tv.missing.map((m) => m.kind)).toContain("complete_true_cost");
  });
});

describe("coverage is a bonus, not a winner", () => {
  const make = (bundlePrice: number) =>
    input([
      product("a", 1, 100_000, [current("alpha", 1), option("big", { unitCost: bundlePrice }), option("small", { unitCost: 0.9, qualification: "confirmed", level: "validated" })]),
      product("b", 1, 100_000, [current("beta", 1), option("big", { unitCost: bundlePrice })]),
      product("c", 1, 100_000, [current("gamma", 1), option("big", { unitCost: bundlePrice })]),
    ]);

  test("a supplier covering every product does not win by covering them", () => {
    const p = sourcingMix(make(1.05));
    for (const o of ["bundle", "balanced", "total_value", "specialists"] as Objective[]) expect(scenario(p, o).measures.suppliers.some((s) => s.key === "big")).toBe(false);
  });

  test("at the same price, grouping the products is worth something", () => {
    const p = sourcingMix(make(1));
    const b = scenario(p, "bundle");
    expect(supplierOf(b, "b")).toBe("big");
    expect(supplierOf(b, "c")).toBe("big");
    expect(scenario(p, "lowest_cost").measures.suppliers.some((s) => s.key === "big")).toBe(false);
  });

  test("the specialist keeps its product even when a bundle is on offer", () => {
    const p = sourcingMix(make(0.97));
    for (const o of ["lowest_cost", "specialists", "balanced", "total_value"] as Objective[]) expect(supplierOf(scenario(p, o), "a")).toBe("small");
    const sp = p.specialists.find((x) => x.key === "small")!;
    expect(sp).toMatchObject({ verdict: "ahead", specialization: "high", level: "validated" });
    expect(sp.difference).toBeCloseTo(10_000);
  });

  test("fewer suppliers accepts a little more cost, and stops where it goes beyond the limit", () => {
    const three = (price: number) => input(["a", "b", "c"].map((id, i) => product(id, 1, 100_000, [current(["alpha", "beta", "gamma"][i], 1), option("big", { unitCost: price })])));
    const within = scenario(sourcingMix(three(1.01)), "fewer_suppliers");
    expect(within.measures.suppliers.map((s) => s.key)).toEqual(["big"]);
    expect(within.gains.join(" ")).toMatch(/1 suppliers? instead of 3/);
    expect(within.tradeoffs.join(" ")).toMatch(/above today's cost/);
    expect(scenario(sourcingMix(three(1.04)), "fewer_suppliers").status).toBe("unchanged");
    // The same offers never move a product in the lowest-cost mix.
    expect(scenario(sourcingMix(three(1.01)), "lowest_cost").status).toBe("unchanged");
  });

  test("coverage is weighed by spend, not by the number of products", () => {
    const small = Array.from({ length: 6 }, (_, i) => product(`s${i}`, 1, 1_000, [current("alpha", 1), candidate("many")]));
    const p = sourcingMix(input([product("large", 4, 100_000, [current("beta", 4), candidate("one")]), product("other", 1, 1_000, [current("beta", 1), candidate("one")]), ...small]));
    const many = p.bundles.find((b) => b.key === "many")!;
    const one = p.bundles.find((b) => b.key === "one")!;
    expect(many.products).toBe(6);
    expect(one.products).toBe(2);
    expect(one.spendShare).toBeGreaterThan(many.spendShare * 50);
    expect(p.bundles.findIndex((b) => b.key === "one")).toBeLessThan(p.bundles.findIndex((b) => b.key === "many"));
    expect(one.potential).toBe("high");
    expect(many.potential).toBe("low");
  });
});

describe("what a bundle is worth", () => {
  const data = input([
    product("a", 1, 100_000, [current("alpha", 1), option("big", { unitCost: 0.9 })]),
    product("b", 2, 30_000, [current("alpha", 2), option("big", { unitCost: 1.8 })]),
    product("c", 1, 30_000, [current("beta", 1), option("big", { unitCost: 1.1 })]),
    product("d", 1, 50_000, [current("beta", 1), candidate("big", { stage: "plausible" })]),
  ]);
  const p = sourcingMix(data);

  test("line by line, with the product that would cost more", () => {
    const big = p.bundles.find((b) => b.key === "big")!;
    expect(big.lines.map((l) => [l.productId, l.difference && Math.round(l.difference)])).toEqual([
      ["a", 10_000],
      ["b", 6_000],
      ["d", null],
      ["c", -3_000],
    ]);
    expect(big.value).toMatchObject({ priced: 3, of: 4 });
    expect(big.value!.amount).toBeCloseTo(13_000);
    expect(big.products).toBe(4);
    expect(big.spendShare).toBe(1);
  });

  test("the current supplier sees who could take several of its products", () => {
    const alpha = p.bySupplier.find((s) => s.key === "alpha")!;
    expect(alpha.alternatives).toEqual([expect.objectContaining({ key: "big", products: 2, priced: true })]);
    expect(alpha.note).toMatch(/credible alternative bundle/);
  });

  test("what managing one more supplier costs counts only when the user says it", () => {
    const s = scenario(p, "lowest_cost");
    expect(s.administration).toEqual({ relationships: 0, amount: null });
    const outside = sourcingMix(input(data.products, { alpha: { spend: 50_000, products: 4 } }), { constraints: limits({ adminCost: 1_500 }) });
    expect(scenario(outside, "lowest_cost").administration).toEqual({ relationships: 1, amount: -1_500 });
  });
});

describe("quality, delivery, risk, cash", () => {
  test("quality stays with what is proven and says what is missing", () => {
    const p = sourcingMix(input([product("a", 1, 100_000, [current("alpha", 1), option("cheap", { unitCost: 0.95 })])]));
    const q = scenario(p, "quality");
    expect(q.status).toBe("not_enough_data");
    expect(supplierOf(q, "a")).toBe("alpha");
    expect(q.missing.map((m) => m.kind)).toEqual(expect.arrayContaining(["quality_data", "confirm_match"]));
    expect(q.quality.status).toBe("insufficient");
  });

  test("delivery picks the faster supplier and shows what it costs", () => {
    const data = input([product("a", 1, 100_000, [current("alpha", 1, { leadTimeDays: 11 }), option("fast", { unitCost: 1.04, leadTimeDays: 5 }), option("unknown", { unitCost: 0.99 })])]);
    const p = sourcingMix(data);
    const d = scenario(p, "delivery");
    expect(supplierOf(d, "a")).toBe("fast");
    expect(d.measures.lead.days).toBe(5);
    expect(d.gains.join(" ")).toMatch(/5 days instead of 11 days/);
    expect(d.tradeoffs.join(" ")).toMatch(/above today's cost/);
    expect(d.benefit.total).toBeCloseTo(-4_000);
    // The lowest-cost mix takes the supplier whose lead time nobody wrote down: it is never called faster.
    expect(supplierOf(scenario(p, "lowest_cost"), "a")).toBe("unknown");
  });

  test("risk shares a heavy product between two suppliers rather than moving it", () => {
    const data = input([product("a", 1, 900_000, [current("alpha", 1), option("second", { unitCost: 1.01, qualification: "confirmed" })]), product("b", 1, 100_000, [current("alpha", 1)])]);
    const p = sourcingMix(data);
    const r = scenario(p, "risk");
    expect(supplierOf(r, "a")).toBe("alpha+second");
    expect(r.allocation[0]).toMatchObject({ decision: "dual_source" });
    expect(r.allocation[0].parts.map((x) => x.share)).toEqual([0.7, 0.3]);
    expect(r.measures.risk.score).toBeLessThan(p.today.measures.risk.score);
    expect(r.gains.join(" ")).toMatch(/second source for 1 product/);
    expect(p.today.measures.topShare).toBe(1);
  });

  test("cash flow prefers the later payment to the lower price", () => {
    const data = input([product("a", 1, 365_000, [current("alpha", 1, { paymentDays: 30 }), option("advance", { unitCost: 0.945, paymentDays: 0, moq: 60_000 }), option("ninety", { unitCost: 0.96, paymentDays: 90 })], { typicalOrder: 20_000 })]);
    const p = sourcingMix(data);
    expect(supplierOf(scenario(p, "lowest_cost"), "a")).toBe("advance");
    const c = scenario(p, "cash_flow");
    expect(supplierOf(c, "a")).toBe("ninety");
    expect(c.cash).toBeCloseTo(0.96 * 1_000 * 60);
    expect(scenario(p, "lowest_cost").cash).toBeLessThan(0);
    expect(scenario(p, "lowest_cost").tradeoffs.join(" ")).toMatch(/more tied up/);
  });
});

describe("limits the user sets", () => {
  const data = input([
    product("a", 1, 600_000, [current("alpha", 1, { leadTimeDays: 20 }), option("abroad", { unitCost: 0.9, region: "asia", country: "China", leadTimeDays: 45 }), option("near", { unitCost: 0.95, region: "eu", country: "Germany", leadTimeDays: 10, qualification: "confirmed" })], { criticality: "high" }),
    product("b", 1, 400_000, [current("alpha", 1), option("near", { unitCost: 0.97, region: "eu", country: "Germany", qualification: "confirmed" })]),
  ]);
  const lowest = (c: Partial<Constraints>) => scenario(sourcingMix(data, { constraints: limits(c) }), "lowest_cost");

  test("region, excluded suppliers, lead time and products to keep", () => {
    expect(supplierOf(lowest({}), "a")).toBe("abroad");
    expect(supplierOf(lowest({ region: "eu" }), "a")).toBe("near");
    expect(supplierOf(lowest({ region: "home" }), "a")).toBe("alpha");
    expect(supplierOf(lowest({ exclude: ["abroad"] }), "a")).toBe("near");
    expect(supplierOf(lowest({ maxLeadDays: 15 }), "a")).toBe("near");
    expect(supplierOf(lowest({ keep: ["a"] }), "a")).toBe("alpha");
    expect(lowest({ keep: ["a"] }).allocation[0].reason).toMatch(/you chose to keep/);
    expect(supplierOf(lowest({ confirmedOnly: true }), "a")).toBe("near");
  });

  test("a ceiling on one supplier's share, and on the number of suppliers", () => {
    const capped = lowest({ maxShare: 0.6 });
    expect(capped.measures.topShare).toBeLessThanOrEqual(0.6);
    expect(capped.unmet).toEqual([]);
    const one = lowest({ maxSuppliers: 1 });
    expect(one.measures.suppliers).toHaveLength(1);
  });

  test("a limit nothing on file can respect is said, not hidden", () => {
    const stuck = sourcingMix(input([product("a", 1, 100_000, [current("alpha", 1)]), product("b", 1, 10_000, [current("beta", 1)])]), { constraints: limits({ maxShare: 0.4, exclude: ["beta"] }) });
    const s = scenario(stuck, "lowest_cost");
    expect(s.unmet.join(" ")).toMatch(/above your limit of 40%/);
    expect(s.unmet.join(" ")).toMatch(/is excluded, but no other supplier has a price/);
  });

  test("a critical product gets a second supplier when one is on file", () => {
    const s = lowest({ criticalSources: 2 });
    expect(s.allocation[0].parts).toHaveLength(2);
    expect(s.unmet).toEqual([]);
  });
});

describe("the suggested mix", () => {
  const data = input([
    product("a", 1, 500_000, [current("alpha", 1), option("x", { unitCost: 0.94, qualification: "confirmed", level: "validated" })]),
    product("b", 1, 300_000, [current("beta", 1), option("y", { unitCost: 0.999, qualification: "possible" })]),
    product("c", 1, 200_000, [current("beta", 1)]),
  ]);
  const p = sourcingMix(data);

  test("is the balanced one, with the reason in figures", () => {
    expect(p.suggested?.objective).toBe("balanced");
    expect(p.suggested!.why).toMatch(/It captures \d+% of the largest advantage/);
    expect(p.suggested!.why).toMatch(/The largest holds \d+% of this spend/);
    // The balanced mix leaves a 0.1% difference alone: not worth a supplier never bought from.
    expect(supplierOf(scenario(p, "balanced"), "b")).toBe("beta");
    expect(supplierOf(scenario(p, "lowest_cost"), "b")).toBe("y");
    expect(scenario(p, "balanced").tradeoffs.join(" ")).toMatch(/less than the lowest-cost mix/);
  });

  test("every objective is worked out, and the custom one only with weights", () => {
    expect(p.scenarios.map((s) => s.objective)).toEqual(OBJECTIVES.filter((o) => o !== "custom"));
    const withCustom = sourcingMix(data, { custom: normalizeWeights({ cost: 35, quality: 20, delivery: 15, risk: 10, coverage: 10, payment: 5, leverage: 5 }) });
    expect(scenario(withCustom, "custom").weights).toEqual(defaultWeights("balanced"));
    expect(normalizeWeights({})).toEqual(defaultWeights("balanced"));
  });

  test("the weights of every objective sum to one", () => {
    for (const w of Object.values(PORTFOLIO_CONFIG.weights)) expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  test("the words stay strict: nothing is a saving, nobody is the best supplier", () => {
    const text = JSON.stringify(p);
    expect(text).not.toMatch(/best supplier|cheapest supplier|winner|saving realised|realized saving|you save|will save/i);
    expect(text).toMatch(/not a saving/);
  });
});

describe("many products", () => {
  test("the search goes product by product and still finds a bundle that moves together", () => {
    const products = Array.from({ length: 18 }, (_, i) =>
      product(`p${i}`, 1, 10_000, [current(i % 2 ? "alpha" : "beta", 1), option("big", { unitCost: 0.999, qualification: "confirmed", level: "validated" }), option(`solo${i}`, { unitCost: i === 0 ? 0.9 : 1.02, qualification: "confirmed", level: "validated" })]),
    );
    const p = sourcingMix(input(products));
    const fewer = scenario(p, "fewer_suppliers");
    expect(fewer.measures.suppliers.map((s) => s.key)).toEqual(["big"]);
    const lowest = scenario(p, "lowest_cost");
    expect(supplierOf(lowest, "p0")).toBe("solo0");
    expect(lowest.measures.suppliers.map((s) => s.key).sort()).toEqual(["big", "solo0"]);
  });
});
