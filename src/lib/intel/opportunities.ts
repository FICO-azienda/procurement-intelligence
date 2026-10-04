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
import { countryKey } from "../countries";
import { en, type Msg, type T } from "../i18n";
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
export function estimateSaving(row: ComparisonRow, ctx: SavingContext, cfg: IntelConfig = INTEL_CONFIG, t: T = en): SavingEstimate | null {
  if (row.isCurrent || row.comparability === "not" || row.priceEUR == null || ctx.currentPrice == null) return null;
  if (!(ctx.annualQuantity > 0)) return null;
  const priceDifference = ctx.currentPrice - row.priceEUR;
  const priceDifferencePct = (priceDifference / ctx.currentPrice) * 100;
  if (priceDifferencePct < cfg.minPriceGapPct) return null;

  const factors: ConfidenceFactor[] = [];
  factors.push({ key: "unit", label: t("Unit"), state: "ok", detail: t("Both prices per {unit}", { unit: ctx.unit }) });

  factors.push(
    row.currency === ctx.currentCurrency
      ? { key: "currency", label: t("Currency"), state: "ok", detail: t("Both in {currency}", { currency: row.currency }) }
      : {
          key: "currency",
          label: t("Currency"),
          state: "caution",
          detail: row.date
            ? t("Converted from {currency} at the rate recorded on {date}", { currency: row.currency, date: row.date.split("-").reverse().join("/") })
            : t("Converted from {currency} at the rate recorded on the offer", { currency: row.currency }),
        },
  );

  factors.push(
    row.specDifferences.length
      ? { key: "specs", label: t("Specifications"), state: "caution", detail: t.n(row.specDifferences.length, "{n} difference: {names}", "{n} differences: {names}", { names: row.specDifferences.map((d) => d.name).join(", ") }) }
      : row.specsKnown
        ? { key: "specs", label: t("Specifications"), state: "ok", detail: t("Recorded specifications match") }
        : { key: "specs", label: t("Specifications"), state: cfg.requireSpecsForHighConfidence ? "caution" : "ok", detail: t("Not compared — no specifications recorded for this offer") },
  );

  const old = t(row.kind === "quote" ? "Quote is {days} days old" : "Last purchase is {days} days old", { days: row.ageDays });
  factors.push(
    row.expired
      ? { key: "age", label: t("Offer age"), state: "poor", detail: t("Quote validity has expired") }
      : { key: "age", label: t("Offer age"), state: row.age === "old" ? "poor" : "ok", detail: old },
  );

  const typical = ctx.typicalOrderQuantity;
  if (row.moq == null) {
    factors.push({ key: "quantity", label: t("Quantity"), state: "caution", detail: t("MOQ unknown") });
  } else if (row.moq > ctx.annualQuantity) {
    factors.push({ key: "quantity", label: t("Quantity"), state: "poor", detail: t("MOQ {moq} {unit} exceeds your annual volume of {annual} {unit}", { moq: fmt(row.moq), annual: fmt(ctx.annualQuantity), unit: ctx.unit }) });
  } else if (typical != null && row.moq > typical * cfg.moqToleranceFactor) {
    factors.push({ key: "quantity", label: t("Quantity"), state: "caution", detail: t("MOQ {moq} {unit} vs typical order {typical} {unit}", { moq: fmt(row.moq), typical: fmt(typical), unit: ctx.unit }) });
  } else {
    factors.push({ key: "quantity", label: t("Quantity"), state: "ok", detail: t("MOQ {moq} {unit} fits your orders", { moq: fmt(row.moq), unit: ctx.unit }) });
  }

  if (ctx.currentPriceIsOutlier) {
    factors.push({ key: "data", label: t("Your data"), state: "poor", detail: t("The current price is flagged as a possible data anomaly") });
  } else if (ctx.dataQuality === "low") {
    factors.push({ key: "data", label: t("Your data"), state: "caution", detail: t("Little or old purchase history for this product") });
  } else {
    factors.push({ key: "data", label: t("Your data"), state: "ok", detail: t("Enough recent purchase history") });
  }

  if (row.overridden) {
    factors.push({ key: "comparability", label: t("Comparability"), state: row.comparability === "partial" ? "caution" : "ok", detail: row.comparabilityReasons[0] ?? t("Set by you") });
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
export function missingInformation(row: ComparisonRow, current: ComparisonRow | null, t: T = en): string[] {
  const out: string[] = [];
  if (row.fxRequired) out.push(t("FX conversion required ({currency})", { currency: row.currency }));
  if (row.freightCost == null) {
    if (row.incoterm && DELIVERED_INCOTERMS.has(row.incoterm)) out.push(t("Freight should be included (Incoterm {incoterm}) — to be confirmed", { incoterm: row.incoterm }));
    else out.push(row.incoterm ? t("Freight unknown (Incoterm {incoterm}: transport not fully included)", { incoterm: row.incoterm }) : t("Freight unknown"));
  }
  if (!row.supplier.country || !current?.supplier.country || countryKey(row.supplier.country) !== countryKey(current.supplier.country)) {
    out.push(t("Duties and customs not assessed"));
  }
  if (!row.specsKnown) out.push(t("Specifications not compared"));
  out.push(t("Quality comparison missing"));
  if (row.moq == null) out.push(t("MOQ unknown"));
  if (row.leadTimeDays == null) out.push(t("Lead time unknown"));
  else if (current?.leadTimeDays != null && row.leadTimeDays > current.leadTimeDays) {
    out.push(t("Longer lead time ({offer} vs {current} days): inventory impact not included", { offer: row.leadTimeDays, current: current.leadTimeDays }));
  }
  if (row.paymentTermsDays == null) out.push(t("Payment terms unknown"));
  else if (current?.paymentTermsDays != null && row.paymentTermsDays < current.paymentTermsDays) {
    out.push(
      row.paymentTermsDays === 0
        ? t("Shorter payment terms (advance vs {current} days): financing cost not included", { current: current.paymentTermsDays })
        : t("Shorter payment terms ({offer} days vs {current} days): financing cost not included", { offer: row.paymentTermsDays, current: current.paymentTermsDays }),
    );
  }
  out.push(t("Landed cost not calculated"));
  return out;
}

// ---------------- Opportunities ----------------

export type OpportunityType = "lower_quote" | "above_average" | "price_increase" | "leverage" | "single_source";

export const OPPORTUNITY_LABEL: Record<OpportunityType, Msg> = {
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

export function findOpportunities(i: OpportunityInput, cfg: IntelConfig = INTEL_CONFIG, t: T = en): Opportunity[] {
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
    const s = estimateSaving(row, ctx, cfg, t);
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
          ? t(row.kind === "quote" ? "Lower quote, partially comparable" : "Lower price, partially comparable")
          : t(row.kind === "quote" ? "Lower comparable quote" : "Lower comparable price"),
      negotiation: recent && increase12m != null && increase12m >= cfg.significantIncreasePct,
      missing: missingInformation(row, current, t),
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
      reason: t("Current price {pct} above your historical average", { pct: pctFmt(i.price.premiumVsAveragePct) }),
      negotiation: false,
      missing: [t("An alternative quote to compare with")],
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
      reason: t(m12.partial ? "Price up {pct} since the first purchase on record" : "Price up {pct} in 12 months", { pct: pctFmt(m12.pct) }),
      negotiation: false,
      missing: hasLowerQuote ? [] : [t("An alternative quote to compare with")],
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
      reason: t("High-spend product with {n} supplier options on file — no lower comparable price yet", { n: options }),
      negotiation: false,
      missing: [t("A recent quote from the alternative suppliers")],
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
      reason: quoted
        ? t.n(quoted, "Single source for {pct} of annual spend — {n} alternative quote on file", "Single source for {pct} of annual spend — {n} alternative quotes on file", { pct: pctFmt(i.spendShare * 100) })
        : t("Single source for {pct} of annual spend — no alternative quotes", { pct: pctFmt(i.spendShare * 100) }),
      negotiation: false,
      missing: quoted ? [] : [t("Quotes from alternative suppliers")],
    });
  }

  return out;
}
