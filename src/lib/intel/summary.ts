/**
 * Plain-language summaries built from rules and templates — no language
 * model. Each sentence states a number the engine computed, so it can always
 * be traced back.
 */
import * as f from "../format";
import type { ComparisonRow } from "./comparison";
import type { Opportunity } from "./opportunities";
import type { Concentration, SupplierPriceChange } from "./portfolio";
import type { PriceMetrics } from "./price-metrics";
import type { DataQuality } from "./quality";

const abs1 = (n: number) => Math.abs(n).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const k = (n: number) => f.money(Math.round(n));

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

export function productSummary(i: ProductSummaryInput): string[] {
  const out: string[] = [];
  const m12 = i.price.changes.m12;
  if (i.currentPriceFlagged && i.price.current) {
    out.push(`The current price (${f.price(i.price.current.price)}) is far from the usual level and may be a data error — check it before relying on the figures below.`);
  }
  if (!i.price.current) {
    out.push("No purchases recorded yet, so there is no price to analyse.");
  } else if (m12.pct == null) {
    out.push("Only one purchase on record — no price history yet.");
  } else if (Math.abs(m12.pct) < 0.05) {
    out.push(`The price has not changed since ${f.month(m12.referenceDate)}.`);
  } else {
    out.push(`Current price is ${abs1(m12.pct)}% ${m12.pct > 0 ? "above" : "below"} ${f.month(m12.referenceDate)}.`);
  }

  if (i.annualSpend > 0) {
    out.push(`The product represents ${k(i.annualSpend)} annual spend${i.spendShare > 0 ? ` (${abs1(i.spendShare * 100)}% of the total)` : ""}.`);
  }

  const alternatives = i.comparison.filter((r) => !r.isCurrent);
  if (i.bestSaving && i.bestSaving.priceDifferencePct != null && i.bestSaving.potentialSaving != null) {
    const row = alternatives.find((r) => r.supplier.id === i.bestSaving!.alternativeSupplierId);
    const age = row?.expired ? "An expired" : row?.age === "old" ? "An old" : "A recent";
    const cmp = i.bestSaving.comparability === "partial" ? "partially comparable" : "comparable";
    out.push(
      `${age} ${cmp} ${row?.kind === "purchase" ? "price" : "quote"} from ${i.supplierName(i.bestSaving.alternativeSupplierId)} is ${abs1(i.bestSaving.priceDifferencePct)}% below the current supplier price.`,
    );
    out.push(`Potential nominal saving: ${k(i.bestSaving.potentialSaving)}/year before landed-cost adjustments (${i.bestSaving.confidence} confidence).`);
  } else if (i.price.current) {
    if (!alternatives.length) out.push("No alternative quotes on file to compare with.");
    else if (alternatives.every((r) => r.comparability === "not")) out.push("The alternatives on file can't be compared yet.");
    else out.push("No alternative on file is priced below the current supplier.");
  }

  if (i.concentration.sourcing === "single" && i.price.current) {
    out.push(`All purchases come from ${i.supplierName(i.concentration.shares[0].supplierId)}.`);
  }
  if (i.quality.level === "low" && i.price.current) {
    const why = i.quality.factors.find((x) => x.state === "poor");
    out.push(`Data quality is low${why ? ` (${why.detail.toLowerCase()})` : ""}: read these figures with caution.`);
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

export function supplierSummary(i: SupplierSummaryInput): string[] {
  const out: string[] = [];
  if (i.annualSpend > 0) {
    out.push(`${i.name} represents ${abs1(i.spendShare * 100)}% of annual purchasing spend (${k(i.annualSpend)}).`);
  } else {
    out.push(`No purchases from ${i.name} in the last 12 months.`);
  }
  const w = i.priceChange.weightedPct;
  if (w != null) {
    out.push(Math.abs(w) < 0.05 ? "Prices are unchanged year to date." : `Prices ${w > 0 ? "increased" : "decreased"} by a weighted ${abs1(w)}% year to date.`);
  }
  if (i.productsWithAlternatives > 0) {
    out.push(`${i.productsWithAlternatives} product${i.productsWithAlternatives > 1 ? "s have" : " has"} recent alternative quotes.`);
  }
  if (i.singleSourcedHighSpend > 0) {
    out.push(`${i.singleSourcedHighSpend} high-spend product${i.singleSourcedHighSpend > 1 ? "s are" : " is"} single-sourced from this supplier.`);
  }
  return out;
}
