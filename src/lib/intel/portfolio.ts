/**
 * Portfolio-level analyses: where the money goes, how concentrated purchases
 * are, which price changes deserve an alert, and how a supplier's prices are
 * moving once weighted by what we actually spend with them.
 */
import { baseTotal, basePrice, isPriced, pctChange, windowStart, type PurchaseData } from "../analytics";
import { INTEL_CONFIG, type IntelConfig } from "./config";
import { comparableObservations } from "./price-metrics";

// ---------------- Spend breakdowns ----------------

export interface SpendSlice {
  key: string;
  label: string;
  spend: number;
  share: number;
}

export function spendBreakdown(entries: { key: string; label: string; spend: number }[]): SpendSlice[] {
  const byKey = new Map<string, { label: string; spend: number }>();
  for (const e of entries) {
    const cur = byKey.get(e.key);
    if (cur) cur.spend += e.spend;
    else byKey.set(e.key, { label: e.label, spend: e.spend });
  }
  const total = [...byKey.values()].reduce((s, e) => s + e.spend, 0);
  return [...byKey.entries()]
    .filter(([, e]) => e.spend > 0)
    .map(([key, e]) => ({ key, label: e.label, spend: e.spend, share: total > 0 ? e.spend / total : 0 }))
    .sort((a, b) => b.spend - a.spend);
}

// ---------------- Pareto ----------------

export interface ParetoItem {
  key: string;
  spend: number;
  share: number;
  cumulativeShare: number;
  rank: number;
  /** Among the items that make up the first `paretoShare` of spend. */
  highSpend: boolean;
}

export interface Pareto {
  items: ParetoItem[];
  total: number;
  /** "Top N items represent X% of spend". */
  topN: number;
  topNShare: number;
  /** How many items it takes to reach the pareto share. */
  itemsForShare: number;
}

export function pareto(spendByKey: { key: string; spend: number }[], cfg: IntelConfig = INTEL_CONFIG): Pareto {
  const sorted = spendByKey.filter((x) => x.spend > 0).sort((a, b) => b.spend - a.spend);
  const total = sorted.reduce((s, x) => s + x.spend, 0);
  let cumulative = 0;
  const items = sorted.map((x, i) => {
    const before = total > 0 ? cumulative / total : 0;
    cumulative += x.spend;
    return {
      key: x.key,
      spend: x.spend,
      share: total > 0 ? x.spend / total : 0,
      cumulativeShare: total > 0 ? cumulative / total : 0,
      rank: i + 1,
      // The item that crosses the threshold is still part of the "vital few".
      highSpend: before < cfg.paretoShare,
    };
  });
  const topN = Math.min(cfg.paretoTopN, items.length);
  return {
    items,
    total,
    topN,
    topNShare: topN ? items[topN - 1].cumulativeShare : 0,
    itemsForShare: items.filter((x) => x.highSpend).length,
  };
}

// ---------------- Supplier concentration ----------------

export type Sourcing = "single" | "dual" | "multi" | "none";

export interface Concentration {
  sourcing: Sourcing;
  /** Share of spend by supplier, largest first. */
  shares: { supplierId: string; spend: number; share: number }[];
  /** False when no purchase falls in the last 12 months and all history was used. */
  lastTwelveMonths: boolean;
}

export function concentration(purchases: PurchaseData[], asOf: string): Concentration {
  const priced = purchases.filter(isPriced);
  const start = windowStart(asOf);
  const recent = priced.filter((p) => p.date > start);
  const pool = recent.length ? recent : priced;
  const by = new Map<string, number>();
  for (const p of pool) by.set(p.supplierId, (by.get(p.supplierId) ?? 0) + baseTotal(p));
  const total = [...by.values()].reduce((s, v) => s + v, 0);
  const shares = [...by.entries()]
    .map(([supplierId, spend]) => ({ supplierId, spend, share: total > 0 ? spend / total : 0 }))
    .sort((a, b) => b.spend - a.spend);
  const n = shares.length;
  return { sourcing: n === 0 ? "none" : n === 1 ? "single" : n === 2 ? "dual" : "multi", shares, lastTwelveMonths: recent.length > 0 };
}

// ---------------- Price alerts ----------------

export type AlertLevel = "moderate" | "high" | "critical";

export function alertLevel(changePct: number | null, cfg: IntelConfig = INTEL_CONFIG): AlertLevel | null {
  if (changePct == null) return null;
  // Decide on the rounded figure the user sees.
  const pct = Number(changePct.toFixed(1));
  if (pct >= cfg.alerts.critical) return "critical";
  if (pct >= cfg.alerts.high) return "high";
  if (pct > cfg.alerts.moderate) return "moderate";
  return null;
}

// ---------------- Supplier price change, weighted by spend ----------------

export interface SupplierProductChange {
  productId: string;
  firstPrice: number;
  firstDate: string;
  lastPrice: number;
  lastDate: string;
  pct: number;
  /** Year-to-date spend with this supplier on this product (the weight). */
  spend: number;
}

export interface SupplierPriceChange {
  /** Σ(change × spend) ÷ Σ(spend), in %. Null when no product has two comparable prices. */
  weightedPct: number | null;
  products: SupplierProductChange[];
}

/**
 * Year-to-date price change of one supplier. For each product: latest price
 * vs the last price paid before 1 January (or the first price of the year if
 * there is none). Products weigh by their year-to-date spend.
 *
 * @param byProduct purchases from this supplier, grouped by product, each in the product's unit
 */
export function supplierPriceChange(byProduct: Map<string, PurchaseData[]>, asOf: string): SupplierPriceChange {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const products: SupplierProductChange[] = [];
  for (const [productId, list] of byProduct) {
    const obs = comparableObservations(list).filter((p) => p.date <= asOf);
    const inYear = obs.filter((p) => p.date >= yearStart);
    if (!inYear.length) continue;
    const before = obs.filter((p) => p.date < yearStart).at(-1);
    const first = before ?? inYear[0];
    const last = inYear.at(-1)!;
    if (first === last) continue;
    const pct = pctChange(basePrice(first), basePrice(last));
    if (pct == null) continue;
    products.push({
      productId,
      firstPrice: basePrice(first),
      firstDate: first.date,
      lastPrice: basePrice(last),
      lastDate: last.date,
      pct,
      spend: inYear.reduce((s, p) => s + baseTotal(p), 0),
    });
  }
  const weight = products.reduce((s, p) => s + p.spend, 0);
  return {
    weightedPct: weight > 0 ? products.reduce((s, p) => s + p.pct * p.spend, 0) / weight : null,
    products: products.sort((a, b) => b.spend - a.spend),
  };
}
