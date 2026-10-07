/**
 * The negotiation engine on generic cases: a product bought by weight, a
 * custom part, a few offers and references. Nothing here is a real company
 * or a real price — the suppliers are called "Supplier A" and "Supplier B".
 */
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { NEGOTIATION_CONFIG, profileOf } from "./config";
import { DATA_CLASS, PRICE_DATA_CLASSES, dataClassOf, derivedVisibility, publicOnly } from "./data-class";
import { negotiate, precisionOf, type Anchor, type NegotiationInput } from "./engine";
import { estimateRecord, publicView, signatureOf } from "./history";
import { relationshipFacts, relationshipLeverage, type RelationshipFacts } from "./relationship";

const AS_OF = "2026-10-01";

const anchor = (over: Partial<Anchor> & Pick<Anchor, "key" | "kind" | "low">): Anchor => ({
  dataClass: over.kind === "quote" ? "real_quote" : over.kind === "trade" ? "trade_benchmark" : over.kind === "own_history" || over.kind === "other_supplier" ? "private_purchase_price" : over.kind === "published_price" ? "supplier_published_price" : "anonymized_benchmark",
  label: over.key,
  high: over.low,
  date: "2026-09-15",
  source: null,
  sourceUrl: null,
  comparability: "comparable",
  recent: true,
  basis: over.kind === "quote" ? "true_cost" : over.kind === "trade" ? "border" : "published",
  technicalConfirmed: false,
  warning: null,
  ...over,
});
const quote = (name: string, price: number, over: Partial<Anchor> = {}) => anchor({ key: `quote:${name}`, kind: "quote", label: name, low: price, ...over });
const benchmark = (price: number, over: Partial<Anchor> = {}) => anchor({ key: "benchmark:1", kind: "benchmark", label: "Published index", low: price, comparability: "partial", ...over });
const trade = (low: number, high: number) => anchor({ key: "trade:1", kind: "trade", label: "Customs code average", low, high, comparability: "partial" });

/** What the invoices say of a supplier the company buys one product from, every month, for over a year. */
const relation = (over: Partial<RelationshipFacts> = {}): RelationshipFacts => ({
  supplierId: "s1",
  supplierSpend: 450_000,
  productSpend: 450_000,
  annualFactor: 1,
  historyMonths: 14,
  products: 1,
  groups: [{ name: "direct_material", label: "Direct materials" }],
  groupsAreCategories: false,
  purchaseDates: 10,
  everyDays: 36,
  firstPurchase: "2025-08-01",
  monthsWithSupplier: 14,
  supplierShare: 0.6,
  productDates: 10,
  productEveryDays: 36,
  ...over,
});

/** A material bought by weight in full loads from one supplier, with a few alternatives identified. */
const input = (over: Partial<NegotiationInput> = {}): NegotiationInput => ({
  unit: "kg",
  productClass: "commodity",
  kind: "direct_material",
  asOf: AS_OF,
  current: { price: 1.5, date: "2026-09-20", supplier: "Current Supplier" },
  volume: { annual: 300_000, annualStatus: "confirmed", typicalOrder: 24_000, typicalOrderKg: 24_000 },
  spendOnFile: 450_000,
  relationship: relation(),
  history: { purchases: 10, suppliersUsed: 1, trend: "stable", recentHigh: null },
  competition: { found: 6, plausible: 5, strong: 4, manufacturers: 3, countries: 3 },
  spec: { readiness: "ready", technical: true, datasheet: true },
  terms: { paymentDays: 60, deliveryBasis: "DAP", freightIncluded: true, moq: null, leadTimeDays: null },
  anchors: [],
  costDrivers: [],
  customsCodeConfirmed: false,
  judgements: {},
  ...over,
});
const onStep = (n: number, step: number) => Math.abs(n / step - Math.round(n / step)) < 1e-6;

describe("when there is not enough to estimate", () => {
  it("gives no range without a price paid", () => {
    const n = negotiate(input({ current: null, anchors: [benchmark(1.4)] }));
    expect(n).toMatchObject({ status: "not_enough_data", range: null, target: null, upside: null, confidence: null });
    expect(n.improve[0].kind).toBe("add_purchase");
  });

  it("gives no range from the buyer's own price alone — and says what to get", () => {
    const n = negotiate(input());
    expect(n).toMatchObject({ status: "not_enough_data", range: null, target: null, upside: null, current: 1.5 });
    expect(n.reason).toMatch(/percentage of your own price/);
    expect(n.improve.map((x) => x.kind)).toContain("first_quote");
    // Strength is still read from what is on file — it is not a price — and knowing nothing of the market holds it down.
    expect(n.strength).toBe("medium");
    expect(negotiate(input({ anchors: [benchmark(1.4)] })).strength).toBe("high");
  });

  it("does not stand a range on border averages under a customs code nobody confirmed", () => {
    expect(negotiate(input({ anchors: [trade(1.2, 1.3)] })).status).toBe("not_enough_data");
    const confirmed = negotiate(input({ anchors: [trade(1.2, 1.3)], customsCodeConfirmed: true }));
    expect(confirmed).toMatchObject({ status: "range", confidence: "low" });
  });

  it("leaves out what is expired or not comparable", () => {
    const n = negotiate(input({ anchors: [quote("Supplier A", 1.3, { recent: false }), benchmark(1.2, { comparability: "not" })] }));
    expect(n.status).toBe("not_enough_data");
    expect(n.anchors.map((a) => a.role)).toEqual(["not_used", "not_used"]);
  });
});

describe("a range from published references", () => {
  const n = negotiate(input({ anchors: [benchmark(1.4), trade(1.2, 1.3)] }));

  it("is anchored on the evidence, not on a percentage of the price", () => {
    expect(n.status).toBe("range");
    // The reference is 6.7% below: only a part of that distance is taken.
    expect(n.range!.low).toBeGreaterThan(1.4);
    expect(n.range!.low).toBeLessThan(1.5);
    // Nothing on file points to a rise: the cautious end is what is paid today.
    expect(n.range!.high).toBe(1.5);
    expect(n.confidence).toBe("low");
    expect(n.confidenceWhy).toMatch(/no real offer on file/);
  });

  it("puts the target inside the range, never at its lowest end", () => {
    expect(n.target!).toBeGreaterThan(n.range!.low);
    expect(n.target!).toBeLessThan(n.current!);
    expect(n.upside!.perUnit).toBeCloseTo(n.current! - n.target!, 6);
    expect(n.upside!.annual).toBeCloseTo(n.upside!.perUnit * 300_000, 2);
  });

  it("moves with the evidence: a reference further away gives a different range for the same price", () => {
    const further = negotiate(input({ anchors: [benchmark(1.3)] }));
    const nearer = negotiate(input({ anchors: [benchmark(1.46)] }));
    expect(further.range!.low).toBeLessThan(nearer.range!.low);
  });

  it("is not symmetric: a rise seen in the buyer's own invoices widens it upwards by a part only", () => {
    const risen = negotiate(input({ anchors: [benchmark(1.4)], history: { purchases: 10, suppliersUsed: 1, trend: "stable", recentHigh: { price: 1.54, date: "2026-06-22" } } }));
    expect(risen.range!.high).toBe(1.52);
    const down = risen.current! - risen.range!.low;
    const up = risen.range!.high - risen.current!;
    expect(down).not.toBeCloseTo(up, 3);
    // A falling price leaves less of that rise in the range than a rising one.
    const falling = negotiate(input({ anchors: [benchmark(1.4)], history: { purchases: 10, suppliersUsed: 1, trend: "decreasing", recentHigh: { price: 1.54, date: "2026-06-22" } } }));
    const rising = negotiate(input({ anchors: [benchmark(1.4)], history: { purchases: 10, suppliersUsed: 1, trend: "increasing", recentHigh: { price: 1.54, date: "2026-06-22" } } }));
    expect(falling.range!.high).toBeLessThan(rising.range!.high);
  });

  it("says why, and what would make it better", () => {
    expect(n.how.join(" ")).toMatch(/No real offer is on file/);
    expect(n.positives.join(" ")).toMatch(/4 credible alternative suppliers/);
    expect(n.limits.join(" ")).toMatch(/only partly comparable/);
    expect(n.improve.map((x) => x.kind)).toEqual(expect.arrayContaining(["first_quote", "customs_code", "your_knowledge"]));
    // The border average under an unconfirmed code supports the estimate; it does not set an end.
    expect(n.anchors.find((a) => a.kind === "benchmark")!.role).toBe("low_end");
    expect(n.anchors.find((a) => a.kind === "trade")!.role).toBe("supports");
  });
});

describe("the same product, another buyer", () => {
  it("gives a small buyer with no alternatives a higher range and target than a large one", () => {
    const anchors = [benchmark(1.38, { comparability: "comparable" })];
    const large = negotiate(input({ anchors }));
    const small = negotiate(
      input({
        anchors,
        volume: { annual: 2_000, annualStatus: "confirmed", typicalOrder: 500, typicalOrderKg: 500 },
        spendOnFile: 3_000,
        history: { purchases: 2, suppliersUsed: 1, trend: null, recentHigh: null },
        competition: { found: 0, plausible: 0, strong: 0, manufacturers: 0, countries: 0 },
        terms: { paymentDays: null, deliveryBasis: null, freightIncluded: null, moq: null, leadTimeDays: null },
      }),
    );
    expect(small.strengthScore).toBeLessThan(large.strengthScore);
    expect(small.range!.low).toBeGreaterThan(large.range!.low);
    expect(small.target!).toBeGreaterThanOrEqual(large.target!);
    expect(small.limits.join(" ")).toMatch(/Small purchase volume/);
  });

  it("weighs a custom part differently from a commodity", () => {
    const same = { anchors: [quote("Supplier A", 1.4)] };
    const commodity = negotiate(input(same));
    const custom = negotiate(input({ ...same, productClass: "custom" }));
    expect(profileOf("custom", "component")).toBe("custom");
    expect(profileOf("standard", "packaging")).toBe("packaging");
    expect(custom.profile).toBe("custom");
    expect(custom.strengthScore).toBeLessThan(commodity.strengthScore);
    expect(custom.judgements.switching_difficulty.system).toBe("high");
    expect(commodity.judgements.switching_difficulty.system).toBe("low");
  });

  it("every set of weights sums to one", () => {
    for (const weights of Object.values(NEGOTIATION_CONFIG.weights)) expect(Object.values(weights).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
  });
});

describe("real offers", () => {
  it("one offer on true cost sets the low end, and moves the cautious end only halfway until a second confirms it", () => {
    const n = negotiate(input({ anchors: [quote("Supplier A", 1.4, { technicalConfirmed: true }), benchmark(1.2)] }));
    expect(n).toMatchObject({ status: "range", confidence: "medium" });
    expect(n.range).toEqual({ low: 1.4, high: 1.45 });
    // The published reference no longer sets anything once a real offer is on file.
    expect(n.anchors.find((a) => a.kind === "benchmark")!.role).toBe("supports");
    expect(n.improve.map((x) => x.kind)).toContain("second_quote");
  });

  it("an offer nobody checked against the specification is not counted in full", () => {
    const n = negotiate(input({ anchors: [quote("Supplier A", 1.4)] }));
    expect(n.range!.low).toBeGreaterThan(1.4);
    expect(n.improve.map((x) => x.kind)).toContain("confirm_match");
  });

  it("two offers set both ends, narrow the range and raise the confidence", () => {
    const before = negotiate(input({ anchors: [benchmark(1.4)], history: { purchases: 10, suppliersUsed: 1, trend: "stable", recentHigh: { price: 1.54, date: "2026-06-22" } } }));
    const after = negotiate(input({ anchors: [benchmark(1.4), quote("Supplier A", 1.44, { technicalConfirmed: true }), quote("Supplier B", 1.46, { technicalConfirmed: true })], history: { purchases: 10, suppliersUsed: 1, trend: "stable", recentHigh: { price: 1.54, date: "2026-06-22" } } }));
    expect(after.range).toEqual({ low: 1.44, high: 1.46 });
    expect(after.confidence).toBe("high");
    expect(after.range!.high - after.range!.low).toBeLessThan(before.range!.high - before.range!.low);
    expect(after.target!).toBeGreaterThan(after.range!.low);
    expect(after.target!).toBeLessThanOrEqual(after.range!.high);
    expect(after.how[0]).toMatch(/Supplier A.*Supplier B/);
  });

  it("without a complete specification two offers are not high confidence", () => {
    const n = negotiate(input({ anchors: [quote("Supplier A", 1.44), quote("Supplier B", 1.46)], spec: { readiness: "partial", technical: false, datasheet: false } }));
    expect(n.confidence).toBe("medium");
  });

  it("prefers true cost: a quoted price with costs still missing counts for half, with a warning", () => {
    const warning = "Supplier A: the true cost is incomplete (a freight estimate).";
    const nominal = negotiate(input({ anchors: [quote("Supplier A", 1.4, { basis: "nominal", warning })] }));
    expect(nominal.range!.low).toBe(1.45);
    expect(nominal.range!.high).toBe(1.5);
    expect(nominal.confidence).toBe("low");
    expect(nominal.warnings).toEqual([warning]);
    expect(nominal.improve.map((x) => x.kind)).toContain("complete_true_cost");
    // Once freight is added the same offer lands at 1.46 on true cost: that is what is used.
    const complete = negotiate(input({ anchors: [quote("Supplier A", 1.46, { technicalConfirmed: true })] }));
    expect(complete.range!.low).toBe(1.46);
  });

  it("does not let a published reference overrule real offers that are above the price", () => {
    const n = negotiate(input({ anchors: [quote("Supplier A", 1.55, { technicalConfirmed: true }), benchmark(1.3)] }));
    expect(n).toMatchObject({ status: "no_upside", target: 1.5, upside: null });
    expect(n.range!.low).toBe(1.5);
  });

  it("holds the price when every reference is above it", () => {
    const n = negotiate(input({ anchors: [benchmark(1.6)] }));
    expect(n).toMatchObject({ status: "no_upside", upside: null });
    expect(n.how[0]).toMatch(/hold the price/);
  });
});

describe("what a person knows better", () => {
  it("a correction replaces the software's estimate, which stays readable", () => {
    const anchors = [benchmark(1.4)];
    const auto = negotiate(input({ anchors }));
    const said = negotiate(input({ anchors, judgements: { switching_difficulty: { level: "high", reason: "Needs a production test", date: "2026-10-01" } } }));
    expect(said.judgements.switching_difficulty).toMatchObject({ system: "low", effective: "high", user: { level: "high", reason: "Needs a production test" } });
    expect(said.strengthScore).toBeLessThan(auto.strengthScore);
    expect(said.limits.join(" ")).toMatch(/Needs a production test/);
    expect(auto.judgements.criticality).toMatchObject({ system: null, effective: null });
  });

  it("a critical product is harder to move", () => {
    const n = negotiate(input({ anchors: [benchmark(1.4)], judgements: { criticality: { level: "high", reason: null, date: "2026-10-01" } } }));
    expect(n.judgements.switching_difficulty.system).toBe("medium");
  });
});

describe("no false precision", () => {
  it("gives the estimate at three significant figures of the price", () => {
    expect(precisionOf(1.48)).toBeCloseTo(0.01, 10);
    expect(precisionOf(0.0752)).toBeCloseTo(0.0001, 10);
    expect(precisionOf(125)).toBe(1);
    const cents = negotiate(input({ anchors: [benchmark(1.3777)] }));
    for (const x of [cents.range!.low, cents.range!.high, cents.target!, cents.upside!.perUnit]) expect(onStep(x, 0.01)).toBe(true);
    const small = negotiate(input({ unit: "pcs", current: { price: 0.0752, date: "2026-09-20", supplier: "Current Supplier" }, volume: { annual: 600_000, annualStatus: "estimated", typicalOrder: 60_000, typicalOrderKg: null }, anchors: [benchmark(0.0688, { comparability: "comparable" })] }));
    for (const x of [small.range!.low, small.range!.high, small.target!]) expect(onStep(x, 0.0001)).toBe(true);
    expect(small.upside!.volumeStatus).toBe("estimated");
  });
});

describe("the relationship with the supplier", () => {
  // A million a year on the product, a hundred thousand more on five other products of three kinds.
  const broad = relation({
    supplierSpend: 1_100_000,
    productSpend: 1_000_000,
    products: 6,
    groups: [
      { name: "Waxes", label: null },
      { name: "Wicks", label: null },
      { name: "Packaging", label: null },
    ],
    groupsAreCategories: true,
    purchaseDates: 24,
    everyDays: 15,
  });
  const single = relation({ supplierSpend: 1_000_000, productSpend: 1_000_000 });
  const about = { supplier: "Current Supplier", importance: null };

  it("never counts spend twice: what the relationship adds is the total minus this product", () => {
    const r = relationshipLeverage(broad, about);
    expect(r.onFile).toEqual({ total: 1_100_000, product: 1_000_000, cross: 100_000 });
    expect(r.yearly).toEqual({ total: 1_100_000, product: 1_000_000, cross: 100_000, estimated: false });
    expect(relationshipLeverage(single, about).onFile.cross).toBe(0);
  });

  it("reads breadth, bundle potential and a score — capped while nobody says how much the buyer matters", () => {
    const r = relationshipLeverage(broad, about);
    expect(r).toMatchObject({ breadth: "high", bundle: "high", level: "high", confidence: "medium" });
    expect(Object.fromEntries(r.parts.map((p) => [p.key, p.score]))).toEqual({ total_spend: 9, cross_spend: 6, breadth: 10, regularity: 10, bundle: 8 });
    expect(r.score).toBe(8);
    expect(r.limits.join(" ")).toMatch(/How much you matter to Current Supplier as a customer is not known/);
    expect(r.limits.join(" ")).toMatch(/margins on each product are not known/);
    expect(r.positives.join(" ")).toMatch(/on 5 other products from the same supplier/);
    const alone = relationshipLeverage(single, about);
    expect(alone).toMatchObject({ breadth: "low", bundle: "low" });
    expect(alone.limits.join(" ")).toMatch(/only product you buy from Current Supplier/);
    expect(alone.score).toBeLessThan(r.score);
  });

  it("takes the buyer's word on its importance to the supplier, and says how sure the reading is", () => {
    const unknown = relationshipLeverage(broad, about);
    const important = relationshipLeverage(broad, { ...about, importance: "high" });
    const small = relationshipLeverage(broad, { ...about, importance: "low" });
    expect(important.score).toBeGreaterThan(unknown.score);
    expect(small.score).toBeLessThan(unknown.score);
    expect(important.confidence).toBe("high");
    // Four months of invoices and no word on importance: a reading to take with care.
    expect(relationshipLeverage(relation({ historyMonths: 4.2, annualFactor: 365 / 128 }), about).confidence).toBe("low");
  });

  it("annualizes a short history, and says it is an estimate", () => {
    const r = relationshipLeverage(relation({ supplierSpend: 460_000, productSpend: 400_000, products: 9, historyMonths: 4, annualFactor: 3 }), about);
    expect(r.onFile).toEqual({ total: 460_000, product: 400_000, cross: 60_000 });
    expect(r.yearly).toEqual({ total: 1_380_000, product: 1_200_000, cross: 180_000, estimated: true });
    expect(r.parts[0].fact).toMatch(/estimated from 4 months on file/);
    expect(relationshipLeverage(relation({ annualFactor: null, historyMonths: 1 }), about).yearly).toBeNull();
  });

  it("lifts the buyer's power above that of a buyer of the single product — as leverage, not as a discount", () => {
    const offers = [quote("Supplier A", 1.44, { technicalConfirmed: true }), quote("Supplier B", 1.46, { technicalConfirmed: true })];
    const withMore = negotiate(input({ anchors: offers, relationship: broad }));
    const onlyThis = negotiate(input({ anchors: offers, relationship: single }));
    expect(withMore.strengthScore).toBeGreaterThan(onlyThis.strengthScore);
    expect(withMore.relationship!.effect.power).toBeGreaterThan(0);
    expect(withMore.relationship!.effect.buyerWith).toBeGreaterThan(withMore.relationship!.effect.buyerAlone);
    expect(onlyThis.relationship!.effect.power).toBe(0);
    expect(withMore.drivers.join(" ")).toMatch(/other products from the same supplier/);
    // Real offers set the range: more products bought do not move it by themselves.
    expect(withMore.range).toEqual(onlyThis.range);
    // With published references only, the stronger buyer is carried a little further — never by a fixed discount.
    const refs = [benchmark(1.3)];
    expect(negotiate(input({ anchors: refs, relationship: broad })).range!.low).toBeLessThanOrEqual(negotiate(input({ anchors: refs, relationship: single })).range!.low);
  });

  it("reads the facts from the invoices: products, groups, dates and what lies beyond the product", () => {
    const product = (id: string, category: string | null, kind: string) => ({ id, sku: id, name: id, description: null, category, kind, unit: "kg", technicalSpecifications: null, specs: null, currentSupplierId: null });
    const purchase = (id: string, productId: string, supplierId: string, date: string, total: number) => ({ id, productId, supplierId, date, quantity: 1, unit: "kg", unitPrice: total, currency: "EUR", fxRate: 1, freightCost: 0, otherCosts: 0, totalAmount: total, invoiceReference: null, paymentTermsDays: null, incoterm: null, originalDescription: null, source: "csv", sourceDoc: null, priceReview: null, notes: null });
    const data = {
      products: [product("wax", null, "direct_material"), product("box", null, "packaging"), product("wick", null, "component"), product("glass", null, "component")],
      purchases: [
        purchase("1", "wax", "s1", "2026-06-01", 30_000),
        purchase("2", "wax", "s1", "2026-07-01", 30_000),
        purchase("3", "wax", "s1", "2026-08-01", 30_000),
        purchase("4", "box", "s1", "2026-08-01", 6_000),
        purchase("5", "wick", "s1", "2026-09-01", 4_000),
        purchase("6", "glass", "s2", "2026-09-10", 20_000),
      ],
    };
    const x = relationshipFacts(data, "wax", "s1", AS_OF)!;
    expect(x).toMatchObject({ supplierSpend: 100_000, productSpend: 90_000, products: 3, purchaseDates: 4, productDates: 3, groupsAreCategories: false, firstPurchase: "2026-06-01" });
    expect(x.groups.map((g) => g.name).sort()).toEqual(["component", "direct_material", "packaging"]);
    expect(x.supplierShare).toBeCloseTo(100_000 / 120_000, 6);
    // 102 days of invoices: a year is worked out from them, and said to be an estimate.
    expect(x.annualFactor).toBeCloseTo(365 / 102, 6);
    expect(x.productEveryDays).toBe(31);
    expect(relationshipFacts(data, "wax", null, AS_OF)).toBeNull();
    // With a category on every product, the groups are the company's own categories.
    const placed = relationshipFacts({ ...data, products: data.products.map((p) => ({ ...p, category: p.id === "wax" ? "Waxes" : "Other" })) }, "wax", "s1", AS_OF)!;
    expect(placed).toMatchObject({ groupsAreCategories: true });
    expect(placed.groups.map((g) => g.name).sort()).toEqual(["Other", "Waxes"]);
  });
});

describe("history and what may be shown outside", () => {
  it("keeps a new record only when the visible answer changes, and says what changed", () => {
    const first = negotiate(input({ anchors: [benchmark(1.4)] }));
    const one = estimateRecord(first, null);
    expect(one.snapshot.change.message).toBe("First estimate.");
    expect(signatureOf(negotiate(input({ anchors: [benchmark(1.4)] })))).toBe(one.signature);
    const second = negotiate(input({ anchors: [benchmark(1.4), quote("Supplier A", 1.42, { technicalConfirmed: true })] }));
    const two = estimateRecord(second, one);
    expect(two.signature).not.toBe(one.signature);
    expect(two.snapshot.change).toMatchObject({ msg: "After the quote of {supplier}.", params: { supplier: "Supplier A" } });
    expect(translator("it").any(two.snapshot.change.msg!, two.snapshot.change.params)).toBe("Dopo il preventivo di Supplier A.");
    const corrected = estimateRecord(negotiate(input({ anchors: [benchmark(1.4), quote("Supplier A", 1.42, { technicalConfirmed: true })], judgements: { standardization: { level: "low", reason: null, date: "2026-10-01" } } })), two);
    expect(corrected.snapshot.change.message).toBe("After your correction of a factor.");
  });

  it("classes every price, and never lets a private one out", () => {
    expect(dataClassOf("actual")).toBe("private_purchase_price");
    expect(dataClassOf("quote")).toBe("real_quote");
    expect(dataClassOf("indicative")).toBe("supplier_published_price");
    expect(dataClassOf("trade_benchmark")).toBe("trade_benchmark");
    expect(PRICE_DATA_CLASSES.filter((c) => DATA_CLASS[c].visibility === "public")).toEqual(["supplier_published_price", "anonymized_benchmark", "trade_benchmark"]);
    // An estimate rests on the price paid: it is as private as that.
    expect(derivedVisibility(["anonymized_benchmark", "private_purchase_price"])).toBe("account");
    expect(derivedVisibility(["anonymized_benchmark", "trade_benchmark"])).toBe("public");
    const record = estimateRecord(negotiate(input({ anchors: [benchmark(1.4), quote("Supplier A", 1.42), anchor({ key: "history:1", kind: "own_history", low: 1.46 })] })), null);
    const shown = publicView(record);
    expect(shown.anchors.map((a) => a.kind)).toEqual(["benchmark"]);
    expect(JSON.stringify(shown)).not.toMatch(/Supplier A|1\.42|1\.46|1\.5\b/);
    expect(publicOnly([{ dataClass: "negotiation_target" as const }, { dataClass: "model_estimate" as const }, { dataClass: "realized_price" as const }])).toEqual([]);
  });
});

describe("in Italian", () => {
  it("words the estimate without calling it a saving", () => {
    const n = negotiate(input({ anchors: [benchmark(1.4)] }), translator("it"));
    const text = [...n.how, ...n.positives, ...n.limits, n.confidenceWhy, ...n.improve.map((x) => x.label)].join(" ");
    expect(text).toMatch(/forza negoziale/);
    expect(text.toLowerCase()).not.toMatch(/risparmi/);
  });
});
