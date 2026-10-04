/**
 * Groups the lines of an import by supplier and by product, so that each
 * decision ("ABC S.r.l. is ABC Srl") is taken once for all its lines.
 */
import type { Dataset } from "../analytics";
import { en, type T } from "../i18n";
import type { MatchResult } from "./match";
import { suggestSku } from "../sku";
import { codeKey, companyKey, productKey, tidy, vatKey } from "./normalize/text";
import type { ItemData } from "./types";

export function supplierGroupKey(d: ItemData) {
  const vat = vatKey(d.supplierVat);
  return vat ? `vat:${vat}` : `name:${companyKey(d.supplierName)}`;
}

export function productGroupKey(d: ItemData) {
  if (d.supplierSku) return `ssku:${codeKey(d.supplierSku)}`;
  if (d.sku) return `sku:${codeKey(d.sku)}`;
  return `text:${productKey(d.productName ?? d.description)}`;
}

export interface GroupItem {
  data: ItemData;
  status: string;
  supplierId: string | null;
  supplierMatch: MatchResult | null;
  supplierResolution: string | null;
  productId: string | null;
  productMatch: MatchResult | null;
  productResolution: string | null;
}

export type GroupState = "matched" | "suggested" | "unknown";

export interface MatchGroup {
  key: string;
  /** How the document writes it. */
  label: string;
  detail: string | null;
  lines: number;
  state: GroupState;
  /** Resolved record (matched) or suggestion (suggested). */
  targetId: string | null;
  targetName: string | null;
  confidence: number | null;
  reason: string | null;
  resolution: string | null;
  alternatives: { id: string; name: string; confidence: number }[];
  /** Prefill for "Create new". */
  create: Record<string, string>;
}

export function buildGroups(items: GroupItem[], data: Dataset, t: T = en) {
  const open = items.filter((i) => i.status === "ready" || i.status === "attention");
  const supplierName = (id: string | null) => data.suppliers.find((s) => s.id === id)?.name ?? null;
  const productName = (id: string | null) => data.products.find((p) => p.id === id)?.name ?? null;

  const suppliers = new Map<string, MatchGroup>();
  for (const i of open) {
    const key = supplierGroupKey(i.data);
    const g = suppliers.get(key);
    if (g) {
      g.lines++;
      continue;
    }
    const m = i.supplierMatch;
    const state: GroupState = i.supplierId ? "matched" : m?.status === "probable" ? "suggested" : "unknown";
    const target = i.supplierId ?? (state === "suggested" ? m!.id : null);
    suppliers.set(key, {
      key,
      label: tidy(i.data.supplierName) || i.data.supplierVat || t("No supplier in the file"),
      detail: i.data.supplierVat ? t("VAT {vat}", { vat: i.data.supplierVat }) : null,
      lines: 1,
      state,
      targetId: target,
      targetName: supplierName(target),
      confidence: state === "matched" ? null : (m?.confidence ?? null),
      reason: m?.reason ? t.any(m.reason) : null,
      resolution: i.supplierResolution,
      alternatives: (m?.alternatives ?? []).map((a) => ({ id: a.id, name: supplierName(a.id) ?? "", confidence: a.confidence })),
      create: {
        name: tidy(i.data.supplierName),
        country: i.data.supplierCountry ?? "",
        vatNumber: i.data.supplierVat ?? "",
      },
    });
  }

  const products = new Map<string, MatchGroup>();
  for (const i of open) {
    const key = productGroupKey(i.data);
    const g = products.get(key);
    if (g) {
      g.lines++;
      continue;
    }
    const m = i.productMatch;
    const state: GroupState = i.productId ? "matched" : m?.status === "probable" ? "suggested" : "unknown";
    const target = i.productId ?? (state === "suggested" ? m!.id : null);
    const name = tidy(i.data.productName ?? i.data.description) || i.data.supplierSku || i.data.sku || "";
    products.set(key, {
      key,
      label: name || t("No product in the file"),
      detail: [i.data.supplierSku && t("Supplier code {code}", { code: i.data.supplierSku }), i.data.sku && t("Code {code}", { code: i.data.sku })].filter(Boolean).join(" · ") || null,
      lines: 1,
      state,
      targetId: target,
      targetName: productName(target),
      confidence: state === "matched" ? null : (m?.confidence ?? null),
      reason: m?.reason ? t.any(m.reason) : null,
      resolution: i.productResolution,
      alternatives: (m?.alternatives ?? []).map((a) => ({ id: a.id, name: productName(a.id) ?? "", confidence: a.confidence })),
      create: {
        name,
        sku: i.data.sku ? i.data.sku.toUpperCase() : suggestSku(name),
        unit: i.data.unit ?? "",
        category: i.data.category ?? "",
      },
    });
  }

  const order = { unknown: 0, suggested: 1, matched: 2 };
  const sort = (a: MatchGroup, b: MatchGroup) => order[a.state] - order[b.state] || a.label.localeCompare(b.label);
  return { suppliers: [...suppliers.values()].sort(sort), products: [...products.values()].sort(sort) };
}
