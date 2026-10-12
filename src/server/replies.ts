/**
 * Replies to requests for quotation, on the database.
 *
 * A file of replies is checked first (`checkReplies`: what it would add,
 * change and leave alone — nothing is written) and loaded only on the user's
 * confirmation (`importReplies`), in one transaction. The load does what the
 * check showed: both run the same plan (lib/replies/plan.ts).
 *
 * Nothing here writes to `suppliers`, `supplier_candidates`, `quotes` or a
 * market directory. A company that answered is not a supplier, a price it
 * stated is not a quote on one of the buyer's products, and neither becomes
 * one by itself. Nothing is sent, and nothing leaves the account.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { marketSuppliers, products, rfqMessages, rfqOffers, rfqSuppliers, rfqThreads, supplierCandidates, suppliers } from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { en, type T } from "@/lib/i18n";
import { companyKey } from "@/lib/import/normalize/text";
import { elsewhereOf, planReplies, type Elsewhere, type Records, type ReplyPlan, type StoredCompany } from "@/lib/replies/plan";
import { parseReplyFile } from "@/lib/replies/read";
import {
  COMPANY_FIELDS, THREAD_FIELDS, isMessageKind, isReplyStatus, isValidation,
  type CompanyField, type MessageKind, type ReplyCompany, type ReplyMessage, type ReplyOffer, type ReplyStatus, type ReplyThread, type ThreadField, type Validation,
} from "@/lib/replies/types";
import { domainOf } from "@/lib/suppliers/resolve";

export class ReplyError extends Error {}

// ---------------- Files kept on this computer ----------------

const dir = () => path.join(process.env.RESEARCH_DIR ?? path.join(process.cwd(), ".data", "research"), "replies");
const SAFE = /^[\w.-]+\.json$/;

export async function listReplyFiles(): Promise<{ name: string; modified: string }[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch {
    return [];
  }
  const files = await Promise.all(names.filter((n) => SAFE.test(n)).map(async (name) => ({ name, modified: (await stat(path.join(dir(), name))).mtime.toISOString() })));
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

/** A file chosen by hand is kept with the others once it is loaded, so that what was read stays on this computer. */
export async function keepReplyFile(name: string, raw: string): Promise<string | null> {
  const safe = name.replace(/[^\w.-]+/g, "_");
  if (!SAFE.test(safe)) return null;
  try {
    await mkdir(dir(), { recursive: true });
    await writeFile(path.join(dir(), safe), raw, { flag: "wx" });
  } catch {
    // Already there under that name, or the folder cannot be written: the load itself does not depend on it.
  }
  return safe;
}

export async function readReplyFile(name: string): Promise<string | null> {
  if (!SAFE.test(name)) return null;
  try {
    return await readFile(path.join(dir(), name), "utf8");
  } catch {
    return null;
  }
}

// ---------------- Reading ----------------

const num = (v: string | null) => (v == null ? null : Number(v));
const text = (n: number | null) => (n == null ? null : String(n));

const toCompany = (r: typeof rfqSuppliers.$inferSelect): ReplyCompany => ({
  id: r.id, name: r.name, country: r.country, address: r.address, website: r.website, email: r.email, phone: r.phone, contactName: r.contactName,
  vatNumber: r.vatNumber, taxCode: r.taxCode, companyType: r.companyType, confirmed: r.confirmed ?? [], checkedAt: r.checkedAt, sourceFile: r.sourceFile,
});

const toOffer = (r: typeof rfqOffers.$inferSelect): ReplyOffer => ({
  id: r.id, threadId: r.threadId, key: r.key, productName: r.productName, productCode: r.productCode, grade: r.grade, category: r.category,
  unitPrice: Number(r.unitPrice), currency: r.currency, unit: r.unit, quantity: num(r.quantity), moq: num(r.moq), incoterm: r.incoterm, destination: r.destination,
  paymentTerms: r.paymentTerms, offeredOn: r.offeredOn, validUntil: r.validUntil, validity: r.validity, specs: r.specs ?? {},
  validation: isValidation(r.validation) ? r.validation : "required", technicalStatus: r.technicalStatus, missing: r.missing, sourceUrl: r.sourceUrl, sourceDocument: r.sourceDocument,
});

const toMessage = (r: typeof rfqMessages.$inferSelect): ReplyMessage => ({
  id: r.id, threadId: r.threadId, key: r.key, date: r.date, kind: isMessageKind(r.kind) ? r.kind : "note", status: isReplyStatus(r.status) ? r.status : null,
  summary: r.summary, reference: r.reference, attachments: r.attachments, source: r.source === "manual" ? "manual" : "file",
});

async function readThreads(db: DB): Promise<ReplyThread[]> {
  const [threads, offers, messages] = await Promise.all([
    db.select().from(rfqThreads).orderBy(asc(rfqThreads.createdAt)),
    db.select().from(rfqOffers).orderBy(asc(rfqOffers.createdAt)),
    db.select().from(rfqMessages).orderBy(asc(rfqMessages.date), asc(rfqMessages.createdAt)),
  ]);
  return threads.map((r) => ({
    id: r.id, supplierId: r.supplierId, reference: r.reference, categories: r.categories ?? [], status: isReplyStatus(r.status) ? r.status : "needs_information", statusText: r.statusText,
    products: r.products, offerSummary: r.offerSummary, moq: r.moq, paymentTerms: r.paymentTerms, leadTime: r.leadTime, samples: r.samples, missing: r.missing, nextAction: r.nextAction,
    priority: r.priority, notes: r.notes, confirmed: r.confirmed ?? [], checkedAt: r.checkedAt, sourceFile: r.sourceFile,
    offers: offers.filter((o) => o.threadId === r.id).map(toOffer),
    messages: messages.filter((m) => m.threadId === r.id).map(toMessage),
  }));
}

/** The buyer's other records, as far as they identify a company: its suppliers, the companies among its candidates, the market directories. */
async function readOthers(db: DB): Promise<Pick<Records, "suppliers" | "candidates" | "directory">> {
  const [own, candidates, names, directory] = await Promise.all([
    db.select().from(suppliers).where(isNull(suppliers.mergedIntoId)),
    db.select().from(supplierCandidates),
    db.select({ id: products.id, name: products.name, mergedIntoId: products.mergedIntoId }).from(products),
    db.select().from(marketSuppliers),
  ]);
  const listed = new Map(names.filter((p) => !p.mergedIntoId).map((p) => [p.id, p.name]));
  // A candidate is a row per product: the company is the same wherever its site or its name is.
  const companies = new Map<string, Records["candidates"][number]>();
  for (const c of candidates) {
    const key = domainOf({ website: c.website, email: null }) ?? companyKey(c.name);
    const company = companies.get(key) ?? { id: key, name: c.name, country: c.country, website: c.website, email: c.specCheck?.email ?? null, phone: null, vatNumber: null, taxCode: null, products: [] };
    if (listed.has(c.productId) && !company.products.some((p) => p.id === c.productId)) company.products.push({ id: c.productId, name: listed.get(c.productId)! });
    companies.set(key, company);
  }
  return {
    suppliers: own.map((s) => ({ id: s.id, name: s.name, country: s.country, website: s.website, email: s.email, phone: s.phone, vatNumber: s.vatNumber, taxCode: s.taxCode })),
    candidates: [...companies.values()],
    directory: directory.map((m) => ({ id: m.id, name: m.name, country: m.country, website: m.website, email: m.email, phone: m.phone, vatNumber: null, taxCode: null, aliases: m.tradeName ? [m.tradeName] : [], market: m.market })),
  };
}

const pick = <K extends string>(fields: readonly K[], from: Record<string, unknown>) => Object.fromEntries(fields.map((f) => [f, (from[f] as string | null | undefined) ?? null])) as Record<K, string | null>;

async function readRecords(db: DB): Promise<Records> {
  const [companies, threads, others] = await Promise.all([db.select().from(rfqSuppliers), readThreads(db), readOthers(db)]);
  const replies: StoredCompany[] = companies.map((r) => ({
    id: r.id, name: r.name, country: r.country, website: r.website, email: r.email, phone: r.phone, vatNumber: r.vatNumber, taxCode: r.taxCode,
    fields: pick(COMPANY_FIELDS, r), confirmed: r.confirmed ?? [], checkedAt: r.checkedAt,
    threads: threads.filter((th) => th.supplierId === r.id).map((th) => ({
      id: th.id, reference: th.reference, categories: th.categories, confirmed: th.confirmed, checkedAt: th.checkedAt, fields: pick(THREAD_FIELDS, th as unknown as Record<string, unknown>),
      offerKeys: th.offers.map((o) => o.key), messageKeys: th.messages.map((m) => m.key),
    })),
  }));
  return { replies, ...others };
}

/** A company that answered, with its conversations and what the buyer's other records say of it. */
export interface ReplyDossier extends ReplyCompany {
  threads: ReplyThread[];
  elsewhere: Elsewhere[];
}

export async function readReplies(db: DB, t: T = en): Promise<ReplyDossier[]> {
  const [companies, threads, others] = await Promise.all([db.select().from(rfqSuppliers).orderBy(asc(rfqSuppliers.name)), readThreads(db), readOthers(db)]);
  return companies.map((r) => {
    const company = toCompany(r);
    return { ...company, threads: threads.filter((th) => th.supplierId === r.id), elsewhere: elsewhereOf(company, others, t) };
  });
}

// ---------------- Check, then load ----------------

export interface ReplyImport {
  plan: ReplyPlan;
  /** False: this was the check. Nothing was written. */
  loaded: boolean;
}

function planOf(raw: string, records: Records, t: T): ReplyPlan {
  const parsed = parseReplyFile(raw, t);
  if (!parsed.ok) throw new ReplyError(parsed.error);
  if (!parsed.file.companies.length && !parsed.file.rejected.length) throw new ReplyError(t("This file names no company."));
  return planReplies(parsed.file, records, todayISO(), t);
}

/** What loading the file would do. Writes nothing. */
export async function checkReplies(db: DB, raw: string, t: T = en): Promise<ReplyImport> {
  return { plan: planOf(raw, await readRecords(db), t), loaded: false };
}

/** A set of values for a row: the plan and the forms never put an empty name or status in it. */
type Patch<Table extends { $inferInsert: object }> = Partial<Table["$inferInsert"]>;
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
const filled = <V>(o: Record<string, V | null | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Record<string, V>;

/** Loads the file: all of it or nothing. The plan is worked out again on what is on file now, so it never acts on a stale check. */
export async function importReplies(db: DB, raw: string, opts: { file: string | null }, t: T = en): Promise<ReplyImport> {
  const records = await readRecords(db);
  const plan = planOf(raw, records, t);
  const file = opts.file;
  // Rows written in one transaction would share one timestamp: each gets its own, so that they stay in the order of the file.
  let tick = Date.now();
  const stamp = () => new Date(tick++);
  await db.transaction(async (tx) => {
    const created = new Map<string, string>();
    for (const c of plan.companies) {
      if (c.action === "unchanged") continue;
      const stored = c.supplierId ? records.replies.find((r) => r.id === c.supplierId) : undefined;
      let supplierId = c.supplierId ?? (c.sameAs ? (created.get(c.sameAs) ?? null) : null);
      if (!supplierId) {
        const [row] = await tx.insert(rfqSuppliers).values({ ...filled(c.company), name: c.read.name, checkedAt: c.read.checkedAt, sourceFile: file }).returning({ id: rfqSuppliers.id });
        supplierId = row.id;
        created.set(c.reference, supplierId);
      } else if (Object.keys(c.company).length) {
        await tx.update(rfqSuppliers).set({ ...(c.company as Patch<typeof rfqSuppliers>), checkedAt: later(stored?.checkedAt ?? null, c.read.checkedAt), updatedAt: new Date() }).where(eq(rfqSuppliers.id, supplierId));
      }

      let threadId = c.threadId;
      if (!threadId) {
        const [row] = await tx
          .insert(rfqThreads)
          .values({ ...filled(c.thread), supplierId, reference: c.reference, categories: c.categories ?? [], status: c.read.status, original: c.read.original, checkedAt: c.read.checkedAt, sourceFile: file , createdAt: stamp() })
          .returning({ id: rfqThreads.id });
        threadId = row.id;
      } else if (Object.keys(c.thread).length || c.categories) {
        const onFile = stored?.threads.find((th) => th.id === threadId);
        // The record is kept as the latest file gave it; the files themselves stay on this computer.
        await tx
          .update(rfqThreads)
          .set({ ...(c.thread as Patch<typeof rfqThreads>), ...(c.categories ? { categories: c.categories } : {}), original: c.read.original, checkedAt: later(onFile?.checkedAt ?? null, c.read.checkedAt), sourceFile: file, updatedAt: new Date() })
          .where(eq(rfqThreads.id, threadId));
      }

      for (const o of c.offers) {
        await tx.insert(rfqOffers).values({
          threadId, key: o.key, productName: o.productName, productCode: o.productCode, grade: o.grade, category: o.category, unitPrice: String(o.unitPrice), currency: o.currency, unit: o.unit,
          quantity: text(o.quantity), moq: text(o.moq), incoterm: o.incoterm, destination: o.destination, paymentTerms: o.paymentTerms, offeredOn: o.offeredOn, validUntil: o.validUntil, validity: o.validity,
          specs: o.specs, technicalStatus: o.technicalStatus, missing: o.missing, sourceUrl: o.sourceUrl ?? c.read.sourceUrl, sourceDocument: c.read.attachments, original: o.original, sourceFile: file, createdAt: stamp(),
        });
      }
      if (c.message) {
        await tx.insert(rfqMessages).values({ threadId, key: c.message.key, date: c.message.date, kind: "reply", status: c.message.status, summary: c.message.summary, reference: c.message.reference, attachments: c.message.attachments, source: "file", sourceFile: file, createdAt: stamp() });
      }
    }
  });
  return { plan, loaded: true };
}

// ---------------- What a person says ----------------

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
};
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** A person corrects who the company is. What they wrote is remembered as theirs: no file changes it afterwards. */
export async function updateReplyCompany(db: DB, id: string, patch: Partial<Record<CompanyField, string | null>>, t: T = en): Promise<void> {
  const [row] = await db.select().from(rfqSuppliers).where(eq(rfqSuppliers.id, id));
  if (!row) throw new ReplyError(t("This company is no longer on file."));
  const set: Partial<Record<CompanyField, string | null>> = {};
  for (const field of COMPANY_FIELDS) {
    if (!(field in patch)) continue;
    const value = clean(patch[field]);
    if (field === "name" && !value) throw new ReplyError(t("A company needs a name."));
    if (value !== (row[field] ?? null)) set[field] = value;
  }
  if (!Object.keys(set).length) return;
  await db.update(rfqSuppliers).set({ ...(set as Patch<typeof rfqSuppliers>), confirmed: union(row.confirmed ?? [], Object.keys(set)), updatedAt: new Date() }).where(eq(rfqSuppliers.id, id));
}

export interface ThreadUpdate {
  /** What happened, to keep in the history: a message sent, an answer received, a note. */
  kind: MessageKind;
  date: string;
  summary: string | null;
  reference: string | null;
  /** Where the conversation stands now, when that changed. */
  status: ReplyStatus | null;
  nextAction?: string | null;
  missing?: string | null;
  categories?: string[];
}

/**
 * A person says what happened in a conversation: it goes in the history, and
 * the status, the next action and what is missing become what they said —
 * theirs from then on, whatever a later file reads.
 */
export async function updateReplyThread(db: DB, threadId: string, v: ThreadUpdate, t: T = en): Promise<void> {
  const [row] = await db.select().from(rfqThreads).where(eq(rfqThreads.id, threadId));
  if (!row) throw new ReplyError(t("This conversation is no longer on file."));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new ReplyError(t("The date is missing."));
  const set: Partial<Record<ThreadField, string | null>> & { categories?: string[] } = {};
  if (v.status && v.status !== row.status) {
    set.status = v.status;
    // The words of the source described the status it had then.
    set.statusText = null;
  }
  if (v.nextAction !== undefined && clean(v.nextAction) !== (row.nextAction ?? null)) set.nextAction = clean(v.nextAction);
  if (v.missing !== undefined && clean(v.missing) !== (row.missing ?? null)) set.missing = clean(v.missing);
  const categories = v.categories ? [...new Set(v.categories.map((c) => clean(c)).filter((c): c is string => !!c))] : null;
  if (categories && categories.join("|") !== (row.categories ?? []).join("|")) set.categories = categories;
  const summary = clean(v.summary);
  if (!Object.keys(set).length && !summary) throw new ReplyError(t("Nothing to record: write what happened, or change something."));
  await db.transaction(async (tx) => {
    if (Object.keys(set).length) await tx.update(rfqThreads).set({ ...(set as Patch<typeof rfqThreads>), confirmed: union(row.confirmed ?? [], Object.keys(set)), updatedAt: new Date() }).where(eq(rfqThreads.id, threadId));
    await tx.insert(rfqMessages).values({ threadId, key: `manual|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, date: v.date, kind: v.kind, status: set.status ? v.status : null, summary, reference: clean(v.reference), source: "manual" });
  });
}

/** A person says whether an offer is for the product they buy. The app never says it by itself. */
export async function setOfferValidation(db: DB, offerId: string, validation: Validation, t: T = en): Promise<void> {
  const [row] = await db.select({ id: rfqOffers.id }).from(rfqOffers).where(eq(rfqOffers.id, offerId));
  if (!row) throw new ReplyError(t("This offer is no longer on file."));
  await db.update(rfqOffers).set({ validation, updatedAt: new Date() }).where(eq(rfqOffers.id, offerId));
}
