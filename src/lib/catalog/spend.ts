/**
 * The company's whole spend, and how it splits: the products of the
 * catalogue (what Procurement Intelligence compares and negotiates) and
 * everything else an invoice can hold — transport, services, utilities,
 * office purchases. Same 12-month window and same EUR rules as every other
 * figure (lib/analytics.ts); nothing here is stored.
 */
import { baseTotal, isPriced, windowStart, type Dataset, type ProductData } from "../analytics";
import { isProductKind, isStrategic, type ProductKind } from "./kinds";

export interface SpendItem {
  product: ProductData;
  kind: ProductKind;
  /** Last 12 months, EUR. */
  annualSpend: number;
  lines: number;
  supplierIds: string[];
  lastDate: string | null;
}

export interface CompanySpend {
  /** Last 12 months, EUR. */
  total: number;
  catalogue: number;
  other: number;
  /** Spend that is not a product, one entry per item, largest first. */
  items: SpendItem[];
  byKind: { kind: ProductKind; amount: number; items: number }[];
  /** Total and other spend per supplier (last 12 months). */
  bySupplier: Map<string, { total: number; other: number }>;
}

/** The catalogue: products that are compared and negotiated, with their purchases and quotes. Every supplier stays. */
export function catalogueOf(data: Dataset): Dataset {
  const ids = new Set(data.products.filter((p) => isStrategic(p.kind)).map((p) => p.id));
  if (ids.size === data.products.length) return data;
  return {
    suppliers: data.suppliers,
    products: data.products.filter((p) => ids.has(p.id)),
    purchases: data.purchases.filter((p) => ids.has(p.productId)),
    quotes: data.quotes.filter((q) => ids.has(q.productId)),
  };
}

export function companySpend(data: Dataset, asOf: string): CompanySpend {
  const start = windowStart(asOf);
  const products = new Map(data.products.map((p) => [p.id, p]));
  const items = new Map<string, SpendItem>();
  const bySupplier = new Map<string, { total: number; other: number }>();
  let catalogue = 0;
  let other = 0;
  for (const p of data.purchases) {
    const product = products.get(p.productId);
    if (!product) continue;
    const strategic = isStrategic(product.kind);
    const amount = p.date > start && p.date <= asOf && isPriced(p) ? baseTotal(p) : 0;
    if (strategic) catalogue += amount;
    else other += amount;
    const s = bySupplier.get(p.supplierId) ?? { total: 0, other: 0 };
    s.total += amount;
    if (!strategic) s.other += amount;
    bySupplier.set(p.supplierId, s);
    if (strategic) continue;
    const item = items.get(product.id) ?? { product, kind: isProductKind(product.kind) ? product.kind : "other", annualSpend: 0, lines: 0, supplierIds: [], lastDate: null };
    item.annualSpend += amount;
    item.lines++;
    if (!item.supplierIds.includes(p.supplierId)) item.supplierIds.push(p.supplierId);
    if (!item.lastDate || p.date > item.lastDate) item.lastDate = p.date;
    items.set(product.id, item);
  }
  // Items created but not bought yet still belong to the list.
  for (const product of data.products) {
    if (!isStrategic(product.kind) && !items.has(product.id)) {
      items.set(product.id, { product, kind: isProductKind(product.kind) ? product.kind : "other", annualSpend: 0, lines: 0, supplierIds: [], lastDate: null });
    }
  }
  const list = [...items.values()].sort((a, b) => b.annualSpend - a.annualSpend || a.product.name.localeCompare(b.product.name));
  const kinds = new Map<ProductKind, { amount: number; items: number }>();
  for (const i of list) {
    const k = kinds.get(i.kind) ?? { amount: 0, items: 0 };
    k.amount += i.annualSpend;
    k.items++;
    kinds.set(i.kind, k);
  }
  return {
    total: catalogue + other,
    catalogue,
    other,
    items: list,
    byKind: [...kinds.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.amount - a.amount),
    bySupplier,
  };
}
