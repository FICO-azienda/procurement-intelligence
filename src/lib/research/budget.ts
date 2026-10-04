/**
 * What a research may spend. Limits per product (searches, pages opened,
 * retries) and, optionally, per day in money — so that nobody can run up a
 * bill by pressing a button. Every limit is a number here or in the
 * environment; none is hidden in the pipeline.
 */
export interface ResearchLimits {
  maxSearchesPerProduct: number;
  resultsPerSearch: number;
  /** Pages opened per product: new sites and candidates on file together. */
  maxPagesPerProduct: number;
  maxRetries: number;
  /** EUR a day across all research. Null: no daily limit. */
  dailyCostLimit: number | null;
  /** How long an answer is reused, in days, by kind of source. */
  cacheDays: { search: number; page: number; fx: number; trade: number };
  /** A run still "running" after this many minutes was interrupted. */
  staleRunMinutes: number;
  /** Months of trade statistics asked for. */
  tradeMonths: number;
}

export const RESEARCH_LIMITS: ResearchLimits = {
  maxSearchesPerProduct: 5,
  resultsPerSearch: 10,
  maxPagesPerProduct: 8,
  maxRetries: 1,
  dailyCostLimit: null,
  cacheDays: { search: 30, page: 30, fx: 1, trade: 30 },
  staleRunMinutes: 10,
  tradeMonths: 8,
};

const positive = (v: string | undefined) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

/** The limits, with what the environment overrides: RESEARCH_MAX_SEARCHES, RESEARCH_MAX_PAGES, RESEARCH_DAILY_LIMIT_EUR. */
export function limitsFrom(env: Record<string, string | undefined>, base: ResearchLimits = RESEARCH_LIMITS): ResearchLimits {
  return {
    ...base,
    maxSearchesPerProduct: positive(env.RESEARCH_MAX_SEARCHES) ?? base.maxSearchesPerProduct,
    maxPagesPerProduct: positive(env.RESEARCH_MAX_PAGES) ?? base.maxPagesPerProduct,
    dailyCostLimit: positive(env.RESEARCH_DAILY_LIMIT_EUR) ?? base.dailyCostLimit,
  };
}

/**
 * How deep a research goes, by how much the product weighs: the full limits
 * for the few products that make up most of the spend, less for the rest.
 */
export function limitsFor(limits: ResearchLimits, materiality: "focus" | "priority" | "minor"): ResearchLimits {
  const share = materiality === "focus" ? 1 : materiality === "priority" ? 0.6 : 0.4;
  return { ...limits, maxSearchesPerProduct: Math.max(1, Math.round(limits.maxSearchesPerProduct * share)), maxPagesPerProduct: Math.max(2, Math.round(limits.maxPagesPerProduct * share)) };
}

/** Counts what one run uses, and says no when a limit is reached. */
export class Budget {
  searches = 0;
  pages = 0;
  cost = 0;
  constructor(
    private limits: ResearchLimits,
    /** EUR already spent today, before this run. */
    private spentToday = 0,
  ) {}
  /** Whether one more search may be paid for. A cached answer costs nothing and is always allowed. */
  canSearch(costPerQuery: number | null): boolean {
    if (this.searches >= this.limits.maxSearchesPerProduct) return false;
    return this.limits.dailyCostLimit == null || costPerQuery == null || this.spentToday + this.cost + costPerQuery <= this.limits.dailyCostLimit;
  }
  canOpenPage(): boolean {
    return this.pages < this.limits.maxPagesPerProduct;
  }
  search(costPerQuery: number | null, cached: boolean) {
    this.searches++;
    if (!cached) this.cost += costPerQuery ?? 0;
  }
  page() {
    this.pages++;
  }
}

export interface PlanLine {
  productId: string;
  name: string;
  queries: number;
  /** Of which already answered recently: no new call. */
  cached: number;
  pages: number;
}

export interface ResearchPlan {
  products: PlanLine[];
  queries: number;
  cachedQueries: number;
  /** EUR. Null: the search provider's price is not known, or no provider is connected. */
  estimatedCost: number | null;
  /** The daily limit would stop the run before the end. */
  overDailyLimit: boolean;
}

export function researchPlan(products: PlanLine[], costPerQuery: number | null, searchConfigured: boolean, limits: ResearchLimits, spentToday: number): ResearchPlan {
  const queries = products.reduce((s, p) => s + p.queries, 0);
  const cachedQueries = products.reduce((s, p) => s + p.cached, 0);
  const estimatedCost = !searchConfigured ? 0 : costPerQuery == null ? null : (queries - cachedQueries) * costPerQuery;
  return { products, queries, cachedQueries, estimatedCost, overDailyLimit: limits.dailyCostLimit != null && estimatedCost != null && spentToday + estimatedCost > limits.dailyCostLimit };
}
