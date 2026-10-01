/**
 * Decides, for each extracted line, what is wrong or noteworthy and whether it
 * is ready to import. Pure: re-run after every user correction/confirmation.
 *
 *   ready     → no blocking issue, review flags confirmed (or none)
 *   attention → something must be fixed, chosen or confirmed
 */
import { productMetrics, todayISO, type Dataset, type PurchaseData } from "../analytics";
import { detectAnomalies } from "../anomalies";
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

export function evaluateItems(items: ItemState[], ctx: EvalContext): Map<string, { issues: Issue[]; status: "ready" | "attention" }> {
  const asOf = ctx.asOf ?? todayISO();
  const existingPurchases = new Set(ctx.data.purchases.map((p) => purchaseKey(p)));
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

  const seenInFile = new Map<string, number>();
  const out = new Map<string, { issues: Issue[]; status: "ready" | "attention" }>();

  for (const item of [...items].sort((a, b) => a.line - b.line)) {
    const d = item.data;
    const corrected = new Set(d.corrected ?? []);
    const issues: Issue[] = item.extracted.parseIssues.filter((i) => !i.field || !corrected.has(i.field));
    const has = (field: keyof ItemData) => issues.some((i) => i.field === field && i.severity === "blocking");

    // Required values
    if (!d.date && !has("date")) issues.push({ code: "missing_field", severity: "blocking", field: "date", message: "Date missing" });
    if (item.recordType === "purchase" && d.quantity == null && !has("quantity")) {
      issues.push({ code: "missing_field", severity: "blocking", field: "quantity", message: "Quantity missing" });
    }
    if (item.recordType === "purchase" && d.quantity != null && d.quantity <= 0) {
      issues.push({ code: "invalid_number", severity: "blocking", field: "quantity", message: "Quantity must be greater than zero" });
    }
    if (d.unitPrice == null && !has("unitPrice")) issues.push({ code: "missing_field", severity: "blocking", field: "unitPrice", message: "Unit price missing" });
    if (!d.currency && !has("currency")) issues.push({ code: "currency_missing", severity: "blocking", field: "currency", message: "Currency missing — select it" });
    if (d.currency && d.currency !== "EUR" && d.fxRate == null) {
      issues.push({ code: "fx_missing", severity: "info", field: "fxRate", message: `Kept in ${d.currency}. Not included in EUR totals until an exchange rate is added.` });
    }

    // Supplier
    if (!item.supplierId) {
      const m = item.supplierMatch;
      issues.push(
        m?.status === "probable"
          ? { code: "supplier_probable", severity: "blocking", message: `Supplier "${d.supplierName}" — confirm the suggested match` }
          : { code: "supplier_unmatched", severity: "blocking", message: d.supplierName ? `Unknown supplier "${d.supplierName}"` : "Supplier missing" },
      );
    } else if (item.supplierResolution === "created") {
      issues.push({ code: "new_supplier", severity: "info", message: "New supplier created from this file" });
    }

    // Product
    const product = item.productId ? ctx.data.products.find((p) => p.id === item.productId) : undefined;
    if (!product) {
      const label = d.productName ?? d.description ?? d.supplierSku ?? d.sku ?? "";
      issues.push(
        item.productMatch?.status === "probable"
          ? { code: "product_probable", severity: "blocking", message: `"${label}" — confirm the suggested product` }
          : { code: "product_unmatched", severity: "blocking", message: label ? `Unknown product "${label}"` : "Product missing" },
      );
    }

    // Unit vs product unit
    const converted = product ? inProductUnit(d, product.unit) : null;
    if (product && !has("unit")) {
      if (!d.unit) {
        issues.push({ code: "unit_assumed", severity: "info", field: "unit", message: `No unit in the file — quantity read in ${product.unit}, the product's unit` });
      } else if (d.unit !== product.unit) {
        if (converted) {
          issues.push({ code: "unit_converted", severity: "info", field: "unit", message: `Converted from ${d.unit} to ${product.unit}` });
        } else {
          issues.push({ code: "unit_changed", severity: "blocking", field: "unit", message: `The file uses "${d.unit}" but ${product.name} is measured in ${product.unit}` });
        }
      }
    }

    // Low extraction confidence (PDF)
    if (item.confidence != null && item.confidence < 0.7) {
      issues.push({ code: "low_confidence", severity: "review", message: "Read from the PDF with low certainty — check the values" });
    }

    // Duplicates
    if (product && item.supplierId && d.date && converted) {
      const key =
        item.recordType === "purchase"
          ? purchaseKey({ supplierId: item.supplierId, invoiceReference: d.invoiceReference, date: d.date, productId: product.id, quantity: converted.quantity, unitPrice: converted.unitPrice })
          : quoteKey({ supplierId: item.supplierId, date: d.date, productId: product.id, unitPrice: converted.unitPrice });
      const exists = item.recordType === "purchase" ? existingPurchases.has(key) : existingQuotes.has(key);
      if (exists && item.duplicateDecision !== "import") {
        if (item.duplicateDecision !== "skip") {
          issues.push({ code: "duplicate", severity: "blocking", message: "This line appears to have already been imported" });
        }
      } else if (seenInFile.has(key) && item.duplicateDecision !== "import") {
        issues.push({ code: "duplicate_in_file", severity: "review", message: `Same as line ${seenInFile.get(key)} of this file` });
      }
      if (!seenInFile.has(key)) seenInFile.set(key, item.line);

      // Price checks (purchases only, need a comparable EUR price)
      if (item.recordType === "purchase") {
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
