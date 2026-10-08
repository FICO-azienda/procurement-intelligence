/**
 * Supplier discovery, the pure part: which searches to run for a product,
 * which of the results can be kept (only what carries its source), how
 * comparable a candidate is, and which few to show first.
 *
 * Nothing here finds a supplier by itself: providers do (providers.ts), or
 * the user does. This module never adds a fact that nobody sourced.
 */
import { allSubs, categorize } from "../catalog/taxonomy";
import { withoutPackNotes } from "../catalog/attributes";
import { separate } from "../catalog/identity";
import { countryName } from "../countries";
import { en, type T } from "../i18n";
import { companyKey, normalizeKey } from "../import/normalize/text";
import { conversionFactor, normalizeUnit } from "../import/normalize/units";
import type { DiscoveredSupplier } from "./providers";
import { crossesCustoms, regionOf, type Region } from "./regions";
import { SOURCING_CONFIG, sourceRank, type Comparability, type MatchStrength, type SourcingConfig, type SupplierCandidate } from "./types";

// ---------------- Search queries ----------------

export interface QueryInput {
  name: string;
  category: string | null;
  subcategory: string | null;
  family: string | null;
  specifications: Record<string, string>;
  deliveryCountry: string | null;
  /** Who the company buys it from: their names are taken out of the searches. */
  knownSuppliers?: string[];
  /** What kind of product it is (lib/research/strategy.ts): a private-label or custom product is searched as such. */
  productClass?: string | null;
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
/**
 * The product's name as it can be said to anyone: without the current
 * supplier's name, its codes in brackets and its packing notes. Used for the
 * searches and for the requests sent to other suppliers.
 */
export function neutralName(input: Pick<QueryInput, "name" | "knownSuppliers">): string {
  return coreName(input);
}

function coreName(input: Pick<QueryInput, "name" | "knownSuppliers">): string {
  // The same reading the catalogue uses (lib/catalog/identity.ts): who sold it and how it calls it are not what the product is.
  const body = separate(withoutPackNotes(input.name), { names: input.knownSuppliers ?? [] }).body;
  return tidy(body.replace(/\([^)]*\)/g, " ")) || tidy(input.name);
}
const numbersIn = (text: string) => (text.match(/\d+(?:[.,/x]\d+)*/g) ?? []).slice(0, 2).join(" ");

/** What the product is called in English, when its subcategory is one we know ("Paraffina" → "paraffin"). */
function englishNoun(input: QueryInput, t: T): string | null {
  const key = normalizeKey(input.subcategory);
  const ref = key ? allSubs().find((r) => normalizeKey(t(r.sub.label)) === key || normalizeKey(r.sub.label) === key) : undefined;
  // Not filed yet: the name itself may say what it is.
  return (ref ?? categorize(input.name))?.sub.noun.toLowerCase() ?? null;
}

/**
 * The searches worth running for a product: its name with "supplier" and
 * "manufacturer", in the user's language and in English, with its sizes and
 * material. They never contain the price paid or the current supplier.
 */
export function searchQueries(input: QueryInput, t: T = en): string[] {
  const core = coreName(input);
  // What the thing is called: its family or subcategory, else the first real word of its name (not "ART." or a code).
  const generic = input.family ?? input.subcategory ?? core.split(" ").find((w) => /^\p{L}{4,}$/u.test(w)) ?? core.split(" ")[0];
  const specs = [input.specifications.material, input.specifications.size ?? input.specifications.diameter, input.specifications.capacity].filter(Boolean).join(" ");
  const country = input.deliveryCountry ? countryName(input.deliveryCountry, t.locale) : null;
  const noun = englishNoun(input, t);
  const figures = numbersIn(core);
  // Made for the company, or to a drawing: what is needed is someone able to make it, not a catalogue price.
  const made =
    input.productClass === "private_label"
      ? [`${generic} ${t("private label manufacturer|search")}`, ...(noun ? [`${noun} private label manufacturer Europe`, `${noun} contract manufacturing`] : [])]
      : input.productClass === "custom"
        ? [`${generic} ${t("custom manufacturer|search")}`, ...(noun ? [`custom ${noun} manufacturer Europe`] : [])]
        : [];
  const out = [
    ...made,
    `${core} ${t("supplier|search")}`,
    `${core} ${t("manufacturer|search")}${country ? ` ${country}` : ""}`,
    `${generic} ${specs} ${t("wholesale|search")}`,
    ...(noun ? [`${noun} ${figures} supplier Europe`, `${noun} ${figures} manufacturer bulk`] : t.locale === "en" ? [] : [`${core} supplier Europe`]),
  ].map((q) => tidy(q));
  return [...new Set(out.map((q) => q.toLowerCase()))].map((lower) => out.find((q) => q.toLowerCase() === lower)!);
}

/**
 * The next searches to try, from how the first ones went: a query that found
 * nothing is tried without its figures and codes; when everything found too
 * much, the material and size are added.
 */
export function refineQueries(input: QueryInput, tried: { query: string; results: number }[], t: T = en): string[] {
  const done = new Set(tried.map((x) => x.query.toLowerCase()));
  const generic = input.family ?? input.subcategory ?? coreName(input).split(" ")[0];
  const noun = englishNoun(input, t);
  const out: string[] = [];
  if (tried.some((x) => x.results === 0)) {
    out.push(`${generic} ${t("supplier|search")}`, `${generic} ${t("manufacturer|search")}`);
    if (noun) out.push(`${noun} supplier`, `${noun} manufacturer Europe`);
  }
  if (tried.length > 0 && tried.every((x) => x.results >= 20)) {
    const specs = Object.values(input.specifications).slice(0, 3).join(" ");
    if (specs) out.push(`${coreName(input)} ${specs} ${t("supplier|search")}`);
  }
  return [...new Set(out.map(tidy))].filter((q) => !done.has(q.toLowerCase()));
}

// ---------------- What a provider returns ----------------

const isUrl = (s: string | null | undefined) => !!s && /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(s.trim());
export const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url.trim()).hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
};

export type Rejection = "no_name" | "no_source" | "known_supplier" | "already_found";

/**
 * Whether a discovered supplier can be kept, and what of it. No name or no
 * source: refused. A company the user buys from already, or found before:
 * skipped. A price with no page behind it: the supplier is kept, the price is not.
 */
export function acceptDiscovered(
  found: DiscoveredSupplier,
  ctx: { productId: string; provider: string; knownSuppliers: string[]; existing: Pick<SupplierCandidate, "name" | "website">[]; discoveredAt?: string | null },
): { ok: true; candidate: Omit<SupplierCandidate, "id"> } | { ok: false; reason: Rejection } {
  const name = tidy(found.name ?? "");
  if (!name) return { ok: false, reason: "no_name" };
  if (!isUrl(found.sourceUrl)) return { ok: false, reason: "no_source" };
  const key = companyKey(name);
  if (ctx.knownSuppliers.some((s) => companyKey(s) === key)) return { ok: false, reason: "known_supplier" };
  const host = hostOf(found.website);
  if (ctx.existing.some((c) => companyKey(c.name) === key || (host && hostOf(c.website) === host))) return { ok: false, reason: "already_found" };
  const price = found.price && isUrl(found.price.sourceUrl) && found.price.low > 0 && found.price.high >= found.price.low ? found.price : null;
  // Invoices and quotes are the company's own: nothing found outside can claim to be one.
  const level = found.sourceLevel === "invoice" || found.sourceLevel === "quote" ? "external" : found.sourceLevel;
  return {
    ok: true,
    candidate: {
      productId: ctx.productId,
      name,
      country: found.country ?? null,
      website: isUrl(found.website) ? found.website!.trim() : null,
      source: ctx.provider,
      sourceLevel: level,
      sourceUrl: found.sourceUrl.trim(),
      sourceDate: found.sourceDate ?? null,
      productMatched: found.productMatched ?? null,
      matchReason: found.matchReason ?? null,
      technicalCompatibility: found.technicalCompatibility ?? null,
      specifications: found.specifications ?? null,
      priceLow: price?.low ?? null,
      priceHigh: price?.high ?? null,
      priceType: price?.type ?? null,
      priceSourceUrl: price?.sourceUrl ?? null,
      currency: price?.currency ?? null,
      unit: price?.unit ?? null,
      incoterm: price?.incoterm ?? null,
      moq: found.moq ?? null,
      leadTimeDays: found.leadTimeDays ?? null,
      paymentTerms: found.paymentTerms ?? null,
      certifications: found.certifications ?? null,
      shippingOrigin: found.shippingOrigin ?? null,
      confidence: found.confidence ?? null,
      notes: found.notes ?? null,
      status: "discovered",
      supplierId: null,
      companyType: found.companyType ?? null,
      sourceTitle: found.sourceTitle ?? null,
      discoveredAt: ctx.discoveredAt ?? null,
      specCheck: null,
    },
  };
}

// ---------------- Comparability ----------------

export interface ProductContext {
  unit: string;
  typicalOrderQuantity: number | null;
  annualQuantity: number | null;
  homeCountry: string | null;
}

const DELIVERED = new Set(["DAP", "DDP", "CPT", "CIP", "DPU"]);

/** The candidate's price per unit of the product, in EUR — null when it can't be put on that basis. */
export function priceOnOurBasis(c: Pick<SupplierCandidate, "priceLow" | "priceHigh" | "currency" | "unit">, productUnit: string): { low: number; high: number } | null {
  if (c.priceLow == null || c.priceHigh == null || (c.currency ?? "EUR").toUpperCase() !== "EUR") return null;
  const from = normalizeUnit(c.unit) ?? c.unit;
  if (!from) return null;
  const factor = from === productUnit ? 1 : conversionFactor(from, productUnit);
  return factor ? { low: c.priceLow / factor, high: c.priceHigh / factor } : null;
}

/**
 * Whether a candidate's product and terms can be set against what the
 * company buys. Null while nobody has checked the specification: an unknown
 * is not a "yes". The reasons say what stands in the way.
 */
export function candidateComparability(c: SupplierCandidate, product: ProductContext, t: T = en): { level: Comparability | null; reasons: string[] } {
  const reasons: string[] = [];
  if (c.technicalCompatibility == null) return { level: null, reasons: [t("Specification not checked yet")] };
  if (c.technicalCompatibility === "not") return { level: "not", reasons: [t("The product is not the same specification")] };
  if (c.technicalCompatibility === "partial") reasons.push(t("Specification only partly matches"));
  if (c.priceLow != null) {
    if ((c.currency ?? "EUR").toUpperCase() !== "EUR") reasons.push(t("Price in {currency}: exchange rate to apply", { currency: c.currency! }));
    else if (!priceOnOurBasis(c, product.unit)) reasons.push(t("Price per {theirs}, you buy per {ours}", { theirs: c.unit ?? "?", ours: product.unit }));
    if (!c.incoterm || !DELIVERED.has(c.incoterm.toUpperCase())) reasons.push(t("Transport not included in the price"));
  }
  if (crossesCustoms(c.country ?? c.shippingOrigin, product.homeCountry)) reasons.push(t("Duties and import costs to add"));
  if (c.moq != null && product.annualQuantity != null && product.annualQuantity > 0 && c.moq > product.annualQuantity) reasons.push(t("Minimum order above your annual volume"));
  else if (c.moq != null && product.typicalOrderQuantity != null && c.moq > product.typicalOrderQuantity * 1.5) reasons.push(t("Minimum order above your typical order"));
  return { level: reasons.length ? "partial" : "comparable", reasons };
}

// ---------------- Which to show first ----------------

export interface RankedCandidate {
  candidate: SupplierCandidate;
  region: Region;
  comparability: Comparability | null;
  reasons: string[];
  strength: MatchStrength;
  /** Internal, to order the list. Never shown. */
  score: number;
}

const REGION_POINTS: Record<Region, number> = { home: 15, eu: 12, nearby: 8, asia: 4, other: 4, unknown: 0 };
const STATUS_POINTS: Partial<Record<SupplierCandidate["status"], number>> = { validated: 30, quote_received: 20, quote_requested: 10, contacted: 8, to_review: 2 };

/**
 * Candidates in the order worth looking at: how well the product matches,
 * how reliable the source is, how close the supplier is, how much is known —
 * never the search engine's order, and never the price alone. Rejected ones last.
 */
export function rankCandidates(candidates: SupplierCandidate[], product: ProductContext, t: T = en): RankedCandidate[] {
  return candidates
    .map((candidate): RankedCandidate => {
      const { level, reasons } = candidateComparability(candidate, product, t);
      const region = regionOf(candidate.country ?? candidate.shippingOrigin, product.homeCountry);
      const fit = candidate.technicalCompatibility;
      const rank = sourceRank(candidate.sourceLevel);
      const strength: MatchStrength = fit === "high" && rank <= sourceRank("official_data") && !!candidate.productMatched ? "strong" : fit === "high" || fit === "partial" ? "possible" : "needs_validation";
      const known = [candidate.priceLow, candidate.moq, candidate.leadTimeDays, candidate.specifications, candidate.certifications, candidate.website, candidate.paymentTerms].filter((x) => x != null).length;
      const score =
        (candidate.status === "rejected" ? -1000 : 0) +
        (fit === "high" ? 40 : fit === "partial" ? 20 : fit === "not" ? -40 : 8) +
        Math.max(0, 24 - rank * 3) +
        REGION_POINTS[region] +
        known * 3 +
        (STATUS_POINTS[candidate.status] ?? 0);
      return { candidate, region, comparability: level, reasons, strength, score };
    })
    .sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
}

export const topCandidates = (ranked: RankedCandidate[], cfg: SourcingConfig = SOURCING_CONFIG) => ranked.filter((r) => r.candidate.status !== "rejected").slice(0, cfg.topCandidates);
