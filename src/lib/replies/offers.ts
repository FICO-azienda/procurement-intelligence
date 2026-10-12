/**
 * An offer's life, and what the offers on file mean for one of the buyer's
 * products. Nothing here is stored: it is read each time from what is.
 *
 * Three things are kept apart, because mixing them is how a price gets
 * compared that should not be: where the conversation stands (commercial),
 * how far the offer is the buyer's product (technical compatibility), and
 * whether its cost is known all the way to the plant (economic completeness).
 * An offer is comparable only when all three say so — and still valid.
 */
import type { Msg } from "../i18n";
import type { PriceDataClass } from "../negotiation/data-class";
import { normalizeKey, productKey } from "../import/normalize/text";
import type { Landed } from "./landed";
import { validityOf, type Compatibility, type ReplyOffer } from "./types";

/** Where an offer is in its life. */
export const OFFER_STATES = ["quote_received", "technical_review", "commercial_review", "awaiting_supplier_info", "validated", "not_comparable", "expired", "superseded", "rejected"] as const;
export type OfferState = (typeof OFFER_STATES)[number];
export const OFFER_STATE_LABEL: Record<OfferState, Msg> = {
  quote_received: "Price received",
  technical_review: "Technical review",
  commercial_review: "Commercial review",
  awaiting_supplier_info: "Awaiting the supplier's information",
  validated: "Validated|offer",
  not_comparable: "Not comparable",
  expired: "Expired",
  superseded: "Replaced by a newer offer",
  rejected: "Rejected|offer",
};

/** The same line quoted again — same product, quantity and terms, whatever the price: versions of one offer. */
export const lineKey = (o: Pick<ReplyOffer, "threadId" | "productName" | "grade" | "quantity" | "incoterm" | "destination" | "currency" | "unit">) =>
  [o.threadId, productKey(o.productName), normalizeKey(o.grade), o.quantity ?? "", o.incoterm ?? "", normalizeKey(o.destination), o.currency, o.unit].join("|");

/** When an offer was made, as far as it is known: its own date, else when it was written down. */
const madeOn = (o: ReplyOffer) => o.offeredOn ?? o.createdAt.slice(0, 10);

/**
 * The offers a newer version replaced: the same line quoted again later. The
 * older ones stay on file, shown as history; only the last is the offer.
 */
export function supersededIds(offers: ReplyOffer[]): Map<string, string> {
  const last = new Map<string, ReplyOffer>();
  const order = [...offers].sort((a, b) => madeOn(a).localeCompare(madeOn(b)) || a.createdAt.localeCompare(b.createdAt));
  const out = new Map<string, string>();
  for (const o of order) {
    const key = lineKey(o);
    const before = last.get(key);
    if (before) out.set(before.id, o.id);
    last.set(key, o);
  }
  return out;
}

/**
 * Where an offer is. A person's refusal first, then what time did to it (a
 * newer version, an expiry), then how far its checks have come.
 */
export function offerState(o: ReplyOffer, known: { today: string; superseded: boolean; awaitingSupplier: boolean; landed: Pick<Landed, "complete"> | null }): OfferState {
  if (o.decision === "rejected") return "rejected";
  if (known.superseded) return "superseded";
  if (validityOf(o.validUntil, known.today) === "expired") return "expired";
  if (o.compatibility === "not_equivalent") return "not_comparable";
  if (o.compatibility === "awaiting_specs" || (known.awaitingSupplier && o.compatibility !== "validated")) return "awaiting_supplier_info";
  if (o.compatibility !== "validated") return o.compatibility === "not_analyzed" ? "quote_received" : "technical_review";
  return known.landed?.complete ? "validated" : "commercial_review";
}

/** An offer that still counts: not turned down, not replaced, not expired. One with no stated validity counts, and says so. */
export const isActive = (state: OfferState) => state !== "rejected" && state !== "superseded" && state !== "expired";

/** Where an offer goes on a product's page. */
export type OfferGroup = "comparable" | "to_verify" | "other_grade" | "history";

/**
 * Comparable: technically validated, still valid on a stated date, in the
 * product's own unit, with its cost known to the plant. Everything short of
 * that is "to verify" — and says what is short. Another grade is shown apart,
 * and what time or a person set aside is history.
 */
export function groupOf(o: Pick<ReplyOffer, "validUntil" | "unit">, known: { state: OfferState; compatibility: Compatibility; productUnit: string; landed: Pick<Landed, "complete"> | null; today: string; linked: boolean }): OfferGroup {
  if (known.state === "rejected" || known.state === "superseded") return "history";
  if (known.compatibility === "not_equivalent") return "other_grade";
  const valid = validityOf(o.validUntil, known.today) === "open";
  const sameUnit = normalizeKey(o.unit) === normalizeKey(known.productUnit);
  return known.linked && known.compatibility === "validated" && valid && sameUnit && !!known.landed?.complete ? "comparable" : "to_verify";
}

/** Why an offer is not comparable yet: what is still short, in the order to work on it. */
export type Shortfall = "not_linked" | "compatibility" | "validity_unknown" | "expired" | "unit" | "landed";
export const SHORTFALL_LABEL: Record<Shortfall, Msg> = {
  not_linked: "Proposed by the app: confirm that it is an alternative for this product",
  compatibility: "Technical equivalence not validated",
  validity_unknown: "Validity not stated",
  expired: "Offer expired",
  unit: "Quoted in another unit",
  landed: "Cost to your plant incomplete",
};

export function shortfallsOf(o: Pick<ReplyOffer, "validUntil" | "unit">, known: { compatibility: Compatibility; productUnit: string; landed: Pick<Landed, "complete"> | null; today: string; linked: boolean }): Shortfall[] {
  const validity = validityOf(o.validUntil, known.today);
  return [
    ...(known.linked ? [] : (["not_linked"] as const)),
    ...(known.compatibility === "validated" ? [] : (["compatibility"] as const)),
    ...(validity === "expired" ? (["expired"] as const) : validity === "unknown" ? (["validity_unknown"] as const) : []),
    ...(normalizeKey(o.unit) === normalizeKey(known.productUnit) ? [] : (["unit"] as const)),
    ...(known.landed?.complete ? [] : (["landed"] as const)),
  ];
}

/**
 * What an alternative would be worth against what is paid today — only for a
 * comparable offer, both costs to the plant and in the same unit. The yearly
 * figure uses the volume really bought, and never more than the offer could
 * be used for: a minimum order above a year's volume is said, not ignored.
 */
export function savingOf(v: { currentCost: number; alternativeCost: number; annualVolume: number | null; minimum: number | null }) {
  const perUnit = v.currentCost - v.alternativeCost;
  const overMinimum = v.minimum != null && v.annualVolume != null && v.minimum > v.annualVolume;
  return {
    perUnit,
    pct: v.currentCost > 0 ? perUnit / v.currentCost : null,
    annual: v.annualVolume != null ? perUnit * v.annualVolume : null,
    /** The order it asks for is larger than what is bought in a year: the yearly figure cannot be had as it stands. */
    overMinimum,
  };
}

/**
 * A price a company quoted to this buyer is the buyer's private data, like the prices it pays (negotiation/data-class.ts):
 * it is shown inside the account and nowhere else — never as a list price of the supplier, never in a public page.
 */
export const OFFER_DATA_CLASS: PriceDataClass = "real_quote";
