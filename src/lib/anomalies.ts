/**
 * Price and quantity checks for a new purchase against history. Simple,
 * explainable rules — no statistics beyond a median. Thresholds live in
 * ANOMALY_RULES so they can be tuned without touching the logic.
 *
 * Used by the import review (before approval) and reusable anywhere a new
 * purchase needs a sanity check.
 */
import { basePrice, isPriced, type PurchaseData, type QuoteData } from "./analytics";
import type { Issue } from "./import/types";

export const ANOMALY_RULES = {
  /** Increase vs previous purchase that needs a human look. */
  reviewIncreasePct: 5,
  /** Increase that is flagged high priority. */
  highIncreasePct: 10,
  /** Distance from the historical median price that needs review. */
  medianDeviationPct: 20,
  /** Quantity above N × the median order quantity needs review. */
  quantityHighFactor: 3,
  /** Minimum past purchases before median-based rules apply. */
  minHistory: 3,
  /** Invoiced vs quoted price difference that needs review. */
  quoteDeviationPct: 5,
} as const;

export interface Candidate {
  productId: string;
  supplierId: string;
  date: string;
  /** EUR per product unit; null when the exchange rate is unknown. */
  price: number | null;
  /** Quantity in the product's unit. */
  quantity: number | null;
  currency: string;
}

export interface PriceChangeData {
  previousPrice: number;
  previousDate: string;
  newPrice: number;
  pct: number;
  annualQuantity: number;
  /** annual quantity × price difference (EUR per year). */
  annualImpact: number;
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const pct = (a: number, b: number) => (a / b - 1) * 100;
const fmt = (n: number) => `€${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const fmtPct = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

/**
 * @param history  existing purchases of the same product (any supplier)
 * @param quotes   existing quotes for the same product
 * @param annualQuantity quantity bought in the last 12 months (for the impact)
 */
export function detectAnomalies(
  c: Candidate,
  history: PurchaseData[],
  quotes: QuoteData[],
  annualQuantity: number,
): Issue[] {
  const issues: Issue[] = [];
  const before = history.filter((p) => p.date <= c.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const priced = before.filter(isPriced);
  const previous = priced.at(-1);

  if (before.length > 0 && !before.some((p) => p.supplierId === c.supplierId)) {
    issues.push({ code: "new_supplier_for_product", severity: "info", message: "First purchase of this product from this supplier" });
  }
  const lastAny = before.at(-1);
  if (lastAny && lastAny.currency !== c.currency) {
    issues.push({
      code: "currency_changed",
      severity: "review",
      field: "currency",
      message: `Currency changed: previous purchase was in ${lastAny.currency}, this one in ${c.currency}`,
    });
  }

  if (c.price != null && previous) {
    const prev = basePrice(previous);
    const change = pct(c.price, prev);
    const data: PriceChangeData = {
      previousPrice: prev,
      previousDate: previous.date,
      newPrice: c.price,
      pct: change,
      annualQuantity,
      annualImpact: annualQuantity * (c.price - prev),
    };
    const message = `Price ${change >= 0 ? "increase" : "decrease"}: ${fmt(prev)} → ${fmt(c.price)} (${fmtPct(change)}) vs previous purchase`;
    if (change > ANOMALY_RULES.highIncreasePct) {
      issues.push({ code: "price_increase", severity: "review", priority: "high", message, data: { ...data } });
    } else if (change > ANOMALY_RULES.reviewIncreasePct) {
      issues.push({ code: "price_increase", severity: "review", message, data: { ...data } });
    } else if (change > 0.05) {
      issues.push({ code: "price_increase", severity: "info", message, data: { ...data } });
    } else if (change < -0.05) {
      issues.push({ code: "price_decrease", severity: "info", message, data: { ...data } });
    }
  }

  if (c.price != null && priced.length >= ANOMALY_RULES.minHistory) {
    const med = median(priced.map(basePrice));
    const dev = pct(c.price, med);
    if (Math.abs(dev) > ANOMALY_RULES.medianDeviationPct) {
      issues.push({
        code: "price_vs_median",
        severity: "review",
        message: `Price is ${fmtPct(dev)} away from the usual price (median ${fmt(med)})`,
        data: { median: med, pct: dev },
      });
    }
  }

  if (c.quantity != null && before.length >= ANOMALY_RULES.minHistory) {
    const medQty = median(before.map((p) => p.quantity));
    if (medQty > 0 && c.quantity > medQty * ANOMALY_RULES.quantityHighFactor) {
      issues.push({
        code: "quantity_high",
        severity: "review",
        field: "quantity",
        message: `Quantity is ${Math.round(c.quantity / medQty)}× the usual order (${medQty.toLocaleString("it-IT")})`,
      });
    }
  }

  const quote = quotes
    .filter((q) => q.supplierId === c.supplierId && q.date <= c.date && isPriced(q))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .at(-1);
  if (c.price != null && quote && isPriced(quote)) {
    const q = basePrice(quote);
    const dev = pct(c.price, q);
    if (Math.abs(dev) > 0.5) {
      issues.push({
        code: "price_vs_quote",
        severity: Math.abs(dev) > ANOMALY_RULES.quoteDeviationPct ? "review" : "info",
        message: `Quoted ${fmt(q)} on ${quote.date.split("-").reverse().join("/")}, invoiced ${fmt(c.price)} (${fmtPct(dev)})`,
        data: { quotedPrice: q, pct: dev },
      });
    }
  }
  return issues;
}
