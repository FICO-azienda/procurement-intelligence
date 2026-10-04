/**
 * True cost, first version: what a quoted price becomes once the goods are
 * at the company's door and paid for. The quoted price, plus transport, plus
 * duty and other import costs, converted at a stated exchange rate, plus what
 * a larger minimum order costs in stock, plus or minus what different
 * payment terms are worth.
 *
 * Every component is kept apart and says where its figure comes from. A
 * component the true cost can't do without and nobody has given — transport
 * on an ex-works price, duty from outside the customs area — is "missing":
 * the result is then incomplete, and no total is shown. Nothing is filled in.
 */
import { en, type Msg, type T } from "../i18n";
import type { Confidence } from "./types";

/** Where a figure comes from. */
export type CostBasis = "actual" | "quote" | "manual" | "official" | "estimate" | "included" | "none" | "missing";
export const BASIS_LABEL: Record<CostBasis, Msg> = {
  actual: "Actual",
  quote: "Quote|price",
  manual: "Entered by you",
  official: "Official data",
  estimate: "Estimate",
  included: "Included in the price",
  none: "Does not apply",
  missing: "Missing",
};

export type CostKey = "price" | "freight" | "duty" | "customs" | "other" | "moq" | "payment";
export const COST_LABEL: Record<CostKey, Msg> = {
  price: "Quoted price",
  freight: "Freight",
  duty: "Duty",
  customs: "Other import costs",
  other: "Other costs",
  moq: "Minimum order (stock)",
  payment: "Payment terms",
};

export interface CostComponent {
  key: CostKey;
  /** EUR per product unit. Null: missing, or not computable. */
  perUnit: number | null;
  basis: CostBasis;
  note: string | null;
  /** The true cost can't be given without it. */
  required: boolean;
}

/** Incoterms under which the seller pays the transport to the destination. */
const DELIVERED = new Set(["DAP", "DPU", "DDP", "CPT", "CIP"]);

export interface TrueCostInput {
  /** Per product unit, in `currency`. */
  price: number;
  currency: string;
  /** EUR for one unit of `currency`. Null with a foreign currency: no rate on file. */
  fxRate: number | null;
  fxNote: string | null;
  incoterm: string | null;
  /** Supplier and company in the same customs area. Null: the supplier's country is not known. */
  sameCustomsArea: boolean | null;
  freightPerUnit: number | null;
  freightBasis: CostBasis | null;
  dutyRatePct: number | null;
  customsPerUnit: number | null;
  otherPerUnit: number | null;
  moq: number | null;
  typicalOrder: number | null;
  annualVolume: number | null;
  paymentDays: number | null;
  /** The payment terms of the current supplier: what the quote's terms are measured against. */
  baselinePaymentDays: number | null;
  financingRatePct: number;
  holdingRatePct: number;
  /** The user confirmed the product offered is the same specification. */
  technicalConfirmed: boolean;
}

export interface TrueCost {
  components: CostComponent[];
  /** EUR per product unit. Null when a required component is missing. */
  perUnit: number | null;
  annual: number | null;
  complete: boolean;
  /** What to add to complete it, in words. */
  missing: string[];
  warnings: string[];
  confidence: Confidence | null;
}

export function trueCost(input: TrueCostInput, t: T = en): TrueCost {
  const missing: string[] = [];
  const warnings: string[] = [];
  const components: CostComponent[] = [];
  const incoterm = input.incoterm?.toUpperCase() ?? null;
  const foreign = input.currency.toUpperCase() !== "EUR";
  const rate = foreign ? input.fxRate : 1;
  const price = rate ? input.price * rate : null;
  components.push({ key: "price", perUnit: price, basis: price == null ? "missing" : "quote", note: foreign ? (rate ? (input.fxNote ?? t("Converted from {currency}.", { currency: input.currency })) : t("In {currency}: no exchange rate on file.", { currency: input.currency })) : null, required: true });
  if (price == null) missing.push(t("The exchange rate for {currency}", { currency: input.currency }));
  if (!incoterm) warnings.push(t("Delivery terms unknown: it is not known whether transport is in the price."));

  // Transport: in the price when the seller delivers; otherwise someone has to say what it costs.
  if (input.freightPerUnit != null) components.push({ key: "freight", perUnit: input.freightPerUnit, basis: input.freightBasis ?? "manual", note: incoterm ? t("Added to a price quoted {incoterm}.", { incoterm }) : null, required: true });
  else if (incoterm && DELIVERED.has(incoterm)) components.push({ key: "freight", perUnit: 0, basis: "included", note: t("{incoterm}: the seller pays the transport to you.", { incoterm }), required: true });
  else {
    components.push({ key: "freight", perUnit: null, basis: "missing", note: incoterm ? t("{incoterm}: transport to you is not in the price.", { incoterm }) : t("Delivery terms unknown."), required: true });
    missing.push(t("A freight estimate"));
  }
  const freight = components.at(-1)!.perUnit;

  // Duty and other import costs: none inside the same customs area, in the price under DDP, otherwise to be given.
  const base = price != null && freight != null ? price + freight : null;
  if (incoterm === "DDP") {
    components.push({ key: "duty", perUnit: 0, basis: "included", note: t("DDP: duties are paid by the seller."), required: true });
    components.push({ key: "customs", perUnit: 0, basis: "included", note: null, required: true });
  } else if (input.sameCustomsArea === true) {
    components.push({ key: "duty", perUnit: 0, basis: "none", note: t("Same customs area: no duty."), required: true });
    components.push({ key: "customs", perUnit: 0, basis: "none", note: null, required: true });
  } else {
    if (input.dutyRatePct != null) components.push({ key: "duty", perUnit: base != null ? (base * input.dutyRatePct) / 100 : null, basis: "manual", note: t("{rate}% on price and transport.", { rate: input.dutyRatePct }), required: true });
    else {
      components.push({ key: "duty", perUnit: null, basis: "missing", note: input.sameCustomsArea == null ? t("The supplier's country is not known.") : t("From outside your customs area."), required: true });
      missing.push(t("The duty rate"));
    }
    if (input.customsPerUnit != null) components.push({ key: "customs", perUnit: input.customsPerUnit, basis: "manual", note: null, required: true });
    else {
      components.push({ key: "customs", perUnit: null, basis: "missing", note: t("Clearance and other import costs."), required: true });
      missing.push(t("Customs and import costs"));
    }
  }
  components.push({ key: "other", perUnit: input.otherPerUnit ?? 0, basis: input.otherPerUnit != null ? "manual" : "none", note: null, required: false });

  const landed = components.every((c) => c.perUnit != null) ? components.reduce((sum, c) => sum + c.perUnit!, 0) : null;

  // A minimum order above the usual one means stock held for longer: half the extra, on average, at the holding rate.
  if (input.moq != null && input.typicalOrder != null && input.annualVolume && input.moq > input.typicalOrder) {
    const extra = (input.moq - input.typicalOrder) / 2;
    components.push({ key: "moq", perUnit: landed != null ? (extra * landed * (input.holdingRatePct / 100)) / input.annualVolume : null, basis: "estimate", note: t("Minimum order {moq} against a usual order of {usual}: about {extra} more held in stock on average, at {rate}% a year.", { moq: Math.round(input.moq), usual: Math.round(input.typicalOrder), extra: Math.round(extra), rate: input.holdingRatePct }), required: false });
  } else components.push({ key: "moq", perUnit: 0, basis: "none", note: input.moq == null ? t("Minimum order not stated.") : t("Minimum order within your usual order."), required: false });

  // Paying sooner than today costs money, paying later saves it: the difference in days at the financing rate.
  if (input.paymentDays != null && input.baselinePaymentDays != null) {
    const days = input.baselinePaymentDays - input.paymentDays;
    components.push({ key: "payment", perUnit: landed != null ? (landed * (input.financingRatePct / 100) * days) / 365 : null, basis: days === 0 ? "none" : "estimate", note: days === 0 ? t("Same payment terms as today.") : t("{offered} days against {current} today, at {rate}% a year.", { offered: input.paymentDays, current: input.baselinePaymentDays, rate: input.financingRatePct }), required: false });
  } else components.push({ key: "payment", perUnit: null, basis: "missing", note: input.paymentDays == null ? t("Payment terms of the offer not stated.") : t("Payment terms of your current supplier not on file."), required: false });

  const complete = missing.length === 0 && landed != null;
  const perUnit = complete ? components.reduce((sum, c) => sum + (c.perUnit ?? 0), 0) : null;
  const paymentKnown = components.find((c) => c.key === "payment")!.perUnit != null;
  const confidence: Confidence | null = !complete ? null : !incoterm ? "low" : input.technicalConfirmed && paymentKnown && components.every((c) => c.basis !== "estimate" || c.key === "moq" || c.key === "payment") && components.find((c) => c.key === "freight")!.basis !== "estimate" ? "high" : "medium";
  return { components, perUnit, annual: perUnit != null && input.annualVolume ? perUnit * input.annualVolume : null, complete, missing, warnings, confidence };
}

/** The three things a price difference can be called, and never mixed up. */
export type OpportunityLevel = "theoretical" | "to_validate" | "validated";
export const OPPORTUNITY_LEVEL: Record<OpportunityLevel, { label: Msg; meaning: Msg }> = {
  theoretical: { label: "Theoretical opportunity", meaning: "From a benchmark or an indication: a reason to ask for quotes, nothing more." },
  to_validate: { label: "Opportunity to validate", meaning: "From a real quote and its estimated true cost — with something still to confirm." },
  validated: { label: "Validated opportunity", meaning: "A real comparable quote, its true cost complete, the specification confirmed. Still not a saving: a saving is proved by an invoice." },
};

export interface QuoteOpportunity {
  level: Extract<OpportunityLevel, "to_validate" | "validated">;
  /** Baseline minus the alternative's true cost, EUR per unit. */
  perUnit: number;
  annual: number | null;
  confidence: Confidence;
  /** What stands between this and a validated opportunity. */
  pending: string[];
}

/**
 * What a quote is worth against what is paid today, on true cost. Null when
 * the true cost is incomplete or not below the baseline: no opportunity is
 * shown on a number that can't be stood behind.
 */
export function quoteOpportunity(baseline: number | null, cost: TrueCost, ctx: { annualVolume: number | null; technicalConfirmed: boolean; moq: number | null; comparable: boolean }, t: T = en): QuoteOpportunity | null {
  if (baseline == null || cost.perUnit == null || cost.confidence == null) return null;
  const perUnit = baseline - cost.perUnit;
  if (perUnit <= 0) return null;
  const pending = [
    ...(!ctx.technicalConfirmed ? [t("Technical specification confirmation still required.")] : []),
    ...(!ctx.comparable ? [t("The offer is not marked as comparable with what you buy.")] : []),
    ...(ctx.moq != null && ctx.annualVolume != null && ctx.moq > ctx.annualVolume ? [t("The minimum order is above what you buy in a year.")] : []),
    ...(cost.confidence === "low" ? [t("Delivery terms to confirm.")] : []),
  ];
  return { level: pending.length ? "to_validate" : "validated", perUnit, annual: ctx.annualVolume ? perUnit * ctx.annualVolume : null, confidence: pending.length && cost.confidence === "high" ? "medium" : cost.confidence, pending };
}
