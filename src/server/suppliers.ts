/**
 * Supplier entity resolution on the database. Two supplier records that are
 * the same company are joined by a pointer (`suppliers.merged_into_id`): the
 * merged record keeps its name, its purchases and its quotes exactly as they
 * were, and every read takes it for the record it points to. Taking a merge
 * back is clearing the pointer — nothing was moved, so nothing has to be put
 * back.
 *
 * A merge happens by itself only on a strong identifier (the same VAT number
 * or tax code, the same web domain with names that agree). Anything less is
 * shown to the user, who merges or keeps apart; what was decided is kept in
 * `supplier_resolutions`, the history of the merges and the memory of the
 * pairs not to propose again.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { after } from "next/server";
import { getDb, type DB } from "@/db";
import { documents, importItems, importSessions, productDataFields, purchases, quotes, rfqRequests, supplierAliases, supplierResolutions, suppliers } from "@/db/schema";
import { baseTotal, isPriced, todayISO, windowStart, type Dataset } from "@/lib/analytics";
import { en, type T } from "@/lib/i18n";
import { countryKey } from "@/lib/countries";
import { companyKey, normalizeKey, tidy, vatKey } from "@/lib/import/normalize/text";
import { isLevel } from "@/lib/negotiation/engine";
import { relationshipFacts, relationshipLeverage, type RelationshipLeverage } from "@/lib/negotiation/relationship";
import { automaticGroups, canonicalIds, compareSuppliers, domainOf, resolveSuppliers, type Decision, type MatchConfidence, type Resolution, type SupplierMatch, type SupplierRecord } from "@/lib/suppliers/resolve";

type Row = typeof suppliers.$inferSelect;

export class SupplierMergeError extends Error {}

/** Every supplier record, merged ones included, and who each is read as. */
export async function readSupplierRows(db: DB): Promise<{ rows: Row[]; canon: Map<string, string> }> {
  const rows = await db.select().from(suppliers).orderBy(suppliers.name);
  return { rows, canon: canonicalIds(rows) };
}

/** The canonical id of a supplier record: itself, or the record it was merged into. */
export async function canonicalSupplierId(db: DB, id: string): Promise<string> {
  const { canon } = await readSupplierRows(db);
  return canon.get(id) ?? id;
}

/** What was decided about pairs of records, read on the companies they stand for today. */
async function readDecisions(db: DB, canon: Map<string, string>): Promise<Decision[]> {
  const rows = await db.select().from(supplierResolutions);
  return rows
    .filter((r) => r.decision === "separate" || r.undoneAt != null)
    .map((r) => ({ a: canon.get(r.supplierId) ?? r.supplierId, b: canon.get(r.otherId) ?? r.otherId, decision: r.decision === "separate" ? ("separate" as const) : ("undone" as const) }));
}

/** The companies on file — one record each — with the names they are known by and how much hangs on them. */
async function canonicalRecords(db: DB): Promise<{ records: SupplierRecord[]; rows: Row[]; canon: Map<string, string> }> {
  const [{ rows, canon }, aliases, bought, quoted] = await Promise.all([
    readSupplierRows(db),
    db.select().from(supplierAliases),
    db.select({ supplierId: purchases.supplierId }).from(purchases),
    db.select({ supplierId: quotes.supplierId }).from(quotes),
  ]);
  const count = new Map<string, number>();
  for (const r of [...bought, ...quoted]) count.set(canon.get(r.supplierId) ?? r.supplierId, (count.get(canon.get(r.supplierId) ?? r.supplierId) ?? 0) + 1);
  const members = (id: string) => rows.filter((r) => canon.get(r.id) === id);
  const first = <K extends keyof Row>(id: string, key: K) => members(id).map((r) => r[key]).find((v) => v != null && v !== "") ?? null;
  const records = rows
    .filter((r) => canon.get(r.id) === r.id)
    .map((r): SupplierRecord => ({
      id: r.id,
      name: r.name,
      // What a merged record knew of the company, the company knows.
      vatNumber: r.vatNumber ?? (first(r.id, "vatNumber") as string | null),
      taxCode: r.taxCode ?? (first(r.id, "taxCode") as string | null),
      website: r.website ?? (first(r.id, "website") as string | null),
      email: r.email ?? (first(r.id, "email") as string | null),
      phone: r.phone ?? (first(r.id, "phone") as string | null),
      city: r.city,
      country: r.country,
      aliases: [...members(r.id).filter((m) => m.id !== r.id).map((m) => m.name), ...aliases.filter((a) => canon.get(a.supplierId) === r.id).map((a) => a.alias)],
      records: count.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
  return { records, rows, canon };
}

export interface ResolutionView extends Resolution {
  /** The records named by the matches. */
  names: Map<string, { name: string; vatNumber: string | null; country: string | null; records: number }>;
}

/** The pairs of suppliers worth a decision today. */
export async function readResolution(db: DB, t: T = en): Promise<ResolutionView> {
  const { records, canon } = await canonicalRecords(db);
  const resolution = resolveSuppliers(records, await readDecisions(db, canon), t);
  return { ...resolution, names: new Map(records.map((r) => [r.id, { name: r.name, vatNumber: r.vatNumber, country: r.country, records: r.records }])) };
}

/**
 * Reads one record as another. `merge` keeps everything it has; it is only
 * pointed at `keep`. Refused when it would point a company at itself.
 */
export async function mergeSuppliers(db: DB, mergeId: string, keepId: string, meta: { basis: string[]; confidence: MatchConfidence | null; decidedBy: "auto" | "user" }): Promise<void> {
  const { rows, canon } = await readSupplierRows(db);
  const merge = rows.find((r) => r.id === mergeId);
  const keep = canon.get(keepId);
  if (!merge || !keep || !rows.some((r) => r.id === keep)) throw new SupplierMergeError("not_found");
  if (canon.get(mergeId) === keep) throw new SupplierMergeError("same");
  // The record merged is the company's own: whatever was merged into it follows.
  const from = canon.get(mergeId)!;
  await db.update(suppliers).set({ mergedIntoId: keep, updatedAt: new Date() }).where(eq(suppliers.id, from));
  await db.insert(supplierResolutions).values({ supplierId: from, otherId: keep, decision: "merged", basis: meta.basis, confidence: meta.confidence, decidedBy: meta.decidedBy });
}

/** Takes a merge back: the record stands for itself again, with everything it always had. */
export async function undoSupplierMerge(db: DB, supplierId: string): Promise<void> {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!row?.mergedIntoId) throw new SupplierMergeError("not_merged");
  await db.update(suppliers).set({ mergedIntoId: null, updatedAt: new Date() }).where(eq(suppliers.id, supplierId));
  await db
    .update(supplierResolutions)
    .set({ undoneAt: new Date() })
    .where(and(eq(supplierResolutions.supplierId, supplierId), eq(supplierResolutions.decision, "merged"), isNull(supplierResolutions.undoneAt)));
}

/** The user says two records are two companies: the pair is not proposed again. */
export async function keepSuppliersSeparate(db: DB, a: string, b: string, meta: { basis: string[]; confidence: MatchConfidence | null }): Promise<void> {
  if (a === b) throw new SupplierMergeError("same");
  await db.insert(supplierResolutions).values({ supplierId: a, otherId: b, decision: "separate", basis: meta.basis, confidence: meta.confidence, decidedBy: "user" });
}

/** What two records match on, worked out here: a decision never rests on what a browser says. */
export async function matchOf(db: DB, a: string, b: string, t: T = en): Promise<SupplierMatch | null> {
  const { records, canon } = await canonicalRecords(db);
  const [x, y] = [records.find((r) => r.id === canon.get(a)), records.find((r) => r.id === canon.get(b))];
  return x && y ? compareSuppliers(x, y, t) : null;
}

/**
 * Merges what a strong identifier proves to be one company. Returns the
 * merges made: record merged → record kept.
 */
export async function autoMergeSuppliers(db: DB): Promise<{ merged: string; into: string }[]> {
  const { records, canon } = await canonicalRecords(db);
  const { automatic } = resolveSuppliers(records, await readDecisions(db, canon));
  const done: { merged: string; into: string }[] = [];
  for (const group of automaticGroups(records, automatic)) {
    for (const { id, match } of group.merge) {
      await mergeSuppliers(db, id, group.keep, { basis: match.basis, confidence: match.confidence, decidedBy: "auto" });
      done.push({ merged: id, into: group.keep });
    }
  }
  return done;
}

/**
 * After a write that may have created a supplier: once the response is out,
 * merge what a strong identifier proves to be one company. It never fails
 * the request it follows.
 */
export function keepSuppliersResolved(): void {
  after(async () => {
    try {
      await autoMergeSuppliers(await getDb());
    } catch (err) {
      console.error("[supplier resolution]", err);
    }
  });
}

// ---------------- The company behind the records ----------------

export interface SupplierAlias {
  name: string;
  /** record: a supplier record merged into this one. alias: a name the user confirmed. document: as written on invoices and quotes. */
  source: "record" | "alias" | "document";
  /** Invoice and quote lines written with this name. */
  lines: number;
  vatNumber: string | null;
}

export interface SupplierIdentity {
  canonicalId: string;
  canonicalName: string;
  aliases: SupplierAlias[];
  vatNumbers: string[];
  taxCodes: string[];
  domains: string[];
  /** Where its records place it. */
  addresses: { city: string | null; country: string | null }[];
  contacts: string[];
  /** The documents its lines were read from. */
  documents: { documentId: string | null; filename: string; lines: number }[];
  /** Purchases and quotes that hang on it, over every record. */
  purchases: number;
  quotes: number;
  /** How each name on the documents was tied to this company. */
  matched: { byVat: number; byName: number; other: number };
  /** The records read as this one, with the merge behind each. */
  merged: { id: string; name: string; vatNumber: string | null; lines: number; basis: string[]; confidence: string | null; decidedBy: string; at: string }[];
  /** Merges taken back, and pairs kept apart. */
  history: { name: string; decision: "merged" | "separate"; decidedBy: string; at: string; undoneAt: string | null }[];
}

/** Everything on file about who a supplier is: its names, identifiers, contacts, documents, and the records it is made of. */
export async function supplierIdentity(db: DB, supplierId: string): Promise<SupplierIdentity | null> {
  const { rows, canon } = await readSupplierRows(db);
  const id = canon.get(supplierId);
  const canonical = rows.find((r) => r.id === id);
  if (!id || !canonical) return null;
  const members = rows.filter((r) => canon.get(r.id) === id);
  const ids = members.map((r) => r.id);
  const lineCols = { supplierId: purchases.supplierId, name: importItems.data, documentId: documents.id, filename: importSessions.filename };
  const [aliases, bought, quoted, resolutions] = await Promise.all([
    db.select().from(supplierAliases).where(inArray(supplierAliases.supplierId, ids)),
    db.select(lineCols).from(purchases).leftJoin(importItems, eq(purchases.importItemId, importItems.id)).leftJoin(importSessions, eq(importItems.sessionId, importSessions.id)).leftJoin(documents, eq(importSessions.documentId, documents.id)).where(inArray(purchases.supplierId, ids)),
    db.select({ ...lineCols, supplierId: quotes.supplierId }).from(quotes).leftJoin(importItems, eq(quotes.importItemId, importItems.id)).leftJoin(importSessions, eq(importItems.sessionId, importSessions.id)).leftJoin(documents, eq(importSessions.documentId, documents.id)).where(inArray(quotes.supplierId, ids)),
    db.select().from(supplierResolutions).orderBy(desc(supplierResolutions.createdAt)),
  ]);
  const lines = [...bought, ...quoted];
  const linesOf = (recordId: string) => lines.filter((l) => l.supplierId === recordId).length;

  // The names as the documents wrote them, each with the VAT number written next to it.
  const written = new Map<string, { name: string; vat: string | null; lines: number }>();
  const matched = { byVat: 0, byName: 0, other: 0 };
  const known = new Set(members.map((m) => vatKey(m.vatNumber)).filter(Boolean));
  const names = new Set([...members.map((m) => companyKey(m.name)), ...aliases.map((a) => a.normalized)]);
  for (const l of lines) {
    const d = (l.name ?? null) as { supplierName?: string | null; supplierVat?: string | null } | null;
    const name = tidy(d?.supplierName);
    if (!name) {
      matched.other++;
      continue;
    }
    const vat = d?.supplierVat ? vatKey(d.supplierVat) : "";
    if (vat && known.has(vat)) matched.byVat++;
    else if (names.has(companyKey(name))) matched.byName++;
    else matched.other++;
    const key = `${name}|${vat}`;
    written.set(key, { name, vat: d?.supplierVat ?? null, lines: (written.get(key)?.lines ?? 0) + 1 });
  }
  const seen = new Set<string>([canonical.name]);
  const out: SupplierAlias[] = [];
  const add = (a: SupplierAlias) => {
    if (seen.has(a.name)) return;
    seen.add(a.name);
    out.push(a);
  };
  for (const m of members) if (m.id !== id) add({ name: m.name, source: "record", lines: linesOf(m.id), vatNumber: m.vatNumber });
  for (const a of aliases) add({ name: a.alias, source: "alias", lines: [...written.values()].filter((w) => w.name === a.alias).reduce((s, w) => s + w.lines, 0), vatNumber: null });
  for (const w of written.values()) add({ name: w.name, source: "document", lines: w.lines, vatNumber: w.vat });

  const distinct = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))];
  const docs = new Map<string, { documentId: string | null; filename: string; lines: number }>();
  for (const l of lines) if (l.filename) docs.set(l.filename, { documentId: l.documentId, filename: l.filename, lines: (docs.get(l.filename)?.lines ?? 0) + 1 });
  const nameOf = (rid: string) => rows.find((r) => r.id === rid)?.name ?? "";
  const mine = resolutions.filter((r) => ids.includes(r.supplierId) || ids.includes(r.otherId));
  return {
    canonicalId: id,
    canonicalName: canonical.name,
    aliases: out,
    vatNumbers: distinct([...members.map((m) => m.vatNumber), ...[...written.values()].map((w) => w.vat)].map((v) => (v ? vatKey(v) : null))),
    taxCodes: distinct(members.map((m) => m.taxCode)),
    domains: distinct(members.map((m) => domainOf(m))),
    // "IT" and "Italia" are the same place: one address per city and country.
    addresses: [...new Map(members.filter((m) => m.city || m.country).map((m) => [`${normalizeKey(m.city)}|${countryKey(m.country) ?? ""}`, { city: m.city, country: m.country }])).values()],
    contacts: distinct(members.flatMap((m) => [m.contactName, m.email, m.phone])),
    documents: [...docs.values()].sort((a, b) => b.lines - a.lines),
    purchases: bought.length,
    quotes: quoted.length,
    matched,
    merged: members
      .filter((m) => m.id !== id)
      .map((m) => {
        const r = mine.find((x) => x.supplierId === m.id && x.decision === "merged" && !x.undoneAt);
        return { id: m.id, name: m.name, vatNumber: m.vatNumber, lines: linesOf(m.id), basis: r?.basis ?? [], confidence: r?.confidence ?? null, decidedBy: r?.decidedBy ?? "user", at: (r?.createdAt ?? m.updatedAt).toISOString() };
      }),
    history: mine
      .filter((r) => r.decision === "separate" || r.undoneAt)
      .map((r) => ({ name: nameOf(ids.includes(r.supplierId) ? r.otherId : r.supplierId), decision: r.decision === "separate" ? ("separate" as const) : ("merged" as const), decidedBy: r.decidedBy, at: r.createdAt.toISOString(), undoneAt: r.undoneAt?.toISOString() ?? null })),
  };
}

// ---------------- The whole relationship, for the supplier's page ----------------

export interface SupplierRelationship {
  /** EUR in the last 12 months on file, catalogue products. */
  totalSpend: number;
  /** Everything ever bought on file, and since when. */
  historicalSpend: number;
  firstPurchase: string | null;
  byMonth: { month: string; spend: number }[];
  products: { id: string; name: string; spend: number; share: number }[];
  quotes: number;
  /** Requests for quotation the user said were sent to it. */
  requests: number;
  /** Read on its largest product: what lies beyond it, the breadth, the leverage. Null with nothing bought in the period. */
  leverage: (RelationshipLeverage & { productId: string; productName: string }) | null;
}

/**
 * What the company buys from a supplier, over every record it is known by.
 * `data` is the dataset already read on canonical suppliers; `catalogue` its
 * products to compare.
 */
export async function supplierRelationship(db: DB, supplierId: string, data: Dataset, catalogue: Pick<Dataset, "purchases" | "products">, t: T = en): Promise<SupplierRelationship> {
  const asOf = todayISO();
  const start = windowStart(asOf);
  const own = catalogue.purchases.filter((p) => p.supplierId === supplierId).filter(isPriced);
  const recent = own.filter((p) => p.date > start);
  const totalSpend = recent.reduce((s, p) => s + baseTotal(p), 0);
  const byProduct = new Map<string, number>();
  for (const p of recent) byProduct.set(p.productId, (byProduct.get(p.productId) ?? 0) + baseTotal(p));
  const products = [...byProduct.entries()]
    .map(([id, spend]) => ({ id, name: catalogue.products.find((x) => x.id === id)?.name ?? "", spend, share: totalSpend > 0 ? spend / totalSpend : 0 }))
    .sort((a, b) => b.spend - a.spend);
  const byMonth = new Map<string, number>();
  for (const p of own) byMonth.set(p.date.slice(0, 7), (byMonth.get(p.date.slice(0, 7)) ?? 0) + baseTotal(p));
  const dates = data.purchases.map((p) => p.date).sort();
  const coverage = dates.length ? { from: dates[0], to: dates.at(-1)! } : null;
  const top = products[0];
  const facts = top ? relationshipFacts(catalogue, top.id, supplierId, asOf, coverage) : null;
  // Requests are remembered by company name: every name the supplier is known by counts.
  const { rows, canon } = await readSupplierRows(db);
  const keys = new Set(rows.filter((r) => canon.get(r.id) === supplierId).map((r) => companyKey(r.name)));
  const sent = (await db.select({ key: rfqRequests.supplierKey }).from(rfqRequests)).filter((r) => keys.has(r.key)).length;
  const name = rows.find((r) => r.id === supplierId)?.name ?? null;
  // What the user said of how much the company matters to this supplier, on its largest product.
  const [said] = top ? await db.select({ value: productDataFields.value }).from(productDataFields).where(and(eq(productDataFields.productId, top.id), eq(productDataFields.field, "buyer_importance"))) : [];
  const importance = isLevel(said?.value) ? said.value : null;
  return {
    totalSpend,
    historicalSpend: own.reduce((s, p) => s + baseTotal(p), 0),
    firstPurchase: own.map((p) => p.date).sort()[0] ?? null,
    byMonth: [...byMonth.entries()].map(([month, spend]) => ({ month, spend })).sort((a, b) => (a.month < b.month ? 1 : -1)),
    products,
    quotes: data.quotes.filter((q) => q.supplierId === supplierId).length,
    requests: sent,
    leverage: facts && top ? { ...relationshipLeverage(facts, { supplier: name, importance }, t), productId: top.id, productName: top.name } : null,
  };
}
