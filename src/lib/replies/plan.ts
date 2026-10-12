/**
 * What loading a file of replies would do, worked out before anything is
 * written: the companies that are new, the ones already on file and what would
 * change in them, the offers to add, and everything that does not fit.
 *
 * The same function runs for the check and for the load, so the load does
 * what the check showed. Rules that must hold:
 *  - a company already on file is never written twice: the same request
 *    reference, a VAT number, a tax code, its own web domain with a name that
 *    agrees, or the very same name make it the same company. A name that only
 *    resembles another is said, and decides nothing;
 *  - a value on file is never emptied by a file that leaves it out, never
 *    replaced by an older file, and never replaced at all when a person wrote
 *    it: the difference is listed instead;
 *  - an offer or a message read before is not added again — loading the same
 *    file twice changes nothing;
 *  - what the buyer's other records say of the company (a supplier, a
 *    candidate, a company of a market directory) is pointed out, and none of
 *    those records is touched.
 */
import { countryKey } from "../countries";
import { en, type T } from "../i18n";
import { companyKey } from "../import/normalize/text";
import { compareSuppliers, type SupplierRecord } from "../suppliers/resolve";
import type { FileCompany, FileOffer, Rejected, ReplyFile } from "./read";
import { COMPANY_FIELDS, THREAD_FIELDS, type CompanyField, type ReplyStatus, type ThreadField } from "./types";

/** What identifies a company, wherever it is on file. */
export interface Known {
  id: string;
  name: string;
  country: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  aliases?: string[];
}

export interface StoredThread {
  id: string;
  reference: string | null;
  categories: string[];
  confirmed: string[];
  checkedAt: string | null;
  fields: Record<ThreadField, string | null>;
  offerKeys: string[];
  messageKeys: string[];
}

export interface StoredCompany extends Known {
  fields: Record<CompanyField, string | null>;
  confirmed: string[];
  checkedAt: string | null;
  threads: StoredThread[];
}

export interface Records {
  replies: StoredCompany[];
  suppliers: Known[];
  candidates: (Known & { products: { id: string; name: string }[] })[];
  directory: (Known & { market: string })[];
}

/** The same company, found in another part of the buyer's records. */
export interface Elsewhere {
  where: "supplier" | "candidate" | "directory";
  id: string;
  name: string;
  /** False: it only looks like it, and a person has to say. */
  certain: boolean;
  why: string;
  products: { id: string; name: string }[];
  market: string | null;
  /** What a person decided about the two: one company, two companies of one group, or two companies. Null: nobody said. */
  decided: "same" | "group" | "different" | null;
}

/** A person's decision about a record of another part of the app and this company. */
export interface CompanyDecision {
  where: Elsewhere["where"];
  id: string;
  relation: "same" | "group" | "different";
}

export interface FieldChange {
  field: CompanyField | ThreadField | "categories";
  from: string | null;
  to: string | null;
}

export interface FieldKept {
  field: CompanyField | ThreadField | "categories";
  stored: string;
  incoming: string;
  /** confirmed: a person wrote the value on file · older: the file is older than what is on file. */
  reason: "confirmed" | "older";
}

export interface PlanMessage {
  key: string;
  date: string;
  status: ReplyStatus;
  summary: string | null;
  reference: string | null;
  attachments: string | null;
}

export interface PlanCompany {
  reference: string;
  name: string;
  action: "create" | "update" | "unchanged";
  /** The company on file it is read as. Null: a new one — or, with `sameAs`, the one another record of this file creates. */
  supplierId: string | null;
  sameAs: string | null;
  threadId: string | null;
  matchedBy: string | null;
  /** What to write: every value for a new record, only the changed ones for one on file. */
  company: Partial<Record<CompanyField, string | null>>;
  thread: Partial<Record<ThreadField, string | null>>;
  categories: string[] | null;
  changes: FieldChange[];
  kept: FieldKept[];
  elsewhere: Elsewhere[];
  offers: FileOffer[];
  offersKnown: number;
  message: PlanMessage | null;
  warnings: string[];
  read: FileCompany;
}

export interface ReplyPlan {
  companies: PlanCompany[];
  rejected: Rejected[];
  repeated: string[];
  counts: {
    create: number;
    update: number;
    unchanged: number;
    offersNew: number;
    offersKnown: number;
    messagesNew: number;
    /** Values on file that the file would have changed and did not. */
    kept: number;
    warnings: number;
    byStatus: Partial<Record<ReplyStatus, number>>;
    /** Companies the buyer's other records already know, surely or possibly. */
    elsewhere: number;
  };
}

const asRecord = (k: Known): SupplierRecord => ({ id: k.id, name: k.name, vatNumber: k.vatNumber, taxCode: k.taxCode, website: k.website, email: k.email, phone: k.phone, city: null, country: k.country, aliases: k.aliases ?? [], records: 0, createdAt: "" });

/** Words many company names share: having one in common says nothing. */
const TRADE_WORDS = new Set(["plastic", "plastics", "plastik", "plastika", "plastica", "candle", "candles", "kerzen", "chemical", "chemicals", "chemie", "industry", "industries", "industrial", "international", "corporation", "company", "trading", "export", "import", "products", "packaging", "supply", "supplies", "project", "service", "services", "solutions", "europe", "italia", "polska", "global", "bottega", "cereria", "candele", "creazioni", "produkcja", "wyrob", "artykulow", "tworzyw", "sztucznych", "handel", "group", "holding"]);

/** A distinctive word both names carry — a family name, a brand — when nothing stronger ties them. */
function sharedWord(a: string, b: string): string | null {
  const words = (name: string) => companyKey(name).split(" ").filter((w) => w.length >= 6 && /^[a-z]+$/.test(w) && !TRADE_WORDS.has(w));
  const other = new Set(words(b));
  return words(a).find((w) => other.has(w)) ?? null;
}

/** Whether two records are one company: surely (an identifier, or the same name), possibly (a resemblance), or not at all. */
export function sameCompanyAs(a: Known, b: Known, t: T = en): { certain: boolean; why: string } | null {
  const match = compareSuppliers(asRecord({ ...a, id: "a" }), asRecord({ ...b, id: "b" }), t);
  if (match) {
    const named = match.basis.includes("name") || match.basis.includes("alias");
    // Its own web domain with its own phone number is the company; a domain alone could be a group's.
    const reached = match.basis.includes("domain") && match.basis.includes("phone");
    return { certain: match.conflicts.length === 0 && (match.automatic || named || reached), why: [match.why, ...match.conflicts].join(". ") };
  }
  const apart = !!a.country && !!b.country && countryKey(a.country) !== countryKey(b.country);
  const word = apart ? null : sharedWord(a.name, b.name);
  return word ? { certain: false, why: t("the word «{word}» is in both names", { word }) } : null;
}

/** Where else the buyer's records know this company. Nothing there is changed: it is pointed out. */
export function elsewhereOf(company: Known, records: Pick<Records, "suppliers" | "candidates" | "directory">, t: T = en, decisions: CompanyDecision[] = []): Elsewhere[] {
  const out: Elsewhere[] = [];
  const look = <R extends Known>(where: Elsewhere["where"], list: R[], more: (r: R) => Pick<Elsewhere, "products" | "market">) => {
    for (const r of list) {
      // What a person said about the two comes first: it makes a resemblance sure, or sets it aside for good.
      const decided = decisions.find((d) => d.where === where && d.id === r.id)?.relation ?? null;
      const same = sameCompanyAs(company, r, t);
      if (decided) out.push({ where, id: r.id, name: r.name, certain: decided === "same", why: same?.why ?? "", decided, ...more(r) });
      else if (same) out.push({ where, id: r.id, name: r.name, ...same, decided: null, ...more(r) });
    }
  };
  look("supplier", records.suppliers, () => ({ products: [], market: null }));
  look("candidate", records.candidates, (r) => ({ products: r.products, market: null }));
  look("directory", records.directory, (r) => ({ products: [], market: r.market }));
  return out.sort((a, b) => Number(b.certain) - Number(a.certain));
}

const same = (a: string | null, b: string | null) => (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim();

/** A value on file meets the one a file brings: what is written, what changes, and what stays although the file says otherwise. */
function merge<K extends CompanyField | ThreadField>(fields: readonly K[], stored: Record<K, string | null>, incoming: Record<K, string | null>, confirmed: string[], older: boolean) {
  const set: Partial<Record<K, string | null>> = {};
  const changes: FieldChange[] = [];
  const kept: FieldKept[] = [];
  for (const field of fields) {
    const [a, b] = [stored[field], incoming[field]];
    // A file that leaves a value out says nothing about it: what is on file stays.
    if (b == null || same(a, b)) continue;
    // The words a source used for a status go with that status: once a person set another, they are not brought back.
    if (field === "statusText" && confirmed.includes("status")) continue;
    // What a person wrote is theirs, also when they left it empty.
    if (confirmed.includes(field)) kept.push({ field, stored: a ?? "—", incoming: b, reason: "confirmed" });
    else if (a == null) {
      set[field] = b;
      changes.push({ field, from: null, to: b });
    } else if (older) kept.push({ field, stored: a, incoming: b, reason: "older" });
    else {
      set[field] = b;
      changes.push({ field, from: a, to: b });
    }
  }
  return { set, changes, kept };
}

const pick = <K extends string>(fields: readonly K[], from: Record<string, unknown>) => Object.fromEntries(fields.map((f) => [f, (from[f] as string | null | undefined) ?? null])) as Record<K, string | null>;

/** The message a record stands for: the answer it was read from. The same answer read again is the same message. */
export const messageOf = (c: FileCompany, today: string): PlanMessage => {
  const date = c.checkedAt ?? today;
  return { key: ["reply", date, c.sourceUrl ?? ""].join("|"), date, status: c.status, summary: c.offerSummary, reference: c.sourceUrl, attachments: c.attachments };
};

export function planReplies(file: ReplyFile, records: Records, today: string, t: T = en): ReplyPlan {
  const companies: PlanCompany[] = [];
  const offersOf = (reference: string) => file.offers.filter((o) => o.reference === reference);
  // The new companies of this file, as they come: a later record of the same company joins the first.
  const fresh: { reference: string; known: Known }[] = [];

  for (const read of file.companies) {
    const identity: Known = { id: `file:${read.reference}`, name: read.name, country: read.country, website: read.website, email: read.email, phone: read.phone, vatNumber: read.vatNumber, taxCode: read.taxCode };
    const warnings = [...read.warnings];

    // The same request read again is the same conversation, whatever the file now calls the company.
    let stored = records.replies.find((r) => r.threads.some((th) => th.reference === read.reference)) ?? null;
    let matchedBy = stored ? t("the same request, read before ({reference})", { reference: read.reference }) : null;
    if (!stored) {
      for (const r of records.replies) {
        const hit = sameCompanyAs(identity, r, t);
        if (hit?.certain) {
          stored = r;
          matchedBy = hit.why;
          break;
        }
        if (hit) warnings.push(t("It looks like {name}, already on file ({why}): it is loaded as another company. Check whether they are one.", { name: r.name, why: hit.why }));
      }
    }
    const twin = stored ? null : (fresh.find((f) => sameCompanyAs(identity, f.known, t)?.certain) ?? null);
    if (!stored && !twin) fresh.push({ reference: read.reference, known: identity });

    const thread = stored?.threads.find((th) => th.reference === read.reference) ?? null;
    const message = messageOf(read, today);
    const lines = offersOf(read.reference);
    const newLines = thread ? lines.filter((o) => !thread.offerKeys.includes(o.key)) : lines;
    const newMessage = thread?.messageKeys.includes(message.key) ? null : message;
    const incomingCompany = pick(COMPANY_FIELDS, read as unknown as Record<string, unknown>);
    const incomingThread = pick(THREAD_FIELDS, read as unknown as Record<string, unknown>);
    const older = (onFile: string | null) => !!onFile && !!read.checkedAt && read.checkedAt < onFile;

    const a = stored ? merge(COMPANY_FIELDS, stored.fields, incomingCompany, stored.confirmed, older(stored.checkedAt)) : { set: incomingCompany, changes: [], kept: [] };
    const b = thread ? merge(THREAD_FIELDS, thread.fields, incomingThread, thread.confirmed, older(thread.checkedAt)) : { set: incomingThread, changes: [], kept: [] };
    let categories: string[] | null = thread ? null : read.categories;
    const kept = [...a.kept, ...b.kept];
    const changes = [...a.changes, ...b.changes];
    if (thread && read.categories.length && [...read.categories].sort().join("|") !== [...thread.categories].sort().join("|")) {
      const [from, to] = [thread.categories.join(", "), read.categories.join(", ")];
      if (!thread.categories.length) categories = read.categories;
      else if (thread.confirmed.includes("categories")) kept.push({ field: "categories", stored: from, incoming: to, reason: "confirmed" });
      else if (older(thread.checkedAt)) kept.push({ field: "categories", stored: from, incoming: to, reason: "older" });
      else categories = read.categories;
      if (categories) changes.push({ field: "categories", from: from || null, to });
    }

    const changed = changes.length > 0 || newLines.length > 0 || !!newMessage || (!!stored && !thread);
    companies.push({
      reference: read.reference,
      name: stored?.name ?? read.name,
      action: !stored && !twin ? "create" : changed ? "update" : "unchanged",
      supplierId: stored?.id ?? null,
      sameAs: twin?.reference ?? null,
      threadId: thread?.id ?? null,
      matchedBy: twin ? t("the same company as another record of this file") : matchedBy,
      company: twin ? {} : a.set,
      thread: b.set,
      categories,
      changes,
      kept,
      elsewhere: elsewhereOf(identity, records, t),
      offers: newLines,
      offersKnown: lines.length - newLines.length,
      message: newMessage,
      warnings,
      read,
    });
  }

  const byStatus: ReplyPlan["counts"]["byStatus"] = {};
  for (const c of companies) byStatus[c.read.status] = (byStatus[c.read.status] ?? 0) + 1;
  const count = (action: PlanCompany["action"]) => companies.filter((c) => c.action === action).length;
  const sum = (of: (c: PlanCompany) => number) => companies.reduce((n, c) => n + of(c), 0);
  return {
    companies,
    rejected: file.rejected,
    repeated: file.repeated,
    counts: {
      create: count("create"),
      update: count("update"),
      unchanged: count("unchanged"),
      offersNew: sum((c) => c.offers.length),
      offersKnown: sum((c) => c.offersKnown),
      messagesNew: sum((c) => (c.message ? 1 : 0)),
      kept: sum((c) => c.kept.length),
      warnings: sum((c) => c.warnings.length),
      byStatus,
      elsewhere: companies.filter((c) => c.elsewhere.length > 0).length,
    },
  };
}

/** One company of a plan, as the person who checks the file reads it: no raw record, only what would happen. */
export interface PlanRow {
  reference: string;
  name: string;
  country: string | null;
  action: PlanCompany["action"];
  status: ReplyStatus;
  statusText: string | null;
  categories: string[];
  matchedBy: string | null;
  changes: FieldChange[];
  kept: FieldKept[];
  elsewhere: Elsewhere[];
  offersNew: number;
  offersKnown: number;
  warnings: string[];
}

export interface PlanSummary {
  rows: PlanRow[];
  rejected: Rejected[];
  repeated: string[];
  counts: ReplyPlan["counts"];
}

export const summarise = (plan: ReplyPlan): PlanSummary => ({
  rows: plan.companies.map((c) => ({
    reference: c.reference,
    name: c.name,
    country: c.read.country,
    action: c.action,
    status: c.read.status,
    statusText: c.read.statusText,
    categories: c.read.categories,
    matchedBy: c.matchedBy,
    changes: c.changes,
    kept: c.kept,
    elsewhere: c.elsewhere,
    offersNew: c.offers.length,
    offersKnown: c.offersKnown,
    warnings: c.warnings,
  })),
  rejected: plan.rejected,
  repeated: plan.repeated,
  counts: plan.counts,
});
