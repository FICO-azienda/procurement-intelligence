/**
 * "No black box": the explanation shown next to every calculated figure.
 * Built from the config, so a changed threshold changes the explanation too.
 */
import { INTEL_CONFIG, type IntelConfig } from "./config";

export function explanations(cfg: IntelConfig = INTEL_CONFIG) {
  const a = cfg.alerts;
  return {
    currentPrice: "The last price paid to the current supplier, per unit, in EUR. The source document is shown below it.",
    previousPrice: "The price of the comparable purchase just before the current one.",
    change: "Current price compared with the last price paid on or before the start of the period. When your history is shorter than the period, the oldest purchase is used and its date is shown.",
    annualSpend: "Sum of all purchases in the last 12 months, including freight and other costs. Purchases in a foreign currency without an exchange rate are left out.",
    ytdSpend: "Sum of all purchases since 1 January of this year.",
    annualQuantity: "Quantity bought in the last 12 months, in the product's unit.",
    priceGap:
      "Current price minus the lowest comparable alternative price on file. A nominal difference: freight, duties, FX, inventory, quality and financial costs are not included.",
    potentialSaving:
      "Calculated as current price minus alternative price, multiplied by the annual volume of the last 12 months. Does not include logistics, duties, quality or inventory costs. It is an estimate, not a realised saving.",
    potentialTotal: `For each product, the largest potential saving among comparable alternatives with ${cfg.headlineConfidence.join(" or ")} confidence. One alternative per product; rejected and closed opportunities are excluded. Before freight, duties, quality and commercial conditions.`,
    confidence: `High: same unit and currency, no conflicting specifications, offer no older than ${cfg.quoteAge.recentDays} days, MOQ within your typical order. Medium: at least one condition not fully aligned (currency converted, specifications differ, MOQ unknown or above your typical order). Low: offer older than ${cfg.quoteAge.recentDays} days or expired, MOQ above your annual volume, or weak data on your side.`,
    comparability: `Comparable: same product, same unit, currency convertible with a recorded exchange rate. Partially comparable: specifications differ, or the MOQ is more than ${cfg.moqToleranceFactor}× your typical order. Not comparable: exchange rate unknown, unit can't be converted, or marked so by you.`,
    average: "Simple mean of all purchase prices, regardless of quantity.",
    weightedAverage: "Σ(quantity × unit price) ÷ Σ(quantity) over all purchases: what one unit actually cost on average.",
    premium: "Current price compared with the weighted average of all your purchases of this product.",
    lowHigh: "Lowest and highest price paid, with the date.",
    trend: `Current price vs the average of the previous ${cfg.trend.previousPurchases} purchases: more than ${cfg.trend.thresholdPct}% above is increasing, more than ${cfg.trend.thresholdPct}% below is decreasing. Needs at least ${cfg.trend.minPrevious} previous purchases.`,
    annualImpact: "Annual quantity (last 12 months) × price difference. If current annual volume remains unchanged — not a forecast of future cost.",
    concentration: "Share of the last 12 months' spend on this product by supplier. Shown as a distribution, not a score.",
    dataQuality: `Based on the number of comparable purchases (${cfg.dataQuality.highObservations}+ is good), how recent the last one is (within ${cfg.dataQuality.freshDays} days), and whether units, currencies and quantities are consistent.`,
    supplierWeightedChange:
      "For each product bought from this supplier: latest price vs the last price paid before 1 January (or the first price of the year). Each product weighs by its year-to-date spend, so large items count more than small ones.",
    highSpend: `Products that together make up the first ${Math.round(cfg.paretoShare * 100)}% of annual spend.`,
    alert: `Price change over 12 months: above +${a.moderate}% moderate, from +${a.high}% high, from +${a.critical}% critical.`,
    quoteAge: `Fresh: under ${cfg.quoteAge.freshDays} days. Recent: ${cfg.quoteAge.freshDays}–${cfg.quoteAge.recentDays} days. Old: over ${cfg.quoteAge.recentDays} days. Old and expired offers lower the confidence of a saving.`,
    outlier: `Flagged when a price is more than ${cfg.outlier.deviationPct}% away from the median of at least ${cfg.outlier.minObservations} purchases. Nothing is removed automatically: you decide.`,
    distribution: `Shown with at least ${cfg.distributionMinObservations} prices. Half of your purchases were priced between the 25th and 75th percentile.`,
    pareto: "Products ranked by spend in the last 12 months, with the cumulative share of the total.",
    priceDifference: "Alternative price minus the current price, in % of the current price. Purchase and quote prices only.",
    opportunityImpact:
      "Potential saving: (current − alternative price) × annual volume. Price increase: annual volume × increase over 12 months. Above average: annual volume × gap to your historical weighted average. Only the first is a potential saving.",
  };
}

export const EXPLAIN = explanations();
