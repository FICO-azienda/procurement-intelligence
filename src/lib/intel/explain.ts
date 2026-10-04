/**
 * "No black box": the explanation shown next to every calculated figure.
 * Built from the config, so a changed threshold changes the explanation too.
 */
import { en, type Msg, type T } from "../i18n";
import { INTEL_CONFIG, type IntelConfig } from "./config";

const CONFIDENCE_WORD: Record<"high" | "medium" | "low", Msg> = { high: "high|confidence", medium: "medium|confidence", low: "low|confidence" };

export function explanations(cfg: IntelConfig = INTEL_CONFIG, t: T = en) {
  const a = cfg.alerts;
  const o = cfg.overview;
  const pareto = Math.round(cfg.paretoShare * 100);
  const recent = cfg.quoteAge.recentDays;
  return {
    currentPrice: t("The last price paid to the current supplier, per unit, in EUR. The source document is shown below it."),
    previousPrice: t("The price of the comparable purchase just before the current one."),
    change: t("Current price compared with the last price paid on or before the start of the period. When your history is shorter than the period, the oldest purchase is used and its date is shown."),
    annualSpend: t("Sum of all purchases in the last 12 months, including freight and other costs. Purchases in a foreign currency without an exchange rate are left out."),
    ytdSpend: t("Sum of all purchases since 1 January of this year."),
    annualQuantity: t("Quantity bought in the last 12 months, in the product's unit."),
    priceGap: t("Current price minus the lowest comparable alternative price on file. A nominal difference: freight, duties, FX, inventory, quality and financial costs are not included."),
    potentialSaving: t(
      "Calculated as current price minus alternative price, multiplied by the annual volume of the last 12 months. Does not include logistics, duties, quality or inventory costs. It is an estimate, not a realised saving.",
    ),
    potentialTotal: t(
      "For each product, the largest potential saving among comparable alternatives with {levels} confidence. One alternative per product; rejected and closed opportunities are excluded. Before freight, duties, quality and commercial conditions.",
      { levels: cfg.headlineConfidence.map((c) => t(CONFIDENCE_WORD[c])).join(t(" or ")) },
    ),
    confidence: t(
      "High: same unit and currency, no conflicting specifications, offer no older than {recent} days, MOQ within your typical order. Medium: at least one condition not fully aligned (currency converted, specifications differ, MOQ unknown or above your typical order). Low: offer older than {recent} days or expired, MOQ above your annual volume, or weak data on your side.",
      { recent },
    ),
    comparability: t(
      "Comparable: same product, same unit, currency convertible with a recorded exchange rate. Partially comparable: specifications differ, or the MOQ is more than {factor}× your typical order. Not comparable: exchange rate unknown, unit can't be converted, or marked so by you.",
      { factor: cfg.moqToleranceFactor },
    ),
    average: t("Simple mean of all purchase prices, regardless of quantity."),
    weightedAverage: t("Σ(quantity × unit price) ÷ Σ(quantity) over all purchases: what one unit actually cost on average."),
    premium: t("Current price compared with the weighted average of all your purchases of this product."),
    lowHigh: t("Lowest and highest price paid, with the date."),
    trend: t(
      "Current price vs the average of the previous {previous} purchases: more than {threshold}% above is increasing, more than {threshold}% below is decreasing. Needs at least {min} previous purchases.",
      { previous: cfg.trend.previousPurchases, threshold: cfg.trend.thresholdPct, min: cfg.trend.minPrevious },
    ),
    annualImpact: t("Annual quantity (last 12 months) × price difference. If current annual volume remains unchanged — not a forecast of future cost."),
    concentration: t("Share of the last 12 months' spend on this product by supplier. Shown as a distribution, not a score."),
    dataQuality: t(
      "Based on the number of comparable purchases ({high}+ is good), how recent the last one is (within {fresh} days), and whether units, currencies and quantities are consistent.",
      { high: cfg.dataQuality.highObservations, fresh: cfg.dataQuality.freshDays },
    ),
    supplierWeightedChange: t(
      "For each product bought from this supplier: latest price vs the last price paid before 1 January (or the first price of the year). Each product weighs by its year-to-date spend, so large items count more than small ones.",
    ),
    highSpend: t("Products that together make up the first {pareto}% of annual spend.", { pareto }),
    alert: t("Price change over 12 months: above +{moderate}% moderate, from +{high}% high, from +{critical}% critical.", { moderate: a.moderate, high: a.high, critical: a.critical }),
    quoteAge: t("Fresh: under {fresh} days. Recent: {fresh}–{recent} days. Old: over {recent} days. Old and expired offers lower the confidence of a saving.", { fresh: cfg.quoteAge.freshDays, recent }),
    outlier: t("Flagged when a price is more than {deviation}% away from the median of at least {min} purchases. Nothing is removed automatically: you decide.", {
      deviation: cfg.outlier.deviationPct,
      min: cfg.outlier.minObservations,
    }),
    distribution: t("Shown with at least {min} prices. Half of your purchases were priced between the 25th and 75th percentile.", { min: cfg.distributionMinObservations }),
    pareto: t("Products ranked by spend in the last 12 months, with the cumulative share of the total."),
    priceDifference: t("Alternative price minus the current price, in % of the current price. Purchase and quote prices only."),
    // ---- Overview page: the technical term lives here, the page speaks plainly
    decisionStatus: t(
      "Action: a comparable, recent offer is below what you pay, worth at least {min} EUR a year. Review: a lower offer that is not fully comparable, a price increase above {moderate}%, or a price that may be a data error. To classify: its name and category still come from the invoice. Needs cost data, history or an alternative: no purchase price, no purchase in 6 months, or — for a product that weighs on your spend — no recent comparable quote. Ready: price and supplier known, nothing to compare with yet. Good: compared, and nothing stands out.",
      { min: o.minMaterialSaving.toLocaleString("it-IT"), moderate: a.moderate },
    ),
    quotesOnFile: t(
      "The range of comparable prices from other suppliers that you have on file — quotes received, or prices paid to someone else. It is a comparison, not a market price: external benchmarks are not connected yet.",
    ),
    trueCost: t(
      "What a unit really costs once transport, duties, exchange rate, stock and payment terms are added (landed cost, or TCO). Not estimated yet: figures on this page compare prices only.",
    ),
    moneyView: t("Your volume of the last 12 months at today's price, and the same volume at the alternative's quoted price. The difference is the potential saving, on price alone."),
    supplyRisk: t(
      "Single source: every purchase in the last 12 months came from one supplier. The risk is high when the product is among those making up the first {pareto}% of your spend. Shown apart from cost: a product can be well priced and still risky.",
      { pareto },
    ),
    priorityOrder: t(
      "Order: high-confidence opportunities by size, then high-spend products bought from a single supplier, then other opportunities and price increases, then products that need data, then fairly priced ones.",
    ),
    highConfidence: t(
      "Savings where the alternative is comparable on every check: same unit and currency, no conflicting specifications, offer no older than {recent} days, MOQ within your typical order.",
      { recent },
    ),
    funnel: t(
      "Potential: calculated from prices. High-confidence: the comparison passes every check. Validated: you marked the opportunity as validated after checking quote and specifications. Realised: observed on invoices after a change — not tracked yet.",
    ),
    recentChanges: t("Price changes on your purchases and quotes received from other suppliers in the last {days} days.", { days: o.recentDays }),
    opportunityImpact: t(
      "Potential saving: (current − alternative price) × annual volume. Price increase: annual volume × increase over 12 months. Above average: annual volume × gap to your historical weighted average. Only the first is a potential saving.",
    ),
  };
}

export type Explanations = ReturnType<typeof explanations>;

export const EXPLAIN = explanations();

const BY_LOCALE = new Map<string, Explanations>();

/** The explanations in the reader's language (built once per language). */
export function explain(t: T): Explanations {
  let e = BY_LOCALE.get(t.locale);
  if (!e) BY_LOCALE.set(t.locale, (e = explanations(INTEL_CONFIG, t)));
  return e;
}
