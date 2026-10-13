/**
 * When an article can be ordered. "Order Ready" is worked out each time from
 * what is on file — never stored, never granted:
 *
 *  - the supplier's company gave, once, what any order needs (who it is, a
 *    verified address to write to, where it works, a person who may act, the
 *    conditions of the service accepted);
 *  - the article says exactly what it is: its code, and a name and technical
 *    description precise enough that two people cannot mean two things by it,
 *    confirmed by the supplier. "Wax" is not an article;
 *  - the six commercial conditions are complete and were confirmed by an
 *    authorised person;
 *  - the price is still within its date. Past it, the article stops being
 *    orderable by itself — its page and its history stay.
 *
 * Nothing here fills in a value: what is missing is said, and the supplier
 * states it.
 */
import { en, type Msg, type T } from "../i18n";
import { normalizeKey } from "../import/normalize/text";
import { LEAD_TIMES, NAMES_A_PLACE, ORDER_CONFIG, ORDER_TERMS_VERSION, type DeliveryTerm, type LeadTime, type ListingState, type PaymentTerm, type TermField, type Terms } from "./types";

// ---------------- The company ----------------

export const ORG_REQUIREMENTS = ["identity", "email", "address", "user", "conditions"] as const;
export type OrgRequirement = (typeof ORG_REQUIREMENTS)[number];
export const ORG_REQUIREMENT_LABEL: Record<OrgRequirement, Msg> = {
  identity: "Company name and VAT number or tax code",
  email: "A verified company email address",
  address: "The address the company works from",
  user: "A person authorised to act for the company",
  conditions: "The conditions of the order service, accepted",
};

export interface OrgFacts {
  name: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  /** A person who may act for the company has a verified address. */
  emailVerified: boolean;
  /** Someone may answer orders and someone may change conditions. */
  authorisedUser: boolean;
  termsVersion: string | null;
}

/** What the company still has to give before any of its articles can take orders. Asked once, never per article. */
export function orgGaps(o: OrgFacts): OrgRequirement[] {
  const has = (v: string | null) => !!v?.trim();
  return ORG_REQUIREMENTS.filter((r) =>
    r === "identity"
      ? !(has(o.name) && (has(o.vatNumber) || has(o.taxCode)))
      : r === "email"
        ? !o.emailVerified
        : r === "address"
          ? !(has(o.address) && has(o.city) && has(o.country))
          : r === "user"
            ? !o.authorisedUser
            : o.termsVersion !== ORDER_TERMS_VERSION,
  );
}

// ---------------- The article ----------------

export interface Identity {
  code: string | null;
  name: string;
  description: string | null;
  specConfirmed: boolean;
}

export const IDENTITY_GAPS = ["code", "description", "confirmation"] as const;
export type IdentityGap = (typeof IDENTITY_GAPS)[number];
export const IDENTITY_GAP_LABEL: Record<IdentityGap, Msg> = {
  code: "Your article code is missing.",
  description: "Name and technical description are too generic: say the type, the grade or the specification, so that the article cannot be taken for another.",
  confirmation: "Confirm that code and description identify exactly one article, with its specification.",
};

/** The distinct words of a name and its description: letters and figures, whatever the punctuation. */
const words = (...texts: (string | null)[]) => new Set(texts.flatMap((x) => normalizeKey(x).split(" ")).filter((w) => w.length > 1 || /\d/.test(w)));

/**
 * Why an article is not precise enough to be ordered. One word and a code is
 * not an article: the description has to say which one, and the supplier has
 * to confirm it does.
 */
export function identityGaps(p: Identity): IdentityGap[] {
  const gaps: IdentityGap[] = [];
  if (!p.code?.trim()) gaps.push("code");
  if (words(p.name, p.description).size < ORDER_CONFIG.minIdentityWords) gaps.push("description");
  if (!p.specConfirmed) gaps.push("confirmation");
  return gaps;
}

// ---------------- The six conditions ----------------

const positive = (n: number | null) => n != null && Number.isFinite(n) && n > 0;
const said = (v: string | null) => !!v?.trim();
const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Close enough to a whole number of steps: quantities are typed with decimals. */
const whole = (n: number) => Math.abs(n - Math.round(n)) < 1e-6;

/**
 * Which of the six are not complete. A date in the past is a complete
 * validity — an expired one: that is `listingState`'s to say, not a gap.
 */
export function missingTerms(terms: Terms | null): TermField[] {
  if (!terms) return ["price", "minimum", "leadTime", "delivery", "payment", "validity"];
  const out: TermField[] = [];
  if (!positive(terms.unitPrice) || !said(terms.currency) || terms.taxesIncluded == null) out.push("price");
  if (!positive(terms.minQuantity) || (terms.quantityStep != null && (!positive(terms.quantityStep) || !whole(terms.minQuantity! / terms.quantityStep)))) out.push("minimum");
  if (!terms.leadTime || (terms.leadTime === "custom" && !said(terms.leadTimeNote))) out.push("leadTime");
  if (
    !terms.delivery ||
    (NAMES_A_PLACE.includes(terms.delivery) && !said(terms.deliveryPlace)) ||
    (terms.delivery === "other" && (!said(terms.deliveryNote) || terms.transportIncluded == null))
  )
    out.push("delivery");
  if (!terms.payment || (terms.payment === "other" && !said(terms.paymentNote))) out.push("payment");
  if (!isDay(terms.validUntil)) out.push("validity");
  return out;
}

/** What is wrong with a minimum and its step, in words — or null. */
export function minimumProblem(terms: Pick<Terms, "minQuantity" | "quantityStep">, t: T = en): string | null {
  if (terms.minQuantity != null && !positive(terms.minQuantity)) return t("The minimum quantity must be greater than zero.");
  if (terms.quantityStep != null && !positive(terms.quantityStep)) return t("The step must be greater than zero.");
  if (positive(terms.minQuantity) && positive(terms.quantityStep) && !whole(terms.minQuantity! / terms.quantityStep!)) return t("The minimum must be a whole number of steps: with steps of {step}, a minimum of {min} cannot be ordered.", { step: String(terms.quantityStep), min: String(terms.minQuantity) });
  return null;
}

export type QuantityCheck = { ok: true } | { ok: false; reason: "invalid" | "below_minimum" | "not_a_multiple"; message: string };

/** Whether a quantity can be ordered on these conditions: from the minimum up, in whole steps. */
export function checkQuantity(quantity: number | null, terms: Pick<Terms, "minQuantity" | "quantityStep">, unit: string, t: T = en): QuantityCheck {
  if (!positive(quantity)) return { ok: false, reason: "invalid", message: t("Say how much you want to order.") };
  if (positive(terms.minQuantity) && quantity! < terms.minQuantity! - 1e-9) return { ok: false, reason: "below_minimum", message: t("The minimum order is {min} {unit}.", { min: String(terms.minQuantity), unit }) };
  if (positive(terms.quantityStep) && !whole(quantity! / terms.quantityStep!)) return { ok: false, reason: "not_a_multiple", message: t("This article is ordered in steps of {step} {unit}.", { step: String(terms.quantityStep), unit }) };
  return { ok: true };
}

// ---------------- The state ----------------

export interface ListingFacts {
  /** Orders were switched on for the article, and are not paused. */
  enabled: boolean;
  suspended: boolean;
  /** The supplier does not take orders from this customer for now. */
  blocked: boolean;
  orgGaps: number;
  identityGaps: number;
  terms: Terms | null;
  /** The conditions in force were confirmed by an authorised person. */
  confirmed: boolean;
}

/**
 * The state of an article for one customer, on a day:
 *  - suspended: the supplier paused it, for everyone or for this customer;
 *  - expired: everything is in place but the price is past its date;
 *  - order_ready: everything is in place and confirmed;
 *  - catalog_ready: the article exists, something is not complete.
 */
export function listingState(x: ListingFacts, today: string): ListingState {
  if (x.suspended || x.blocked) return "suspended";
  const complete = x.enabled && x.confirmed && x.orgGaps === 0 && x.identityGaps === 0 && missingTerms(x.terms).length === 0;
  if (!complete) return "catalog_ready";
  return x.terms!.validUntil! < today ? "expired" : "order_ready";
}

// ---------------- What is already known: proposals to check ----------------

/** A number of days as one of the quick choices — or the days themselves, in words, when none fits. */
export function leadTimeFromDays(days: number | null, t: T = en): { leadTime: LeadTime; leadTimeNote: string | null } | null {
  if (days == null || !Number.isFinite(days) || days <= 0) return null;
  const bucket = days <= 3 ? "1_3" : days <= 7 ? "4_7" : days <= 14 ? "7_14" : days <= 30 ? "15_30" : null;
  return bucket ? { leadTime: bucket, leadTimeNote: null } : { leadTime: "custom", leadTimeNote: t.n(days, "{n} day", "{n} days") };
}

export function paymentFromDays(days: number | null, t: T = en): { payment: PaymentTerm; paymentNote: string | null } | null {
  if (days == null || !Number.isFinite(days) || days < 0) return null;
  if (days === 0) return { payment: "advance", paymentNote: null };
  if (days === 30 || days === 60 || days === 90) return { payment: `${days}_days` as PaymentTerm, paymentNote: null };
  return { payment: "other", paymentNote: t.n(days, "{n} day", "{n} days") };
}

/** Delivery terms as written on a quotation ("CFR Salerno", "DAP") read into the choices on offer; what is none of them stays in words. */
export function deliveryFromIncoterm(incoterm: string | null, place: string | null): Pick<Terms, "delivery" | "deliveryPlace" | "deliveryNote"> | null {
  const term = incoterm?.trim().toUpperCase() ?? "";
  if (!term) return null;
  if (term === "DAP" || term === "FCA" || term === "EXW") return { delivery: term as DeliveryTerm, deliveryPlace: place?.trim() || null, deliveryNote: null };
  return { delivery: "other", deliveryPlace: null, deliveryNote: [term, place?.trim()].filter(Boolean).join(" ") };
}

export const isLeadTimeKey = (v: unknown): v is LeadTime => typeof v === "string" && (LEAD_TIMES as readonly string[]).includes(v);

/** Where a proposed value comes from: only the supplier's own statements to this same customer. */
export const TERMS_SOURCES = ["reply_offer", "recorded_quote", "invoice"] as const;
export type TermsSourceKind = (typeof TERMS_SOURCES)[number];
export const TERMS_SOURCE_LABEL: Record<TermsSourceKind, Msg> = {
  reply_offer: "From your quotation to {company} of {date}",
  recorded_quote: "From your quotation, as {company} recorded it on {date}",
  invoice: "From your invoice to {company} of {date}",
};

/**
 * Values the supplier already stated to this customer, offered to be checked.
 * Never the conditions themselves: a person of the supplier confirms them, and
 * what comes from one customer's invoices or quotations is proposed for that
 * customer only — never as a price for everyone.
 */
export interface TermsProposal {
  kind: TermsSourceKind;
  date: string | null;
  /** The customer it was stated to: the only one it may be proposed for. */
  relationshipId: string;
  values: Partial<Terms>;
  /** What the source wrote that could not be read into a choice: shown next to the field, as written. */
  asWritten: Partial<Record<TermField, string>>;
}
