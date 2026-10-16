/**
 * The offers received that are still to verify, per product: what the
 * summaries, Compare, the market page and the notifications say about them.
 * They are counted and named — never set against the price paid, never in a
 * range or a ranking: what is not comparable stays out of every figure
 * (offers.ts `groupOf`). A comparable offer is not here: it is a quote of the
 * analysis already (bridge.ts).
 */
import * as f from "../format";
import { en, type T } from "../i18n";
import { isActive, type OfferGroup, type OfferState, type Shortfall } from "./offers";
import type { ReplyOffer } from "./types";

/** How many days before its end an offer is said to be expiring. */
export const EXPIRING_DAYS = 7;

export interface PendingOffer {
  offerId: string;
  companyId: string;
  company: string;
  /** The offer's own product, as the company wrote it. */
  product: string;
  /** The price as quoted, in words: "0,40 PLN/pz DAP Novate". Never converted. */
  quoted: string;
  /** The quantity the price is for, in the offer's own unit: two lines of one company often differ only by it. */
  quantity: number | null;
  unit: string;
  validUntil: string | null;
  /** When it came, as far as it is known: its own date, else the day the answer was read. */
  receivedOn: string | null;
  state: OfferState;
  shortfalls: Shortfall[];
  link: "linked" | "proposed";
}

export interface PendingOffers {
  /** Active offers (not expired, replaced or turned down) still short of comparable, the soonest to expire first. */
  toVerify: PendingOffer[];
  /** The companies those offers come from. */
  companies: string[];
  /** Offers to verify that end within `EXPIRING_DAYS` (today included). */
  expiring: PendingOffer[];
  /** Offers to verify that already expired: on file, and no longer an offer. */
  expired: number;
  /** Companies that answered about this product's category and stated no price for it yet. */
  awaitingPrice: number;
}

interface ViewLike {
  offer: Pick<ReplyOffer, "id" | "productName" | "grade" | "unitPrice" | "currency" | "unit" | "incoterm" | "destination" | "validUntil"> & { quantity?: number | null };
  company: { id: string; name: string };
  link: "linked" | "proposed";
  state: OfferState;
  group: OfferGroup;
  shortfalls: Shortfall[];
  receivedOn?: string | null;
}

const daysTo = (day: string, today: string) => Math.round((Date.parse(day) - Date.parse(today)) / 86_400_000);

/** The price as quoted, in words: nothing converted, nothing added. */
export const quotedText = (o: ViewLike["offer"]) => `${f.price(o.unitPrice, o.currency)}/${o.unit}${o.incoterm ? ` ${o.incoterm}` : ""}${o.destination ? ` ${o.destination}` : ""}`;

/** What is still to verify for one product, from the offers grouped for it (`readProductOffers`). Null when there is nothing. */
export function pendingOf(p: { toVerify: ViewLike[]; awaitingPrice: unknown[] }, today: string): PendingOffers | null {
  const active = p.toVerify.filter((v) => isActive(v.state));
  const toVerify = active
    .map((v): PendingOffer => ({
      offerId: v.offer.id,
      companyId: v.company.id,
      company: v.company.name,
      product: [v.offer.productName, v.offer.grade && v.offer.grade !== v.offer.productName ? v.offer.grade : null].filter(Boolean).join(" "),
      quoted: quotedText(v.offer),
      quantity: v.offer.quantity ?? null,
      unit: v.offer.unit,
      validUntil: v.offer.validUntil,
      receivedOn: v.receivedOn ?? null,
      state: v.state,
      shortfalls: v.shortfalls,
      link: v.link,
    }))
    .sort((a, b) => (a.validUntil ?? "9999").localeCompare(b.validUntil ?? "9999") || a.company.localeCompare(b.company));
  const expired = p.toVerify.filter((v) => v.state === "expired").length;
  if (!toVerify.length && !p.awaitingPrice.length && !expired) return null;
  return {
    toVerify,
    companies: [...new Set(toVerify.map((o) => o.company))],
    expiring: toVerify.filter((o) => o.validUntil != null && daysTo(o.validUntil, today) >= 0 && daysTo(o.validUntil, today) <= EXPIRING_DAYS),
    expired,
    awaitingPrice: p.awaitingPrice.length,
  };
}

/** The shortfalls the offers to verify have most often, the most common first: what to work on. */
export function commonShortfalls(p: PendingOffers): Shortfall[] {
  const n = new Map<Shortfall, number>();
  for (const o of p.toVerify) for (const s of o.shortfalls) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

export const daysLeft = daysTo;

/** For a set of products (those of one supplier): how many offers are still to verify, over how many of them. */
export function pendingAcross(productIds: Iterable<string>, pending: Record<string, PendingOffers>): { offers: number; products: string[] } {
  const products = [...new Set(productIds)].filter((id) => (pending[id]?.toVerify.length ?? 0) > 0);
  // One offer proposed for two products is one offer.
  return { offers: new Set(products.flatMap((id) => pending[id].toVerify.map((o) => o.offerId))).size, products };
}

/** One line of the bell: what it says, where it leads, whether it waits for the user. */
export interface OfferNotice {
  key: string;
  text: string;
  href: string;
  todo: boolean;
}

/**
 * What the bell says about the replies: an offer to verify that ends today (each named), the others that end within
 * `EXPIRING_DAYS`, and the replies that came lately. Prices are never in it.
 */
export function offerNotices(pending: Record<string, PendingOffers>, names: Map<string, string>, today: string, replies: { date: string }[], recentDays: number, t: T = en): OfferNotice[] {
  const out: OfferNotice[] = [];
  // One offer proposed for several products ends once: it is said once, under the first product it is for.
  const seen = new Set<string>();
  const expiring = Object.entries(pending)
    .flatMap(([productId, p]) => p.expiring.map((o) => ({ productId, o, days: daysTo(o.validUntil!, today) })))
    .filter((x) => !seen.has(x.o.offerId) && !!seen.add(x.o.offerId));
  const todayOnes = expiring.filter((x) => x.days === 0);
  for (const { productId, o } of todayOnes.slice(0, 3)) {
    out.push({ key: `expires-${o.offerId}`, text: t("{company}'s offer for {product} expires today", { company: o.company, product: names.get(productId) ?? o.product }), href: `/sourcing/replies/offers/${o.offerId}`, todo: true });
  }
  const later = expiring.length - Math.min(todayOnes.length, 3);
  if (later > 0) {
    const first = expiring.find((x) => !todayOnes.slice(0, 3).includes(x))!;
    out.push({ key: "expiring", text: t.n(later, "{n} offer to verify ends within {days} days", "{n} offers to verify end within {days} days", { days: EXPIRING_DAYS }), href: `/products/${first.productId}#offers`, todo: true });
  }
  const since = new Date(Date.parse(today) - recentDays * 86_400_000).toISOString().slice(0, 10);
  const recent = replies.filter((r) => r.date >= since && r.date <= today).length;
  if (recent > 0) out.push({ key: "replies", text: t.n(recent, "{n} reply to your requests in the last {days} days", "{n} replies to your requests in the last {days} days", { days: recentDays }), href: "/sourcing/replies", todo: false });
  return out;
}
