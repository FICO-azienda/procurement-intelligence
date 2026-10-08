/**
 * Every assumption of the sourcing mix engine, in one place. Starting
 * assumptions, to be calibrated on real decisions: nothing in the engine or
 * the UI repeats these numbers, and the engine takes a config so a company
 * (or, later, a learned model) can pass its own.
 */
import type { Msg } from "../i18n";

/** What a mix can be optimized for. The order is the order of the cards. */
export const OBJECTIVES = ["lowest_cost", "bundle", "specialists", "total_value", "quality", "delivery", "risk", "cash_flow", "fewer_suppliers", "balanced", "custom"] as const;
export type Objective = (typeof OBJECTIVES)[number];
export const isObjective = (v: unknown): v is Objective => typeof v === "string" && (OBJECTIVES as readonly string[]).includes(v);

/** What a mix is judged on. Each one is read as the advantage over today's mix. */
export const CRITERIA = ["cost", "quality", "delivery", "risk", "coverage", "payment", "leverage"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Weights = Record<Criterion, number>;

export const OBJECTIVE_LABEL: Record<Objective, { label: Msg; question: Msg }> = {
  lowest_cost: { label: "Lowest cost", question: "For each product, the lowest comparable price on file — however many suppliers it takes." },
  bundle: { label: "Best bundle", question: "Suppliers able to take several products together, judged on what the whole bundle is worth." },
  specialists: { label: "Best specialists", question: "For each product, the supplier with the strongest technical match — covering one product is no handicap." },
  total_value: { label: "Total economic value", question: "True cost of every offer, plus what consolidation, leverage and risk add or take away." },
  quality: { label: "Best quality", question: "Technical match and quality evidence first; the price stays visible but does not lead." },
  delivery: { label: "Fastest delivery", question: "The shortest lead times, with what they cost." },
  risk: { label: "Lowest risk", question: "Less dependence on one supplier, a second source where it matters." },
  cash_flow: { label: "Best cash flow", question: "Payment terms and stock: what keeps more money in the company." },
  fewer_suppliers: { label: "Fewer suppliers", question: "As few suppliers as possible, while cost and quality stay within limits." },
  balanced: { label: "Balanced", question: "Cost, quality, delivery, risk, coverage and leverage weighed together." },
  custom: { label: "Custom", question: "Your own weights." },
};

export const CRITERION_LABEL: Record<Criterion, Msg> = {
  cost: "Price / true cost",
  quality: "Quality|criterion",
  delivery: "Delivery|criterion",
  risk: "Risk|criterion",
  coverage: "Supplier coverage",
  payment: "Payment terms",
  leverage: "Negotiation leverage",
};

const zero: Weights = { cost: 0, quality: 0, delivery: 0, risk: 0, coverage: 0, payment: 0, leverage: 0 };

export const PORTFOLIO_CONFIG = {
  /** How many of the largest products a first analysis works on, and the wider round after it. */
  rounds: [5, 18],

  /**
   * How much each criterion weighs, by objective. Each row sums to 1.
   * Coverage and leverage are a bonus next to the cost, never the whole
   * answer: a supplier does not win a product because it covers many.
   * In "total economic value" payment terms and stock are already inside the
   * true cost, so they are not weighed a second time.
   */
  weights: {
    lowest_cost: { ...zero, cost: 1 },
    bundle: { ...zero, cost: 0.5, coverage: 0.3, leverage: 0.2 },
    specialists: { ...zero, cost: 0.5, quality: 0.5 },
    total_value: { ...zero, cost: 0.7, risk: 0.1, coverage: 0.1, leverage: 0.1 },
    quality: { ...zero, quality: 0.7, cost: 0.15, risk: 0.15 },
    delivery: { ...zero, delivery: 0.7, cost: 0.2, risk: 0.1 },
    risk: { ...zero, risk: 0.7, cost: 0.2, quality: 0.1 },
    cash_flow: { ...zero, payment: 0.7, cost: 0.3 },
    fewer_suppliers: { ...zero, coverage: 0.6, cost: 0.3, quality: 0.1 },
    balanced: { cost: 0.35, quality: 0.2, delivery: 0.15, risk: 0.1, coverage: 0.1, payment: 0.05, leverage: 0.05 },
  } satisfies Record<Exclude<Objective, "custom">, Weights>,

  /** The criterion each objective is about: without data on it, the objective has nothing to say. */
  leading: {
    lowest_cost: "cost",
    bundle: "coverage",
    specialists: "quality",
    total_value: "cost",
    quality: "quality",
    delivery: "delivery",
    risk: "risk",
    cash_flow: "payment",
    fewer_suppliers: "coverage",
    balanced: "cost",
    custom: "cost",
  } satisfies Record<Objective, Criterion>,

  /** A yearly cost lower by this % is the full score on cost; a difference of a fraction of a point barely counts. */
  costScalePct: 10,
  /** Paying this many days later (or sooner) on the whole spend is the full score on payment. */
  cashScaleDays: 60,
  /** A mix replaces today's only when its weighted advantage is above this. */
  minAdvantage: 0.0005,
  /** "Fewer suppliers" accepts a yearly cost above today's by at most this %. */
  maxExtraCostPct: 2,

  /** A product shared between two suppliers: the main one keeps this share. */
  dualSplit: 0.7,

  /**
   * Risk of a mix, 0–10: dependence on one supplier, products with a single
   * source, spend moved to suppliers never bought from, and distance.
   */
  risk: {
    /** Share of the spend with one supplier from which concentration is medium, and high. */
    concentration: { medium: 0.4, high: 0.6 },
    concentrationPoints: { medium: 2, high: 4 },
    /** × the share of the spend with one source only. A second priced source not used counts half; a shared product nothing. */
    singleSourcePoints: 3,
    untestedSecondSource: 0.5,
    /** × the share of the spend moved to suppliers never bought from, by how hard the product is to move. */
    unprovenPoints: 2,
    switchingFactor: { low: 0.5, medium: 1, high: 1.5 },
    /** × the share of the spend bought outside the customs area or far away. */
    distancePoints: 1,
    /** The score in words: below `medium` low, from `high` up high. */
    level: { medium: 3.5, high: 6.5 },
  },

  /** How strong the evidence of a supplier's fit is, 0–1: bought from already, match confirmed, possible, nobody checked. Not a quality score. */
  qualification: { proven: 1, confirmed: 0.8, possible: 0.4, unknown: 0.2 },

  /**
   * Data confidence of a scenario: the share of the spend whose products have
   * a real alternative price on file, from which it is medium, and high.
   */
  confidence: { medium: 0.5, high: 0.8 },

  /** Above this many combinations the search goes product by product instead of trying them all. */
  maxCombinations: 20_000,
};

export type PortfolioConfig = typeof PORTFOLIO_CONFIG;

export const defaultWeights = (objective: Objective, cfg: PortfolioConfig = PORTFOLIO_CONFIG): Weights => ({ ...cfg.weights[objective === "custom" ? "balanced" : objective] });
