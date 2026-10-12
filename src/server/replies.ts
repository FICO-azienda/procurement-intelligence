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
import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { companyLinks, deliveryDestinations, documents, marketSuppliers, products, rfqDocuments, rfqMessages, rfqOffers, rfqRequests, rfqSuppliers, rfqThreads, settings, supplierCandidates, suppliers } from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { isStrategic } from "@/lib/catalog/kinds";
import { subByKey } from "@/lib/catalog/taxonomy";
import { en, type T } from "@/lib/i18n";
import { companyKey } from "@/lib/import/normalize/text";
import { landedCost, readLandedInput, type Landed, type LandedInput } from "@/lib/replies/landed";
import { categoryKeyOf, suggestFor, type MatchProduct, type Suggestion } from "@/lib/replies/match";
import { groupOf, lineKey, offerState, shortfallsOf, supersededIds, type OfferGroup, type OfferState, type Shortfall } from "@/lib/replies/offers";
import { elsewhereOf, planReplies, type CompanyDecision, type Elsewhere, type Records, type ReplyPlan, type StoredCompany } from "@/lib/replies/plan";
import { parseReplyFile } from "@/lib/replies/read";
import {
  COMPANY_FIELDS, THREAD_FIELDS, isCompatibility, isDocumentKind, isMessageKind, isReplyStatus,
  type Actor, type CompanyField, type Compatibility, type DocumentKind, type MessageKind, type ReplyCompany, type ReplyDocument, type ReplyMessage, type ReplyOffer, type ReplyStatus, type ReplyThread, type ThreadField,
} from "@/lib/replies/types";
import { crossesCustoms } from "@/lib/sourcing/regions";
import { domainOf } from "@/lib/suppliers/resolve";
import { logEvents, type AuditInput } from "./audit";
import { readNaming } from "./categories";
import { defaultOf, placeOf, readDestinations, type Destination } from "./destinations";
import { getStorage, storageKey } from "@/lib/storage";

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
  productId: r.productId, compatibility: isCompatibility(r.compatibility) ? r.compatibility : "not_analyzed", compatibilityNote: r.compatibilityNote, declinedProductIds: r.declinedProductIds ?? [],
  decision: r.decision === "rejected" ? "rejected" : null, decisionNote: r.decisionNote, landed: r.landed ?? {}, destinationId: r.destinationId, createdAt: r.createdAt.toISOString(),
  technicalStatus: r.technicalStatus, missing: r.missing, sourceUrl: r.sourceUrl, sourceDocument: r.sourceDocument,
});

const toMessage = (r: typeof rfqMessages.$inferSelect): ReplyMessage => ({
  id: r.id, threadId: r.threadId, key: r.key, date: r.date, kind: isMessageKind(r.kind) ? r.kind : "note", status: isReplyStatus(r.status) ? r.status : null,
  summary: r.summary, reference: r.reference, attachments: r.attachments, source: r.source === "manual" || r.source === "assistant" ? r.source : "file",
});

const toDocument = (r: typeof rfqDocuments.$inferSelect): ReplyDocument => ({ id: r.id, threadId: r.threadId, offerId: r.offerId, kind: isDocumentKind(r.kind) ? r.kind : "other", name: r.name, url: r.url, documentId: r.documentId, note: r.note });

async function readThreads(db: DB): Promise<ReplyThread[]> {
  const [threads, offers, messages, docs] = await Promise.all([
    db.select().from(rfqThreads).orderBy(asc(rfqThreads.createdAt)),
    db.select().from(rfqOffers).orderBy(asc(rfqOffers.createdAt)),
    db.select().from(rfqMessages).orderBy(asc(rfqMessages.date), asc(rfqMessages.createdAt)),
    db.select().from(rfqDocuments).orderBy(asc(rfqDocuments.createdAt)),
  ]);
  return threads.map((r) => ({
    id: r.id, supplierId: r.supplierId, reference: r.reference, categories: r.categories ?? [], status: isReplyStatus(r.status) ? r.status : "needs_information", statusText: r.statusText,
    products: r.products, offerSummary: r.offerSummary, moq: r.moq, paymentTerms: r.paymentTerms, leadTime: r.leadTime, samples: r.samples, missing: r.missing, nextAction: r.nextAction,
    followUpOn: r.followUpOn, priority: r.priority, notes: r.notes, confirmed: r.confirmed ?? [], checkedAt: r.checkedAt, sourceFile: r.sourceFile,
    offers: offers.filter((o) => o.threadId === r.id).map(toOffer),
    messages: messages.filter((m) => m.threadId === r.id).map(toMessage),
    documents: docs.filter((d) => d.threadId === r.id).map(toDocument),
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

/** What people decided about a reply's company and a record elsewhere, by the reply's company. */
async function readDecisions(db: DB): Promise<Map<string, CompanyDecision[]>> {
  const out = new Map<string, CompanyDecision[]>();
  for (const r of await db.select().from(companyLinks).where(eq(companyLinks.aKind, "reply"))) {
    if (r.bKind !== "supplier" && r.bKind !== "candidate" && r.bKind !== "directory") continue;
    if (r.relation !== "same" && r.relation !== "group" && r.relation !== "different") continue;
    out.set(r.aId, [...(out.get(r.aId) ?? []), { where: r.bKind, id: r.bId, relation: r.relation }]);
  }
  return out;
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
  /** The requests the buyer recorded as sent to it (rfq_requests), by its name. */
  requests: { sentAt: string; kind: string; products: number }[];
}

export async function readReplies(db: DB, t: T = en): Promise<ReplyDossier[]> {
  const [companies, threads, others, decisions, sent] = await Promise.all([db.select().from(rfqSuppliers).orderBy(asc(rfqSuppliers.name)), readThreads(db), readOthers(db), readDecisions(db), db.select().from(rfqRequests)]);
  return companies.map((r) => {
    const company = toCompany(r);
    const key = companyKey(r.name);
    return {
      ...company,
      threads: threads.filter((th) => th.supplierId === r.id),
      elsewhere: elsewhereOf(company, others, t, decisions.get(r.id) ?? []),
      requests: sent.filter((q) => q.supplierKey === key).map((q) => ({ sentAt: q.sentAt, kind: q.kind, products: q.productIds.length })),
    };
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

/**
 * Loads the file: all of it or nothing. The plan is worked out again on what is on file now, so it never acts on a
 * stale check. What it writes is recorded as the file's doing — never as a person's.
 */
export async function importReplies(db: DB, raw: string, opts: { file: string | null }, t: T = en): Promise<ReplyImport> {
  const records = await readRecords(db);
  const plan = planOf(raw, records, t);
  const file = opts.file;
  const actor: Actor = { type: "import", id: file };
  // Rows written in one transaction would share one timestamp: each gets its own, so that they stay in the order of the file.
  let tick = Date.now();
  const stamp = () => new Date(tick++);
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const created = new Map<string, string>();
    const events: AuditInput[] = [];
    for (const c of plan.companies) {
      if (c.action === "unchanged") continue;
      const stored = c.supplierId ? records.replies.find((r) => r.id === c.supplierId) : undefined;
      let supplierId = c.supplierId ?? (c.sameAs ? (created.get(c.sameAs) ?? null) : null);
      if (!supplierId) {
        const [row] = await tx.insert(rfqSuppliers).values({ ...filled(c.company), name: c.read.name, checkedAt: c.read.checkedAt, sourceFile: file }).returning({ id: rfqSuppliers.id });
        supplierId = row.id;
        created.set(c.reference, supplierId);
        events.push({ action: "create", entity: "rfq_supplier", entityId: supplierId, newValue: c.read.name, source: file });
      } else if (Object.keys(c.company).length) {
        await tx.update(rfqSuppliers).set({ ...(c.company as Patch<typeof rfqSuppliers>), checkedAt: later(stored?.checkedAt ?? null, c.read.checkedAt), updatedAt: new Date() }).where(eq(rfqSuppliers.id, supplierId));
      }

      let threadId = c.threadId;
      if (!threadId) {
        const [row] = await tx
          .insert(rfqThreads)
          .values({ ...filled(c.thread), supplierId, reference: c.reference, categories: c.categories ?? [], status: c.read.status, original: c.read.original, checkedAt: c.read.checkedAt, sourceFile: file, createdAt: stamp() })
          .returning({ id: rfqThreads.id });
        threadId = row.id;
        events.push({ action: "create", entity: "rfq_thread", entityId: threadId, newValue: c.reference, source: file });
      } else if (Object.keys(c.thread).length || c.categories) {
        const onFile = stored?.threads.find((th) => th.id === threadId);
        // The record is kept as the latest file gave it; the files themselves stay on this computer.
        await tx
          .update(rfqThreads)
          .set({ ...(c.thread as Patch<typeof rfqThreads>), ...(c.categories ? { categories: c.categories } : {}), original: c.read.original, checkedAt: later(onFile?.checkedAt ?? null, c.read.checkedAt), sourceFile: file, updatedAt: new Date() })
          .where(eq(rfqThreads.id, threadId));
      }
      // What the file changed in a record that was on file, field by field.
      for (const ch of c.changes) {
        const company = (COMPANY_FIELDS as readonly string[]).includes(ch.field);
        if (company ? !c.supplierId : !c.threadId) continue;
        events.push({ action: "update", entity: company ? "rfq_supplier" : "rfq_thread", entityId: company ? supplierId : threadId, field: ch.field, oldValue: ch.from, newValue: ch.to, source: file });
      }

      for (const o of c.offers) {
        const [row] = await tx
          .insert(rfqOffers)
          .values({
            threadId, key: o.key, productName: o.productName, productCode: o.productCode, grade: o.grade, category: o.category, unitPrice: String(o.unitPrice), currency: o.currency, unit: o.unit,
            quantity: text(o.quantity), moq: text(o.moq), incoterm: o.incoterm, destination: o.destination, paymentTerms: o.paymentTerms, offeredOn: o.offeredOn, validUntil: o.validUntil, validity: o.validity,
            specs: o.specs, technicalStatus: o.technicalStatus, missing: o.missing, sourceUrl: o.sourceUrl ?? c.read.sourceUrl, sourceDocument: c.read.attachments, original: o.original, sourceFile: file, createdAt: stamp(),
          })
          .returning({ id: rfqOffers.id });
        events.push({ action: "create", entity: "rfq_offer", entityId: row.id, newValue: `${o.productName} · ${o.unitPrice} ${o.currency}/${o.unit}`, source: file });
      }
      if (c.message) {
        await tx.insert(rfqMessages).values({ threadId, key: c.message.key, date: c.message.date, kind: "reply", status: c.message.status, summary: c.message.summary, reference: c.message.reference, attachments: c.message.attachments, source: "file", sourceFile: file, createdAt: stamp() });
      }
    }
    await logEvents(txDb, actor, events);
  });
  return { plan, loaded: true };
}

// ---------------- What a person says ----------------

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
};
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Someone corrects who the company is. What they wrote is no longer the file's: no file changes it afterwards. */
export async function updateReplyCompany(db: DB, id: string, patch: Partial<Record<CompanyField, string | null>>, actor: Actor, t: T = en): Promise<void> {
  const [row] = await db.select().from(rfqSuppliers).where(eq(rfqSuppliers.id, id));
  if (!row) throw new ReplyError(t("This company is no longer on file."));
  const set: Partial<Record<CompanyField, string | null>> = {};
  for (const field of COMPANY_FIELDS) {
    if (!(field in patch)) continue;
    const value = clean(patch[field]);
    if (field === "name" && !value) throw new ReplyError(t("A company needs a name."));
    if (value !== (row[field] ?? null)) set[field] = value;
  }
  const changed = Object.keys(set) as CompanyField[];
  if (!changed.length) return;
  await db.transaction(async (tx) => {
    await tx.update(rfqSuppliers).set({ ...(set as Patch<typeof rfqSuppliers>), confirmed: union(row.confirmed ?? [], changed), updatedAt: new Date() }).where(eq(rfqSuppliers.id, id));
    await logEvents(tx as unknown as DB, actor, changed.map((f) => ({ action: "update", entity: "rfq_supplier", entityId: id, field: f, oldValue: row[f], newValue: set[f] ?? null, source: "ui" })));
  });
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
  /** When to come back to it. An empty text takes the day off. */
  followUpOn?: string | null;
  missing?: string | null;
  categories?: string[];
}

/**
 * Someone says what happened in a conversation: it goes in the history, and
 * the status, the next action and what is missing become what they said —
 * no longer the file's, whatever a later file reads. Who said it is kept.
 */
export async function updateReplyThread(db: DB, threadId: string, v: ThreadUpdate, actor: Actor, t: T = en): Promise<void> {
  const [row] = await db.select().from(rfqThreads).where(eq(rfqThreads.id, threadId));
  if (!row) throw new ReplyError(t("This conversation is no longer on file."));
  if (!isDay(v.date)) throw new ReplyError(t("The date is missing."));
  const set: Partial<Record<ThreadField, string | null>> & { categories?: string[]; followUpOn?: string | null } = {};
  if (v.status && v.status !== row.status) {
    set.status = v.status;
    // The words of the source described the status it had then.
    set.statusText = null;
  }
  if (v.nextAction !== undefined && clean(v.nextAction) !== (row.nextAction ?? null)) set.nextAction = clean(v.nextAction);
  if (v.missing !== undefined && clean(v.missing) !== (row.missing ?? null)) set.missing = clean(v.missing);
  if (v.followUpOn !== undefined) {
    const day = clean(v.followUpOn);
    if (day && !isDay(day)) throw new ReplyError(t("The follow-up date cannot be read."));
    if (day !== (row.followUpOn ?? null)) set.followUpOn = day;
  }
  const categories = v.categories ? [...new Set(v.categories.map((c) => clean(c)).filter((c): c is string => !!c))] : null;
  if (categories && categories.join("|") !== (row.categories ?? []).join("|")) set.categories = categories;
  const summary = clean(v.summary);
  const changed = Object.keys(set).filter((k) => k !== "statusText");
  if (!changed.length && !summary) throw new ReplyError(t("Nothing to record: write what happened, or change something."));
  const shown = (value: unknown) => (Array.isArray(value) ? value.join(", ") : ((value as string | null | undefined) ?? null));
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    // The follow-up day is the user's by nature: a file never carries one, so it needs no protection from files.
    const guarded = Object.keys(set).filter((k) => k !== "followUpOn");
    if (Object.keys(set).length) await tx.update(rfqThreads).set({ ...(set as Patch<typeof rfqThreads>), confirmed: union(row.confirmed ?? [], guarded), updatedAt: new Date() }).where(eq(rfqThreads.id, threadId));
    await tx.insert(rfqMessages).values({ threadId, key: `manual|${Date.now()}|${Math.random().toString(36).slice(2, 8)}`, date: v.date, kind: v.kind, status: set.status ? v.status : null, summary, reference: clean(v.reference), source: actor.type === "user" ? "manual" : "assistant" });
    await logEvents(txDb, actor, [
      ...changed.map((f) => ({ action: "update", entity: "rfq_thread", entityId: threadId, field: f, oldValue: shown((row as unknown as Record<string, unknown>)[f]), newValue: shown((set as Record<string, unknown>)[f]), source: "ui" })),
      ...(summary ? [{ action: "note", entity: "rfq_thread", entityId: threadId, newValue: summary, source: "ui" }] : []),
    ]);
  });
}

// ---------------- An offer and one of the buyer's products ----------------

async function offerRow(db: DB, offerId: string, t: T) {
  const [row] = await db.select().from(rfqOffers).where(eq(rfqOffers.id, offerId));
  if (!row) throw new ReplyError(t("This offer is no longer on file."));
  return row;
}

/** How far an offer is the buyer's product, with the reason: a classification nobody can explain is not one. */
export async function setOfferCompatibility(db: DB, offerId: string, v: { compatibility: Compatibility; note: string | null }, actor: Actor, t: T = en): Promise<void> {
  const row = await offerRow(db, offerId, t);
  const note = clean(v.note);
  if (v.compatibility !== "not_analyzed" && !note) throw new ReplyError(t("Say why: a compatibility needs its reason."));
  // Equivalence is said of a product: an offer tied to none cannot be the same as "it".
  if (v.compatibility === "validated" && !row.productId) throw new ReplyError(t("Link the offer to one of your products first: equivalence is said of a product."));
  if (v.compatibility === row.compatibility && note === (row.compatibilityNote ?? null)) return;
  await db.transaction(async (tx) => {
    await tx.update(rfqOffers).set({ compatibility: v.compatibility, compatibilityNote: note, updatedAt: new Date() }).where(eq(rfqOffers.id, offerId));
    await logEvents(tx as unknown as DB, actor, [{ action: "update", entity: "rfq_offer", entityId: offerId, field: "compatibility", oldValue: row.compatibility, newValue: v.compatibility, note, source: "ui" }]);
  });
}

/**
 * An offer is looked at as an alternative for one of the buyer's products. A
 * link is not an equivalence: it keeps the compatibility it has — and one made
 * here never starts as "validated".
 */
export async function linkOffer(db: DB, offerId: string, productId: string, v: { compatibility?: Compatibility; note?: string | null }, actor: Actor, t: T = en): Promise<void> {
  const row = await offerRow(db, offerId, t);
  const [product] = await db.select({ id: products.id, name: products.name, mergedIntoId: products.mergedIntoId }).from(products).where(eq(products.id, productId));
  if (!product || product.mergedIntoId) throw new ReplyError(t("This product is no longer in the catalogue."));
  const compatibility = v.compatibility && v.compatibility !== "validated" ? v.compatibility : row.productId === productId ? (row.compatibility as Compatibility) : "not_analyzed";
  const note = clean(v.note) ?? (row.productId === productId ? row.compatibilityNote : null);
  if (compatibility !== "not_analyzed" && !note) throw new ReplyError(t("Say why: a compatibility needs its reason."));
  await db.transaction(async (tx) => {
    await tx.update(rfqOffers).set({ productId, compatibility, compatibilityNote: note, declinedProductIds: (row.declinedProductIds ?? []).filter((x) => x !== productId), updatedAt: new Date() }).where(eq(rfqOffers.id, offerId));
    await logEvents(tx as unknown as DB, actor, [
      ...(row.productId !== productId ? [{ action: "link", entity: "rfq_offer", entityId: offerId, field: "product", oldValue: row.productId, newValue: productId, note: product.name, source: "ui" }] : []),
      ...(compatibility !== row.compatibility ? [{ action: "update", entity: "rfq_offer", entityId: offerId, field: "compatibility", oldValue: row.compatibility, newValue: compatibility, note, source: "ui" }] : []),
    ]);
  });
}

/** The offer is no longer looked at for that product: what was said of their compatibility goes with the link. */
export async function unlinkOffer(db: DB, offerId: string, actor: Actor, t: T = en): Promise<void> {
  const row = await offerRow(db, offerId, t);
  if (!row.productId) return;
  await db.transaction(async (tx) => {
    await tx.update(rfqOffers).set({ productId: null, compatibility: "not_analyzed", compatibilityNote: null, updatedAt: new Date() }).where(eq(rfqOffers.id, offerId));
    await logEvents(tx as unknown as DB, actor, [{ action: "unlink", entity: "rfq_offer", entityId: offerId, field: "product", oldValue: row.productId, newValue: null, note: row.compatibility !== "not_analyzed" ? `${row.compatibility}: ${row.compatibilityNote ?? ""}` : null, source: "ui" }]);
  });
}

/** "It is not for this product": the app stops proposing the two together. */
export async function declineSuggestion(db: DB, offerId: string, productId: string, actor: Actor, t: T = en): Promise<void> {
  const row = await offerRow(db, offerId, t);
  if ((row.declinedProductIds ?? []).includes(productId)) return;
  await db.transaction(async (tx) => {
    await tx.update(rfqOffers).set({ declinedProductIds: [...(row.declinedProductIds ?? []), productId], updatedAt: new Date() }).where(eq(rfqOffers.id, offerId));
    await logEvents(tx as unknown as DB, actor, [{ action: "decline_link", entity: "rfq_offer", entityId: offerId, field: "product", newValue: productId, source: "ui" }]);
  });
}

/** An offer is turned down, or taken up again. It stays on file either way. */
export async function decideOffer(db: DB, offerId: string, v: { rejected: boolean; note: string | null }, actor: Actor, t: T = en): Promise<void> {
  const row = await offerRow(db, offerId, t);
  const note = clean(v.note);
  if (v.rejected && !note) throw new ReplyError(t("Say why the offer is turned down."));
  const decision = v.rejected ? "rejected" : null;
  if (decision === row.decision && note === (row.decisionNote ?? null)) return;
  await db.transaction(async (tx) => {
    await tx.update(rfqOffers).set({ decision, decisionNote: v.rejected ? note : null, updatedAt: new Date() }).where(eq(rfqOffers.id, offerId));
    await logEvents(tx as unknown as DB, actor, [{ action: v.rejected ? "reject" : "reopen", entity: "rfq_offer", entityId: offerId, field: "decision", oldValue: row.decision, newValue: decision, note, source: "ui" }]);
  });
}

/** A stated cost in a line, for the log: "0.05 EUR per unit · estimated · forwarder, 2026-10-12". */
const costText = (e: LandedInput[keyof LandedInput] | undefined): string | null => {
  if (!e) return null;
  if ("rate" in e) return `${e.rate} · ${e.status} · ${e.source}, ${e.date}`;
  return [`${e.amount} ${e.per === "percent" ? "%" : `${e.currency} per ${e.per}`}`, e.status, [e.source, e.date].filter(Boolean).join(", ") || null, e.note].filter(Boolean).join(" · ");
};

/** What it costs to bring the goods to the plant, as someone stated it: each figure with its status, its source and its date. */
export async function saveLanded(db: DB, offerId: string, v: { input: unknown; destinationId?: string | null }, actor: Actor, t: T = en): Promise<void> {
  const row = await offerRow(db, offerId, t);
  const input = readLandedInput(v.input);
  if (v.destinationId) {
    const [dest] = await db.select({ id: deliveryDestinations.id }).from(deliveryDestinations).where(eq(deliveryDestinations.id, v.destinationId));
    if (!dest) throw new ReplyError(t("This destination is no longer on file."));
  }
  const before = readLandedInput(row.landed);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(input)])] as (keyof LandedInput)[];
  const changed = keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(input[k] ?? null));
  const destinationId = v.destinationId === undefined ? row.destinationId : v.destinationId;
  if (!changed.length && destinationId === row.destinationId) return;
  await db.transaction(async (tx) => {
    await tx.update(rfqOffers).set({ landed: input as Record<string, unknown>, destinationId, updatedAt: new Date() }).where(eq(rfqOffers.id, offerId));
    await logEvents(tx as unknown as DB, actor, [
      ...changed.map((k) => ({ action: "update", entity: "rfq_offer", entityId: offerId, field: `landed.${k}`, oldValue: costText(before[k]), newValue: costText(input[k]), source: "ui" })),
      ...(destinationId !== row.destinationId ? [{ action: "update", entity: "rfq_offer", entityId: offerId, field: "destination", oldValue: row.destinationId, newValue: destinationId, source: "ui" }] : []),
    ]);
  });
}

// ---------------- Documents ----------------

/**
 * A document of a conversation: named, linked, or kept. Only a file uploaded
 * here is a copy on file — a link to a message is a way to it while the
 * message is there. The same file uploaded twice is one document.
 */
export async function addReplyDocument(db: DB, threadId: string, v: { offerId?: string | null; kind: DocumentKind; name: string; url?: string | null; note?: string | null; file?: { name: string; bytes: Uint8Array; mimeType: string | null } | null }, actor: Actor, t: T = en): Promise<string> {
  const [thread] = await db.select({ id: rfqThreads.id }).from(rfqThreads).where(eq(rfqThreads.id, threadId));
  if (!thread) throw new ReplyError(t("This conversation is no longer on file."));
  const name = clean(v.name) ?? clean(v.file?.name);
  if (!name) throw new ReplyError(t("A document needs a name."));
  const url = clean(v.url);
  if (url && !/^https?:\/\//i.test(url)) throw new ReplyError(t("The link must start with http:// or https://."));
  let documentId: string | null = null;
  if (v.file) {
    const sha256 = createHash("sha256").update(v.file.bytes).digest("hex");
    let [doc] = await db.select().from(documents).where(eq(documents.sha256, sha256));
    if (!doc) {
      const key = storageKey(v.file.name, sha256);
      await getStorage().put(key, v.file.bytes, v.file.mimeType ?? "application/octet-stream");
      [doc] = await db.insert(documents).values({ filename: v.file.name, mimeType: v.file.mimeType, sizeBytes: v.file.bytes.length, sha256, storagePath: key }).returning();
    }
    documentId = doc.id;
    const [same] = await db.select({ id: rfqDocuments.id }).from(rfqDocuments).where(and(eq(rfqDocuments.threadId, threadId), eq(rfqDocuments.documentId, doc.id)));
    if (same) return same.id;
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(rfqDocuments).values({ threadId, offerId: v.offerId ?? null, kind: v.kind, name, url, documentId, note: clean(v.note) }).returning({ id: rfqDocuments.id });
    await logEvents(tx as unknown as DB, actor, [{ action: "add_document", entity: "rfq_thread", entityId: threadId, field: v.kind, newValue: name, note: documentId ? "copy on file" : url ? "link only" : "named only", source: "ui" }]);
    return row.id;
  });
}

/** Takes a document off a conversation. The file itself, if one was uploaded, stays in the store: other records may point to it. */
export async function removeReplyDocument(db: DB, id: string, actor: Actor): Promise<void> {
  const [row] = await db.select().from(rfqDocuments).where(eq(rfqDocuments.id, id));
  if (!row) return;
  await db.transaction(async (tx) => {
    await tx.delete(rfqDocuments).where(eq(rfqDocuments.id, id));
    await logEvents(tx as unknown as DB, actor, [{ action: "remove_document", entity: "rfq_thread", entityId: row.threadId, field: row.kind, oldValue: row.name, source: "ui" }]);
  });
}

// ---------------- One company, several records ----------------

/**
 * Someone says what a record of another part of the app is to this company:
 * the same company, another company of the same group, or another company —
 * or takes the decision back (`null`). The records stay as they are.
 */
export async function decideCompanyLink(db: DB, replyId: string, other: { where: Elsewhere["where"]; id: string }, relation: CompanyDecision["relation"] | null, actor: Actor, t: T = en): Promise<void> {
  const [company] = await db.select({ id: rfqSuppliers.id }).from(rfqSuppliers).where(eq(rfqSuppliers.id, replyId));
  if (!company) throw new ReplyError(t("This company is no longer on file."));
  const pair = and(eq(companyLinks.aKind, "reply"), eq(companyLinks.aId, replyId), eq(companyLinks.bKind, other.where), eq(companyLinks.bId, other.id));
  const [before] = await db.select().from(companyLinks).where(pair);
  if ((before?.relation ?? null) === relation) return;
  await db.transaction(async (tx) => {
    if (before) await tx.delete(companyLinks).where(eq(companyLinks.id, before.id));
    if (relation) await tx.insert(companyLinks).values({ aKind: "reply", aId: replyId, bKind: other.where, bId: other.id, relation });
    await logEvents(tx as unknown as DB, actor, [{ action: "company_link", entity: "rfq_supplier", entityId: replyId, field: `${other.where}:${other.id}`, oldValue: before?.relation ?? null, newValue: relation, source: "ui" }]);
  });
}

// ---------------- What the offers mean for a product ----------------

/** An offer as a product's page reads it: whose it is, how it stands to the product, where it is in its life, what it costs to the plant. */
export interface OfferView {
  offer: ReplyOffer;
  company: { id: string; name: string; country: string | null };
  thread: { id: string; status: ReplyStatus; nextAction: string | null; followUpOn: string | null; missing: string | null; categories: string[] };
  /** linked: a person tied it to the product · proposed: the app proposes it, nobody confirmed. */
  link: "linked" | "proposed";
  compatibility: Compatibility;
  reasons: string[];
  state: OfferState;
  group: OfferGroup;
  shortfalls: Shortfall[];
  landed: Landed;
  /** The destination the cost is worked out to, in a line. Null: none is set. */
  destination: string | null;
  /** When it was received, as far as it is known: its own date, else the day the answer was read. */
  receivedOn: string | null;
  supersededBy: string | null;
}

interface World {
  companies: ReplyDossier[];
  products: (MatchProduct & { category: string | null })[];
  destinations: Destination[];
  home: string | null;
  today: string;
}

async function readWorld(db: DB, t: T): Promise<World> {
  const [companies, rows, naming, destinations, [company]] = await Promise.all([
    readReplies(db, t),
    db.select({ id: products.id, name: products.name, unit: products.unit, kind: products.kind, category: products.category, subcategory: products.subcategory, mergedIntoId: products.mergedIntoId }).from(products),
    readNaming(db, t),
    readDestinations(db),
    db.select({ country: settings.country }).from(settings),
  ]);
  return {
    companies,
    products: rows.filter((p) => !p.mergedIntoId && isStrategic(p.kind as Parameters<typeof isStrategic>[0])).map((p) => ({ id: p.id, name: p.name, unit: p.unit, subKey: naming.subKeyOf(p.category, p.subcategory), category: p.category })),
    destinations,
    home: company?.country ?? null,
    today: todayISO(),
  };
}

/** How one offer stands to one product — the one it is linked to, or one the app proposes. Null: it is nothing to that product. */
function viewOf(w: World, company: ReplyDossier, thread: ReplyThread, offer: ReplyOffer, product: MatchProduct, superseded: Map<string, string>, t: T): OfferView | null {
  const linked = offer.productId === product.id;
  const suggestion = linked || offer.productId ? null : (suggestFor(offer, [product], t)[0] ?? null);
  if (!linked && !suggestion) return null;
  const destination = (offer.destinationId ? w.destinations.find((d) => d.id === offer.destinationId) : null) ?? defaultOf(w.destinations);
  const landed = landedCost(offer, readLandedInput(offer.landed), { customs: crossesCustoms(company.country, w.home), destinationCity: destination?.city ?? null }, t);
  const compatibility = linked ? offer.compatibility : suggestion!.compatibility;
  const supersededBy = superseded.get(offer.id) ?? null;
  const awaitingSupplier = thread.status === "awaiting_reply";
  const state = offerState({ ...offer, compatibility }, { today: w.today, superseded: !!supersededBy, awaitingSupplier, landed });
  const known = { state, compatibility, productUnit: product.unit, landed, today: w.today, linked };
  return {
    offer,
    company: { id: company.id, name: company.name, country: company.country },
    thread: { id: thread.id, status: thread.status, nextAction: thread.nextAction, followUpOn: thread.followUpOn, missing: thread.missing, categories: thread.categories },
    link: linked ? "linked" : "proposed",
    compatibility,
    reasons: linked ? (offer.compatibilityNote ? [offer.compatibilityNote] : []) : suggestion!.reasons,
    state,
    group: groupOf(offer, known),
    shortfalls: shortfallsOf(offer, known),
    landed,
    destination: destination ? placeOf(destination) : null,
    receivedOn: offer.offeredOn ?? thread.messages.find((m) => m.kind === "reply")?.date ?? null,
    supersededBy,
  };
}

/** A company that answered about this kind of product and stated no price for it yet. */
export interface AwaitingPrice {
  company: { id: string; name: string; country: string | null };
  thread: { id: string; status: ReplyStatus; nextAction: string | null; followUpOn: string | null; missing: string | null; categories: string[] };
  /** candidate: it is already a candidate for this very product · category: it answered about this product's category. */
  basis: "candidate" | "category";
}

export interface ProductOffers {
  comparable: OfferView[];
  toVerify: OfferView[];
  otherGrades: OfferView[];
  history: OfferView[];
  awaitingPrice: AwaitingPrice[];
  /** Companies that said they cannot supply it: counted, so that they are not asked again. */
  notSuitable: number;
}

/**
 * Everything the replies say about one of the buyer's products: the offers
 * tied to it or proposed for it, each in the group its checks put it in, and
 * the companies that answered about its category without a price.
 */
export async function readProductOffers(db: DB, productId: string, t: T = en): Promise<ProductOffers | null> {
  const w = await readWorld(db, t);
  const product = w.products.find((p) => p.id === productId);
  if (!product) return null;
  const out: ProductOffers = { comparable: [], toVerify: [], otherGrades: [], history: [], awaitingPrice: [], notSuitable: 0 };
  const mine = product.subKey ? (subByKey(product.subKey)?.category.key ?? null) : null;
  for (const company of w.companies) {
    for (const thread of company.threads) {
      const superseded = supersededIds(thread.offers);
      const views = thread.offers.map((o) => viewOf(w, company, thread, o, product, superseded, t)).filter((v): v is OfferView => !!v);
      for (const v of views) (v.group === "comparable" ? out.comparable : v.group === "other_grade" ? out.otherGrades : v.group === "history" ? out.history : out.toVerify).push(v);
      if (views.length) continue;
      const candidate = company.elsewhere.some((e) => e.where === "candidate" && e.certain && e.products.some((p) => p.id === productId));
      const sameCategory = !!mine && thread.categories.some((c) => categoryKeyOf(c) === mine);
      if (!candidate && !sameCategory) continue;
      // A conversation with prices for other products of the category is not "without a price": it is about them.
      if (thread.offers.length && !candidate) continue;
      if (thread.status === "not_suitable") out.notSuitable += 1;
      else out.awaitingPrice.push({ company: { id: company.id, name: company.name, country: company.country }, thread: { id: thread.id, status: thread.status, nextAction: thread.nextAction, followUpOn: thread.followUpOn, missing: thread.missing, categories: thread.categories }, basis: candidate ? "candidate" : "category" });
    }
  }
  return out;
}

/** One offer in full: where it stands for the product it is tied to, and the products the app would propose for it. */
export interface OfferPage {
  company: ReplyDossier;
  thread: ReplyThread;
  offer: ReplyOffer;
  product: { id: string; name: string; unit: string } | null;
  view: OfferView | null;
  suggestions: Suggestion[];
  landed: Landed;
  input: LandedInput;
  destination: Destination | null;
  destinations: Destination[];
  state: OfferState;
  /** The other versions of the same line: the same product, quantity and terms quoted at another time. */
  versions: ReplyOffer[];
  supersededBy: string | null;
}

export async function readOffer(db: DB, offerId: string, t: T = en): Promise<OfferPage | null> {
  const w = await readWorld(db, t);
  for (const company of w.companies) {
    for (const thread of company.threads) {
      const offer = thread.offers.find((o) => o.id === offerId);
      if (!offer) continue;
      const superseded = supersededIds(thread.offers);
      const product = offer.productId ? (w.products.find((p) => p.id === offer.productId) ?? null) : null;
      const view = product ? viewOf(w, company, thread, offer, product, superseded, t) : null;
      const destination = (offer.destinationId ? w.destinations.find((d) => d.id === offer.destinationId) : null) ?? defaultOf(w.destinations);
      const input = readLandedInput(offer.landed);
      const landed = landedCost(offer, input, { customs: crossesCustoms(company.country, w.home), destinationCity: destination?.city ?? null }, t);
      return {
        company, thread, offer,
        product: product ? { id: product.id, name: product.name, unit: product.unit } : null,
        view,
        suggestions: offer.productId ? [] : suggestFor(offer, w.products, t),
        landed, input, destination, destinations: w.destinations,
        state: view?.state ?? offerState(offer, { today: w.today, superseded: superseded.has(offer.id), awaitingSupplier: thread.status === "awaiting_reply", landed }),
        versions: thread.offers.filter((o) => o.id !== offer.id && lineKey(o) === lineKey(offer)),
        supersededBy: superseded.get(offer.id) ?? null,
      };
    }
  }
  return null;
}
