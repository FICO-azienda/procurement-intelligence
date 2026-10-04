/**
 * Global search: one box for products, suppliers, quotes, purchases and
 * opportunities, so nobody has to remember where a piece of information lives.
 * Pure — the route handler and the tests call the same function.
 */
import type { Dataset } from "./analytics";
import * as f from "./format";
import { en, type T } from "./i18n";
import type { Intel } from "./intel/engine";
import { OPPORTUNITY_LABEL } from "./intel/opportunities";

export type SearchKind = "product" | "supplier" | "quote" | "purchase" | "opportunity";

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface SearchAliases {
  productAliases: { productId: string; alias: string }[];
  supplierAliases: { supplierId: string; alias: string }[];
}

const PER_GROUP = 5;

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function search(query: string, data: Dataset, intel: Intel, aliases: SearchAliases = { productAliases: [], supplierAliases: [] }, t: T = en): SearchResult[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  // Every word must appear, each as the start of a word ("par 58" finds "Paraffina 58/60").
  const hit = (...texts: (string | null | undefined)[]) => {
    const hay = ` ${texts.map(norm).join(" ")} `;
    return words.every((w) => hay.includes(` ${w}`));
  };
  const supplierName = (id: string | null) => data.suppliers.find((s) => s.id === id)?.name ?? t("Unknown supplier");
  const product = (id: string) => data.products.find((p) => p.id === id);
  const out: SearchResult[] = [];

  // ---- Products (also by the names learned from imports)
  const productHits = intel.products.filter((p) =>
    hit(p.product.name, p.product.sku, p.product.category, ...aliases.productAliases.filter((a) => a.productId === p.product.id).map((a) => a.alias)),
  );
  for (const p of productHits.slice(0, PER_GROUP)) {
    const price = p.price.current ? `${f.priceShort(p.price.current.price)}/${p.product.unit}` : t("No price yet");
    out.push({ kind: "product", id: p.product.id, title: p.product.name, subtitle: [price, supplierName(p.price.current?.supplierId ?? p.product.currentSupplierId)].join(" · "), href: `/products/${p.product.id}` });
  }

  // ---- Suppliers
  const supplierHits = data.suppliers.filter((s) => hit(s.name, s.city, s.country, ...aliases.supplierAliases.filter((a) => a.supplierId === s.id).map((a) => a.alias)));
  for (const s of supplierHits.slice(0, PER_GROUP)) {
    const spend = intel.suppliers.find((x) => x.supplier.id === s.id)?.metrics.annualSpend ?? 0;
    out.push({ kind: "supplier", id: s.id, title: s.name, subtitle: [s.country, spend > 0 ? t("{amount} a year", { amount: f.money(Math.round(spend)) }) : t("No purchases in 12 months")].filter(Boolean).join(" · "), href: `/suppliers/${s.id}` });
  }

  const productIds = new Set(productHits.map((p) => p.product.id));
  const supplierIds = new Set(supplierHits.map((s) => s.id));

  // ---- Quotes: of a product found, or from a supplier found
  const quotes = [...data.quotes].filter((q) => productIds.has(q.productId) || supplierIds.has(q.supplierId)).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const q of quotes.slice(0, PER_GROUP)) {
    const p = product(q.productId);
    out.push({
      kind: "quote",
      id: q.id,
      title: `${supplierName(q.supplierId)} — ${p?.name ?? t("Unknown product")}`,
      subtitle: t("Quoted {price} · {date}", { price: `${f.price(q.unitPrice, q.currency)}/${p?.unit ?? ""}`, date: f.date(q.date) }),
      href: `/compare?product=${q.productId}`,
    });
  }

  // ---- Purchases: by invoice number, or of what was found
  const purchases = [...data.purchases].filter((p) => productIds.has(p.productId) || supplierIds.has(p.supplierId) || hit(p.invoiceReference)).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const p of purchases.slice(0, 3)) {
    const prod = product(p.productId);
    out.push({
      kind: "purchase",
      id: p.id,
      title: `${prod?.name ?? t("Unknown product")} — ${supplierName(p.supplierId)}`,
      subtitle: [f.date(p.date), t("{quantity} at {price}", { quantity: `${f.number(p.quantity)} ${p.unit}`, price: f.price(p.unitPrice, p.currency) }), p.invoiceReference].filter(Boolean).join(" · "),
      href: `/purchases?q=${encodeURIComponent(query.trim())}`,
    });
  }
  if (purchases.length > 3) {
    out.push({ kind: "purchase", id: "all", title: t("All {n} purchases", { n: purchases.length }), subtitle: t("Open the list"), href: `/purchases?q=${encodeURIComponent(query.trim())}` });
  }

  // ---- Opportunities with money in them
  const opportunities = intel.opportunities
    .filter((o) => o.impact != null && o.impact > 0 && (productIds.has(o.productId) || (o.alternativeSupplierId != null && supplierIds.has(o.alternativeSupplierId))))
    .sort((a, b) => b.impact! - a.impact!);
  for (const o of opportunities.slice(0, PER_GROUP)) {
    out.push({
      kind: "opportunity",
      id: o.key,
      title: `${t(OPPORTUNITY_LABEL[o.type])} — ${product(o.productId)?.name ?? ""}`,
      subtitle: `${t("{amount}/year", { amount: f.moneyApprox(o.impact) })}${o.alternativeSupplierId ? ` · ${supplierName(o.alternativeSupplierId)}` : ""}`,
      href: `/opportunities/${o.key}`,
    });
  }
  return out;
}
