/**
 * Companies and their roles (lib/companies/plan.ts): the records of every part
 * of the app tied to one company each. `syncCompanies` gives a company to every
 * record that has none — by an identifier or by what the app already holds as
 * one, else a new company made from the record — and is safe to run any time:
 * a record already tied is never moved. What a person says of two companies
 * (the same, one group, two companies) is kept in `company_relations` with who
 * and when; "the same" is a pointer and can be taken back. Nothing here changes
 * a supplier, a candidate, a directory record, a reply or a purchase.
 */
import { after } from "next/server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { getDb } from "@/db";
import { companies, companyContacts, companyLinks, companyRelations, marketSuppliers, organizations, products, purchases, rfqSuppliers, supplierCandidates, suppliers, tradeRelationships } from "@/db/schema";
import { en, type T } from "@/lib/i18n";
import { companyKey, vatKey } from "@/lib/import/normalize/text";
import { candidateGroup, companyProposals, fill, idKeys, isRelation, pairKey, planCompanies, type CompanyFacts, type CompanyProposal, type CompanyRelation, type RoleKind, type RoleRecord } from "@/lib/companies/plan";
import type { Actor } from "@/lib/replies/types";
import { domainOf } from "@/lib/suppliers/resolve";
import { logEvents } from "./audit";

export class CompanyError extends Error {}

const SYSTEM: Actor = { type: "system", id: "companies" };
const TABLE = { supplier: suppliers, candidate: supplierCandidates, directory: marketSuppliers, reply: rfqSuppliers, registered: organizations } as const;

async function readRecords(db: DB): Promise<RoleRecord[]> {
  const [sup, cand, dir, rep, orgs, links, trades] = await Promise.all([
    db.select().from(suppliers),
    db.select().from(supplierCandidates),
    db.select().from(marketSuppliers),
    db.select().from(rfqSuppliers),
    db.select().from(organizations).where(and(eq(organizations.kind, "supplier"), eq(organizations.isWorkspace, false))),
    db.select().from(companyLinks).where(and(eq(companyLinks.aKind, "reply"), eq(companyLinks.relation, "same"))),
    db.select().from(tradeRelationships),
  ]);
  const byGroup = new Map<string, string[]>();
  for (const c of cand) byGroup.set(candidateGroup({ name: c.name, website: c.website, email: c.specCheck?.email ?? null }), [...(byGroup.get(candidateGroup({ name: c.name, website: c.website, email: c.specCheck?.email ?? null })) ?? []), c.id]);
  const base = { city: null as string | null, email: null as string | null, phone: null as string | null, vatNumber: null as string | null, taxCode: null as string | null };
  return [
    ...sup.map((s): RoleRecord => ({ kind: "supplier", id: s.id, name: s.name, vatNumber: s.vatNumber, taxCode: s.taxCode, country: s.country, city: s.city, website: s.website, email: s.email, phone: s.phone, companyId: s.companyId, sameAs: s.mergedIntoId ? [{ kind: "supplier", id: s.mergedIntoId }] : [] })),
    ...orgs.map((o): RoleRecord => ({
      ...base, kind: "registered", id: o.id, name: o.name, vatNumber: o.vatNumber, taxCode: o.taxCode, country: o.country, city: o.city, website: null, companyId: o.companyId,
      sameAs: trades.filter((r) => r.supplierOrgId === o.id).flatMap((r) => [...(r.supplierId ? [{ kind: "supplier" as const, id: r.supplierId }] : []), ...(r.rfqSupplierId ? [{ kind: "reply" as const, id: r.rfqSupplierId }] : [])]),
    })),
    ...rep.map((r): RoleRecord => ({
      ...base, kind: "reply", id: r.id, name: r.name, vatNumber: r.vatNumber, taxCode: r.taxCode, country: r.country, website: r.website, email: r.email, phone: r.phone, companyId: r.companyId,
      // A person said the company that answered is a record elsewhere: one company.
      sameAs: links.filter((l) => l.aId === r.id).flatMap((l): { kind: RoleKind; id: string }[] => (l.bKind === "supplier" ? [{ kind: "supplier" as const, id: l.bId }] : l.bKind === "directory" ? [{ kind: "directory" as const, id: l.bId }] : l.bKind === "candidate" ? (byGroup.get(l.bId) ?? []).map((id) => ({ kind: "candidate" as const, id })) : [])),
    })),
    ...dir.map((m): RoleRecord => ({ ...base, kind: "directory", id: m.id, name: m.name, country: m.country, city: m.city, website: m.website, email: m.email, phone: m.phone, companyId: m.companyId, sameAs: [] })),
    // A candidate a person converted into a supplier is that supplier.
    ...cand.map((c): RoleRecord => ({ ...base, kind: "candidate", id: c.id, name: c.name, country: c.country, website: c.website, email: c.specCheck?.email ?? null, companyId: c.companyId, sameAs: c.supplierId ? [{ kind: "supplier", id: c.supplierId }] : [] })),
  ];
}

const factsOf = (c: typeof companies.$inferSelect): CompanyFacts => ({ id: c.id, name: c.name, otherNames: c.otherNames ?? [], vatNumber: c.vatNumber, taxCode: c.taxCode, country: c.country, city: c.city, website: c.website, domain: c.domain, mergedIntoId: c.mergedIntoId });
const keysOf = (f: Pick<CompanyFacts, "vatNumber" | "taxCode">) => ({ vatKey: vatKey(f.vatNumber) || null, taxKey: vatKey(f.taxCode) || null });

/** Gives every record without a company its company, in one transaction. Returns how many were created and tied. */
export async function syncCompanies(db: DB): Promise<{ created: number; linked: number }> {
  const [records, rows] = await Promise.all([readRecords(db), db.select().from(companies)]);
  if (records.every((r) => r.companyId)) return { created: 0, linked: 0 };
  const plan = planCompanies(records, rows.map(factsOf));
  if (!plan.create.length && !plan.link.length) return { created: 0, linked: 0 };
  const recordOf = new Map(records.map((r) => [`${r.kind}:${r.id}`, r]));
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const events: Parameters<typeof logEvents>[2] = [];
    const tie = async (kind: RoleKind, id: string, companyId: string) => {
      const table = TABLE[kind];
      await tx.update(table).set({ companyId } as never).where(and(eq(table.id, id), isNull(table.companyId)));
      events.push({ action: "link_role", entity: "company", entityId: companyId, field: kind, newValue: id, source: "sync" });
    };
    for (const made of plan.create) {
      const [row] = await tx.insert(companies).values({ ...made.facts, ...keysOf(made.facts) }).returning({ id: companies.id });
      events.push({ action: "create", entity: "company", entityId: row.id, newValue: made.facts.name, source: "sync" });
      for (const r of made.records) await tie(r.kind, r.id, row.id);
    }
    // A record tied to a company on file adds what the company did not know yet; nothing is overwritten.
    const touched = new Map<string, CompanyFacts>();
    for (const l of plan.link) {
      const facts = touched.get(l.companyId) ?? rows.map(factsOf).find((c) => c.id === l.companyId);
      if (!facts) continue;
      if (fill(facts, recordOf.get(`${l.kind}:${l.id}`)!)) touched.set(l.companyId, facts);
      await tie(l.kind, l.id, l.companyId);
    }
    for (const [id, f] of touched) await tx.update(companies).set({ otherNames: f.otherNames, vatNumber: f.vatNumber, taxCode: f.taxCode, country: f.country, city: f.city, website: f.website, domain: f.domain, ...keysOf(f), updatedAt: new Date() }).where(eq(companies.id, id));
    await logEvents(txDb, SYSTEM, events);
    return { created: plan.create.length, linked: plan.link.length };
  });
}

/** After a write that may have brought a new record: its company, without making the request wait. Never fails it. */
export function keepCompaniesInSync(): void {
  after(async () => {
    try {
      await syncCompanies(await getDb());
    } catch (err) {
      console.error("[companies]", err);
    }
  });
}

// ---------------- Reading ----------------

export interface CompanyRole {
  kind: RoleKind;
  id: string;
  /** As this record writes the company. */
  name: string;
  href: string;
  /** What the record says in a few words: the product a candidate is for, the market of a directory record… */
  detail: string | null;
}

export interface CompanySummary {
  id: string;
  name: string;
  otherNames: string[];
  country: string | null;
  vatNumber: string | null;
  domain: string | null;
  roles: Record<RoleKind, number>;
  /** Spend with it in the last 12 months, over its supplier records (catalogue and other spend). */
  spend: number;
  contacts: number;
}

export interface CompanyDetail extends CompanySummary {
  taxCode: string | null;
  city: string | null;
  website: string | null;
  list: CompanyRole[];
  contactList: (typeof companyContacts.$inferSelect)[];
  /** The contacts its own records already carry, each with the record it is read from: shown, never copied. */
  recordContacts: { kind: RoleKind; name: string | null; email: string | null; phone: string | null }[];
  relations: { id: string; relation: CompanyRelation; other: { id: string; name: string }; note: string | null; decidedBy: string; createdAt: string; mine: boolean }[];
  /** Companies a person said are this one: read as this one. */
  merged: { id: string; name: string; relationId: string | null }[];
  proposals: (CompanyProposal & { other: { id: string; name: string } })[];
}

interface World {
  rows: (typeof companies.$inferSelect)[];
  canon: (id: string) => string;
  roles: Map<string, CompanyRole[]>;
  spend: Map<string, number>;
  contacts: (typeof companyContacts.$inferSelect)[];
  relations: (typeof companyRelations.$inferSelect)[];
}

async function readWorld(db: DB, t: T): Promise<World> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const [rows, sup, cand, dir, rep, orgs, contacts, relations, productRows, spendRows] = await Promise.all([
    db.select().from(companies),
    db.select({ id: suppliers.id, name: suppliers.name, companyId: suppliers.companyId, mergedIntoId: suppliers.mergedIntoId }).from(suppliers).where(isNotNull(suppliers.companyId)),
    db.select({ id: supplierCandidates.id, name: supplierCandidates.name, companyId: supplierCandidates.companyId, productId: supplierCandidates.productId, status: supplierCandidates.status }).from(supplierCandidates).where(isNotNull(supplierCandidates.companyId)),
    db.select({ id: marketSuppliers.id, name: marketSuppliers.name, companyId: marketSuppliers.companyId, market: marketSuppliers.market }).from(marketSuppliers).where(isNotNull(marketSuppliers.companyId)),
    db.select({ id: rfqSuppliers.id, name: rfqSuppliers.name, companyId: rfqSuppliers.companyId }).from(rfqSuppliers).where(isNotNull(rfqSuppliers.companyId)),
    db.select({ id: organizations.id, name: organizations.name, companyId: organizations.companyId }).from(organizations).where(isNotNull(organizations.companyId)),
    db.select().from(companyContacts),
    db.select().from(companyRelations).where(isNull(companyRelations.undoneAt)),
    db.select({ id: products.id, name: products.name }).from(products),
    db.select({ supplierId: purchases.supplierId, total: purchases.totalAmount, fx: purchases.fxRate, date: purchases.date }).from(purchases),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const canon = (id: string) => {
    const seen = new Set<string>();
    let cur = byId.get(id);
    while (cur?.mergedIntoId && !seen.has(cur.id) && byId.has(cur.mergedIntoId)) {
      seen.add(cur.id);
      cur = byId.get(cur.mergedIntoId);
    }
    return cur?.id ?? id;
  };
  const productName = new Map(productRows.map((p) => [p.id, p.name]));
  const roles = new Map<string, CompanyRole[]>();
  const add = (companyId: string | null, role: CompanyRole) => {
    if (!companyId) return;
    const id = canon(companyId);
    roles.set(id, [...(roles.get(id) ?? []), role]);
  };
  for (const s of sup) add(s.companyId, { kind: "supplier", id: s.id, name: s.name, href: `/suppliers/${s.mergedIntoId ?? s.id}`, detail: s.mergedIntoId ? t("a record merged into another supplier") : null });
  for (const c of cand) add(c.companyId, { kind: "candidate", id: c.id, name: c.name, href: `/sourcing/${c.productId}`, detail: productName.get(c.productId) ?? null });
  for (const m of dir) add(m.companyId, { kind: "directory", id: m.id, name: m.name, href: `/sourcing/directory/${m.id}`, detail: null });
  for (const r of rep) add(r.companyId, { kind: "reply", id: r.id, name: r.name, href: `/sourcing/replies/${r.id}`, detail: null });
  for (const o of orgs) add(o.companyId, { kind: "registered", id: o.id, name: o.name, href: "/orders", detail: null });
  const supplierCompany = new Map(sup.map((s) => [s.id, canon(s.companyId!)]));
  const spend = new Map<string, number>();
  for (const p of spendRows) {
    const c = supplierCompany.get(p.supplierId);
    if (!c || String(p.date) < since) continue;
    spend.set(c, (spend.get(c) ?? 0) + Number(p.total) * (p.fx == null ? 1 : Number(p.fx)));
  }
  return { rows, canon, roles, spend, contacts, relations };
}

const count = (list: CompanyRole[]): Record<RoleKind, number> => {
  const out = { supplier: 0, registered: 0, reply: 0, directory: 0, candidate: 0 } as Record<RoleKind, number>;
  for (const r of list) out[r.kind] += r.kind === "supplier" && r.detail ? 0 : 1;
  return out;
};

function summaryOf(w: World, c: typeof companies.$inferSelect): CompanySummary {
  const list = w.roles.get(c.id) ?? [];
  return { id: c.id, name: c.name, otherNames: c.otherNames ?? [], country: c.country, vatNumber: c.vatNumber, domain: c.domain, roles: count(list), spend: w.spend.get(c.id) ?? 0, contacts: w.contacts.filter((x) => w.canon(x.companyId) === c.id).length };
}

const decidedPairs = (w: World) => new Set(w.relations.map((r) => pairKey(w.canon(r.aId), w.canon(r.bId))));

/** Every company, the ones that weigh most on the spend first, with its roles — and the pairs that may be one company. */
export async function readCompanies(db: DB, t: T = en): Promise<{ companies: CompanySummary[]; proposals: (CompanyProposal & { names: [string, string] })[] }> {
  const w = await readWorld(db, t);
  const live = w.rows.filter((r) => !r.mergedIntoId);
  const list = live.map((c) => summaryOf(w, c)).sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
  const roleCount = (id: string) => (w.roles.get(id) ?? []).length;
  const proposals = companyProposals(live.map((c) => ({ ...factsOf(c), roles: roleCount(c.id) })), decidedPairs(w), t).map((p) => ({ ...p, names: [live.find((c) => c.id === p.a)!.name, live.find((c) => c.id === p.b)!.name] as [string, string] }));
  return { companies: list, proposals };
}

export async function readCompany(db: DB, id: string, t: T = en): Promise<CompanyDetail | null> {
  const w = await readWorld(db, t);
  const row = w.rows.find((r) => r.id === w.canon(id));
  if (!row) return null;
  const name = (cid: string) => w.rows.find((r) => r.id === cid)?.name ?? "—";
  const mine = w.relations.filter((r) => w.canon(r.aId) === row.id || w.canon(r.bId) === row.id);
  const live = w.rows.filter((r) => !r.mergedIntoId);
  const proposals = companyProposals(live.map((c) => ({ ...factsOf(c), roles: (w.roles.get(c.id) ?? []).length })), decidedPairs(w), t)
    .filter((p) => p.a === row.id || p.b === row.id)
    .map((p) => {
      const other = p.a === row.id ? p.b : p.a;
      return { ...p, other: { id: other, name: name(other) } };
    });
  return {
    ...summaryOf(w, row),
    taxCode: row.taxCode,
    city: row.city,
    website: row.website,
    list: (w.roles.get(row.id) ?? []).sort((a, b) => ROLE_ORDER.indexOf(a.kind) - ROLE_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)),
    contactList: w.contacts.filter((x) => w.canon(x.companyId) === row.id),
    recordContacts: await recordContactsOf(db, (w.roles.get(row.id) ?? []).map((r) => r)),
    relations: mine.filter((r) => r.relation !== "same_company").map((r) => {
      const other = w.canon(r.aId) === row.id ? w.canon(r.bId) : w.canon(r.aId);
      return { id: r.id, relation: r.relation as CompanyRelation, other: { id: other, name: name(other) }, note: r.note, decidedBy: r.decidedBy, createdAt: r.createdAt.toISOString(), mine: w.canon(r.aId) === row.id };
    }),
    merged: w.rows.filter((r) => r.mergedIntoId && w.canon(r.id) === row.id).map((r) => ({ id: r.id, name: r.name, relationId: w.relations.find((x) => x.relation === "same_company" && x.bId === r.id)?.id ?? null })),
    proposals,
  };
}

const ROLE_ORDER: RoleKind[] = ["supplier", "registered", "reply", "directory", "candidate"];

async function recordContactsOf(db: DB, roles: CompanyRole[]): Promise<CompanyDetail["recordContacts"]> {
  const of = (kind: RoleKind) => roles.filter((r) => r.kind === kind).map((r) => r.id);
  const [sup, rep, dir] = await Promise.all([
    of("supplier").length ? db.select({ name: suppliers.contactName, email: suppliers.email, phone: suppliers.phone }).from(suppliers).where(inArray(suppliers.id, of("supplier"))) : [],
    of("reply").length ? db.select({ name: rfqSuppliers.contactName, email: rfqSuppliers.email, phone: rfqSuppliers.phone }).from(rfqSuppliers).where(inArray(rfqSuppliers.id, of("reply"))) : [],
    of("directory").length ? db.select({ email: marketSuppliers.email, phone: marketSuppliers.phone }).from(marketSuppliers).where(inArray(marketSuppliers.id, of("directory"))) : [],
  ]);
  const out: CompanyDetail["recordContacts"] = [
    ...sup.map((x) => ({ kind: "supplier" as const, ...x })),
    ...rep.map((x) => ({ kind: "reply" as const, ...x })),
    ...dir.map((x) => ({ kind: "directory" as const, name: null, ...x })),
  ].filter((x) => x.name || x.email || x.phone);
  const seen = new Set<string>();
  return out.filter((x) => {
    const k = [x.name, x.email, x.phone].join("|").toLowerCase();
    return !seen.has(k) && !!seen.add(k);
  });
}

/** The company a record of one part of the app is a role of — for the link from its page. */
export async function companyOfRecord(db: DB, kind: RoleKind, id: string): Promise<string | null> {
  const table = TABLE[kind];
  const [row] = await db.select({ companyId: table.companyId }).from(table).where(eq(table.id, id));
  if (!row?.companyId) return null;
  const all = await db.select({ id: companies.id, mergedIntoId: companies.mergedIntoId }).from(companies);
  let cur = row.companyId;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const next = all.find((c) => c.id === cur)?.mergedIntoId;
    if (!next) break;
    cur = next;
  }
  return cur;
}

// ---------------- What a person says ----------------

/**
 * Two companies are the same (the second is read as the first), of one group, one controlled by or distributing the
 * other, or simply two companies. Two different VAT numbers are never "the same company".
 */
export async function relateCompanies(db: DB, aId: string, bId: string, relation: string, note: string | null, actor: Actor, t: T = en): Promise<void> {
  if (!isRelation(relation)) throw new CompanyError(t("Choose what the two companies are to each other."));
  const rows = await db.select().from(companies).where(inArray(companies.id, [aId, bId]));
  const [a, b] = [rows.find((r) => r.id === aId), rows.find((r) => r.id === bId)];
  if (!a || !b) throw new CompanyError(t("This company is no longer on file."));
  if (a.id === b.id) throw new CompanyError(t("Choose another company."));
  if (relation === "same_company") {
    if (a.mergedIntoId || b.mergedIntoId) throw new CompanyError(t("One of the two is read as another company already: decide from that company's page."));
    const [ka, kb] = [idKeys(a), idKeys(b)];
    if (ka.length && kb.length && !ka.some((k) => kb.includes(k))) throw new CompanyError(t("The two have different VAT numbers: they are two legal entities, never one company. Say instead that they are of one group."));
  }
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(companyRelations).values({ aId, bId, relation, note: note?.trim() || null, decidedBy: actor.id ?? actor.type, decidedByType: actor.type }).returning({ id: companyRelations.id });
    if (relation === "same_company") await tx.update(companies).set({ mergedIntoId: aId, updatedAt: new Date() }).where(eq(companies.id, bId));
    await logEvents(tx as unknown as DB, actor, [{ action: relation === "same_company" ? "merge" : "relate", entity: "company", entityId: aId, field: relation, newValue: bId, note: note?.trim() || null, source: "ui" }]);
    return row;
  });
}

/** Takes a decision back: the row stays, marked undone; "the same company" stops being read as one. */
export async function undoCompanyRelation(db: DB, relationId: string, actor: Actor, t: T = en): Promise<void> {
  const [r] = await db.select().from(companyRelations).where(eq(companyRelations.id, relationId));
  if (!r || r.undoneAt) throw new CompanyError(t("This decision is no longer on file."));
  await db.transaction(async (tx) => {
    await tx.update(companyRelations).set({ undoneAt: new Date(), undoneBy: actor.id ?? actor.type }).where(eq(companyRelations.id, relationId));
    if (r.relation === "same_company") await tx.update(companies).set({ mergedIntoId: null, updatedAt: new Date() }).where(and(eq(companies.id, r.bId), eq(companies.mergedIntoId, r.aId)));
    await logEvents(tx as unknown as DB, actor, [{ action: "undo", entity: "company", entityId: r.aId, field: r.relation, oldValue: r.bId, source: "ui" }]);
  });
}

export async function addCompanyContact(db: DB, companyId: string, v: { name?: string | null; role?: string | null; email?: string | null; phone?: string | null; note?: string | null }, actor: Actor, t: T = en): Promise<string> {
  const clean = (x: string | null | undefined) => (x ?? "").replace(/\s+/g, " ").trim() || null;
  const c = { name: clean(v.name), role: clean(v.role), email: clean(v.email)?.toLowerCase() ?? null, phone: clean(v.phone), note: clean(v.note) };
  if (!c.name && !c.email && !c.phone) throw new CompanyError(t("A contact needs at least a name, an email or a phone number."));
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) throw new CompanyError(t("This does not look like an email address."));
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw new CompanyError(t("This company is no longer on file."));
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(companyContacts).values({ companyId, ...c, source: "manual", createdBy: actor.id }).returning({ id: companyContacts.id });
    await logEvents(tx as unknown as DB, actor, [{ action: "create", entity: "company_contact", entityId: row.id, newValue: [c.name, c.email, c.phone].filter(Boolean).join(" · "), source: "ui" }]);
    return row.id;
  });
}

/** A contact a person wrote can be taken off; the whole row goes in the log first. */
export async function removeCompanyContact(db: DB, contactId: string, actor: Actor, t: T = en): Promise<void> {
  const [row] = await db.select().from(companyContacts).where(eq(companyContacts.id, contactId));
  if (!row) throw new CompanyError(t("This contact is no longer on file."));
  await db.transaction(async (tx) => {
    await logEvents(tx as unknown as DB, actor, [{ action: "delete", entity: "company_contact", entityId: row.id, oldValue: JSON.stringify(row), source: "ui" }]);
    await tx.delete(companyContacts).where(eq(companyContacts.id, contactId));
  });
}

/** The key the replies module reads a candidate company by (domain, else name): kept equal to the plan's. */
export const candidateCompanyKey = (c: { name: string; website: string | null }) => domainOf({ website: c.website, email: null }) ?? companyKey(c.name);
