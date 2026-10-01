/**
 * Every threshold of the intelligence engine, in one place.
 *
 * These are starting assumptions, to be calibrated on real company data.
 * Nothing in the engine or the UI repeats these numbers: change them here.
 * Functions accept a config, so tests (and later per-company settings) can
 * pass their own.
 */
export interface IntelConfig {
  /** Price-change alert levels on the 12-month change, in %. */
  alerts: { moderate: number; high: number; critical: number };
  /** Trend: current price vs the average of the previous purchases. */
  trend: { thresholdPct: number; previousPurchases: number; minPrevious: number };
  /** Quote age classes, in days. */
  quoteAge: { freshDays: number; recentDays: number };
  /** Price differences smaller than this % are not worth an opportunity. */
  minPriceGapPct: number;
  /** Current price above the historical weighted average by this % is notable. */
  premiumOverAveragePct: number;
  /** Supplier increase that becomes an opportunity (type "price increase"). */
  significantIncreasePct: number;
  /** MOQ above typical order × this factor makes an offer only partially comparable. */
  moqToleranceFactor: number;
  /** Products within this cumulative share of annual spend are "high spend". */
  paretoShare: number;
  /** Outliers: distance from the median price, with a minimum number of purchases. */
  outlier: { deviationPct: number; minObservations: number };
  /** Price distribution (percentiles) is shown only with at least this many prices. */
  distributionMinObservations: number;
  /** Data quality: how many purchases and how recent. */
  dataQuality: { highObservations: number; mediumObservations: number; freshDays: number; staleDays: number };
  /** When true, a saving is "high confidence" only if specifications were compared. */
  requireSpecsForHighConfidence: boolean;
  /** Confidence levels summed in the headline "potential price opportunities". */
  headlineConfidence: ("high" | "medium" | "low")[];
  /** How many items "Top N products represent X%" refers to. */
  paretoTopN: number;
}

export const INTEL_CONFIG: IntelConfig = {
  alerts: { moderate: 5, high: 10, critical: 20 },
  trend: { thresholdPct: 2, previousPurchases: 3, minPrevious: 2 },
  quoteAge: { freshDays: 30, recentDays: 90 },
  minPriceGapPct: 1,
  premiumOverAveragePct: 5,
  significantIncreasePct: 10,
  moqToleranceFactor: 1.5,
  paretoShare: 0.8,
  outlier: { deviationPct: 50, minObservations: 4 },
  distributionMinObservations: 8,
  dataQuality: { highObservations: 6, mediumObservations: 3, freshDays: 90, staleDays: 180 },
  requireSpecsForHighConfidence: false,
  headlineConfidence: ["high", "medium"],
  paretoTopN: 10,
};
