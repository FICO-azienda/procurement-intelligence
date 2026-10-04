/**
 * From many companies found to the few worth writing to. A research can find
 * twenty candidates; nobody should read twenty pages or send twenty emails.
 * Each candidate is placed on a funnel from what is on file — what its own
 * page states, what kind of company it is, where it is, what is known of its
 * terms — and only a handful are recommended for a request for quotation.
 *
 * Technical fit comes first: a candidate that does not plausibly supply the
 * product is never lifted by a low price. Nothing is deleted: what is put
 * aside says why. The user's own judgement (validated, rejected, "different
 * product") always wins over the rules.
 *
 * Company-agnostic: the rules read fields every candidate has, never a
 * product category or a supplier's name.
 */
import { daysBetween } from "../analytics";
import { countryName } from "../countries";
import { en, upperFirst, type Msg, type T } from "../i18n";
import { companyKey } from "../import/normalize/text";
import { hostOf } from "./discovery";
import { crossesCustoms, regionOf, type Region } from "./regions";
import { COMPANY_TYPE_LABEL, SOURCING_CONFIG, type SourcingConfig, type SupplierCandidate } from "./types";

/** Where a candidate stands before anyone is contacted. */
export type FunnelStage = "not_suitable" | "low_priority" | "discovered" | "plausible" | "strong";

export const STAGE_LABEL: Record<FunnelStage, Msg> = {
  not_suitable: "Not suitable",
  low_priority: "Low priority",
  discovered: "Discovered",
  plausible: "Plausible",
  strong: "Strong match",
};

export const STAGE_MEANING: Record<FunnelStage, Msg> = {
  not_suitable: "Judged a different product, or rejected by you. Kept on file, not proposed.",
  low_priority: "Nothing on file shows it supplies this product. Kept on file, not proposed.",
  discovered: "Found, with nothing yet to say whether it supplies this product.",
  plausible: "There is evidence it produces or sells this kind of product.",
  strong: "Its own site states the product, the kind of company is known and it is within practical reach.",
};

export type ContactValue = "high" | "possible" | "low";
export const CONTACT_VALUE_LABEL: Record<ContactValue, Msg> = { high: "High value to contact", possible: "Possible", low: "Low value" };

/** How much a product weighs: the first round of requests is for the few that weigh most. */
export type Materiality = "focus" | "priority" | "minor";

export type Logistics = "simple" | "moderate" | "complex" | "unknown";
export const LOGISTICS_LABEL: Record<Logistics, Msg> = {
  simple: "Simple: same customs area",
  moderate: "Moderate: nearby, with customs",
  complex: "Complex: long transport and customs",
  unknown: "Unknown: country not known",
};

export type EvidenceQuality = "checked" | "official" | "external" | "none";
export const EVIDENCE_LABEL: Record<EvidenceQuality, Msg> = {
  checked: "Its own site, read by the research",
  official: "Its own site, as recorded by who found it",
  external: "A third-party source",
  none: "No page on file",
};

/** What an entry is for: a price to know about, a company on file, or a company worth a request. */
export type EvidenceRole = "market_signal" | "supplier_candidate" | "rfq_candidate";
export const ROLE_LABEL: Record<EvidenceRole, Msg> = { market_signal: "Market signal only", supplier_candidate: "Supplier candidate", rfq_candidate: "RFQ candidate" };

export interface Screened {
  candidate: SupplierCandidate;
  region: Region;
  stage: FunnelStage;
  /** Why it is at this stage. */
  reason: string;
  /** What the evidence says of the technical fit, in words. */
  fit: string;
  evidence: EvidenceQuality;
  logistics: Logistics;
  /** The best thing known about it, and the most important thing not known. */
  strength: string | null;
  unknown: string;
  contactValue: ContactValue;
  /** One of the few recommended for a request for quotation. */
  shortlisted: boolean;
  why: string | null;
  role: EvidenceRole;
  /** Asked already: a request has been sent, or a quote has arrived. */
  inProgress: boolean;
  /** Internal, to order the list. Never shown. */
  score: number;
}

export interface Screening {
  all: Screened[];
  shortlist: Screened[];
  /** Of the shortlist, those not written to yet. */
  toContact: Screened[];
  counts: { found: number; plausible: number; strong: number; recommended: number; lower: number; notSuitable: number; asked: number; quotes: number };
}

export interface ScreeningContext {
  unit: string;
  annualQuantity: number | null;
  typicalOrderQuantity: number | null;
  homeCountry: string | null;
  materiality: Materiality;
  /** The current price is above the outside evidence on file: an answer could change a decision. */
  priceAboveEvidence: boolean;
  asOf: string;
}

const NEAR: Region[] = ["home", "eu", "nearby"];
const TYPE_POINTS = { manufacturer: 20, distributor: 12, wholesaler: 10 } as const;
const REGION_POINTS: Record<Region, number> = { home: 12, eu: 11, nearby: 7, asia: 3, other: 3, unknown: 0 };
const MATERIALITY_FACTOR: Record<Materiality, number> = { focus: 1, priority: 0.7, minor: 0.4 };
const ASKED: SupplierCandidate["status"][] = ["contacted", "quote_requested", "quote_received"];

export function screenCandidates(candidates: SupplierCandidate[], ctx: ScreeningContext, t: T = en, cfg: SourcingConfig = SOURCING_CONFIG): Screening {
  const all = candidates.map((c): Screened => {
    const region = regionOf(c.country ?? c.shippingOrigin, ctx.homeCountry);
    const own = c.sourceLevel === "supplier_official";
    // What its own page says: true, false, or null when no page was read.
    const stated = c.specCheck ? c.specCheck.product.length > 0 : null;
    const exact = !!c.specCheck && stated === true && c.specCheck.confirmed.length > 0 && c.specCheck.missing.length === 0;
    const judged = c.technicalCompatibility;
    const overMinimum = c.moq != null && ctx.annualQuantity != null && ctx.annualQuantity > 0 && c.moq > ctx.annualQuantity;
    const evidence: EvidenceQuality = c.specCheck && own ? "checked" : own ? "official" : c.sourceUrl ? "external" : "none";
    const customs = crossesCustoms(c.country ?? c.shippingOrigin, ctx.homeCountry);
    const logistics: Logistics = region === "unknown" ? "unknown" : region === "home" || region === "eu" ? (customs ? "moderate" : "simple") : region === "nearby" ? "moderate" : "complex";

    // ---- Stage: technical fit first, the user's judgement above everything.
    let stage: FunnelStage;
    let reason: string;
    if (c.status === "rejected") [stage, reason] = ["not_suitable", t("Rejected by you.")];
    else if (judged === "not") [stage, reason] = ["not_suitable", t("Judged a different product.")];
    else if (stated === false && judged == null) [stage, reason] = ["low_priority", t("The page read on its site does not state the product.")];
    else if (overMinimum) [stage, reason] = ["low_priority", t("Its minimum order is above what you buy in a year.")];
    else if (!c.sourceUrl && !c.website) [stage, reason] = ["low_priority", t("No page on file to check what it sells.")];
    else {
      const plausible = stated === true || judged === "high" || judged === "partial" || (own && !!c.productMatched);
      const strong = plausible && (stated === true || judged === "high") && c.companyType != null && NEAR.includes(region);
      if (strong) [stage, reason] = ["strong", exact ? t("Its own site states the product and the specification.") : t("Its own site states the product; the kind of company is known and it is within practical reach.")];
      else if (plausible) {
        stage = "plausible";
        reason = stated === true ? (c.companyType == null ? t("Its own site states the product; the kind of company is not known.") : t("Its own site states the product; it is far, with customs and long transport.")) : t("Recorded as selling this kind of product; its page has not been checked against the product.");
      } else [stage, reason] = ["discovered", own ? t("Found, with nothing yet on what it sells.") : t("Found on a third-party source only: nothing from its own site yet.")];
    }

    const missing = c.specCheck?.missing ?? [];
    const fit = exact
      ? t("Product and specification stated on its site")
      : stated === true
        ? missing.length
          ? t("Product stated; exact specification ({spec}) to confirm", { spec: missing.join(", ") })
          : t("Product stated; specification to confirm")
        : stated === false
          ? t("Product not stated on the page read")
          : judged === "high"
            ? t("Same specification, as judged by you")
            : c.productMatched
              ? t("As recorded by who found it; not checked on its site")
              : t("Unknown|compatibility");

    const where = region === "home" && ctx.homeCountry ? countryName(ctx.homeCountry, t.locale) : c.country ? countryName(c.country, t.locale) : null;
    const kind = c.companyType ? t(COMPANY_TYPE_LABEL[c.companyType]) : null;
    const strength =
      [
        kind && where ? t("{kind} in {country}", { kind, country: where }) : (kind ?? where),
        exact ? t("states the exact specification") : stated === true ? t("its own site states the product") : null,
        c.priceLow != null ? t("publishes a price") : null,
        c.certifications ? t("certifications stated") : null,
      ]
        .filter(Boolean)
        .join("; ") || null;
    const unknown = exact ? t("Price, minimum order and lead time: not public, to ask") : missing.length ? t("Exact specification ({spec}), then price and terms", { spec: missing.join(", ") }) : t("Specification to confirm, then price and terms");

    const known = [c.priceLow, c.moq, c.leadTimeDays, c.certifications, c.specCheck?.email].filter((x) => x != null && x !== "").length;
    const seen = c.specCheck?.checkedAt ?? c.discoveredAt ?? c.sourceDate;
    const score =
      (exact || judged === "high" ? 40 : stated === true ? 28 : stage === "plausible" ? 16 : 0) +
      (c.companyType ? TYPE_POINTS[c.companyType] : 4) +
      REGION_POINTS[region] +
      (evidence === "checked" ? 10 : evidence === "official" ? 6 : evidence === "external" ? 2 : 0) +
      Math.min(known, 4) * 2 +
      (seen && daysBetween(seen, ctx.asOf) <= cfg.maxAgeDays ? 3 : 0) +
      (c.status === "validated" ? 25 : c.status === "quote_received" ? 20 : ASKED.includes(c.status) ? 10 : 0);

    return { candidate: c, region, stage, reason, fit, evidence, logistics, strength, unknown, contactValue: "low", shortlisted: false, why: null, role: "supplier_candidate", inProgress: ASKED.includes(c.status), score };
  });

  // ---- The few worth writing to: strong ones first, plausible ones only to fill; the user's own picks always.
  const order = (a: Screened, b: Screened) => (a.stage === b.stage ? 0 : a.stage === "strong" ? -1 : b.stage === "strong" ? 1 : 0) || b.score - a.score || a.candidate.name.localeCompare(b.candidate.name);
  const eligible = all.filter((s) => (s.stage === "strong" || s.stage === "plausible") && s.candidate.status !== "converted").sort(order);
  const strong = all.filter((s) => s.stage === "strong").length;
  const size = strong >= cfg.manyStrongCandidates ? cfg.shortlistMax : cfg.shortlistSize;
  const picked = eligible.filter((s) => s.candidate.status === "validated" || s.inProgress).slice(0, cfg.shortlistMax);
  for (const s of eligible) if (picked.length < size && !picked.includes(s)) picked.push(s);
  const shortlist = picked.sort(order);
  for (const s of shortlist) {
    s.shortlisted = true;
    s.role = "rfq_candidate";
    s.why = s.candidate.status === "validated" ? t("Validated by you. {strength}.", { strength: upperFirst(s.strength ?? s.fit) }) : `${upperFirst(s.strength ?? s.fit)}.`;
  }
  for (const s of all) {
    const value = s.score * MATERIALITY_FACTOR[ctx.materiality] + (ctx.priceAboveEvidence ? 10 : 0);
    s.contactValue = s.stage === "not_suitable" || s.stage === "low_priority" || s.stage === "discovered" ? "low" : s.shortlisted && value >= 60 ? "high" : "possible";
    // A company that is not worth writing to may still publish a price worth knowing.
    if (!s.shortlisted && s.candidate.priceLow != null && (s.stage === "low_priority" || s.stage === "not_suitable")) s.role = "market_signal";
  }

  const sorted = [...all].sort((a, b) => Number(b.shortlisted) - Number(a.shortlisted) || STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
  return {
    all: sorted,
    shortlist,
    toContact: shortlist.filter((s) => !s.inProgress),
    counts: {
      found: all.length,
      plausible: all.filter((s) => s.stage === "plausible" || s.stage === "strong").length,
      strong,
      recommended: shortlist.length,
      lower: all.filter((s) => s.stage === "low_priority" || s.stage === "discovered").length,
      notSuitable: all.filter((s) => s.stage === "not_suitable").length,
      asked: all.filter((s) => s.inProgress).length,
      quotes: all.filter((s) => s.candidate.status === "quote_received").length,
    },
  };
}

const STAGE_ORDER: FunnelStage[] = ["strong", "plausible", "discovered", "low_priority", "not_suitable"];

// ---------------- One supplier, several products ----------------

export interface SupplierLine {
  productId: string;
  productName: string;
  annualSpend: number;
  candidateId: string;
  stage: FunnelStage;
  shortlisted: boolean;
  materiality: Materiality;
  status: SupplierCandidate["status"];
  unknown: string;
}

export interface SupplierOpportunity {
  key: string;
  name: string;
  country: string | null;
  companyType: SupplierCandidate["companyType"];
  website: string | null;
  email: string | null;
  /** The products it could cover, the largest first: at least plausible for each. */
  lines: SupplierLine[];
  /** What the company spends today on the products it could cover. */
  combinedSpend: number;
  /** Recommended for a product of the first round: worth a request now. */
  recommended: boolean;
  contactValue: ContactValue;
  /** What to ask, across its products. */
  missing: string[];
}

/** The same company on several products is one supplier to write to once, with one request. */
export function supplierOpportunities(products: { productId: string; name: string; annualSpend: number; materiality: Materiality; screening: Screening }[], t: T = en): SupplierOpportunity[] {
  const byKey = new Map<string, SupplierOpportunity>();
  for (const p of products) {
    for (const s of p.screening.all) {
      if (s.stage !== "strong" && s.stage !== "plausible") continue;
      const c = s.candidate;
      const key = companyKey(c.name) || hostOf(c.website) || c.name;
      const o = byKey.get(key) ?? { key, name: c.name, country: c.country, companyType: c.companyType, website: c.website, email: null, lines: [], combinedSpend: 0, recommended: false, contactValue: "low" as ContactValue, missing: [] };
      o.lines.push({ productId: p.productId, productName: p.name, annualSpend: p.annualSpend, candidateId: c.id, stage: s.stage, shortlisted: s.shortlisted, materiality: p.materiality, status: c.status, unknown: s.unknown });
      o.email ??= c.specCheck?.email ?? null;
      o.companyType ??= c.companyType;
      o.country ??= c.country;
      o.website ??= c.website;
      if (s.shortlisted && p.materiality === "focus") o.recommended = true;
      if (s.contactValue === "high" || (s.contactValue === "possible" && o.contactValue === "low")) o.contactValue = s.contactValue;
      byKey.set(key, o);
    }
  }
  const out = [...byKey.values()];
  for (const o of out) {
    o.lines.sort((a, b) => b.annualSpend - a.annualSpend);
    o.combinedSpend = o.lines.reduce((sum, l) => sum + l.annualSpend, 0);
    o.missing = [...new Set([...o.lines.map((l) => l.unknown), t("Minimum order, lead time, payment and delivery terms")])].slice(0, 3);
  }
  return out.sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.combinedSpend - a.combinedSpend || a.name.localeCompare(b.name));
}

// ---------------- Who was asked, and when ----------------

export interface RfqRequest {
  id: string;
  supplierKey: string;
  supplierName: string;
  candidateIds: string[];
  productIds: string[];
  kind: "request" | "update" | "follow_up";
  sentAt: string;
}

export interface ContactHistory {
  /** Times written to, follow-ups included. */
  times: number;
  first: string | null;
  last: string | null;
  productIds: string[];
  daysSinceLast: number | null;
  /** Written to recently: extend the earlier request instead of starting a new one. */
  recent: boolean;
  /** Asked, no quote on file, and the wait is over: a follow-up is in order. */
  followUpDue: boolean;
}

export function contactHistory(requests: RfqRequest[], supplierKey: string, answered: boolean, asOf: string, cfg: SourcingConfig = SOURCING_CONFIG): ContactHistory {
  const mine = requests.filter((r) => r.supplierKey === supplierKey).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const last = mine.at(-1)?.sentAt ?? null;
  const days = last ? daysBetween(last, asOf) : null;
  return {
    times: mine.length,
    first: mine[0]?.sentAt ?? null,
    last,
    productIds: [...new Set(mine.flatMap((r) => r.productIds))],
    daysSinceLast: days,
    recent: days != null && days <= cfg.recentContactDays,
    followUpDue: !answered && days != null && days >= cfg.followUpAfterDays,
  };
}
