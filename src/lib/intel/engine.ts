/**
 * The intelligence engine: one pass over the dataset that produces everything
 * the pages show. Pure — no database, no UI.
 *
 *   analyze(dataset, links, opportunity states, as-of date, config) → Intel
 *
 * Purchases and quotes are indexed once by product and by supplier, so the
 * cost grows with the number of records, not with products × records.
 */
import {
  currentSupplierId,
  isPriced,
  normalizePurchases,
  productMetrics,
  supplierMetrics,
  supplierOrderStats,
  windowStart,
  type Dataset,
  type ProductData,
  type ProductMetrics,
  type PurchaseData,
  type QuoteData,
  type SupplierData,
  type SupplierMetrics,
  type SupplierOrderStats,
} from "../analytics";
import { compareSuppliers, type ComparisonRow, type SupplierLink } from "./comparison";
import { INTEL_CONFIG, type IntelConfig } from "./config";
import { findOpportunities, type Opportunity } from "./opportunities";
import {
  alertLevel,
  concentration,
  pareto,
  spendBreakdown,
  supplierPriceChange,
  type AlertLevel,
  type Concentration,
  type Pareto,
  type SpendSlice,
  type SupplierPriceChange,
} from "./portfolio";
import { median, priceMetrics, type PriceMetrics } from "./price-metrics";
import { dataQuality, type DataQuality } from "./quality";
import type { OpportunityStatus } from "./statuses";
import { productSummary, supplierSummary } from "./summary";

export type { OpportunityStatus };

export interface OpportunityState {
  key: string;
  status: OpportunityStatus;
  note: string | null;
  snapshot: unknown;
  updatedAt: string;
}

export type TrackedOpportunity = Opportunity & { status: OpportunityStatus; note: string | null };

export interface ProductIntel {
  product: ProductData;
  metrics: ProductMetrics;
  price: PriceMetrics;
  comparison: ComparisonRow[];
  concentration: Concentration;
  quality: DataQuality;
  alert: AlertLevel | null;
  opportunities: TrackedOpportunity[];
  /** The saving that represents the product: most trustworthy first, then largest; not rejected/closed. */
  bestSaving: TrackedOpportunity | null;
  /** Lower offers the user rejected or closed. */
  dismissedSavings: number;
  /** The current price is flagged as a possible data error and not reviewed yet. */
  currentPriceFlagged: boolean;
  typicalOrderQuantity: number | null;
  spendShare: number;
  rank: number | null;
  highSpend: boolean;
  /** Suppliers with a price on record (paid or quoted). */
  supplierOptions: number;
  /** Quotes from suppliers other than the current one. */
  alternativeQuotes: number;
  recentAlternativeQuote: boolean;
  summary: string[];
}

export interface SupplierIntel {
  supplier: SupplierData;
  metrics: SupplierMetrics;
  orders: SupplierOrderStats;
  priceChange: SupplierPriceChange;
  spendShare: number;
  /** Products where this is the current supplier and a recent alternative quote exists. */
  productsWithAlternatives: string[];
  /** High-spend products bought only from this supplier. */
  singleSourcedHighSpend: string[];
  alerts: { productId: string; level: AlertLevel; pct: number }[];
  summary: string[];
}

export interface Intel {
  asOf: string;
  config: IntelConfig;
  products: ProductIntel[];
  suppliers: SupplierIntel[];
  opportunities: TrackedOpportunity[];
  totals: {
    annualSpend: number;
    /** Sum of the best potential saving per product, at headline confidence, still open. */
    potentialSavings: number;
    potentialSavingsProducts: number;
    productsWithIncrease: number;
    singleSourceHighSpend: number;
  };
  spendBySupplier: SpendSlice[];
  spendByCategory: SpendSlice[];
  pareto: Pareto;
}

const INACTIVE: OpportunityStatus[] = ["rejected", "closed"];
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

/**
 * Which saving represents a product: the most trustworthy first, then the
 * largest. A big number with weak comparability must not hide a smaller one
 * that can actually be relied on.
 */
function bySavingQuality(a: Opportunity, b: Opportunity) {
  const conf = (o: Opportunity) => (o.confidence ? CONFIDENCE_RANK[o.confidence] : 0);
  return conf(b) - conf(a) || (b.potentialSaving ?? 0) - (a.potentialSaving ?? 0);
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function analyze(
  data: Dataset,
  links: SupplierLink[],
  states: OpportunityState[],
  asOf: string,
  cfg: IntelConfig = INTEL_CONFIG,
): Intel {
  const purchasesByProduct = groupBy(data.purchases, (p) => p.productId);
  const purchasesBySupplier = groupBy(data.purchases, (p) => p.supplierId);
  const quotesByProduct = groupBy(data.quotes, (q) => q.productId);
  const quotesBySupplier = groupBy(data.quotes, (q) => q.supplierId);
  const linksByProduct = groupBy(links, (l) => l.productId);
  const supplierById = new Map(data.suppliers.map((s) => [s.id, s]));
  const stateByKey = new Map(states.map((s) => [s.key, s]));
  const supplierName = (id: string | null) => (id ? (supplierById.get(id)?.name ?? "an unknown supplier") : "an unknown supplier");
  const start = windowStart(asOf);

  // ---- Pass 1: base metrics per product (needed for portfolio shares)
  const base = data.products.map((product) => {
    const own = purchasesByProduct.get(product.id) ?? [];
    const metrics = productMetrics(product, own, asOf);
    return { product, own, metrics };
  });
  const par = pareto(base.map((b) => ({ key: b.product.id, spend: b.metrics.annualSpend })), cfg);
  const paretoByProduct = new Map(par.items.map((x) => [x.key, x]));

  // ---- Pass 2: full intelligence per product
  const products: ProductIntel[] = base.map(({ product, own, metrics }) => {
    const { comparable, unitMismatch } = normalizePurchases(product, own);
    const currentId = currentSupplierId(product, metrics);
    const price = priceMetrics(comparable, asOf, product.currentSupplierId, cfg);
    const recentQty = comparable.filter((p) => p.date > start && p.quantity > 0).map((p) => p.quantity);
    const allQty = comparable.filter((p) => p.quantity > 0).map((p) => p.quantity);
    const typicalOrderQuantity = recentQty.length ? median(recentQty) : allQty.length ? median(allQty) : null;

    const comparison = compareSuppliers(
      {
        product,
        suppliers: data.suppliers,
        purchases: comparable,
        unitMismatch,
        quotes: quotesByProduct.get(product.id) ?? [],
        links: linksByProduct.get(product.id) ?? [],
        currentSupplierId: currentId,
        currentPrice: price.current?.price ?? null,
        typicalOrderQuantity,
        asOf,
      },
      cfg,
    );

    const conc = concentration(own, asOf);
    const quality = dataQuality(
      {
        observations: price.observations,
        lastPurchaseDate: own.length ? own.reduce((d, p) => (p.date > d ? p.date : d), own[0].date) : null,
        unitMismatch: unitMismatch.length,
        fxMissing: own.filter((p) => !isPriced(p)).length,
        quantityMissing: own.filter((p) => !(p.quantity > 0)).length,
        openOutliers: price.outliers.length,
        hasSupplier: !!currentId,
        asOf,
      },
      cfg,
    );

    const par0 = paretoByProduct.get(product.id);
    const currentPurchase = comparable.find((p) => p.id === price.current?.purchaseId);
    const opportunities: TrackedOpportunity[] = findOpportunities(
      {
        product,
        price,
        comparison,
        annualQuantity: metrics.annualQuantity,
        annualSpend: metrics.annualSpend,
        typicalOrderQuantity,
        dataQuality: quality.level,
        highSpend: par0?.highSpend ?? false,
        spendShare: par0?.share ?? 0,
        sourceCount: conc.shares.length,
        currentCurrency: currentPurchase?.currency ?? null,
      },
      cfg,
    ).map((o) => ({ ...o, status: stateByKey.get(o.key)?.status ?? "open", note: stateByKey.get(o.key)?.note ?? null }));

    // Offers the user rejected or closed no longer represent the product.
    const savings = opportunities.filter((o) => o.potentialSaving != null);
    const bestSaving = savings.filter((o) => !INACTIVE.includes(o.status)).sort(bySavingQuality)[0] ?? null;
    const alternatives = comparison.filter((r) => !r.isCurrent);
    const currentPriceFlagged = !!price.current && price.outliers.some((o) => o.purchaseId === price.current!.purchaseId);

    return {
      product,
      metrics,
      price,
      comparison,
      concentration: conc,
      quality,
      alert: alertLevel(price.changes.m12.pct, cfg),
      opportunities,
      bestSaving,
      dismissedSavings: savings.filter((o) => INACTIVE.includes(o.status)).length,
      currentPriceFlagged,
      typicalOrderQuantity,
      spendShare: par0?.share ?? 0,
      rank: par0?.rank ?? null,
      highSpend: par0?.highSpend ?? false,
      supplierOptions: comparison.filter((r) => r.price != null).length,
      alternativeQuotes: alternatives.filter((r) => r.kind === "quote").length,
      recentAlternativeQuote: alternatives.some((r) => r.kind === "quote" && !r.expired && r.age !== "old"),
      summary: productSummary({
        price,
        annualSpend: metrics.annualSpend,
        spendShare: par0?.share ?? 0,
        comparison,
        bestSaving,
        concentration: conc,
        quality,
        currentPriceFlagged,
        supplierName,
      }),
    };
  });

  // ---- Portfolio
  const productById = new Map(products.map((p) => [p.product.id, p]));
  const recentPriced = data.purchases.filter((p) => p.date > start && isPriced(p));
  const spendBySupplier = spendBreakdown(
    recentPriced.map((p) => ({ key: p.supplierId, label: supplierById.get(p.supplierId)?.name ?? "Unknown", spend: p.totalAmount * (p.fxRate ?? 0) })),
  );
  const spendByCategory = spendBreakdown(
    recentPriced.map((p) => {
      const category = productById.get(p.productId)?.product.category?.trim() || "Uncategorised";
      return { key: category.toLowerCase(), label: category, spend: p.totalAmount * (p.fxRate ?? 0) };
    }),
  );
  const totalSpend = par.total;
  const supplierShare = new Map(spendBySupplier.map((s) => [s.key, s.share]));

  // ---- Suppliers
  const suppliers: SupplierIntel[] = data.suppliers.map((supplier) => {
    const own = purchasesBySupplier.get(supplier.id) ?? [];
    // A slice of the dataset is enough for supplier metrics.
    const metrics = supplierMetrics(supplier, { suppliers: [supplier], products: data.products, purchases: own, quotes: quotesBySupplier.get(supplier.id) ?? [] }, asOf);
    const byProduct = new Map<string, PurchaseData[]>();
    for (const [productId, list] of groupBy(own, (p) => p.productId)) {
      const product = productById.get(productId)?.product;
      if (product) byProduct.set(productId, normalizePurchases(product, list).comparable);
    }
    const change = supplierPriceChange(byProduct, asOf);
    const mine = products.filter((p) => currentSupplierId(p.product, p.metrics) === supplier.id);
    const productsWithAlternatives = mine.filter((p) => p.recentAlternativeQuote).map((p) => p.product.id);
    const singleSourcedHighSpend = mine
      .filter((p) => p.highSpend && p.concentration.sourcing === "single" && p.concentration.shares[0]?.supplierId === supplier.id)
      .map((p) => p.product.id);
    const alerts = mine.flatMap((p) => (p.alert && p.price.changes.m12.pct != null ? [{ productId: p.product.id, level: p.alert, pct: p.price.changes.m12.pct }] : []));
    return {
      supplier,
      metrics,
      orders: supplierOrderStats(supplier.id, own, asOf),
      priceChange: change,
      spendShare: supplierShare.get(supplier.id) ?? 0,
      productsWithAlternatives,
      singleSourcedHighSpend,
      alerts,
      summary: supplierSummary({
        name: supplier.name,
        annualSpend: metrics.annualSpend,
        spendShare: supplierShare.get(supplier.id) ?? 0,
        priceChange: change,
        productsWithAlternatives: productsWithAlternatives.length,
        singleSourcedHighSpend: singleSourcedHighSpend.length,
      }),
    };
  });

  // ---- Totals
  const opportunities = products.flatMap((p) => p.opportunities);
  let potentialSavings = 0;
  let potentialSavingsProducts = 0;
  for (const p of products) {
    const best = p.opportunities
      .filter((o) => o.potentialSaving != null && o.confidence && cfg.headlineConfidence.includes(o.confidence) && !INACTIVE.includes(o.status))
      .sort(bySavingQuality)[0];
    if (best) {
      potentialSavings += best.potentialSaving!;
      potentialSavingsProducts++;
    }
  }

  return {
    asOf,
    config: cfg,
    products,
    suppliers,
    opportunities,
    totals: {
      annualSpend: totalSpend,
      potentialSavings,
      potentialSavingsProducts,
      productsWithIncrease: products.filter((p) => p.alert != null).length,
      singleSourceHighSpend: products.filter((p) => p.highSpend && p.concentration.sourcing === "single").length,
    },
    spendBySupplier,
    spendByCategory,
    pareto: par,
  };
}

/** One opportunity per product (the largest impact), for "top opportunities" lists. */
export function topOpportunities(intel: Intel, limit = 5): TrackedOpportunity[] {
  const best = new Map<string, TrackedOpportunity>();
  for (const o of intel.opportunities) {
    if (o.impact == null || o.impact <= 0 || INACTIVE.includes(o.status)) continue;
    // A low-confidence estimate should not lead the list.
    if (o.confidence === "low") continue;
    const cur = best.get(o.productId);
    const better =
      !cur ||
      rankOf(o) > rankOf(cur) ||
      (rankOf(o) === rankOf(cur) && (o.potentialSaving != null ? bySavingQuality(o, cur) < 0 : o.impact > cur.impact!));
    if (better) best.set(o.productId, o);
  }
  return [...best.values()].sort((a, b) => b.impact! - a.impact!).slice(0, limit);
}

/** A potential saving (there is an actual alternative) outranks a mere price signal. */
const rankOf = (o: Opportunity) => (o.potentialSaving != null ? 1 : 0);

export type { QuoteData };
