/**
 * Negotiation intelligence: for one product and one buyer, the price that
 * could realistically be negotiated — a range, a suggested target inside it,
 * how sure that is, and why.
 *
 * It is an estimate, and says so. It is not a market price, not a quote and
 * not a saving. It is built in three steps, each one explainable:
 *
 *  1. The buyer's negotiation power — six scores from what is on file about
 *     this buyer and this product (its own leverage: volume, order size and
 *     the whole relationship with the supplier; the alternatives; how
 *     standard the product is; how much price evidence exists; how hard
 *     switching is; which terms can be traded), weighted by the kind of
 *     product. Leverage is never turned into a discount by itself.
 *  2. The range — anchored on price evidence, never on a percentage of the
 *     current price. Real comparable offers set both ends. Without them the
 *     low end is how far the published references could carry this buyer
 *     (each counted for a part of its distance, by how comparable it is and
 *     how strong the buyer is), and the cautious end is today's price plus
 *     the rise the buyer's own invoices show is possible.
 *  3. The target — a point inside the range, further down the stronger the
 *     buyer and the firmer the evidence. Never the lowest end by default.
 *
 * With no price evidence able to stand on its own there is no range: "not
 * enough data", and what to get. Nothing is filled in, and the same product
 * gives a different answer to a different buyer.
 *
 * Pure: no database, no UI. The rules read fields every product has; nothing
 * here knows an industry.
 */
import { daysBetween } from "../analytics";
import * as f from "../format";
import { en, list, type Msg, type T } from "../i18n";
import type { ProductClass } from "../research/strategy";
import type { Comparability, Confidence } from "../sourcing/types";
import { DIMENSION_KEYS, NEGOTIATION_CONFIG, profileOf, type AnchorKind, type DimensionKey, type NegotiationConfig, type NegotiationProfile } from "./config";
import type { PriceDataClass } from "./data-class";
import { relationshipLeverage, type RelationshipFacts, type RelationshipLeverage } from "./relationship";

export type InputStatus = "confirmed" | "estimated" | "missing";

export type Level = "low" | "medium" | "high";
export const LEVELS: Level[] = ["low", "medium", "high"];
export const isLevel = (v: unknown): v is Level => v === "low" || v === "medium" || v === "high";
export const LEVEL_LABEL: Record<Level, Msg> = { low: "Low|level", medium: "Medium|level", high: "High|level" };

export type Strength = "low" | "medium" | "high" | "very_high";
export const STRENGTH_LABEL: Record<Strength, Msg> = { low: "Low|level", medium: "Medium|level", high: "High|level", very_high: "Very high|level" };

export const DIMENSION_LABEL: Record<DimensionKey, Msg> = {
  buyer: "Buyer leverage",
  competition: "Supplier competition",
  substitutability: "Product substitutability",
  evidence: "Market evidence",
  switching: "Switching feasibility",
  commercial: "Commercial flexibility",
};

/** What the software can only estimate and a person knows better: each can be corrected, with the reason. */
export const JUDGEMENT_KEYS = ["switching_difficulty", "standardization", "criticality", "buyer_importance"] as const;
export type JudgementKey = (typeof JUDGEMENT_KEYS)[number];
export const isJudgementKey = (v: unknown): v is JudgementKey => typeof v === "string" && (JUDGEMENT_KEYS as readonly string[]).includes(v);
export const JUDGEMENT_LABEL: Record<JudgementKey, { label: Msg; question: Msg }> = {
  switching_difficulty: { label: "Switching difficulty", question: "How hard would it be to buy this from another supplier (tests, approvals, tooling, contracts)?" },
  standardization: { label: "Product standardization", question: "How standard is it: can other suppliers sell the very same product?" },
  criticality: { label: "Product criticality", question: "How much does your production depend on this product arriving exactly as it is today?" },
  buyer_importance: { label: "Your importance to the supplier", question: "How much do you matter to this supplier as a customer, for what you know of its size and of your share of its sales?" },
};

export interface Judgement {
  key: JudgementKey;
  /** What the rules make of it. Null: nothing on file can tell. */
  system: Level | null;
  systemWhy: string | null;
  user: { level: Level; reason: string | null; date: string } | null;
  /** What the engine uses: the person's word first. */
  effective: Level | null;
}

/** One piece of price evidence, on the buyer's own basis: EUR per product unit. */
export interface Anchor {
  key: string;
  kind: AnchorKind;
  dataClass: PriceDataClass;
  label: string;
  low: number;
  high: number;
  date: string | null;
  source: string | null;
  sourceUrl: string | null;
  comparability: Comparability | null;
  /** Still valid: not expired, not too old. */
  recent: boolean;
  /** true_cost: an offer with its true cost complete. nominal: the quoted price alone, with costs still to add. */
  basis: "true_cost" | "nominal" | "invoice" | "published" | "border";
  /** The user confirmed the product offered is the same specification. */
  technicalConfirmed: boolean;
  warning: string | null;
}

export type AnchorRole = "low_end" | "high_end" | "both_ends" | "supports" | "above" | "not_used";
export const ANCHOR_ROLE_LABEL: Record<AnchorRole, Msg> = {
  low_end: "Sets the low end",
  high_end: "Sets the cautious end",
  both_ends: "Sets both ends",
  supports: "Supports the estimate",
  above: "Above your price",
  not_used: "Not used|evidence",
};

export interface AnchorUse extends Anchor {
  /** The point the engine reads it at: the middle of its range. */
  value: number;
  /** The share of its distance from the current price it is counted for (0–1). */
  weight: number;
  /** How far the current price is from it, in % (positive: the current price is higher). */
  gapPct: number | null;
  role: AnchorRole;
  /** In words: how much it counts, or why it does not. */
  how: string;
}

export interface NegotiationInput {
  unit: string;
  productClass: ProductClass;
  /** The product's kind in the catalogue (packaging, component…). */
  kind: string | null;
  asOf: string;
  current: { price: number; date: string; supplier: string | null } | null;
  volume: {
    annual: number | null;
    annualStatus: InputStatus;
    typicalOrder: number | null;
    /** The usual order in kilograms, for products bought by weight. Null otherwise. */
    typicalOrderKg: number | null;
  };
  /** EUR bought in the last 12 months on file: what a year is worth when no yearly volume is known. */
  spendOnFile: number;
  /** Everything bought from the current supplier, as the invoices show it. Null: no current supplier. */
  relationship: RelationshipFacts | null;
  history: {
    purchases: number;
    /** Suppliers this product was really bought from. */
    suppliersUsed: number;
    trend: "increasing" | "stable" | "decreasing" | null;
    /** The highest price paid in the last 12 months, when above today's. */
    recentHigh: { price: number; date: string } | null;
  };
  competition: {
    found: number;
    plausible: number;
    strong: number;
    manufacturers: number;
    countries: number;
    /** Alternatives able to take this product together with others bought from the same supplier: how many, how many products, and their share of the spend with it. */
    bundle?: { suppliers: number; products: number; share: number } | null;
  };
  spec: { readiness: "ready" | "partial" | "not_ready"; technical: boolean; datasheet: boolean };
  /** The terms of the current supply. Null: not on file. */
  terms: { paymentDays: number | null; deliveryBasis: string | null; freightIncluded: boolean | null; moq: number | null; leadTimeDays: number | null };
  anchors: Anchor[];
  /** Movements of raw materials, energy or exchange rates on file for this product, in %. */
  costDrivers: { label: string; changePct: number }[];
  customsCodeConfirmed: boolean;
  judgements: Partial<Record<JudgementKey, { level: Level; reason: string | null; date: string }>>;
}

export interface DimensionScore {
  key: DimensionKey;
  /** 0–10. Internal: it builds the strength, it is not a figure to show on its own. */
  score: number;
  weight: number;
  positives: string[];
  limits: string[];
}

export type ImproveKind = "add_purchase" | "find_suppliers" | "first_quote" | "second_quote" | "complete_true_cost" | "confirm_match" | "describe_product" | "delivery_basis" | "payment_terms" | "confirm_volume" | "customs_code" | "your_knowledge";
export interface Improvement {
  kind: ImproveKind;
  label: string;
}

export type NegotiationStatus = "range" | "no_upside" | "not_enough_data";

export interface Negotiation {
  status: NegotiationStatus;
  unit: string;
  /** The current price, at the precision of the estimate. */
  current: number | null;
  /** The precision the estimate is given at: three significant figures of the current price. */
  step: number;
  range: { low: number; high: number } | null;
  target: number | null;
  /** What reaching the target would be worth. Theoretical: an estimate, never a saving. */
  upside: { perUnit: number; pct: number; annual: number | null; volume: number | null; volumeStatus: InputStatus } | null;
  confidence: Confidence | null;
  confidenceWhy: string | null;
  /** The buyer's negotiation power, in words and as the 0–10 figure behind them. */
  strength: Strength;
  strengthScore: number;
  profile: NegotiationProfile;
  dimensions: DimensionScore[];
  /** What the power mostly rests on: the first reasons of each score, the heaviest first. */
  drivers: string[];
  /** What the whole relationship with the supplier weighs, read apart. Null: no current supplier. */
  relationship: (RelationshipLeverage & { effect: { buyerWith: number; buyerAlone: number; power: number } }) | null;
  positives: string[];
  limits: string[];
  anchors: AnchorUse[];
  /** How the range and the target were built, in plain sentences. */
  how: string[];
  judgements: Record<JudgementKey, Judgement>;
  improve: Improvement[];
  warnings: string[];
  /** Why there is no range, when there is none. */
  reason: string | null;
}

const clamp = (n: number, lo = 0, hi = 10) => Math.min(hi, Math.max(lo, n));
const NOTCH: Record<Level, number> = { low: 0, medium: 1, high: 2 };
const shift = (level: Level, by: number): Level => LEVELS[clamp(NOTCH[level] + by, 0, 2)];
const LEVEL_SCORE_UP: Record<Level, number> = { high: 9, medium: 6, low: 3 };
const LEVEL_SCORE_DOWN: Record<Level, number> = { low: 9, medium: 6, high: 3 };
const isReal = (a: Anchor) => a.kind === "quote" || a.kind === "other_supplier";
const mid = (a: Anchor) => (a.low + a.high) / 2;
const strengthOf = (score: number, cfg: NegotiationConfig): Strength => (score >= cfg.strength.veryHigh ? "very_high" : score >= cfg.strength.high ? "high" : score >= cfg.strength.medium ? "medium" : "low");

/** Three significant figures of the price: €1,48 is given to the cent, €0,0752 to the hundredth of a cent. Never more than the data carries. */
export function precisionOf(price: number): number {
  if (!(price > 0)) return 0.01;
  return 10 ** (Math.floor(Math.log10(price)) - 2);
}
/** A figure at the precision of the estimate: what is shown never carries more digits than that. */
export const roundTo = (n: number, step: number) => Number((Math.round(n / step) * step).toFixed(Math.max(0, -Math.floor(Math.log10(step)))));

/** How much a weight is, in words: the user reads why, not a coefficient. */
function weightWords(w: number, t: T): string {
  return w >= 0.95 ? t("Counted in full: a price on the table.") : w >= 0.75 ? t("Counted for most of its distance.") : w >= 0.45 ? t("Counted for about half of its distance.") : w >= 0.25 ? t("Counted for a part of its distance.") : t("Counted for little: indirect evidence.");
}

export function negotiate(input: NegotiationInput, t: T = en, cfg: NegotiationConfig = NEGOTIATION_CONFIG): Negotiation {
  const profile = profileOf(input.productClass, input.kind);
  const P = input.current?.price ?? null;
  const supplier = input.current?.supplier ?? null;
  const step = precisionOf(P ?? 1);
  const money = (n: number) => `${f.price(roundTo(n, step))}/${input.unit}`;

  // ---------------- What only a person knows better ----------------
  const said = input.judgements;
  const judgement = (key: JudgementKey, system: Level | null, systemWhy: string | null): Judgement => ({ key, system, systemWhy, user: said[key] ?? null, effective: said[key]?.level ?? system });
  const cls = input.productClass;
  const standardization = judgement(
    "standardization",
    cls === "commodity" ? "high" : cls === "custom" || cls === "private_label" ? "low" : "medium",
    cls === "commodity"
      ? t("A raw material or commodity: many suppliers sell the same thing.")
      : cls === "private_label"
        ? t("Its name carries your company's name: it is made for you.")
        : cls === "custom"
          ? t("Identified by a supplier's article code, with no measurable specification in its name.")
          : t("A standard product, with a specification to match."),
  );
  const criticality = judgement("criticality", null, null);
  let systemSwitching: Level = cls === "commodity" ? "low" : cls === "custom" || cls === "private_label" ? "high" : "medium";
  const switchingWhy = [cls === "commodity" ? t("A commodity: suppliers are interchangeable once the grade is matched.") : cls === "custom" || cls === "private_label" ? t("Made to your specification: a new supplier has to be qualified.") : t("A standard product: a new supplier needs a check of the specification.")];
  if (input.history.suppliersUsed >= 2) {
    systemSwitching = shift(systemSwitching, -1);
    switchingWhy.push(t("You already buy it from more than one supplier."));
  }
  if (criticality.effective === "high") {
    systemSwitching = shift(systemSwitching, 1);
    switchingWhy.push(t("You said the product is critical."));
  }
  const switching = judgement("switching_difficulty", systemSwitching, switchingWhy.join(" "));
  // Nothing on file says how much the buyer matters to the supplier: only a person can.
  const importance = judgement("buyer_importance", null, null);
  const judgements = { switching_difficulty: switching, standardization, criticality, buyer_importance: importance };
  const yours = (j: Judgement) => (j.user ? (j.user.reason ? ` ${t("Your judgement: {reason}", { reason: j.user.reason })}` : ` ${t("Your judgement.")}`) : "");

  // ---------------- 1. The evidence that can be used ----------------
  const usable = input.anchors.filter((a) => a.recent && a.comparability !== "not" && a.low > 0 && a.high > 0);
  const real = usable.filter(isReal);
  const complete = real.filter((a) => a.basis !== "nominal");
  const nominal = real.filter((a) => a.basis === "nominal");
  const indirect = usable.filter((a) => !isReal(a));
  const w = cfg.anchorWeight;
  const weightOf = (a: Anchor): number => {
    const partial = a.comparability === "partial" ? cfg.partialFactor : 1;
    switch (a.kind) {
      case "quote":
        return (a.basis === "nominal" ? w.quoteNominal : a.technicalConfirmed ? w.quoteConfirmed : w.quoteTrueCost) * partial;
      case "other_supplier":
        return w.otherSupplier * partial;
      case "published_price":
        return a.comparability === "comparable" ? w.publishedComparable : w.publishedPartial;
      case "benchmark":
        return a.comparability === "comparable" ? w.benchmarkComparable : w.benchmarkPartial;
      case "trade":
        return input.customsCodeConfirmed ? w.tradeConfirmedCode : w.tradeSuggestedCode;
      case "estimate":
        return w.estimate;
      case "own_history":
        return a.date && daysBetween(a.date, input.asOf) <= cfg.recentHistoryMonths * 30.44 ? w.historyRecent : w.historyOlder;
    }
  };
  /** Evidence a range can rest on by itself. Border averages under an unconfirmed code and system estimates only support. */
  const standsAlone = (a: Anchor) => (a.kind === "trade" ? input.customsCodeConfirmed : a.kind !== "estimate");

  // ---------------- 2. The buyer's negotiation power ----------------
  const dims: DimensionScore[] = [];
  const add = (key: DimensionKey, score: number, positives: string[], limits: string[]) => dims.push({ key, score: clamp(score), weight: cfg.weights[profile][key], positives, limits });

  // Buyer leverage: what a year of this product is worth, how it is ordered, and what the whole relationship with the
  // supplier adds. The product's own spend is counted once, as its volume: the relationship adds only what lies beyond it.
  const rel = input.relationship ? relationshipLeverage(input.relationship, { supplier, importance: importance.effective }, t, cfg) : null;
  let relationship: Negotiation["relationship"] = null;
  {
    const pos: string[] = [];
    const neg: string[] = [];
    const parts: [score: number, weight: number][] = [];
    const yearly = P != null && input.volume.annual != null ? P * input.volume.annual : input.spendOnFile > 0 ? input.spendOnFile : null;
    if (yearly != null) {
      parts.push([cfg.spendSteps.find(([min]) => yearly >= min)?.[1] ?? cfg.smallSpendScore, cfg.buyerParts.volume]);
      const amount = f.moneyApprox(yearly);
      if (yearly >= cfg.largeSpend) pos.push(input.volume.annual != null && input.volume.annualStatus === "estimated" ? t("High purchase volume: about {amount} a year, estimated from the purchases on file.", { amount }) : t("High purchase volume: about {amount} a year.", { amount }));
      else if (yearly < cfg.smallSpend) neg.push(t("Small purchase volume: about {amount} a year gives little weight with a supplier.", { amount }));
    }
    const fullLoad = input.volume.typicalOrderKg != null && input.volume.typicalOrderKg / cfg.fullLoadKg >= cfg.fullLoadShare;
    if (input.volume.typicalOrderKg != null && input.volume.typicalOrder != null) {
      const share = input.volume.typicalOrderKg / cfg.fullLoadKg;
      parts.push([fullLoad ? 10 : share >= cfg.fullLoadShare / 2 ? 6 : 4, cfg.buyerParts.orderSize]);
      if (fullLoad) pos.push(t("Full-load orders: a usual order of {quantity}.", { quantity: f.quantity(Math.round(input.volume.typicalOrder), input.unit) }));
    }
    // Order consolidation: frequent orders can be grouped into larger ones; frequent full loads can become a yearly commitment.
    const every = input.relationship?.productEveryDays ?? null;
    const frequent = every != null && every <= cfg.relationship.monthlyDays;
    if (every != null) parts.push([frequent ? (fullLoad ? 6 : 8) : 4, cfg.buyerParts.consolidation]);
    const n = input.history.purchases;
    if (n < cfg.minPurchases) neg.push(t.n(n, "Very little purchase history: {n} purchase on file.", "Very little purchase history: {n} purchases on file."));
    const mean = (xs: [number, number][]) => (xs.length ? xs.reduce((sum, [score, x]) => sum + score * x, 0) / xs.reduce((sum, [, x]) => sum + x, 0) : 5);
    const own = parts;
    const buyerWith = mean(rel ? [...own, [rel.added, cfg.buyerParts.relationship]] : own);
    if (rel) {
      // Against the same buyer, had it bought only this product from the supplier.
      const buyerAlone = mean([...own, [rel.alone, cfg.buyerParts.relationship]]);
      relationship = { ...rel, effect: { buyerWith, buyerAlone, power: (buyerWith - buyerAlone) * cfg.weights[profile].buyer } };
      pos.push(...rel.positives.slice(0, 3));
      if (importance.effective == null) neg.push(rel.limits[0]);
    }
    if (frequent) pos.push(fullLoad ? t("Regular full loads, about every {days}: a volume commitment over the year is something to offer.", { days: f.days(every!, t) }) : t("You order about every {days}: fewer, larger orders are something to offer.", { days: f.days(every!, t) }));
    add("buyer", buyerWith, pos, neg);
  }

  // Supplier competition: who else could supply, and whether any of them has been put to the test.
  {
    const { strong, plausible, countries, manufacturers } = input.competition;
    const pos: string[] = [];
    const neg: string[] = [];
    let score = strong >= 5 ? 9 : strong >= 3 ? 8 : strong === 2 ? 6 : strong === 1 ? 4 : plausible >= 2 ? 3 : plausible === 1 ? 2 : 1;
    if (strong >= 2 && countries >= 2) score += 0.5;
    if (strong >= 1 && manufacturers >= 1) score += 0.5;
    // Someone who could take several of the supplier's products at once is a stronger alternative than one product alone.
    const bundle = input.competition.bundle ?? null;
    if (bundle && bundle.suppliers >= 1) score += cfg.alternativeBundleBonus;
    if (real.length >= 2) score = Math.max(score, 9.5);
    else if (real.length === 1) score = Math.max(score, 7.5);
    else score = Math.min(score, cfg.untestedCompetitionCap);
    if (strong >= 2) pos.push(countries >= 2 ? t("{n} credible alternative suppliers identified, in {k} countries.", { n: strong, k: countries }) : t("{n} credible alternative suppliers identified.", { n: strong }));
    else if (strong === 1) neg.push(t("Only one credible alternative supplier identified."));
    else neg.push(plausible > 0 ? t.n(plausible, "No alternative is a strong match yet: {n} plausible candidate on file.", "No alternative is a strong match yet: {n} plausible candidates on file.") : t("No credible alternative supplier identified."));
    if (bundle && bundle.suppliers >= 1)
      pos.push(
        t.n(
          bundle.suppliers,
          "{n} alternative could take over {k} of the products you buy from this supplier together ({pct}% of what you spend with it): a credible alternative bundle weighs more than one product alone.",
          "{n} alternatives could each take over {k} of the products you buy from this supplier together ({pct}% of what you spend with it): a credible alternative bundle weighs more than one product alone.",
          { k: bundle.products, pct: Math.round(bundle.share * 100) },
        ),
      );
    if (real.length >= 2) pos.push(t("{n} real offers or prices from other suppliers on file.", { n: real.length }));
    else if (!real.length && strong >= 1) neg.push(t("None of the alternatives has made an offer yet: the competition is still on paper."));
    add("competition", score, pos, neg);
  }

  // Product substitutability: how standard it is, and whether it can be described to someone else.
  {
    const pos: string[] = [];
    const neg: string[] = [];
    const level = standardization.effective ?? "medium";
    let score = LEVEL_SCORE_UP[level];
    if (level === "high") pos.push(t("Highly standardized product: other suppliers sell the same thing.") + yours(standardization));
    else if (level === "low") neg.push(t("Made to a specification of its own: few suppliers can make the same product.") + yours(standardization));
    if (input.spec.readiness === "not_ready") {
      score -= 2;
      neg.push(t("The product is not described in neutral words yet: another supplier cannot quote it."));
    } else if (!input.spec.technical) {
      score -= 1;
      neg.push(t("No technical specification on file: an alternative offer cannot be checked against it."));
    } else if (input.spec.datasheet) {
      score += 1;
      pos.push(t("Specification and data sheet on file: an alternative can be checked against them."));
    }
    add("substitutability", score, pos, neg);
  }

  // Market evidence: how much is known about prices, real offers first.
  {
    const pos: string[] = [];
    const neg: string[] = [];
    let score = 0;
    if (complete.length >= 2) {
      score = 10;
      pos.push(t("{n} comparable offers on file, on true cost.", { n: complete.length }));
    } else if (complete.length === 1) {
      score = 7;
      neg.push(t("Only one comparable offer on file: a second one would confirm it."));
    } else if (nominal.length) {
      score = 5;
      neg.push(t("The true cost of the offers on file is incomplete: their price is not yet comparable with what you pay."));
    } else if (indirect.length) {
      const base = Math.max(
        ...indirect.map((a) =>
          a.kind === "published_price" || a.kind === "benchmark" ? (a.comparability === "comparable" ? 5 : 4) : a.kind === "own_history" ? 3 : a.kind === "trade" ? (input.customsCodeConfirmed ? 3 : 1) : 1,
        ),
      );
      score = Math.min(cfg.indirectEvidenceCap, base + Math.min(2, new Set(indirect.map((a) => a.kind)).size - 1));
      neg.push(t("No real offer from another supplier on file: the estimate rests on published references."));
    } else neg.push(t("No price evidence on file besides your own invoices."));
    const partial = indirect.find((a) => (a.kind === "benchmark" || a.kind === "published_price") && a.comparability !== "comparable");
    if (partial && !complete.length) neg.push(t("{label} is only partly comparable: its specification and delivery terms are not confirmed.", { label: partial.label }));
    if (indirect.some((a) => a.kind === "trade") && !input.customsCodeConfirmed && !complete.length) neg.push(t("Trade statistics are an average at the border, under a customs code nobody has confirmed yet."));
    add("evidence", score, pos, neg);
  }

  // Switching feasibility: how hard it would be to move, and whether a second source has ever been used.
  {
    const pos: string[] = [];
    const neg: string[] = [];
    const level = switching.effective ?? "medium";
    let score = LEVEL_SCORE_DOWN[level];
    if (level === "low") pos.push(t("Low switching difficulty.") + (switching.user ? yours(switching) : ` ${switching.systemWhy}`));
    else if (level === "high") neg.push(t("High switching difficulty.") + (switching.user ? yours(switching) : ` ${switching.systemWhy}`));
    if (input.history.suppliersUsed >= 2) {
      score += 1;
      pos.push(t("You already buy it from {n} suppliers: a second source exists.", { n: input.history.suppliersUsed }));
    } else if (supplier) {
      score -= 1;
      neg.push(t("Every purchase on file is from {supplier}: no second source has been tried.", { supplier }));
    }
    if (criticality.effective === "high") neg.push(t("A critical product, as you said: changing supplier carries a production risk."));
    add("switching", score, pos, neg);
  }

  // Commercial flexibility: the terms around the price that are known and can be traded.
  {
    const pos: string[] = [];
    const neg: string[] = [];
    const terms = input.terms;
    const unknown = [
      ...(terms.deliveryBasis == null ? [t("delivery terms")] : []),
      ...(terms.freightIncluded == null ? [t("whether freight is included")] : []),
      ...(terms.paymentDays == null ? [t("payment terms")] : []),
      ...(terms.moq == null ? [t("minimum order")] : []),
      ...(terms.leadTimeDays == null ? [t("lead time")] : []),
    ];
    let score = 2 + (5 - unknown.length);
    if (terms.paymentDays != null && terms.paymentDays >= cfg.longPaymentDays) {
      score += 1;
      pos.push(t("You pay at {n} days: paying sooner is something to offer in exchange for a lower price.", { n: terms.paymentDays }));
    }
    if (terms.moq != null && input.volume.typicalOrder != null && input.volume.typicalOrder >= terms.moq * 2) {
      score += 1;
      pos.push(t("Your usual order is well above the minimum order: order size is something to offer."));
    }
    if (unknown.length >= 4) neg.push(t("The terms of your current supply are not on file ({list}): they can neither be traded nor used to compare offers.", { list: list(t, unknown) }));
    else if (terms.deliveryBasis == null || terms.freightIncluded == null) neg.push(t("How your current price is delivered is not on file: offers cannot be put on the same basis."));
    add("commercial", score, pos, neg);
  }

  const dimensions = DIMENSION_KEYS.map((k) => dims.find((d) => d.key === k)!);
  const strengthScore = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  const strength = strengthOf(strengthScore, cfg);
  /** How far a published reference carries this buyer. */
  const leverage = cfg.leverageFloor + (1 - cfg.leverageFloor) * (strengthScore / 10);

  // ---------------- What would make the estimate better ----------------
  const improve: Improvement[] = [];
  const better = (kind: ImproveKind, label: string) => improve.push({ kind, label });
  if (P == null) better("add_purchase", t("Add or import a purchase of this product"));
  if (!real.length && !input.competition.strong && !input.competition.plausible) better("find_suppliers", t("Run a research for alternative suppliers"));
  if (!real.length) better("first_quote", t("Get one comparable quote"));
  else if (real.length === 1) better("second_quote", t("Get a second comparable quote"));
  if (nominal.length) better("complete_true_cost", t("Complete the true cost of {names}: freight, duty and the other costs to your door", { names: list(t, nominal.map((a) => a.label)) }));
  const unconfirmed = complete.filter((a) => a.kind === "quote" && !a.technicalConfirmed);
  if (unconfirmed.length) better("confirm_match", t("Confirm that what {names} offered matches your specification", { names: list(t, unconfirmed.map((a) => a.label)) }));
  if (input.spec.readiness === "not_ready") better("describe_product", t("Describe the product in neutral words, with its technical specification"));
  else if (!input.spec.technical || !input.spec.datasheet) better("describe_product", t("Add the technical specification and the data sheet"));
  if (input.terms.deliveryBasis == null || input.terms.freightIncluded == null) better("delivery_basis", t("Confirm how your current price is delivered: delivery terms, freight included or not"));
  if (input.volume.annual == null) better("confirm_volume", t("Say how much of it you need in a year"));
  else if (input.volume.annualStatus === "estimated") better("confirm_volume", t("Confirm the annual volume: today it is an estimate"));
  if (indirect.some((a) => a.kind === "trade") && !input.customsCodeConfirmed) better("customs_code", t("Confirm the customs code the trade statistics are read under"));
  if (input.terms.paymentDays == null) better("payment_terms", t("Add the payment terms of your current supplier"));
  if (!switching.user && !criticality.user && !importance.user) better("your_knowledge", t("Say how hard switching would be, how critical the product is and how much you matter to the supplier: you know it better than the software"));

  const warnings = [...new Set(input.anchors.filter((a) => a.recent && a.warning).map((a) => a.warning!))];
  const byWeight = [...dimensions].sort((a, b) => b.weight - a.weight);
  const positives = byWeight.flatMap((d) => d.positives);
  // The main drivers: the buyer's own leverage first — volume, order size, the relationship with the supplier — then the
  // first reason of each other score, the heaviest first.
  const own = dimensions.find((d) => d.key === "buyer")!.positives.slice(0, 5);
  const drivers = [...own, ...byWeight.filter((d) => d.key !== "buyer").map((d) => d.positives[0]).filter((x): x is string => !!x)].slice(0, 7);
  const limits = [...dimensions].sort((a, b) => b.weight - a.weight).flatMap((d) => d.limits);

  const describe = (a: Anchor, role: AnchorRole, weight: number): AnchorUse => ({
    ...a,
    value: mid(a),
    weight,
    gapPct: P != null ? ((P - mid(a)) / mid(a)) * 100 : null,
    role,
    how: role === "not_used" ? (!a.recent ? t("Expired or too old to count.") : a.comparability === "not" ? t("Not comparable with what you buy.") : t("No usable price.")) : weightWords(weight, t),
  });
  const base = { unit: input.unit, step, strength, strengthScore, profile, dimensions, drivers, relationship, judgements, improve, warnings };

  // ---------------- 3. The range ----------------
  if (P == null) {
    return { ...base, status: "not_enough_data", current: null, range: null, target: null, upside: null, confidence: null, confidenceWhy: null, positives, limits, anchors: input.anchors.map((a) => describe(a, usable.includes(a) ? "supports" : "not_used", usable.includes(a) ? weightOf(a) : 0)), how: [], reason: t("There is no purchase price on file for this product.") };
  }
  if (!usable.some(standsAlone)) {
    return {
      ...base,
      status: "not_enough_data",
      current: roundTo(P, step),
      range: null,
      target: null,
      upside: null,
      confidence: null,
      confidenceWhy: null,
      positives,
      limits,
      anchors: input.anchors.map((a) => describe(a, usable.includes(a) ? "supports" : "not_used", usable.includes(a) ? weightOf(a) : 0)),
      how: [],
      reason: usable.length ? t("The only price evidence on file is too indirect to stand on its own: a range built on it would be a guess.") : t("There is no price evidence on file besides what you pay today: a range would be a percentage of your own price, not an estimate."),
    };
  }

  const roles = new Map<string, AnchorRole>();
  const how: string[] = [];
  const reachOf = (a: Anchor) => P - weightOf(a) * (isReal(a) ? 1 : leverage) * (P - mid(a));
  const reaching = (xs: Anchor[]) =>
    xs
      .filter((a) => mid(a) < P)
      .map((a) => ({ a, at: reachOf(a) }))
      .sort((x, y) => x.at - y.at);

  // What the buyer's own invoices say about a rise: a share of the highest recent price above today's.
  let share = cfg.upward[input.history.trend ?? "stable"];
  const driver = [...input.costDrivers].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
  if (driver && Math.abs(driver.changePct) >= cfg.driverMovePct) share += driver.changePct > 0 ? cfg.driverShift : -cfg.driverShift;
  const high0 = input.history.recentHigh && input.history.recentHigh.price > P ? input.history.recentHigh : null;
  const rise = high0 ? (high0.price - P) * clamp(share, 0, 1) : 0;

  let low = P;
  let high = P + rise;
  const offers = reaching(complete);
  if (offers.length >= 2) {
    // Real offers on true cost set both ends: the lowest, and the second lowest — a price two suppliers stand behind.
    low = offers[0].at;
    high = offers[1].at;
    roles.set(offers[0].a.key, "low_end");
    roles.set(offers[1].a.key, "high_end");
    how.push(t("Both ends come from real offers on true cost: the low end from {first}, the cautious end from {second} — a price two suppliers stand behind.", { first: offers[0].a.label, second: offers[1].a.label }));
  } else if (offers.length === 1) {
    const { a, at } = offers[0];
    low = at;
    high = P - cfg.singleQuoteShare * (P - at);
    roles.set(a.key, "both_ends");
    how.push(t("The low end is the offer of {supplier} on true cost. The cautious end is halfway between it and what you pay: one offer, until a second one confirms it.", { supplier: a.label }));
    if (!a.technicalConfirmed && a.kind === "quote") how.push(t("The offer is not counted in full: nobody has confirmed yet that the product offered matches your specification."));
  } else if (complete.length) {
    // Real offers on file, none below today's price: published references do not overrule them.
    how.push(t("The real offers on file are not below what you pay: no published reference is set against them."));
  } else {
    // Only evidence able to stand on its own sets an end; the rest supports it.
    const refs = reaching([...nominal, ...indirect.filter(standsAlone)]);
    if (refs.length) {
      const { a, at } = refs[0];
      low = at;
      roles.set(a.key, "low_end");
      how.push(
        isReal(a)
          ? t("The low end comes from the price quoted by {supplier}, counted for half of its distance: its true cost is still incomplete.", { supplier: a.label })
          : t("No real offer is on file, so the low end is an estimate: your price is about {pct}% above {label}, which is counted for a part of that distance — nobody has confirmed it for your specification, quantity and delivery terms. How far it carries depends on your negotiation power ({strength}).", {
              label: a.label,
              pct: Math.round(((P - mid(a)) / mid(a)) * 100),
              strength: t(STRENGTH_LABEL[strength]).toLowerCase(),
            }),
      );
    }
    how.push(
      high0
        ? t("The cautious end is above today's price: you paid {price} on {date}, and without an offer in hand a part of that rise can come back.", { price: money(high0.price), date: f.date(high0.date) })
        : t("The cautious end is what you pay today: nothing on file points to a rise, and no offer in hand moves it lower."),
    );
  }
  for (const a of usable) if (!roles.has(a.key)) roles.set(a.key, mid(a) >= P ? "above" : "supports");
  const anchors = input.anchors
    .map((a) => (usable.includes(a) ? describe(a, roles.get(a.key)!, weightOf(a)) : describe(a, "not_used", 0)))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.weight - a.weight);

  // ---------------- Confidence: how much real evidence stands behind the range ----------------
  const stale = daysBetween(input.current!.date, input.asOf) > cfg.staleCurrentPriceDays;
  const firmRefs = indirect.filter((a) => (a.kind === "benchmark" || a.kind === "published_price") && a.comparability === "comparable").length;
  const kinds = new Set(usable.map((a) => a.kind)).size;
  let confidence: Confidence;
  let confidenceWhy: string;
  if (complete.length >= 2 && input.spec.readiness === "ready" && !stale) {
    confidence = "high";
    confidenceWhy = t("Two or more comparable offers on true cost, a specification ready to send and a recent price paid.");
  } else if (complete.length >= 1) {
    confidence = "medium";
    confidenceWhy = complete.length >= 2 ? (stale ? t("Comparable offers on true cost, but the price you pay is an old one.") : t("Comparable offers on true cost, but the product's specification is not complete yet.")) : t("One comparable offer on true cost: a second one would make the estimate firm.");
  } else if (nominal.length >= 2 || (firmRefs >= 1 && kinds >= 2 && input.spec.readiness === "ready" && input.history.purchases >= cfg.minPurchases && profile !== "custom")) {
    confidence = "medium";
    confidenceWhy = nominal.length >= 2 ? t("Several real offers, with their true cost still to complete.") : t("A comparable published reference, backed by a second source — but no real offer yet.");
  } else {
    confidence = "low";
    confidenceWhy = list(t, [
      ...(real.length ? [t("the offers on file are not yet comparable")] : [t("no real offer on file")]),
      ...(firmRefs ? [] : indirect.length ? [t("the references are only partly comparable")] : []),
      ...(input.spec.readiness !== "ready" ? [t("the specification is incomplete")] : []),
      ...(input.history.purchases < cfg.minPurchases ? [t("little purchase history")] : []),
      ...(profile === "custom" ? [t("a product made to your own specification")] : []),
    ]);
    confidenceWhy = t("Low because: {reasons}.", { reasons: confidenceWhy });
  }

  // ---------------- The target: inside the range, never its lowest end by default ----------------
  const current = roundTo(P, step);
  const lowR = Math.min(current, roundTo(low, step));
  const highR = Math.max(lowR, roundTo(high, step));
  const from = Math.min(high, P);
  const position = (cfg.target.base + cfg.target.span * (strengthScore / 10)) * (confidence === "high" ? 1 : confidence === "medium" ? cfg.target.mediumConfidence : cfg.target.lowConfidence);
  const target = clamp(roundTo(from - position * (from - low), step), lowR, Math.min(highR, current));
  const anyBelow = usable.some((a) => mid(a) < P);

  if (lowR >= current || target >= current) {
    const above = usable.filter((a) => mid(a) >= P);
    return {
      ...base,
      status: "no_upside",
      current,
      range: { low: current, high: highR },
      target: current,
      upside: null,
      confidence,
      confidenceWhy,
      positives,
      limits,
      anchors,
      how: [
        above.length && !anyBelow ? t("Every reference on file is at or above what you pay: the aim is to hold the price, not to lower it.") : t("What the evidence on file supports is smaller than the precision of your price: no room worth a negotiation is estimated."),
        ...(high0 && highR > current ? [t("The cautious end is above today's price: you paid {price} on {date}.", { price: money(high0.price), date: f.date(high0.date) })] : []),
      ],
      reason: null,
    };
  }

  how.push(
    t("The suggested target is not the lowest end: it sits where a buyer with {strength} negotiation power can realistically arrive, held to the confidence of the evidence ({confidence}).", {
      strength: t(STRENGTH_LABEL[strength]).toLowerCase(),
      confidence: t(LEVEL_LABEL[confidence]).toLowerCase(),
    }),
  );
  const perUnit = roundTo(current - target, step);
  // Each reference below the price is a reason to negotiate, named for what it is.
  const below = anchors.filter((a) => a.role !== "not_used" && a.role !== "above" && a.gapPct != null && a.gapPct >= 0.5);
  const priceReasons = below.slice(0, 3).map((a) => {
    const params = { pct: Math.round(a.gapPct!), label: a.label };
    return a.kind === "quote" ? t("Your price is about {pct}% above the offer of {label}.", params) : a.kind === "other_supplier" ? t("Your price is about {pct}% above what you paid {label}.", params) : t("Your price is about {pct}% above {label}.", params);
  });
  return {
    ...base,
    status: "range",
    current,
    range: { low: lowR, high: highR },
    target,
    upside: { perUnit, pct: (perUnit / current) * 100, annual: input.volume.annual != null ? perUnit * input.volume.annual : null, volume: input.volume.annual, volumeStatus: input.volume.annualStatus },
    confidence,
    confidenceWhy,
    positives: [...priceReasons, ...positives],
    limits,
    anchors,
    how,
    reason: null,
  };
}

const ROLE_ORDER: AnchorRole[] = ["both_ends", "low_end", "high_end", "supports", "above", "not_used"];

/** The same price evidence, by what it is called on screen. */
export const ANCHOR_KIND_LABEL: Record<AnchorKind, Msg> = {
  quote: "Real quote",
  other_supplier: "Price paid to another supplier",
  published_price: "Supplier-published price",
  benchmark: "Published benchmark",
  trade: "Trade benchmark",
  estimate: "Model estimate",
  own_history: "Your own purchase history",
};
