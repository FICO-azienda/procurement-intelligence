/**
 * Price metrics of one product, from its purchase history.
 *
 * Input: the product's purchases already expressed in the product's unit
 * (see normalizePurchases). Purchases without an exchange rate, or excluded
 * by the user, are left out here: prices must be comparable to be compared.
 * Pure functions; every threshold comes from the config.
 */
import { basePrice, isPriced, minusMonths, pctChange, priceChange, type PurchaseData } from "../analytics";
import { INTEL_CONFIG, type IntelConfig } from "./config";

export interface WindowChange {
  /** Window length in months; null = whole history. */
  months: number | null;
  referencePrice: number | null;
  referenceDate: string | null;
  pct: number | null;
  /** History is shorter than the window: compared with the oldest price instead. */
  partial: boolean;
}

export interface TimelineEvent {
  purchaseId: string;
  date: string;
  price: number;
  supplierId: string;
  /** Change vs the previous price level; null for the first one. */
  pct: number | null;
}

export type Trend = "increasing" | "stable" | "decreasing";

export interface PricePointRef {
  purchaseId: string;
  price: number;
  date: string;
  supplierId: string;
}

export interface Outlier extends PricePointRef {
  median: number;
  deviationPct: number;
}

export interface PriceMetrics {
  /** Comparable price observations used. */
  observations: number;
  current: PricePointRef | null;
  /** The comparable purchase just before the current one. */
  previous: PricePointRef | null;
  changes: { m3: WindowChange; m6: WindowChange; m12: WindowChange; all: WindowChange };
  /** Simple mean of all observed prices. */
  averagePrice: number | null;
  /** Σ(quantity × price) ÷ Σ(quantity): what a unit actually cost on average. */
  weightedAveragePrice: number | null;
  low: PricePointRef | null;
  high: PricePointRef | null;
  /** Current price vs the weighted average, in %. */
  premiumVsAveragePct: number | null;
  trend: Trend | null;
  /** Average of the previous purchases the trend compares against. */
  trendBaseline: number | null;
  timeline: TimelineEvent[];
  /** First → last price of the timeline, in %. */
  totalChangePct: number | null;
  distribution: { min: number; p25: number; median: number; p75: number; max: number } | null;
  outliers: Outlier[];
}

const ref = (p: PurchaseData & { fxRate: number }): PricePointRef => ({
  purchaseId: p.id,
  price: basePrice(p),
  date: p.date,
  supplierId: p.supplierId,
});

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/** Prices that can be compared: known exchange rate, not excluded by the user. */
export function comparableObservations(purchases: PurchaseData[]) {
  return purchases
    .filter(isPriced)
    .filter((p) => p.priceReview !== "excluded")
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function priceMetrics(
  purchases: PurchaseData[],
  asOf: string,
  currentSupplierId: string | null = null,
  cfg: IntelConfig = INTEL_CONFIG,
): PriceMetrics {
  const obs = comparableObservations(purchases);
  const base = priceChange(obs, asOf, currentSupplierId);
  const current = obs.find((p) => p.id === base.currentPurchaseId) ?? null;
  const empty: WindowChange = { months: null, referencePrice: null, referenceDate: null, pct: null, partial: false };

  if (!current) {
    return {
      observations: 0,
      current: null,
      previous: null,
      changes: { m3: { ...empty, months: 3 }, m6: { ...empty, months: 6 }, m12: { ...empty, months: 12 }, all: empty },
      averagePrice: null,
      weightedAveragePrice: null,
      low: null,
      high: null,
      premiumVsAveragePct: null,
      trend: null,
      trendBaseline: null,
      timeline: [],
      totalChangePct: null,
      distribution: null,
      outliers: [],
    };
  }

  const currentPrice = basePrice(current);
  // Everything bought before the current purchase.
  const earlier = obs.filter((p) => p !== current && p.date <= current.date);

  const windowChange = (months: number | null): WindowChange => {
    if (!earlier.length) return { ...empty, months };
    let reference = months == null ? earlier[0] : earlier.filter((p) => p.date <= minusMonths(asOf, months)).at(-1);
    let partial = false;
    if (!reference) {
      reference = earlier[0];
      partial = true;
    }
    const price = basePrice(reference);
    return { months, referencePrice: price, referenceDate: reference.date, pct: pctChange(price, currentPrice), partial };
  };

  const prices = obs.map(basePrice);
  const withQty = obs.filter((p) => p.quantity > 0);
  const qty = withQty.reduce((s, p) => s + p.quantity, 0);
  const weightedAveragePrice = qty > 0 ? withQty.reduce((s, p) => s + p.quantity * basePrice(p), 0) / qty : null;
  const averagePrice = prices.reduce((s, p) => s + p, 0) / prices.length;

  const byPrice = [...obs].sort((a, b) => basePrice(a) - basePrice(b));

  // Trend: current vs the average of the purchases just before it.
  const before = earlier.slice(-cfg.trend.previousPurchases);
  let trend: Trend | null = null;
  let trendBaseline: number | null = null;
  if (before.length >= cfg.trend.minPrevious) {
    trendBaseline = before.reduce((s, p) => s + basePrice(p), 0) / before.length;
    const pct = (currentPrice / trendBaseline - 1) * 100;
    trend = pct > cfg.trend.thresholdPct ? "increasing" : pct < -cfg.trend.thresholdPct ? "decreasing" : "stable";
  }

  // Timeline: one event each time the price level changes.
  const timeline: TimelineEvent[] = [];
  for (const p of obs) {
    const price = basePrice(p);
    const last = timeline.at(-1);
    if (!last) timeline.push({ purchaseId: p.id, date: p.date, price, supplierId: p.supplierId, pct: null });
    else if (Math.abs(price / last.price - 1) > 0.0005) {
      timeline.push({ purchaseId: p.id, date: p.date, price, supplierId: p.supplierId, pct: (price / last.price - 1) * 100 });
    }
  }

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const distribution =
    obs.length >= cfg.distributionMinObservations
      ? {
          min: sortedPrices[0],
          p25: quantile(sortedPrices, 0.25),
          median: quantile(sortedPrices, 0.5),
          p75: quantile(sortedPrices, 0.75),
          max: sortedPrices.at(-1)!,
        }
      : null;

  const outliers: Outlier[] = [];
  if (obs.length >= cfg.outlier.minObservations) {
    const med = quantile(sortedPrices, 0.5);
    for (const p of obs) {
      if (p.priceReview === "confirmed" || med === 0) continue;
      const deviationPct = (basePrice(p) / med - 1) * 100;
      if (Math.abs(deviationPct) > cfg.outlier.deviationPct) outliers.push({ ...ref(p), median: med, deviationPct });
    }
  }

  return {
    observations: obs.length,
    current: ref(current),
    previous: earlier.length ? ref(earlier.at(-1)!) : null,
    changes: { m3: windowChange(3), m6: windowChange(6), m12: windowChange(12), all: windowChange(null) },
    averagePrice,
    weightedAveragePrice,
    low: ref(byPrice[0]),
    high: ref(byPrice.at(-1)!),
    premiumVsAveragePct: pctChange(weightedAveragePrice ?? averagePrice, currentPrice),
    trend,
    trendBaseline,
    timeline,
    totalChangePct: timeline.length > 1 ? pctChange(timeline[0].price, timeline.at(-1)!.price) : null,
    distribution,
    outliers,
  };
}
