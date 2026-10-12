/**
 * The directory, narrowed: by where a company is, what it is, what it makes
 * and of what, how far along it is, whether it can be written to. Every
 * filter is its own — they add up, none resets another — and the search box
 * reads names and products with the same forgiving search the product picker
 * uses (lib/catalog/find.ts).
 */
import { countryKey } from "../countries";
import { findProducts } from "../catalog/find";
import { continentOf, isMaker, isOem, statusRank, type Continent, type MarketSupplier } from "./types";

/** What the buyer's own records say about a company of the directory. */
export interface SupplierLinks {
  /** It is one of the buyer's suppliers already. */
  current: boolean;
  /** The buyer's products it was made a candidate for. */
  candidateFor: { productId: string; name: string }[];
  /** answered: it replied to a request for quotation (its reply is on file, lib/replies/) — which is not yet a quote on a product. */
  rfq: "none" | "candidate" | "contacted" | "answered" | "quote_received";
  /** The company's page among the replies to requests, when it answered one. */
  replyId: string | null;
}
export const NO_LINKS: SupplierLinks = { current: false, candidateFor: [], rfq: "none", replyId: null };

export interface MarketQuery {
  q?: string | null;
  continent?: string | null;
  country?: string | null;
  /** maker: produces it · oem: could make it to a drawing · reseller: distributes or imports it · a role key. */
  role?: string | null;
  material?: string | null;
  type?: string | null;
  technology?: string | null;
  status?: string | null;
  /** yes: a public email is on file · no: none found. */
  email?: string | null;
  /** yes: at least a technical match to review with the buyer's references. */
  match?: string | null;
  rfq?: string | null;
}

export type Row = MarketSupplier & { links: SupplierLinks };

const MATCH_FROM = statusRank("technical_match_to_review");
export const isMatch = (s: { status: string }) => statusRank(s.status) >= MATCH_FROM;

export function filterSuppliers(rows: Row[], query: MarketQuery): Row[] {
  const country = query.country ? countryKey(query.country) : null;
  let out = rows.filter((s) => {
    if (query.continent && continentOf(s.country) !== (query.continent as Continent)) return false;
    if (country && countryKey(s.country) !== country) return false;
    if (query.role === "maker" ? !isMaker(s.role) : query.role === "oem" ? !isOem(s) : query.role === "reseller" ? !(s.role === "distributor" || s.role === "importer") : query.role ? s.role !== query.role : false) return false;
    if (query.material && !s.materials.some((m) => m.toUpperCase() === query.material!.toUpperCase())) return false;
    if (query.type && !s.productTypes.includes(query.type)) return false;
    if (query.technology && !s.technologies.includes(query.technology)) return false;
    if (query.status && s.status !== query.status) return false;
    if (query.email === "yes" ? !s.email : query.email === "no" ? !!s.email : false) return false;
    if (query.match === "yes" && !isMatch(s)) return false;
    if (query.rfq && s.links.rfq !== query.rfq) return false;
    return true;
  });
  const words = query.q?.trim();
  if (words) {
    // The name first, then everything its page says it makes and where it is.
    const found = findProducts(
      out.map((s) => ({ id: s.id, name: s.name, code: s.tradeName, terms: [s.profile.products, s.profile.sizes, s.profile.evidence, s.city, s.country, ...s.materials].filter((x): x is string => !!x) })),
      words,
    );
    const order = new Map(found.map((f, i) => [f.item.id, i]));
    out = out.filter((s) => order.has(s.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  } else {
    // The furthest along first, then makers before the others, then by name.
    out = [...out].sort((a, b) => statusRank(b.status) - statusRank(a.status) || Number(isMaker(b.role)) - Number(isMaker(a.role)) || a.name.localeCompare(b.name));
  }
  return out;
}

export interface Facets {
  continents: [Continent, number][];
  countries: [string, number][];
  materials: [string, number][];
  types: [string, number][];
  technologies: [string, number][];
  statuses: [string, number][];
  roles: [string, number][];
  withEmail: number;
  makers: number;
  oem: number;
  resellers: number;
  matches: number;
}

const count = <K extends string>(keys: (K | null | undefined)[]): [K, number][] => {
  const m = new Map<K, number>();
  for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

/** What there is to filter by, with how many companies each choice leaves: nothing is offered that is not on file. */
export function facets(rows: Row[]): Facets {
  return {
    continents: count(rows.map((s) => continentOf(s.country))),
    countries: count(rows.map((s) => countryKey(s.country))),
    materials: count(rows.flatMap((s) => s.materials.map((m) => m.toUpperCase()))),
    types: count(rows.flatMap((s) => s.productTypes)),
    technologies: count(rows.flatMap((s) => s.technologies)),
    statuses: count(rows.map((s) => s.status)).sort((a, b) => statusRank(b[0]) - statusRank(a[0])),
    roles: count(rows.map((s) => s.role)),
    withEmail: rows.filter((s) => s.email).length,
    makers: rows.filter((s) => isMaker(s.role)).length,
    oem: rows.filter((s) => isOem(s)).length,
    resellers: rows.filter((s) => s.role === "distributor" || s.role === "importer").length,
    matches: rows.filter(isMatch).length,
  };
}

export const PAGE_SIZE = 25;
export function pageOf<X>(rows: X[], page: number, size = PAGE_SIZE): { rows: X[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((at - 1) * size, at * size), page: at, pages };
}
