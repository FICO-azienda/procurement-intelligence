/**
 * Decides, for each extracted line, what is wrong or noteworthy and whether it
 * is ready to import. Pure: re-run after every user correction/confirmation.
 *
 *   ready     → no blocking issue, review flags confirmed (or none)
 *   attention → something must be fixed, chosen or confirmed
 *   skipped   → not a purchase (a credit note, a line with no amount): set
 *               aside with its reason, until the user brings it back
 *
 * Lines of spend that is not a product (transport, a service, a utility) are
 * held to what matters for spend: who, when, how much. Their units are not
 * compared and their prices are not watched.
 */
import { productMetrics, todayISO, type Dataset, type PurchaseData } from "../analytics";
import { detectAnomalies } from "../anomalies";
import { isStrategic } from "../catalog/kinds";
import { say } from "../i18n";
import type { MatchResult } from "./match";
import { conversionFactor } from "./normalize/units";
import { codeKey } from "./normalize/text";
import type { CurrentData, ExtractedData, Issue, ItemData, RecordType } from "./types";

export interface ItemState {
  id: string;
  line: number;
  recordType: RecordType;
  extracted: ExtractedData;
  data: CurrentData;
  confidence: number | null;
  supplierId: string | null;
  supplierMatch: MatchResult | null;
  supplierResolution: string | null;
  productId: string | null;
  productMatch: MatchResult | null;
  productResolution: string | null;
  acknowledged: boolean;
  duplicateDecision: string | null;
}

export interface EvalContext {
  data: Dataset;
  asOf?: string;
}

/** Quantity and price expressed in the product's unit (2 t at €1.500/t → 2000 kg at €1,50/kg). */
export function inProductUnit(d: ItemData, productUnit: string | null) {
  if (!productUnit || !d.unit || d.unit === productUnit) {
    return { quantity: d.quantity, unitPrice: d.unitPrice, moq: d.moq, factor: 1, unit: productUnit ?? d.unit };
  }
  const f = conversionFactor(d.unit, productUnit);
  if (f == null) return null;
  return {
    quantity: d.quantity == null ? null : d.quantity * f,
    unitPrice: d.unitPrice == null ? null : d.unitPrice / f,
    moq: d.moq == null ? null : d.moq * f,
    factor: f,
    unit: productUnit,
  };
}

const r4 = (n: number | null) => (n == null ? "" : String(Math.round(n * 1e4) / 1e4));
const ref = (s: string | null | undefined) => codeKey(s);

/** Identity of a purchase line, to spot the same invoice line imported twice. */
export function purchaseKey(p: { supplierId: string; invoiceReference: string | null; date: string; productId: string; quantity: number | null; unitPrice: number | null }) {
  return [p.supplierId, ref(p.invoiceReference), p.date, p.productId, r4(p.quantity), r4(p.unitPrice)].join("|");
}
export function quoteKey(q: { supplierId: string; date: string; productId: string; unitPrice: number | null }) {
  return [q.supplierId, q.date, q.productId, r4(q.unitPrice)].join("|");
}

/** Two lines are the same line when their invoice line numbers agree — or when one of them has none to compare. */
const sameLine = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null || a === b;

export function evaluateItems(items: ItemState[], ctx: EvalContext): Map<string, { issues: Issue[]; status: "ready" | "attention" | "skipped" }> {
  const asOf = ctx.asOf ?? todayISO();
  const existingPurchases = new Map<string, (number | null)[]>();
  for (const p of ctx.data.purchases) {
    const key = purchaseKey(p);
    if (!existingPurchases.has(key)) existingPurchases.set(key, []);
    existingPurchases.get(key)!.push(p.invoiceLine ?? null);
  }
  const existingQuotes = new Set(ctx.data.quotes.map((q) => quoteKey(q)));
  const annualQty = new Map<string, number>();
  const annual = (productId: string) => {
    if (!annualQty.has(productId)) {
      const product = ctx.data.products.find((p) => p.id === productId);
      annualQty.set(productId, product ? productMetrics(product, ctx.data.purchases, asOf).annualQuantity : 0);
    }
    return annualQty.get(productId)!;
  };
  const historyByProduct = new Map<string, PurchaseData[]>();
  for (const p of ctx.data.purchases) {
    if (!historyByProduct.has(p.productId)) historyByProduct.set(p.productId, []);
    historyByProduct.get(p.productId)!.push(p);
  }

  const seenInFile = new Map<string, { line: number; invoiceLine: number | null }[]>();
  const out = new Map<string, { issues: Issue[]; status: "ready" | "attention" | "skipped" }>();

  for (const item of [...items].sort((a, b) => a.line - b.line)) {
    const d = item.data;
    const corrected = new Set(d.corrected ?? []);
    const product = item.productId ? ctx.data.products.find((p) => p.id === item.productId) : undefined;
    /** Spend that is not a product: the unit is whatever the invoice says. */
    const spend = !!product && !isStrategic(product.kind);
    const issues: Issue[] = item.extracted.parseIssues.filter((i) => (!i.field || !corrected.has(i.field)) && !(spend && i.code === "unit_unknown"));
    const has = (field: keyof ItemData) => issues.some((i) => i.field === field && i.severity === "blocking");

    // Not a purchase: set aside, unless the user said to keep it.
    if (issues.some((i) => i.excludes) && !item.acknowledged) {
      out.set(item.id, { issues, status: "skipped" });
      continue;
    }

    // Required values
    if (!d.date && !has("date")) issues.push({ code: "missing_field", severity: "blocking", field: "date", ...say("Date missing") });
    if (item.recordType === "purchase" && d.quantity == null && !has("quantity")) {
      issues.push({ code: "missing_field", severity: "blocking", field: "quantity", ...say("Quantity missing") });
    }
    if (item.recordType === "purchase" && d.quantity != null && d.quantity <= 0) {
      issues.push({ code: "invalid_number", severity: "blocking", field: "quantity", ...say("Quantity must be greater than zero") });
    }
    if (d.unitPrice == null && !has("unitPrice")) issues.push({ code: "missing_field", severity: "blocking", field: "unitPrice", ...say("Unit price missing") });
    // A negative amount lowers what was spent (a discount, a credit): fine on a bill, never the price of a product.
    if (!spend && ((d.unitPrice ?? 0) < 0 || (d.total ?? 0) < 0) && !has("unitPrice")) {
      issues.push({
        code: "invalid_number",
        severity: "blocking",
        field: "unitPrice",
        ...say("This line has a negative amount ({total}): it looks like a return or a correction, not a purchase", { total: (d.total ?? d.unitPrice ?? 0).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }),
      });
    }
    if (!d.currency && !has("currency")) issues.push({ code: "currency_missing", severity: "blocking", field: "currency", ...say("Currency missing — select it") });
    if (d.currency && d.currency !== "EUR" && d.fxRate == null) {
      issues.push({ code: "fx_missing", severity: "info", field: "fxRate", ...say("Kept in {currency}. Not included in EUR totals until an exchange rate is added.", { currency: d.currency }) });
    }

    // Supplier
    if (!item.supplierId) {
      const m = item.supplierMatch;
      issues.push(
        m?.status === "probable"
          ? { code: "supplier_probable", severity: "blocking", ...say('Supplier "{name}" — confirm the suggested match', { name: d.supplierName }) }
          : { code: "supplier_unmatched", severity: "blocking", ...(d.supplierName ? say('Unknown supplier "{name}"', { name: d.supplierName }) : say("Supplier missing")) },
      );
    } else if (item.supplierResolution === "created") {
      issues.push({ code: "new_supplier", severity: "info", ...say("New supplier created from this file") });
    }

    // Product
    if (!product) {
      const label = d.productName ?? d.description ?? d.supplierSku ?? d.sku ?? "";
      issues.push(
        item.productMatch?.status === "probable"
          ? { code: "product_probable", severity: "blocking", ...say('"{name}" — confirm the suggested product', { name: label }) }
          : { code: "product_unmatched", severity: "blocking", ...(label ? say('Unknown product "{name}"', { name: label }) : say("Product missing")) },
      );
    }

    // Unit vs product unit
    const converted = !product ? null : spend ? { quantity: d.quantity, unitPrice: d.unitPrice, moq: d.moq, factor: 1, unit: d.unit ?? product.unit } : inProductUnit(d, product.unit);
    if (product && !spend && !has("unit")) {
      if (!d.unit) {
        issues.push({ code: "unit_assumed", severity: "info", field: "unit", ...say("No unit in the file — quantity read in {unit}, the product's unit", { unit: product.unit }) });
      } else if (d.unit !== product.unit) {
        if (converted) {
          issues.push({ code: "unit_converted", severity: "info", field: "unit", ...say("Converted from {from} to {to}", { from: d.unit, to: product.unit }) });
        } else {
          issues.push({ code: "unit_changed", severity: "blocking", field: "unit", ...say('The file uses "{from}" but {product} is measured in {to}', { from: d.unit, product: product.name, to: product.unit }) });
        }
      }
    }

    // Low extraction confidence (PDF)
    if (item.confidence != null && item.confidence < 0.7) {
      issues.push({ code: "low_confidence", severity: "review", ...say("Read from the PDF with low certainty — check the values") });
    }

    // Duplicates
    if (product && item.supplierId && d.date && converted) {
      const key =
        item.recordType === "purchase"
          ? purchaseKey({ supplierId: item.supplierId, invoiceReference: d.invoiceReference, date: d.date, productId: product.id, quantity: converted.quantity, unitPrice: converted.unitPrice })
          : quoteKey({ supplierId: item.supplierId, date: d.date, productId: product.id, unitPrice: converted.unitPrice });
      const exists = item.recordType === "purchase" ? !!existingPurchases.get(key)?.some((line) => sameLine(line, d.invoiceLine)) : existingQuotes.has(key);
      // Two equal lines with different numbers on one invoice are two purchases, not one read twice.
      const twin = seenInFile.get(key)?.find((s) => sameLine(s.invoiceLine, d.invoiceLine));
      if (exists && item.duplicateDecision !== "import") {
        if (item.duplicateDecision !== "skip") {
          issues.push({ code: "duplicate", severity: "blocking", ...say("This line appears to have already been imported") });
        }
      } else if (twin && item.duplicateDecision !== "import") {
        issues.push({ code: "duplicate_in_file", severity: "review", ...say("Same as line {line} of this file", { line: twin.line }) });
      }
      if (!seenInFile.has(key)) seenInFile.set(key, []);
      seenInFile.get(key)!.push({ line: item.line, invoiceLine: d.invoiceLine ?? null });

      // Price checks (purchases of products only, need a comparable EUR price)
      if (item.recordType === "purchase" && !spend) {
        const fx = d.currency === "EUR" ? 1 : d.fxRate;
        const price = converted.unitPrice != null && fx != null ? converted.unitPrice * fx : null;
        issues.push(
          ...detectAnomalies(
            { productId: product.id, supplierId: item.supplierId, date: d.date, price, quantity: converted.quantity, currency: d.currency ?? "EUR" },
            historyByProduct.get(product.id) ?? [],
            ctx.data.quotes.filter((q) => q.productId === product.id),
            annual(product.id),
          ),
        );
      }
    }

    const blocking = issues.some((i) => i.severity === "blocking");
    const review = issues.some((i) => i.severity === "review");
    const status = blocking || (review && !item.acknowledged) ? "attention" : "ready";
    out.set(item.id, { issues, status });
  }
  return out;
}
