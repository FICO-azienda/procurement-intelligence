/**
 * Plain-language summaries built from rules and templates — no language
 * model. Each sentence states a number the engine computed, so it can always
 * be traced back.
 */
import * as f from "../format";
import { en, lowerFirst, type Msg, type T } from "../i18n";
import type { ComparisonRow } from "./comparison";
import type { Opportunity } from "./opportunities";
import type { Concentration, SupplierPriceChange } from "./portfolio";
import type { PriceMetrics } from "./price-metrics";
import type { DataQuality } from "./quality";

const abs1 = (n: number) => Math.abs(n).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const k = (n: number) => f.money(Math.round(n));

/** "A recent comparable quote": whole phrases, because adjectives agree with the noun in other languages. */
const OFFER: Record<"expired" | "old" | "recent", Record<"partial" | "comparable", Record<"price" | "quote", Msg>>> = {
  expired: {
    partial: { price: "An expired partially comparable price", quote: "An expired partially comparable quote" },
    comparable: { price: "An expired comparable price", quote: "An expired comparable quote" },
  },
  old: {
    partial: { price: "An old partially comparable price", quote: "An old partially comparable quote" },
    comparable: { price: "An old comparable price", quote: "An old comparable quote" },
  },
  recent: {
    partial: { price: "A recent partially comparable price", quote: "A recent partially comparable quote" },
    comparable: { price: "A recent comparable price", quote: "A recent comparable quote" },
  },
};

export const CONFIDENCE_WORD: Record<"high" | "medium" | "low", Msg> = { high: "high|confidence", medium: "medium|confidence", low: "low|confidence" };

export interface ProductSummaryInput {
  price: PriceMetrics;
  annualSpend: number;
  spendShare: number;
  comparison: ComparisonRow[];
  bestSaving: Opportunity | null;
  concentration: Concentration;
  quality: DataQuality;
  currentPriceFlagged: boolean;
  supplierName: (id: string | null) => string;
}

export function productSummary(i: ProductSummaryInput, t: T = en): string[] {
  const out: string[] = [];
  const m12 = i.price.changes.m12;
  if (i.currentPriceFlagged && i.price.current) {
    out.push(t("The current price ({price}) is far from the usual level and may be a data error — check it before relying on the figures below.", { price: f.price(i.price.current.price) }));
  }
  if (!i.price.current) {
    out.push(t("No purchases recorded yet, so there is no price to analyse."));
  } else if (m12.pct == null) {
    out.push(t("Only one purchase on record — no price history yet."));
  } else if (Math.abs(m12.pct) < 0.05) {
    out.push(t("The price has not changed since {month}.", { month: f.month(m12.referenceDate, t) }));
  } else {
    out.push(t(m12.pct > 0 ? "Current price is {pct}% above {month}." : "Current price is {pct}% below {month}.", { pct: abs1(m12.pct), month: f.month(m12.referenceDate, t) }));
  }

  if (i.annualSpend > 0) {
    out.push(
      i.spendShare > 0
        ? t("The product represents {amount} annual spend ({share}% of the total).", { amount: k(i.annualSpend), share: abs1(i.spendShare * 100) })
        : t("The product represents {amount} annual spend.", { amount: k(i.annualSpend) }),
    );
  }

  const alternatives = i.comparison.filter((r) => !r.isCurrent);
  if (i.bestSaving && i.bestSaving.priceDifferencePct != null && i.bestSaving.potentialSaving != null) {
    const row = alternatives.find((r) => r.supplier.id === i.bestSaving!.alternativeSupplierId);
    const age = row?.expired ? "expired" : row?.age === "old" ? "old" : "recent";
    const cmp = i.bestSaving.comparability === "partial" ? "partial" : "comparable";
    out.push(
      t("{~offer} from {supplier} is {pct}% below the current supplier price.", {
        offer: OFFER[age][cmp][row?.kind === "purchase" ? "price" : "quote"],
        supplier: i.supplierName(i.bestSaving.alternativeSupplierId),
        pct: abs1(i.bestSaving.priceDifferencePct),
      }),
    );
    out.push(
      t("Potential nominal saving: {amount}/year before landed-cost adjustments ({~confidence} confidence).", {
        amount: k(i.bestSaving.potentialSaving),
        confidence: i.bestSaving.confidence ? CONFIDENCE_WORD[i.bestSaving.confidence] : "",
      }),
    );
  } else if (i.price.current) {
    if (!alternatives.length) out.push(t("No alternative quotes on file to compare with."));
    else if (alternatives.every((r) => r.comparability === "not")) out.push(t("The alternatives on file can't be compared yet."));
    else out.push(t("No alternative on file is priced below the current supplier."));
  }

  if (i.concentration.sourcing === "single" && i.price.current) {
    out.push(t("All purchases come from {supplier}.", { supplier: i.supplierName(i.concentration.shares[0].supplierId) }));
  }
  if (i.quality.level === "low" && i.price.current) {
    const why = i.quality.factors.find((x) => x.state === "poor");
    out.push(why ? t("Data quality is low ({why}): read these figures with caution.", { why: lowerFirst(why.detail) }) : t("Data quality is low: read these figures with caution."));
  }
  return out;
}

export interface SupplierSummaryInput {
  name: string;
  annualSpend: number;
  spendShare: number;
  priceChange: SupplierPriceChange;
  productsWithAlternatives: number;
  singleSourcedHighSpend: number;
}

export function supplierSummary(i: SupplierSummaryInput, t: T = en): string[] {
  const out: string[] = [];
  if (i.annualSpend > 0) {
    out.push(t("{name} represents {share}% of annual purchasing spend ({amount}).", { name: i.name, share: abs1(i.spendShare * 100), amount: k(i.annualSpend) }));
  } else {
    out.push(t("No purchases from {name} in the last 12 months.", { name: i.name }));
  }
  const w = i.priceChange.weightedPct;
  if (w != null) {
    out.push(
      Math.abs(w) < 0.05
        ? t("Prices are unchanged year to date.")
        : t(w > 0 ? "Prices increased by a weighted {pct}% year to date." : "Prices decreased by a weighted {pct}% year to date.", { pct: abs1(w) }),
    );
  }
  if (i.productsWithAlternatives > 0) {
    out.push(t.n(i.productsWithAlternatives, "{n} product has recent alternative quotes.", "{n} products have recent alternative quotes."));
  }
  if (i.singleSourcedHighSpend > 0) {
    out.push(t.n(i.singleSourcedHighSpend, "{n} high-spend product is single-sourced from this supplier.", "{n} high-spend products are single-sourced from this supplier."));
  }
  return out;
}
