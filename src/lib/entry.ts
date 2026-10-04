/**
 * What the entry forms show while the user types — computed, never asked.
 * Same definitions as the analytics: change = new price vs the last price
 * paid; annual impact = that difference × the quantity of the last 12 months.
 */
import { computeTotal } from "./analytics";

export interface PurchasePreviewInput {
  quantity: number | null;
  unitPrice: number | null;
  /** EUR per 1 unit of the purchase currency; 1 for EUR, null when unknown. */
  fxRate: number | null;
  freight?: number | null;
  otherCosts?: number | null;
  /** Last price paid for the product, EUR per unit. */
  previousPrice: number | null;
  /** Quantity bought in the last 12 months. */
  annualQuantity: number;
}

export interface PurchasePreview {
  /** In the purchase currency. */
  total: number | null;
  /** EUR per unit; null without an exchange rate. */
  priceEUR: number | null;
  changePct: number | null;
  /** EUR/year at the last 12 months' volume. */
  annualImpact: number | null;
}

export function purchasePreview(i: PurchasePreviewInput): PurchasePreview {
  const total = i.quantity != null && i.unitPrice != null ? computeTotal(i.quantity, i.unitPrice, i.freight ?? 0, i.otherCosts ?? 0) : null;
  const priceEUR = i.unitPrice != null && i.fxRate != null ? i.unitPrice * i.fxRate : null;
  const changePct = priceEUR != null && i.previousPrice != null && i.previousPrice > 0 ? (priceEUR / i.previousPrice - 1) * 100 : null;
  const moved = changePct != null && Math.abs(changePct) >= 0.05;
  return {
    total,
    priceEUR,
    changePct,
    annualImpact: moved && i.annualQuantity > 0 ? i.annualQuantity * (priceEUR! - i.previousPrice!) : null,
  };
}

/** A quote against what is paid today: negative = the quote is lower. */
export function quoteGapPct(quotedEUR: number | null, currentPrice: number | null): number | null {
  return quotedEUR != null && currentPrice != null && currentPrice > 0 ? (quotedEUR / currentPrice - 1) * 100 : null;
}
