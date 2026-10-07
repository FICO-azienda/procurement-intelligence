/**
 * Supplier entity resolution: telling when two supplier records are the same
 * company written in two ways — "SER S.p.A.", "SER SPA", "S.E.R. S.p.A." —
 * so that spend, products, quotes and the weight of the relationship are read
 * on the whole company and not on each spelling.
 *
 * Matching follows a hierarchy, the most trustworthy first: VAT number, tax
 * code, web domain, the same normalized name, a similar name, with address
 * and phone as supporting evidence. Only a strong identifier makes two
 * records the same without asking; a name alone never does — two companies
 * can share a name. Two different VAT numbers are two legal entities,
 * whatever their names say.
 *
 * Pure, and rule-based: no language model decides anything here. Nothing is
 * merged in this module — it says what matches, how surely and why.
 */
import { countryKey } from "../countries";
import { en, list, lowerFirst, type Msg, type T } from "../i18n";
import { ratio } from "../import/match/similarity";
import { codeKey, companyKey, normalizeKey, vatKey } from "../import/normalize/text";

export interface SupplierRecord {
  id: string;
  name: string;
  vatNumber: string | null;
  taxCode: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  /** Other names it is known by: confirmed aliases, names written on documents. */
  aliases: string[];
  /** Purchases and quotes that hang on the record: the fuller one stays. */
  records: number;
  createdAt: string;
}

export type MatchBasis = "vat" | "tax_code" | "domain" | "name" | "alias" | "similar_name" | "phone" | "city";
/** The hierarchy: what is looked at first. */
export const MATCH_BASES: MatchBasis[] = ["vat", "tax_code", "domain", "name", "alias", "similar_name", "phone", "city"];
export const BASIS_LABEL: Record<MatchBasis, Msg> = {
  vat: "Same VAT number",
  tax_code: "Same tax code",
  domain: "Same web domain",
  name: "Same name, different spelling or legal form",
  alias: "A name already recognised as the other's",
  similar_name: "Similar name",
  phone: "Same phone number",
  city: "Same city",
};

export type MatchConfidence = "high" | "medium" | "low";
export const MATCH_CONFIDENCE_LABEL: Record<MatchConfidence, Msg> = { high: "High|confidence", medium: "Medium|confidence", low: "Low|confidence" };

export interface SupplierMatch {
  /** The record that would stay, and the one that would be read as it. */
  keep: string;
  merge: string;
  basis: MatchBasis[];
  confidence: MatchConfidence;
  /** High on a strong identifier: the only matches made without asking. */
  automatic: boolean;
  /** What speaks against it. */
  conflicts: string[];
  why: string;
}

/** Mailboxes anyone can have: sharing one says nothing about being the same company. */
const SHARED_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "outlook.it", "hotmail.com", "hotmail.it", "live.com", "live.it", "yahoo.com", "yahoo.it", "icloud.com", "libero.it", "virgilio.it", "alice.it", "tiscali.it", "tin.it", "fastwebnet.it", "aruba.it", "pec.it", "legalmail.it", "arubapec.it", "postecert.it", "pec.aruba.it", "gmx.de", "gmx.com", "web.de", "t-online.de", "orange.fr", "wanadoo.fr", "free.fr", "qq.com", "163.com", "126.com"]);

/** The web domain a record declares: its site's, else its mailbox's when that is the company's own. */
export function domainOf(s: Pick<SupplierRecord, "website" | "email">): string | null {
  const host = (raw: string | null | undefined) => {
    const v = (raw ?? "").trim().toLowerCase();
    if (!v) return null;
    const h = v.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
  };
  const site = host(s.website);
  if (site) return site;
  const mail = host(s.email?.split("@")[1]);
  return mail && !SHARED_DOMAINS.has(mail) ? mail : null;
}

const phoneKey = (p: string | null) => {
  const digits = (p ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : "";
};
/** VAT numbers shorter than this are not VAT numbers: a typo, a placeholder. */
const MIN_VAT = 8;
const vatOf = (s: SupplierRecord) => {
  const v = vatKey(s.vatNumber);
  return v.length >= MIN_VAT ? v : "";
};
const containment = (a: string, b: string) => {
  const A = new Set(a.split(" "));
  const B = b.split(" ");
  return B.filter((t) => A.has(t)).length / B.length;
};
/** From this similarity up two names are worth a look; below, they are just two names. */
const SIMILAR = 0.85;

/** Which of two records stays: the one a tax office would recognise, then the one more hangs on, then the older. */
function order(a: SupplierRecord, b: SupplierRecord): [SupplierRecord, SupplierRecord] {
  const filled = (s: SupplierRecord) => [s.website, s.email, s.phone, s.city, s.country].filter(Boolean).length;
  const rank = (s: SupplierRecord) => [vatOf(s) ? 1 : 0, s.taxCode ? 1 : 0, s.records, filled(s)];
  const [ra, rb] = [rank(a), rank(b)];
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i] ? [a, b] : [b, a];
  return a.createdAt <= b.createdAt ? [a, b] : [b, a];
}

/** Whether two records look like one company, how surely, and on what. Null: nothing says so. */
export function compareSuppliers(a: SupplierRecord, b: SupplierRecord, t: T = en): SupplierMatch | null {
  if (a.id === b.id) return null;
  const [vatA, vatB] = [vatOf(a), vatOf(b)];
  const [taxA, taxB] = [codeKey(a.taxCode), codeKey(b.taxCode)];
  const sameVat = !!vatA && vatA === vatB;
  const vatConflict = !!vatA && !!vatB && vatA !== vatB;
  // A company's tax code is often its VAT number: either may be written in either field.
  const sameTax = (!!taxA && (taxA === taxB || vatKey(taxA) === vatB)) || (!!taxB && vatKey(taxB) === vatA);
  const [domA, domB] = [domainOf(a), domainOf(b)];
  const sameDomain = !!domA && domA === domB;
  const [keyA, keyB] = [companyKey(a.name), companyKey(b.name)];
  const sameName = !!keyA && keyA === keyB;
  const known = (x: SupplierRecord, key: string) => !!key && x.aliases.some((alias) => companyKey(alias) === key);
  const alias = !sameName && (known(a, keyB) || known(b, keyA));
  // Similar: nearly the same letters, or one name wholly inside the other ("SER" and "SER Industries").
  const within = Math.max(containment(keyA, keyB), containment(keyB, keyA)) === 1 && Math.min(keyA.length, keyB.length) >= 3;
  const similar = !sameName && !alias && !!keyA && !!keyB && (ratio(keyA, keyB) >= SIMILAR || within);
  const samePhone = !!phoneKey(a.phone) && phoneKey(a.phone) === phoneKey(b.phone);
  const sameCity = !!normalizeKey(a.city) && normalizeKey(a.city) === normalizeKey(b.city) && (!a.country || !b.country || countryKey(a.country) === countryKey(b.country));
  const countryConflict = !!a.country && !!b.country && countryKey(a.country) !== countryKey(b.country);
  const named = sameName || alias || similar;

  const basis = MATCH_BASES.filter((k) => ({ vat: sameVat, tax_code: sameTax && !sameVat, domain: sameDomain, name: sameName, alias, similar_name: similar, phone: samePhone, city: sameCity && named })[k]);
  if (!basis.length) return null;
  const conflicts = [...(vatConflict ? [t("Different VAT numbers: two legal entities.")] : []), ...(countryConflict && !sameVat ? [t("Different countries.")] : [])];

  let confidence: MatchConfidence;
  let automatic = false;
  if (sameVat || (sameTax && !vatConflict)) {
    confidence = "high";
    automatic = true;
  } else if (vatConflict) {
    // Two VAT numbers are two companies. Only the very same name is still worth showing, as a warning.
    if (!sameName && !alias) return null;
    confidence = "low";
  } else if (sameDomain) {
    // A domain is the company's own, but a group can share one: it decides alone only when the names agree too.
    confidence = named ? "high" : "medium";
    automatic = named && !countryConflict;
  } else if (sameName || alias) confidence = countryConflict ? "low" : "medium";
  else if (similar) confidence = samePhone ? "medium" : "low";
  else return null;

  const [keep, merge] = order(a, b);
  return { keep: keep.id, merge: merge.id, basis, confidence, automatic, conflicts, why: list(t, basis.map((k) => lowerFirst(t(BASIS_LABEL[k])))) };
}

export type Decision = { a: string; b: string; decision: "separate" | "undone" };
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface Resolution {
  /** Strong identifier, nothing against, never decided otherwise: read as one company without asking. */
  automatic: SupplierMatch[];
  /** "These suppliers may be the same company": for the user to merge or keep apart. */
  suggestions: SupplierMatch[];
  /** Too little to suggest it; listed so a person who knows can still decide. */
  weak: SupplierMatch[];
}

/**
 * Every pair of records worth a decision. A pair the user kept apart is not
 * proposed again; a merge the user took back is never redone by itself — it
 * comes back as a suggestion.
 */
export function resolveSuppliers(records: SupplierRecord[], decisions: Decision[] = [], t: T = en): Resolution {
  const decided = new Map(decisions.map((d) => [pairKey(d.a, d.b), d.decision]));
  const out: Resolution = { automatic: [], suggestions: [], weak: [] };
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const match = compareSuppliers(records[i], records[j], t);
      if (!match) continue;
      const was = decided.get(pairKey(match.keep, match.merge));
      if (was === "separate") continue;
      if (match.automatic && !was) out.automatic.push(match);
      else if (match.confidence === "low") out.weak.push(match);
      else out.suggestions.push({ ...match, automatic: false });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const byStrength = (x: SupplierMatch, y: SupplierMatch) => rank[x.confidence] - rank[y.confidence] || MATCH_BASES.indexOf(x.basis[0]) - MATCH_BASES.indexOf(y.basis[0]);
  out.suggestions.sort(byStrength);
  out.weak.sort(byStrength);
  return out;
}

/**
 * Who each record is read as: itself, or the record it was merged into.
 * Chains are followed (A into B, B into C) and a loop — which should not
 * exist — is cut rather than followed forever.
 */
export function canonicalIds(rows: { id: string; mergedIntoId: string | null }[]): Map<string, string> {
  const into = new Map(rows.map((r) => [r.id, r.mergedIntoId]));
  const out = new Map<string, string>();
  for (const r of rows) {
    let id = r.id;
    const seen = new Set([id]);
    for (let next = into.get(id); next && into.has(next) && !seen.has(next); next = into.get(id)) {
      id = next;
      seen.add(id);
    }
    out.set(r.id, id);
  }
  return out;
}

/**
 * Automatic matches as groups: A = B and B = C is one company of three
 * records. Each group names the record that stays.
 */
export function automaticGroups(records: SupplierRecord[], matches: SupplierMatch[]): { keep: string; merge: { id: string; match: SupplierMatch }[] }[] {
  const parent = new Map(records.map((r) => [r.id, r.id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  for (const m of matches) parent.set(find(m.merge), find(m.keep));
  const groups = new Map<string, string[]>();
  for (const r of records) groups.set(find(r.id), [...(groups.get(find(r.id)) ?? []), r.id]);
  const byId = new Map(records.map((r) => [r.id, r]));
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => {
      const keep = ids.map((id) => byId.get(id)!).reduce((best, r) => order(best, r)[0]);
      return { keep: keep.id, merge: ids.filter((id) => id !== keep.id).map((id) => ({ id, match: matches.find((m) => (m.merge === id || m.keep === id) && ids.includes(m.keep) && ids.includes(m.merge))! })) };
    });
}
