/**
 * Opportunity engine: looks for situations worth a buyer's attention and puts
 * a number on them only when the data supports one.
 *
 * Vocabulary (kept strict on purpose):
 *   price difference  → nominal gap between two prices
 *   potential saving  → (current − alternative) × annual quantity, from prices
 *                       alone: before freight, duties, quality, inventory and
 *                       commercial conditions
 *   verified saving   → not computed here; confirmed by the user in a later phase
 *
 * No saving is produced for offers that are not comparable (unknown exchange
 * rate, unconvertible unit, or marked so by the user).
 */
import type { ProductData } from "../analytics";
import type { ComparisonRow } from "./comparison";
import { INTEL_CONFIG, type IntelConfig } from "./config";
import type { PriceMetrics } from "./price-metrics";

export type Confidence = "high" | "medium" | "low";
export type FactorState = "ok" | "caution" | "poor";

export interface ConfidenceFactor {
  key: "unit" | "currency" | "specs" | "age" | "quantity" | "data" | "comparability";
  label: string;
  state: FactorState;
  detail: string;
}

export interface SavingEstimate {
  /** Current minus alternative, EUR per unit (positive = alternative is lower). */
  priceDifference: number;
  priceDifferencePct: number;
  annualQuantity: number;
  /** priceDifference × annualQuantity, EUR/year. */
  potentialSaving: number;
  confidence: Confidence;
  factors: ConfidenceFactor[];
}

export interface SavingContext {
  currentPrice: number | null;
  currentCurrency: string | null;
  annualQuantity: number;
  typicalOrderQuantity: number | null;
  /** The current price is itself flagged as a possible data error. */
  currentPriceIsOutlier: boolean;
  dataQuality: "high" | "medium" | "low";
  unit: string;
}

/** Potential saving of one alternative offer, or null when none can be claimed. */
export function estimateSaving(row: ComparisonRow, ctx: SavingContext, cfg: IntelConfig = INTEL_CONFIG): SavingEstimate | null {
  if (row.isCurrent || row.comparability === "not" || row.priceEUR == null || ctx.currentPrice == null) return null;
  if (!(ctx.annualQuantity > 0)) return null;
  const priceDifference = ctx.currentPrice - row.priceEUR;
  const priceDifferencePct = (priceDifference / ctx.currentPrice) * 100;
  if (priceDifferencePct < cfg.minPriceGapPct) return null;

  const factors: ConfidenceFactor[] = [];
  factors.push({ key: "unit", label: "Unit", state: "ok", detail: `Both prices per ${ctx.unit}` });

  factors.push(
    row.currency === ctx.currentCurrency
      ? { key: "currency", label: "Currency", state: "ok", detail: `Both in ${row.currency}` }
      : {
          key: "currency",
          label: "Currency",
          state: "caution",
          detail: `Converted from ${row.currency} at the rate recorded on ${row.date ? row.date.split("-").reverse().join("/") : "the offer"}`,
        },
  );

  factors.push(
    row.specDifferences.length
      ? { key: "specs", label: "Specifications", state: "caution", detail: `${row.specDifferences.length} difference${row.specDifferences.length > 1 ? "s" : ""}: ${row.specDifferences.map((d) => d.name).join(", ")}` }
      : row.specsKnown
        ? { key: "specs", label: "Specifications", state: "ok", detail: "Recorded specifications match" }
        : { key: "specs", label: "Specifications", state: cfg.requireSpecsForHighConfidence ? "caution" : "ok", detail: "Not compared — no specifications recorded for this offer" },
  );

  const what = row.kind === "quote" ? "Quote" : "Last purchase";
  factors.push(
    row.expired
      ? { key: "age", label: "Offer age", state: "poor", detail: "Quote validity has expired" }
      : row.age === "old"
        ? { key: "age", label: "Offer age", state: "poor", detail: `${what} is ${row.ageDays} days old` }
        : { key: "age", label: "Offer age", state: "ok", detail: `${what} is ${row.ageDays} days old` },
  );

  const typical = ctx.typicalOrderQuantity;
  if (row.moq == null) {
    factors.push({ key: "quantity", label: "Quantity", state: "caution", detail: "MOQ unknown" });
  } else if (row.moq > ctx.annualQuantity) {
    factors.push({ key: "quantity", label: "Quantity", state: "poor", detail: `MOQ ${fmt(row.moq)} ${ctx.unit} exceeds your annual volume of ${fmt(ctx.annualQuantity)} ${ctx.unit}` });
  } else if (typical != null && row.moq > typical * cfg.moqToleranceFactor) {
    factors.push({ key: "quantity", label: "Quantity", state: "caution", detail: `MOQ ${fmt(row.moq)} ${ctx.unit} vs typical order ${fmt(typical)} ${ctx.unit}` });
  } else {
    factors.push({ key: "quantity", label: "Quantity", state: "ok", detail: `MOQ ${fmt(row.moq)} ${ctx.unit} fits your orders` });
  }

  if (ctx.currentPriceIsOutlier) {
    factors.push({ key: "data", label: "Your data", state: "poor", detail: "The current price is flagged as a possible data anomaly" });
  } else if (ctx.dataQuality === "low") {
    factors.push({ key: "data", label: "Your data", state: "caution", detail: "Little or old purchase history for this product" });
  } else {
    factors.push({ key: "data", label: "Your data", state: "ok", detail: "Enough recent purchase history" });
  }

  if (row.overridden) {
    factors.push({ key: "comparability", label: "Comparability", state: row.comparability === "partial" ? "caution" : "ok", detail: row.comparabilityReasons[0] ?? "Set by you" });
  }

  const confidence: Confidence = factors.some((f) => f.state === "poor") ? "low" : factors.some((f) => f.state === "caution") ? "medium" : "high";
  return {
    priceDifference,
    priceDifferencePct,
    annualQuantity: ctx.annualQuantity,
    potentialSaving: priceDifference * ctx.annualQuantity,
    confidence,
    factors,
  };
}

const fmt = (n: number) => n.toLocaleString("it-IT", { useGrouping: "always", maximumFractionDigits: 2 });

/** Incoterms where the seller delivers to destination: transport is in the price. */
export const DELIVERED_INCOTERMS = new Set(["DAP", "DPU", "DDP"]);

/** What is still unknown before a decision (prepares the landed-cost phase). */
export function missingInformation(row: ComparisonRow, current: ComparisonRow | null): string[] {
  const out: string[] = [];
  if (row.fxRequired) out.push(`FX conversion required (${row.currency})`);
  if (row.freightCost == null) {
    if (row.incoterm && DELIVERED_INCOTERMS.has(row.incoterm)) out.push(`Freight should be included (Incoterm ${row.incoterm}) — to be confirmed`);
    else out.push(row.incoterm ? `Freight unknown (Incoterm ${row.incoterm}: transport not fully included)` : "Freight unknown");
  }
  if (!row.supplier.country || !current?.supplier.country || row.supplier.country !== current.supplier.country) {
    out.push("Duties and customs not assessed");
  }
  if (!row.specsKnown) out.push("Specifications not compared");
  out.push("Quality comparison missing");
  if (row.moq == null) out.push("MOQ unknown");
  if (row.leadTimeDays == null) out.push("Lead time unknown");
  else if (current?.leadTimeDays != null && row.leadTimeDays > current.leadTimeDays) {
    out.push(`Longer lead time (${row.leadTimeDays} vs ${current.leadTimeDays} days): inventory impact not included`);
  }
  if (row.paymentTermsDays == null) out.push("Payment terms unknown");
  else if (current?.paymentTermsDays != null && row.paymentTermsDays < current.paymentTermsDays) {
    out.push(`Shorter payment terms (${row.paymentTermsDays === 0 ? "advance" : row.paymentTermsDays + " days"} vs ${current.paymentTermsDays} days): financing cost not included`);
  }
  out.push("Landed cost not calculated");
  return out;
}

// ---------------- Opportunities ----------------

export type OpportunityType = "lower_quote" | "above_average" | "price_increase" | "leverage" | "single_source";

export const OPPORTUNITY_LABEL: Record<OpportunityType, string> = {
  lower_quote: "Lower quote",
  above_average: "Above historical average",
  price_increase: "Supplier price increase",
  leverage: "Multiple supplier options",
  single_source: "Single source",
};

/** What the monetary figure of an opportunity is based on. */
export type ImpactBasis = "alternative_quote" | "historical_average" | "price_increase";

export interface Opportunity {
  /** Stable identity: type.productId[.alternativeSupplierId] */
  key: string;
  type: OpportunityType;
  productId: string;
  currentSupplierId: string | null;
  alternativeSupplierId: string | null;
  currentPrice: number | null;
  /** Alternative price (lower quote) or reference price (average, previous level). */
  comparePrice: number | null;
  priceDifference: number | null;
  priceDifferencePct: number | null;
  annualQuantity: number;
  annualSpend: number;
  /** EUR/year. Only "alternative_quote" is a potential saving. */
  impact: number | null;
  impactBasis: ImpactBasis | null;
  potentialSaving: number | null;
  confidence: Confidence | null;
  factors: ConfidenceFactor[];
  comparability: ComparisonRow["comparability"] | null;
  reason: string;
  /** Supplier raised prices significantly and a recent lower quote exists. */
  negotiation: boolean;
  missing: string[];
}

export const opportunityKey = (type: OpportunityType, productId: string, supplierId?: string | null) =>
  [type.replace("_", "-"), productId, supplierId].filter(Boolean).join(".");

export interface OpportunityInput {
  product: ProductData;
  price: PriceMetrics;
  comparison: ComparisonRow[];
  annualQuantity: number;
  annualSpend: number;
  typicalOrderQuantity: number | null;
  dataQuality: "high" | "medium" | "low";
  highSpend: boolean;
  spendShare: number;
  /** Suppliers actually bought from in the period. */
  sourceCount: number;
  currentCurrency: string | null;
}

export function findOpportunities(i: OpportunityInput, cfg: IntelConfig = INTEL_CONFIG): Opportunity[] {
  const out: Opportunity[] = [];
  const current = i.comparison.find((r) => r.isCurrent) ?? null;
  const currentPrice = i.price.current?.price ?? null;
  const base = {
    productId: i.product.id,
    currentSupplierId: current?.supplier.id ?? null,
    currentPrice,
    annualQuantity: i.annualQuantity,
    annualSpend: i.annualSpend,
  };
  const pctFmt = (n: number) => `${Math.abs(n).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const increase12m = i.price.changes.m12.pct;
  const ctx: SavingContext = {
    currentPrice,
    currentCurrency: i.currentCurrency,
    annualQuantity: i.annualQuantity,
    typicalOrderQuantity: i.typicalOrderQuantity,
    currentPriceIsOutlier: !!i.price.current && i.price.outliers.some((o) => o.purchaseId === i.price.current!.purchaseId),
    dataQuality: i.dataQuality,
    unit: i.product.unit,
  };

  // 1 — a comparable alternative is priced below what we pay
  for (const row of i.comparison) {
    const s = estimateSaving(row, ctx, cfg);
    if (!s) continue;
    const recent = !row.expired && row.age !== "old";
    out.push({
      ...base,
      key: opportunityKey("lower_quote", i.product.id, row.supplier.id),
      type: "lower_quote",
      alternativeSupplierId: row.supplier.id,
      comparePrice: row.priceEUR,
      priceDifference: s.priceDifference,
      priceDifferencePct: s.priceDifferencePct,
      impact: s.potentialSaving,
      impactBasis: "alternative_quote",
      potentialSaving: s.potentialSaving,
      confidence: s.confidence,
      factors: s.factors,
      comparability: row.comparability,
      reason:
        row.comparability === "partial"
          ? `Lower ${row.kind === "quote" ? "quote" : "price"}, partially comparable`
          : `Lower comparable ${row.kind === "quote" ? "quote" : "price"}`,
      negotiation: recent && increase12m != null && increase12m >= cfg.significantIncreasePct,
      missing: missingInformation(row, current),
    });
  }
  const hasLowerQuote = out.length > 0;

  // 2 — paying clearly more than our own historical average
  const avg = i.price.weightedAveragePrice;
  if (currentPrice != null && avg != null && i.price.observations >= 3 && i.price.premiumVsAveragePct != null && i.price.premiumVsAveragePct >= cfg.premiumOverAveragePct) {
    out.push({
      ...base,
      key: opportunityKey("above_average", i.product.id),
      type: "above_average",
      alternativeSupplierId: null,
      comparePrice: avg,
      priceDifference: currentPrice - avg,
      priceDifferencePct: i.price.premiumVsAveragePct,
      impact: i.annualQuantity > 0 ? (currentPrice - avg) * i.annualQuantity : null,
      impactBasis: "historical_average",
      potentialSaving: null,
      confidence: null,
      factors: [],
      comparability: null,
      reason: `Current price ${pctFmt(i.price.premiumVsAveragePct)} above your historical average`,
      negotiation: false,
      missing: ["An alternative quote to compare with"],
    });
  }

  // 3 — the supplier raised the price significantly
  const m12 = i.price.changes.m12;
  if (currentPrice != null && m12.pct != null && m12.referencePrice != null && m12.pct >= cfg.significantIncreasePct) {
    out.push({
      ...base,
      key: opportunityKey("price_increase", i.product.id),
      type: "price_increase",
      alternativeSupplierId: null,
      comparePrice: m12.referencePrice,
      priceDifference: currentPrice - m12.referencePrice,
      priceDifferencePct: m12.pct,
      impact: i.annualQuantity > 0 ? (currentPrice - m12.referencePrice) * i.annualQuantity : null,
      impactBasis: "price_increase",
      potentialSaving: null,
      confidence: null,
      factors: [],
      comparability: null,
      reason: `Price up ${pctFmt(m12.pct)} ${m12.partial ? "since the first purchase on record" : "in 12 months"}`,
      negotiation: false,
      missing: hasLowerQuote ? [] : ["An alternative quote to compare with"],
    });
  }

  // 4 — high spend and more than one supplier to play with
  const options = i.comparison.filter((r) => r.priceEUR != null).length;
  if (i.highSpend && options >= 2 && !hasLowerQuote) {
    out.push({
      ...base,
      key: opportunityKey("leverage", i.product.id),
      type: "leverage",
      alternativeSupplierId: null,
      comparePrice: null,
      priceDifference: null,
      priceDifferencePct: null,
      impact: null,
      impactBasis: null,
      potentialSaving: null,
      confidence: null,
      factors: [],
      comparability: null,
      reason: `High-spend product with ${options} supplier options on file — no lower comparable price yet`,
      negotiation: false,
      missing: ["A recent quote from the alternative suppliers"],
    });
  }

  // 5 — everything bought from one supplier, and it matters
  if (i.highSpend && i.sourceCount === 1) {
    const quoted = i.comparison.filter((r) => !r.isCurrent && r.kind === "quote").length;
    out.push({
      ...base,
      key: opportunityKey("single_source", i.product.id),
      type: "single_source",
      alternativeSupplierId: null,
      comparePrice: null,
      priceDifference: null,
      priceDifferencePct: null,
      impact: null,
      impactBasis: null,
      potentialSaving: null,
      confidence: null,
      factors: [],
      comparability: null,
      reason: `Single source for ${pctFmt(i.spendShare * 100)} of annual spend${quoted ? ` — ${quoted} alternative quote${quoted > 1 ? "s" : ""} on file` : " — no alternative quotes"}`,
      negotiation: false,
      missing: quoted ? [] : ["Quotes from alternative suppliers"],
    });
  }

  return out;
}
