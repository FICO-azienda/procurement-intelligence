/**
 * What can happen to an order, and what it is worth.
 *
 * Rules that must hold:
 *  - every change of status is one of the transitions below, made by the side
 *    it belongs to, with the permission it needs. Anything else is refused on
 *    the server, whatever the page shows;
 *  - a request becomes an order only when the supplier accepts it as written,
 *    or when the customer accepts the changes the supplier proposed. A
 *    proposal is never an order by itself;
 *  - a total is shown only when it can be worked out: goods at the agreed
 *    price, plus a transport charge somebody stated. When the delivery terms
 *    do not cover the destination, there is no total — the supplier has to
 *    confirm or state the transport. "DAP" alone never means "delivered
 *    anywhere at this price";
 *  - another article in place of the one asked is a different specification:
 *    the customer approves it in so many words.
 */
import { en, type T } from "../i18n";
import { normalizeKey } from "../import/normalize/text";
import {
  DELIVERY_LABEL, LEAD_TIME_LABEL, PAYMENT_LABEL, isDeliveryTerm, isPaymentTerm,
  type OrderAction, type OrderStatus, type Permission, type Principal, type ProposalChanges, type ProposalField, type Side, type Terms, type TermsSnapshot,
} from "./types";

export const TRANSITIONS: Record<OrderAction, { from: readonly OrderStatus[]; to: OrderStatus; by: Side | "system"; permission?: Permission }> = {
  send: { from: ["draft"], to: "pending_supplier", by: "buyer", permission: "order.send" },
  accept: { from: ["pending_supplier"], to: "confirmed", by: "supplier", permission: "order.respond" },
  propose: { from: ["pending_supplier"], to: "pending_buyer_approval", by: "supplier", permission: "order.respond" },
  reject: { from: ["pending_supplier"], to: "rejected", by: "supplier", permission: "order.respond" },
  accept_changes: { from: ["pending_buyer_approval"], to: "confirmed", by: "buyer", permission: "order.send" },
  reject_changes: { from: ["pending_buyer_approval"], to: "pending_supplier", by: "buyer", permission: "order.send" },
  cancel: { from: ["draft", "pending_supplier", "pending_buyer_approval"], to: "cancelled", by: "buyer", permission: "order.send" },
  complete: { from: ["confirmed"], to: "completed", by: "buyer", permission: "order.send" },
  expire: { from: ["pending_supplier", "pending_buyer_approval"], to: "expired", by: "system" },
};

/** Why this person cannot do this to an order in this status — or null when they can. */
export function refusal(action: OrderAction, status: OrderStatus, who: Pick<Principal, "side" | "permissions"> | "system", t: T = en): string | null {
  const rule = TRANSITIONS[action];
  const side = who === "system" ? "system" : who.side;
  if (rule.by !== side) return t("This is not yours to do on this order.");
  if (who !== "system" && rule.permission && !who.permissions.includes(rule.permission)) return t("Your account is not allowed to do this.");
  if (!rule.from.includes(status)) return t("The order has moved on in the meantime: it can no longer be changed this way.");
  return null;
}

/** What each side can still do to an order in a status: the buttons a page may show. The server checks again. */
export const actionsFor = (status: OrderStatus, who: Pick<Principal, "side" | "permissions">): OrderAction[] =>
  (Object.keys(TRANSITIONS) as OrderAction[]).filter((a) => refusal(a, status, who) == null);

/** The day a waiting request lapses, counted from the day it last moved. */
export function expiryFrom(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------- What an order is worth ----------------

export interface OrderFacts {
  quantity: number;
  unitPrice: number;
  currency: string;
  unit: string;
  terms: Pick<Terms, "delivery" | "deliveryPlace" | "deliveryNote" | "transportIncluded" | "taxesIncluded" | "leadTime" | "leadTimeNote">;
  /** The town the goods go to. */
  destinationCity: string | null;
  /** A transport charge the supplier stated for the whole order, in its currency. */
  transportCost: number | null;
}

export interface Amounts {
  goods: number;
  currency: string;
  taxesIncluded: boolean | null;
  /**
   * included: in the price, to the customer's destination · excluded: the customer's to arrange · stated: a charge the
   * supplier gave · agreed: as in the two companies' own agreement, which is not on file · to_confirm: the conditions do
   * not cover this destination.
   */
  transport: { state: "included" | "excluded" | "stated" | "agreed" | "to_confirm"; amount: number | null; note: string };
  /** Goods plus a stated transport. Null whenever something it depends on is not known: no total is made up. */
  total: number | null;
  /** What the supplier has to confirm or state before this can be an order. */
  open: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Whether a place named in the conditions is the town the goods go to: the town itself, with at most its province or
 * country after it. A place that only contains the town's name ("Sesto San Giovanni" for "San Giovanni") is another
 * place — when in doubt the supplier confirms, which costs one click and never a wrong total.
 */
const samePlace = (place: string | null, city: string | null) => {
  const a = normalizeKey(place);
  const b = normalizeKey(city);
  return !!a && !!b && (a === b || a.startsWith(`${b} `));
};

export function orderAmounts(o: OrderFacts, t: T = en): Amounts {
  const goods = round2(o.quantity * o.unitPrice);
  const where = o.destinationCity ?? t("your destination");
  const place = o.terms.deliveryPlace ?? "";
  let transport: Amounts["transport"];
  if (o.transportCost != null) {
    transport = { state: "stated", amount: round2(o.transportCost), note: t("Stated by the supplier for this order.") };
  } else if (o.terms.delivery === "DAP") {
    transport = samePlace(o.terms.deliveryPlace, o.destinationCity)
      ? { state: "included", amount: 0, note: t("In the price: delivered to {place}.", { place }) }
      : { state: "to_confirm", amount: null, note: t("The price is delivered to {place}, and these goods go to {where}: the supplier has to confirm the price holds there, or state the transport.", { place, where }) };
  } else if (o.terms.delivery === "FCA" || o.terms.delivery === "EXW") {
    transport = { state: "excluded", amount: null, note: t("Not in the price: the goods are handed over at {place}, and transport from there is yours to arrange.", { place }) };
  } else if (o.terms.delivery === "existing_agreement") {
    transport = { state: "agreed", amount: null, note: t("As in the agreement already in force between the two companies: it is not on file here.") };
  } else if (o.terms.delivery === "other" && o.terms.transportIncluded === false) {
    transport = { state: "excluded", amount: null, note: t("Not in the price ({terms}).", { terms: o.terms.deliveryNote ?? "" }) };
  } else {
    transport = { state: "to_confirm", amount: null, note: t("The delivery terms ({terms}) do not say what transport to {where} costs: the supplier has to confirm or state it.", { terms: o.terms.deliveryNote ?? t("not stated"), where }) };
  }
  const known = transport.state === "included" || transport.state === "excluded" || transport.state === "stated";
  return {
    goods,
    currency: o.currency,
    taxesIncluded: o.terms.taxesIncluded,
    transport,
    total: known ? round2(goods + (transport.state === "stated" ? transport.amount! : 0)) : null,
    open: transport.state === "to_confirm" ? [transport.note] : [],
  };
}

// ---------------- Conditions in words ----------------

/** A destination in one line, as far as it was written: who, the street, the town, the country. */
export const destinationLine = (d: { recipient: string | null; address: string | null; postalCode: string | null; city: string; province: string | null; country: string | null }) =>
  [d.recipient, d.address, [d.postalCode, d.city, d.province ? `(${d.province})` : null].filter(Boolean).join(" "), d.country].filter(Boolean).join(", ");

/** The six conditions as lines to read: what each one says, with what completes it. */
export function termsLines(terms: Terms, unit: string, f: { price: (n: number, currency: string) => string; quantity: (n: number, unit: string) => string; date: (d: string) => string }, t: T = en) {
  const delivery = terms.delivery
    ? terms.delivery === "other"
      ? (terms.deliveryNote ?? t(DELIVERY_LABEL.other))
      : terms.delivery === "existing_agreement"
        ? t(DELIVERY_LABEL.existing_agreement)
        : [terms.delivery, terms.deliveryPlace, terms.incotermsVersion ? `(Incoterms® ${terms.incotermsVersion})` : null].filter(Boolean).join(" ")
    : null;
  return {
    price: terms.unitPrice != null && terms.currency ? `${f.price(terms.unitPrice, terms.currency)}/${unit}` : null,
    taxes: terms.taxesIncluded == null ? null : terms.taxesIncluded ? t("VAT and taxes included") : t("VAT and taxes not included"),
    minimum: terms.minQuantity != null ? (terms.quantityStep != null ? t("{min}, in steps of {step}", { min: f.quantity(terms.minQuantity, unit), step: f.quantity(terms.quantityStep, unit) }) : f.quantity(terms.minQuantity, unit)) : null,
    leadTime: terms.leadTime ? (terms.leadTime === "custom" ? terms.leadTimeNote : [t(LEAD_TIME_LABEL[terms.leadTime]), terms.leadTimeNote].filter(Boolean).join(" — ")) : null,
    delivery,
    payment: terms.payment ? (terms.payment === "other" ? terms.paymentNote : [t(PAYMENT_LABEL[terms.payment]), terms.paymentNote].filter(Boolean).join(" — ")) : null,
    validity: terms.validUntil ? f.date(terms.validUntil) : null,
  };
}

// ---------------- Proposals ----------------

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A proposal read back from where it is kept: only whole, well-formed changes count. */
export function readChanges(raw: unknown): ProposalChanges {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ProposalChanges = {};
  const price = num(o.unitPrice);
  if (price != null && price > 0) out.unitPrice = price;
  const quantity = num(o.quantity);
  if (quantity != null && quantity > 0) out.quantity = quantity;
  const date = day(o.deliveryDate);
  if (date) out.deliveryDate = date;
  const transport = num(o.transportCost);
  if (transport != null) out.transportCost = transport;
  const d = o.delivery as Record<string, unknown> | undefined;
  if (d && isDeliveryTerm(d.term)) out.delivery = { term: d.term, place: text(d.place), note: text(d.note) };
  const p = o.payment as Record<string, unknown> | undefined;
  if (p && isPaymentTerm(p.term)) out.payment = { term: p.term, note: text(p.note) };
  const a = o.product as Record<string, unknown> | undefined;
  if (a && typeof a.orderProductId === "string" && text(a.name) && text(a.unit)) out.product = { orderProductId: a.orderProductId, code: text(a.code), name: text(a.name)!, description: text(a.description), unit: text(a.unit)! };
  return out;
}

export const changedFields = (c: ProposalChanges): ProposalField[] => (["unitPrice", "quantity", "deliveryDate", "delivery", "transportCost", "payment", "product"] as const).filter((f) => c[f] != null);

/** Another article is another specification: the customer says yes to it in so many words, not with the rest. */
export const needsSpecApproval = (c: ProposalChanges) => c.product != null;

export interface OrderDraft {
  line: { orderProductId: string | null; code: string | null; name: string; description: string | null; unit: string; quantity: number; unitPrice: number; currency: string };
  terms: TermsSnapshot;
  transportCost: number | null;
  deliveryDate: string | null;
}

/** The order as it would be with the supplier's changes: what the customer is asked to accept. */
export function applyChanges(o: OrderDraft, c: ProposalChanges): OrderDraft {
  const line = { ...o.line, ...(c.product ? { orderProductId: c.product.orderProductId, code: c.product.code, name: c.product.name, description: c.product.description, unit: c.product.unit } : {}) };
  if (c.unitPrice != null) line.unitPrice = c.unitPrice;
  if (c.quantity != null) line.quantity = c.quantity;
  const terms: TermsSnapshot = { ...o.terms, unitPrice: line.unitPrice, unit: line.unit };
  if (c.delivery) Object.assign(terms, { delivery: c.delivery.term, deliveryPlace: c.delivery.place, deliveryNote: c.delivery.note });
  if (c.payment) Object.assign(terms, { payment: c.payment.term, paymentNote: c.payment.note });
  return { line, terms, transportCost: c.transportCost ?? o.transportCost, deliveryDate: c.deliveryDate ?? o.deliveryDate };
}

// ---------------- Ordering again ----------------

/**
 * What changed between an order of the past and the conditions in force
 * today, in words: ordering again never takes the old price along.
 */
export function reorderNotes(past: { unitPrice: number; currency: string; quantity: number; unit: string; terms: Pick<Terms, "payment" | "paymentNote" | "delivery" | "deliveryPlace" | "leadTime"> }, now: Terms, f: { price: (n: number, currency: string) => string }, t: T = en): string[] {
  const notes: string[] = [];
  if (now.unitPrice != null && now.currency && (now.unitPrice !== past.unitPrice || now.currency !== past.currency))
    notes.push(t("The price is now {now}/{unit}: the order you are repeating was at {then}/{unit}.", { now: f.price(now.unitPrice, now.currency), then: f.price(past.unitPrice, past.currency), unit: past.unit }));
  if (now.payment !== past.terms.payment || (now.paymentNote ?? null) !== (past.terms.paymentNote ?? null)) notes.push(t("The payment terms have changed since that order."));
  if (now.delivery !== past.terms.delivery || normalizeKey(now.deliveryPlace) !== normalizeKey(past.terms.deliveryPlace)) notes.push(t("The delivery terms have changed since that order."));
  if (now.leadTime !== past.terms.leadTime) notes.push(t("The lead time has changed since that order."));
  return notes;
}
