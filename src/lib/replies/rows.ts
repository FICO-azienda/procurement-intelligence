/**
 * The offers of a product, as rows a page can show and filter: every figure
 * already written out, every status already in words. Nothing is decided
 * here — it words what offers.ts, landed.ts and match.ts worked out.
 */
import * as f from "../format";
import { en, type T } from "../i18n";
import { LANDED_LABEL, type Landed } from "./landed";
import { OFFER_STATE_LABEL, SHORTFALL_LABEL, savingOf, type OfferGroup, type OfferState } from "./offers";
import { COMPATIBILITY_LABEL, REPLY_STATUS_LABEL, deliveryOf, validityOf, type Compatibility, type ReplyOffer, type ReplyStatus } from "./types";

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Until when an offer holds, in words, and how urgent that is. */
export function validityText(o: Pick<ReplyOffer, "validUntil" | "validity">, today: string, t: T = en): { text: string; tone: "ok" | "soon" | "expired" | "unknown" } {
  const state = validityOf(o.validUntil, today);
  if (state === "unknown") return { text: o.validity ?? t("Validity not stated"), tone: "unknown" };
  if (state === "expired") return { text: t("Expired on {date}", { date: f.date(o.validUntil) }), tone: "expired" };
  const left = days(today, o.validUntil!);
  return { text: left === 0 ? t("Valid until today, {date}", { date: f.date(o.validUntil) }) : t.n(left, "Valid until {date}: {n} day left", "Valid until {date}: {n} days left", { date: f.date(o.validUntil) }), tone: left <= 5 ? "soon" : "ok" };
}

/** The landed cost in a line: the figure when it is whole, else what is missing. */
export function landedText(landed: Landed, unit: string, t: T = en): string {
  if (landed.complete && landed.total != null) return `${f.price(landed.total)}/${unit}${landed.estimated ? ` · ${t("includes estimates")}` : ""}`;
  return t("Incomplete: {what} missing", { what: landed.missing.map((k) => t(LANDED_LABEL[k]).toLowerCase()).join(", ") });
}

export interface OfferRow {
  offerId: string;
  productId: string;
  href: string;
  supplier: string;
  supplierHref: string;
  product: string;
  detail: string | null;
  price: string;
  terms: string;
  quantity: string | null;
  group: OfferGroup;
  link: "linked" | "proposed";
  state: string;
  stateKey: OfferState;
  compatibility: string;
  compatibilityKey: Compatibility;
  validity: string;
  validityTone: "ok" | "soon" | "expired" | "unknown";
  shortfalls: string[];
  reasons: string[];
  nextAction: string | null;
  landed: string;
  landedComplete: boolean;
  /** Against what is paid today — only for a comparable offer. */
  compare: { current: string; perUnit: string; pct: string | null; annual: string | null; limit: string | null; lower: boolean } | null;
  payment: string | null;
}

export interface AwaitingRow {
  key: string;
  supplier: string;
  supplierHref: string;
  status: string;
  statusKey: ReplyStatus;
  missing: string | null;
  nextAction: string | null;
  followUp: string | null;
  basis: string;
}

interface ViewLike {
  offer: ReplyOffer;
  company: { id: string; name: string };
  thread: { nextAction: string | null };
  link: "linked" | "proposed";
  compatibility: Compatibility;
  reasons: string[];
  state: OfferState;
  group: OfferGroup;
  shortfalls: (keyof typeof SHORTFALL_LABEL)[];
  landed: Landed;
  /** How many of the product's units one unit of the offer holds. */
  factor: number | null;
  /** The complete cost to the plant per unit of the product. */
  perProductUnit: number | null;
}

export function offerRow(v: ViewLike, product: { id: string; unit: string }, current: { price: number | null; annualQuantity: number | null }, today: string, t: T = en): OfferRow {
  const o = v.offer;
  const validity = validityText(o, today, t);
  const delivery = deliveryOf(o.incoterm, o.destination, t);
  let compare: OfferRow["compare"] = null;
  // Set against the price paid per the product's own unit: a price per tonne is read per kilo here, and stays as quoted on the row.
  if (v.group === "comparable" && v.perProductUnit != null && v.factor && current.price != null) {
    const minimum = o.moq ?? o.quantity;
    const s = savingOf({ currentCost: current.price, alternativeCost: v.perProductUnit, annualVolume: current.annualQuantity, minimum: minimum != null ? minimum * v.factor : null });
    compare = {
      current: `${f.price(current.price)}/${product.unit}`,
      perUnit: `${f.price(Math.abs(s.perUnit))}/${product.unit}`,
      pct: s.pct != null ? f.pct(Math.abs(s.pct) * 100) : null,
      annual: s.annual != null ? f.money(Math.round(Math.abs(s.annual))) : null,
      limit: s.overMinimum ? t("It asks for {minimum} at a time, more than the {volume} you buy in a year: the yearly figure cannot be had as it stands.", { minimum: f.quantity(minimum, o.unit), volume: f.quantity(current.annualQuantity, product.unit) }) : null,
      lower: s.perUnit > 0,
    };
  }
  return {
    offerId: o.id,
    productId: product.id,
    href: `/sourcing/replies/offers/${o.id}`,
    supplier: v.company.name,
    supplierHref: `/sourcing/replies/${v.company.id}`,
    product: o.productName,
    detail: [o.grade && o.grade !== o.productName ? o.grade : null, o.specs.melting_point, o.specs.oil_content].filter(Boolean).join(" · ") || null,
    price: `${f.price(o.unitPrice, o.currency)}/${o.unit}`,
    terms: [delivery.incoterm, o.destination].filter(Boolean).join(" ") || t("Delivery terms not stated"),
    quantity: o.quantity != null ? f.quantity(o.quantity, o.unit) : null,
    group: v.group,
    link: v.link,
    state: t(OFFER_STATE_LABEL[v.state]),
    stateKey: v.state,
    compatibility: t(COMPATIBILITY_LABEL[v.compatibility]),
    compatibilityKey: v.compatibility,
    validity: validity.text,
    validityTone: validity.tone,
    shortfalls: v.shortfalls.map((s) => t(SHORTFALL_LABEL[s])),
    reasons: v.reasons,
    nextAction: v.thread.nextAction,
    landed: landedText(v.landed, o.unit, t),
    landedComplete: v.landed.complete,
    compare,
    payment: o.paymentTerms,
  };
}

export function awaitingRow(a: { company: { id: string; name: string }; thread: { id: string; status: ReplyStatus; nextAction: string | null; followUpOn: string | null; missing: string | null }; basis: "candidate" | "category" }, t: T = en): AwaitingRow {
  return {
    key: a.thread.id,
    supplier: a.company.name,
    supplierHref: `/sourcing/replies/${a.company.id}`,
    status: t(REPLY_STATUS_LABEL[a.thread.status]),
    statusKey: a.thread.status,
    missing: a.thread.missing,
    nextAction: a.thread.nextAction,
    followUp: a.thread.followUpOn ? f.date(a.thread.followUpOn) : null,
    basis: a.basis === "candidate" ? t("Already a candidate for this product") : t("Answered about this product's category"),
  };
}
