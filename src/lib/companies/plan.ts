/**
 * One company, whatever part of the app names it. A supplier on the invoices, a
 * candidate for a product, a company of a market directory, a company that
 * answered a request and a company registered on the portal are roles: each
 * stays in its own table with its own data and points to its company.
 *
 * Rules that hold here (pure, tested):
 *  - records are tied to one company by themselves only on the same VAT number
 *    or tax code (either may be written in either field), or because the app
 *    already holds them as one: a supplier record merged into another, a
 *    candidate converted into a supplier, a registered company invited as one
 *    of the buyer's records, a person's "the same company";
 *  - the candidates of one company for several products are one company, as the
 *    app always read them: the same site, else the same name;
 *  - anything else — a shared site, the same name across two archives — is a
 *    proposal a person settles (`companyProposals`), never a merge;
 *  - two different VAT numbers are two companies, always.
 */
import { companyKey, vatKey } from "../import/normalize/text";
import { en, type T } from "../i18n";
import { compareSuppliers, domainOf, type SupplierMatch } from "../suppliers/resolve";

export const ROLE_KINDS = ["supplier", "registered", "reply", "directory", "candidate"] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

export interface RoleRecord {
  kind: RoleKind;
  id: string;
  name: string;
  vatNumber: string | null;
  taxCode: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  /** Another record the app already holds as the same company: the record it was merged into, converted into, invited as, said to be. */
  sameAs: { kind: RoleKind; id: string }[];
}

export interface CompanyFacts {
  id: string;
  name: string;
  otherNames: string[];
  vatNumber: string | null;
  taxCode: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  domain: string | null;
  mergedIntoId: string | null;
}

/** The identifiers a record carries, as compared: a tax code is often the VAT number, so both count in either field. */
export function idKeys(r: { vatNumber: string | null; taxCode: string | null }): string[] {
  return [...new Set([vatKey(r.vatNumber), vatKey(r.taxCode)].filter((k) => k.length >= 8))];
}

/** The key the candidates of one company share across products: its site, else its name. */
export const candidateGroup = (r: Pick<RoleRecord, "name" | "website" | "email">) => domainOf({ website: r.website, email: r.email }) ?? companyKey(r.name);

export interface CompanyPlan {
  /** New companies, each with the records it is born from. */
  create: { ref: string; facts: Omit<CompanyFacts, "id" | "mergedIntoId">; records: { kind: RoleKind; id: string }[] }[];
  /** Records tied to a company on file. */
  link: { kind: RoleKind; id: string; companyId: string }[];
}

const recKey = (r: { kind: RoleKind; id: string }) => `${r.kind}:${r.id}`;

/**
 * What `syncCompanies` writes: every record without a company gets one — the company an identifier, a merge or a
 * person's word ties it to, else a new one made from the record itself. Records already tied are left as they are.
 */
export function planCompanies(records: RoleRecord[], companies: CompanyFacts[]): CompanyPlan {
  const canonical = (id: string) => {
    const seen = new Set<string>();
    let c = companies.find((x) => x.id === id);
    while (c?.mergedIntoId && !seen.has(c.id)) {
      seen.add(c.id);
      c = companies.find((x) => x.id === c!.mergedIntoId) ?? c;
    }
    return c?.id ?? id;
  };
  // Where each identifier and each candidate group already belongs: the companies on file, then the ones planned.
  const byId = new Map<string, string>();
  const byGroup = new Map<string, string>();
  const ofRecord = new Map<string, string>();
  for (const c of companies) if (!c.mergedIntoId) for (const k of idKeys(c)) byId.set(k, c.id);
  for (const r of records) {
    if (!r.companyId) continue;
    const id = canonical(r.companyId);
    ofRecord.set(recKey(r), id);
    for (const k of idKeys(r)) if (!byId.has(k)) byId.set(k, id);
    if (r.kind === "candidate") byGroup.set(candidateGroup(r), id);
  }

  const plan: CompanyPlan = { create: [], link: [] };
  const planned = new Map<string, CompanyPlan["create"][number]>();
  const attach = (r: RoleRecord, target: string) => {
    ofRecord.set(recKey(r), target);
    for (const k of idKeys(r)) if (!byId.has(k)) byId.set(k, target);
    if (r.kind === "candidate") byGroup.set(candidateGroup(r), target);
    const made = planned.get(target);
    if (made) {
      made.records.push({ kind: r.kind, id: r.id });
      fill(made.facts, r);
    } else plan.link.push({ kind: r.kind, id: r.id, companyId: target });
  };

  // The order says whose name a new company takes: the supplier on the invoices first, a candidate last.
  const order = [...records].sort((a, b) => ROLE_KINDS.indexOf(a.kind) - ROLE_KINDS.indexOf(b.kind));
  // Records tied by the app's own word may come in any order: go round until nothing more can be tied.
  let pending = order.filter((r) => !r.companyId);
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    const next: RoleRecord[] = [];
    for (const r of pending) {
      const same = r.sameAs.map((x) => ofRecord.get(recKey(x))).find(Boolean);
      const byKey = idKeys(r).map((k) => byId.get(k)).find(Boolean);
      const group = r.kind === "candidate" ? byGroup.get(candidateGroup(r)) : undefined;
      // A record whose "same as" is still waiting is tied on a later round, not given a company of its own now.
      const waiting = !same && r.sameAs.some((x) => pending.some((p) => recKey(p) === recKey(x)) && !ofRecord.has(recKey(x)));
      const target = same ?? byKey ?? group;
      if (target) attach(r, target);
      else if (waiting && pass < 3) next.push(r);
      else {
        const ref = `new:${plan.create.length}`;
        const made = { ref, facts: { name: r.name.trim(), otherNames: [], vatNumber: null, taxCode: null, country: null, city: null, website: null, domain: null }, records: [] as { kind: RoleKind; id: string }[] };
        plan.create.push(made);
        planned.set(ref, made);
        attach(r, ref);
      }
    }
    pending = next;
  }
  return plan;
}

/** What a record adds to its company's facts: a name not known yet, and the identifiers and places still missing. Nothing is overwritten. */
export function fill(facts: Omit<CompanyFacts, "id" | "mergedIntoId">, r: Pick<RoleRecord, "name" | "vatNumber" | "taxCode" | "country" | "city" | "website" | "email">): boolean {
  let changed = false;
  const known = new Set([facts.name, ...facts.otherNames].map((n) => companyKey(n)));
  if (r.name.trim() && !known.has(companyKey(r.name))) {
    facts.otherNames = [...facts.otherNames, r.name.trim()];
    changed = true;
  }
  const set = <K extends "vatNumber" | "taxCode" | "country" | "city" | "website">(k: K, v: string | null) => {
    if (!facts[k] && v?.trim()) {
      facts[k] = v.trim();
      changed = true;
    }
  };
  set("vatNumber", r.vatNumber);
  set("taxCode", r.taxCode);
  set("country", r.country);
  set("city", r.city);
  set("website", r.website);
  const domain = domainOf({ website: r.website, email: r.email });
  if (!facts.domain && domain) {
    facts.domain = domain;
    changed = true;
  }
  return changed;
}

export interface CompanyProposal extends SupplierMatch {
  a: string;
  b: string;
}

/**
 * Companies that may be one: a shared site, the same name, a similar name with something more. Proposed with the
 * reason, never merged; what a person decided (the same, two companies, of one group) is not proposed again.
 */
export function companyProposals(list: (CompanyFacts & { roles: number })[], decided: Set<string>, t: T = en): CompanyProposal[] {
  const live = list.filter((c) => !c.mergedIntoId);
  const record = (c: CompanyFacts & { roles: number }) => ({ id: c.id, name: c.name, vatNumber: c.vatNumber, taxCode: c.taxCode, website: c.website ?? (c.domain ? `https://${c.domain}` : null), email: null, phone: null, city: c.city, country: c.country, aliases: c.otherNames, records: c.roles, createdAt: "" });
  // Compared only within a block that could match at all: the same domain, or a name word in common.
  const blocks = new Map<string, number[]>();
  live.forEach((c, i) => {
    const words = new Set([c.name, ...c.otherNames].flatMap((n) => companyKey(n).split(" ")).filter((w) => w.length >= 3));
    for (const k of [...(c.domain ? [`d:${c.domain}`] : []), ...[...words].map((w) => `w:${w}`)]) blocks.set(k, [...(blocks.get(k) ?? []), i]);
  });
  const seen = new Set<string>();
  const out: CompanyProposal[] = [];
  for (const members of blocks.values()) {
    if (members.length > 60) continue;
    for (let x = 0; x < members.length; x++)
      for (let y = x + 1; y < members.length; y++) {
        const [a, b] = [live[members[x]], live[members[y]]];
        const pair = pairKey(a.id, b.id);
        if (seen.has(pair) || decided.has(pair)) continue;
        seen.add(pair);
        const m = compareSuppliers(record(a), record(b), t);
        if (!m || m.confidence === "low" || m.conflicts.length) continue;
        out.push({ ...m, a: a.id, b: b.id });
      }
  }
  return out.sort((p, q) => (p.confidence === q.confidence ? 0 : p.confidence === "high" ? -1 : 1));
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const RELATIONS = ["same_company", "same_group", "subsidiary_of", "distributor_of", "different"] as const;
export type CompanyRelation = (typeof RELATIONS)[number];
export const isRelation = (v: unknown): v is CompanyRelation => typeof v === "string" && (RELATIONS as readonly string[]).includes(v);
