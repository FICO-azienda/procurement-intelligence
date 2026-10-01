/**
 * CSV exports. Written for Italian Excel: ";" separator, decimal comma,
 * dd/mm/yyyy dates and a UTF-8 BOM — so a double-click opens them correctly.
 * (The app's own importer reads this format back.)
 */
import type { Dataset } from "../analytics";
import { basePrice, isPriced, normalizePurchases } from "../analytics";
import { sourceLabel as sourceName } from "../source-labels";
import type { Intel, ProductIntel } from "./engine";
import { OPPORTUNITY_LABEL } from "./opportunities";
import { comparableObservations } from "./price-metrics";

type Cell = string | number | null | undefined;

const num = (n: number) => n.toLocaleString("it-IT", { useGrouping: false, maximumFractionDigits: 6 });
const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");

function cell(v: Cell): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? num(v) : "") : v;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

const round = (n: number | null | undefined, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export function productsCsv(intel: Intel, data: Dataset): string {
  const name = (id: string | null) => data.suppliers.find((s) => s.id === id)?.name ?? "";
  return toCsv(
    ["Product", "SKU", "Category", "Unit", "Current supplier", "Current price EUR", "Price date", "Previous price EUR", "12M change %", "Weighted average EUR", "Historical low EUR", "Historical high EUR", "Trend", "Annual quantity", "Annual spend EUR", "Share of spend %", "Suppliers on file", "Sourcing", "Potential saving EUR/yr", "Saving confidence", "Data quality"],
    intel.products.map((p) => [
      p.product.name,
      p.product.sku,
      p.product.category,
      p.product.unit,
      name(p.comparison.find((r) => r.isCurrent)?.supplier.id ?? null),
      round(p.price.current?.price, 6),
      date(p.price.current?.date),
      round(p.price.previous?.price, 6),
      round(p.price.changes.m12.pct),
      round(p.price.weightedAveragePrice, 6),
      round(p.price.low?.price, 6),
      round(p.price.high?.price, 6),
      p.price.trend,
      round(p.metrics.annualQuantity, 4),
      round(p.metrics.annualSpend),
      round(p.spendShare * 100),
      p.supplierOptions,
      p.concentration.sourcing,
      round(p.bestSaving?.potentialSaving),
      p.bestSaving?.confidence,
      p.quality.level,
    ]),
  );
}

export function suppliersCsv(intel: Intel): string {
  return toCsv(
    ["Supplier", "Country", "VAT number", "Annual spend EUR", "Share of spend %", "Purchases (12M)", "Orders YTD", "Average order EUR", "Products", "Weighted price change YTD %", "Price increases", "Single-sourced high-spend products", "Last purchase", "Payment terms days", "Status"],
    intel.suppliers.map((s) => [
      s.supplier.name,
      s.supplier.country,
      s.supplier.vatNumber,
      round(s.metrics.annualSpend),
      round(s.spendShare * 100),
      s.orders.purchasesLast12m,
      s.orders.ordersYtd,
      round(s.orders.averageOrderValue),
      s.metrics.productIds.length,
      round(s.priceChange.weightedPct),
      s.orders.priceIncreases,
      s.singleSourcedHighSpend.length,
      date(s.metrics.lastPurchaseDate),
      s.supplier.paymentTermsDays,
      s.metrics.status,
    ]),
  );
}

export function opportunitiesCsv(intel: Intel, data: Dataset): string {
  const supplier = (id: string | null) => data.suppliers.find((s) => s.id === id)?.name ?? "";
  const product = (id: string) => data.products.find((p) => p.id === id);
  return toCsv(
    ["Product", "SKU", "Type", "Current supplier", "Current price EUR", "Alternative", "Compared price EUR", "Price difference %", "Annual quantity", "Potential saving EUR/yr", "Other impact EUR/yr", "Confidence", "Comparability", "Reason", "Status", "Missing information", "Note"],
    intel.opportunities.map((o) => [
      product(o.productId)?.name,
      product(o.productId)?.sku,
      OPPORTUNITY_LABEL[o.type],
      supplier(o.currentSupplierId),
      round(o.currentPrice, 6),
      supplier(o.alternativeSupplierId),
      round(o.comparePrice, 6),
      round(o.priceDifferencePct),
      round(o.annualQuantity, 4),
      round(o.potentialSaving),
      o.potentialSaving == null ? round(o.impact) : null,
      o.confidence,
      o.comparability,
      o.reason,
      o.status,
      o.missing.join(" | "),
      o.note,
    ]),
  );
}

export function priceHistoryCsv(pi: ProductIntel, data: Dataset): string {
  const supplier = (id: string) => data.suppliers.find((s) => s.id === id)?.name ?? "";
  const own = data.purchases.filter((p) => p.productId === pi.product.id);
  const { comparable } = normalizePurchases(pi.product, own);
  const used = new Set(comparableObservations(comparable).map((p) => p.id));
  return toCsv(
    ["Date", "Supplier", "Quantity", "Unit", "Unit price", "Currency", "Unit price EUR", "Freight", "Total", "Invoice / reference", "Source", "Source file", "Used in price analysis"],
    [...comparable]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((p) => [
        date(p.date),
        supplier(p.supplierId),
        round(p.quantity, 4),
        p.unit,
        round(p.unitPrice, 6),
        p.currency,
        isPriced(p) ? round(basePrice(p), 6) : null,
        round(p.freightCost),
        round(p.totalAmount),
        p.invoiceReference,
        sourceName(p.source),
        p.sourceDoc?.filename,
        used.has(p.id) ? "yes" : p.priceReview === "excluded" ? "no (excluded)" : "no (no exchange rate)",
      ]),
  );
}

export function comparisonCsv(pi: ProductIntel): string {
  return toCsv(
    ["Product", "Supplier", "Country", "Role", "Basis", "Price", "Currency", "Price EUR", "Unit", "MOQ", "Lead time days", "Payment terms days", "Incoterm", "Last update", "Age days", "Price difference %", "Comparability", "Notes", "Source"],
    pi.comparison.map((r) => [
      pi.product.name,
      r.supplier.name,
      r.supplier.country,
      r.isCurrent ? "Current" : "Alternative",
      r.kind,
      round(r.price, 6),
      r.currency,
      round(r.priceEUR, 6),
      pi.product.unit,
      round(r.moq, 4),
      r.leadTimeDays,
      r.paymentTermsDays,
      r.incoterm,
      date(r.date),
      r.ageDays,
      round(r.differencePct),
      r.isCurrent ? "" : r.comparability,
      r.comparabilityReasons.join(" | "),
      r.source ? sourceName(r.source) : "",
    ]),
  );
}
