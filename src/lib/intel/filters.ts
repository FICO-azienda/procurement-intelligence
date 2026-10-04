/**
 * Quick filters and sorting for the product list — the "ask-like" questions
 * a buyer has, answered without a language model.
 */
import { currentSupplierId } from "../analytics";
import { en, type Msg, type T } from "../i18n";
import { INTEL_CONFIG, type IntelConfig } from "./config";
import type { ProductIntel } from "./engine";

export type QuickFilter = "up-moderate" | "up-high" | "down" | "high-spend" | "single-source" | "multi-supplier" | "recent-quote" | "saving" | "review";

export function quickFilters(cfg: IntelConfig = INTEL_CONFIG, t: T = en): { key: QuickFilter; label: string; test: (p: ProductIntel) => boolean }[] {
  const pct = (p: ProductIntel) => (p.price.changes.m12.pct == null ? null : Number(p.price.changes.m12.pct.toFixed(1)));
  return [
    { key: "up-moderate", label: t("Up >{pct}%", { pct: cfg.alerts.moderate }), test: (p) => (pct(p) ?? 0) > cfg.alerts.moderate },
    { key: "up-high", label: t("Up >{pct}%", { pct: cfg.alerts.high }), test: (p) => (pct(p) ?? 0) > cfg.alerts.high },
    { key: "down", label: t("Price decrease"), test: (p) => (pct(p) ?? 0) < 0 },
    { key: "high-spend", label: t("High spend"), test: (p) => p.highSpend },
    { key: "single-source", label: t("Single-source"), test: (p) => p.concentration.sourcing === "single" },
    { key: "multi-supplier", label: t("Multiple supplier options"), test: (p) => p.supplierOptions >= 2 },
    { key: "recent-quote", label: t("Recent quote available"), test: (p) => p.recentAlternativeQuote },
    { key: "saving", label: t("Potential saving"), test: (p) => p.bestSaving != null },
    { key: "review", label: t("Needs review"), test: (p) => p.metrics.status === "review" || p.price.outliers.length > 0 },
  ];
}

export type SortKey = "spend" | "change" | "saving" | "last" | "suppliers" | "name";

export const SORTS: { key: SortKey; label: Msg }[] = [
  { key: "spend", label: "Annual spend" },
  { key: "change", label: "Price change" },
  { key: "saving", label: "Potential saving" },
  { key: "last", label: "Last purchase" },
  { key: "suppliers", label: "Number of suppliers" },
  { key: "name", label: "Name" },
];

export interface ProductQuery {
  filters?: string[];
  supplierId?: string | null;
  category?: string | null;
  search?: string | null;
  sort?: string | null;
}

export function filterProducts(products: ProductIntel[], q: ProductQuery, cfg: IntelConfig = INTEL_CONFIG): ProductIntel[] {
  const active = quickFilters(cfg).filter((f) => q.filters?.includes(f.key));
  const search = q.search?.trim().toLowerCase();
  const out = products.filter((p) => {
    if (!active.every((f) => f.test(p))) return false;
    if (q.supplierId && currentSupplierId(p.product, p.metrics) !== q.supplierId && !p.comparison.some((r) => r.supplier.id === q.supplierId)) return false;
    if (q.category && (p.product.category ?? "").toLowerCase() !== q.category.toLowerCase()) return false;
    if (search && !`${p.product.name} ${p.product.sku} ${p.product.category ?? ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
  // Missing values always sort last, whatever the direction.
  const desc = (get: (p: ProductIntel) => number | string | null) => (a: ProductIntel, b: ProductIntel) => {
    const [x, y] = [get(a), get(b)];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x < y ? 1 : x > y ? -1 : 0;
  };
  const byName = (a: ProductIntel, b: ProductIntel) => a.product.name.localeCompare(b.product.name);
  const sorters: Record<SortKey, (a: ProductIntel, b: ProductIntel) => number> = {
    spend: desc((p) => p.metrics.annualSpend),
    change: desc((p) => p.price.changes.m12.pct),
    saving: desc((p) => p.bestSaving?.potentialSaving ?? null),
    last: desc((p) => p.metrics.currentDate),
    suppliers: desc((p) => p.supplierOptions),
    name: byName,
  };
  const sort = (q.sort && q.sort in sorters ? q.sort : "spend") as SortKey;
  return out.sort((a, b) => sorters[sort](a, b) || byName(a, b));
}
