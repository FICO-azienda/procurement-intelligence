/**
 * The articles of the suppliers (lib/catalog/articles.ts) and the invoices,
 * built from what is on file and kept so: `syncArticles` gives every invoice
 * link, offer line and portal article its supplier's article; `syncInvoices`
 * gives every purchase with a number its invoice. Both are idempotent, logged
 * as the app's rules, and never change a value of the records they read — a
 * purchase keeps every figure it has, an offer its price and its words.
 */
import { after } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { getDb } from "@/db";
import { articleLinks, companies, importItems, importSessions, invoices, orderProducts, organizations, products, purchases, rfqOffers, rfqSuppliers, rfqThreads, supplierArticles, supplierProducts, suppliers } from "@/db/schema";
import { articleKey, linkTypeOf, type ArticleLinkType } from "@/lib/catalog/articles";
import { en, type T } from "@/lib/i18n";
import { invoiceKey } from "@/lib/import/evaluate";
import type { Actor, Compatibility } from "@/lib/replies/types";
import { logEvents } from "./audit";
import { syncCompanies } from "./companies";

const SYSTEM: Actor = { type: "system", id: "articles" };

async function companyCanon(db: DB) {
  const rows = await db.select({ id: companies.id, mergedIntoId: companies.mergedIntoId }).from(companies);
  const next = new Map(rows.map((r) => [r.id, r.mergedIntoId]));
  return (id: string | null | undefined) => {
    if (!id) return null;
    const seen = new Set<string>();
    let cur = id;
    while (next.get(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = next.get(cur)!;
    }
    return cur;
  };
}

/** Every invoice link, offer line and portal article gets its article, in one transaction. */
export async function syncArticles(db: DB): Promise<{ created: number; tied: number }> {
  await syncCompanies(db);
  const [links, offers, portal] = await Promise.all([
    db.select({ sp: supplierProducts, supplier: suppliers, product: products }).from(supplierProducts).innerJoin(suppliers, eq(supplierProducts.supplierId, suppliers.id)).innerJoin(products, eq(supplierProducts.productId, products.id)).where(isNull(supplierProducts.articleId)),
    db.select({ offer: rfqOffers, company: rfqSuppliers.companyId }).from(rfqOffers).innerJoin(rfqThreads, eq(rfqOffers.threadId, rfqThreads.id)).innerJoin(rfqSuppliers, eq(rfqThreads.supplierId, rfqSuppliers.id)).where(isNull(rfqOffers.articleId)),
    db.select({ article: orderProducts, company: organizations.companyId }).from(orderProducts).innerJoin(organizations, eq(orderProducts.supplierOrgId, organizations.id)).where(isNull(orderProducts.articleId)),
  ]);
  if (!links.length && !offers.length && !portal.length) return { created: 0, tied: 0 };
  const canon = await companyCanon(db);
  const existing = await db.select().from(supplierArticles);
  const byKey = new Map(existing.map((a) => [`${canon(a.companyId) ?? `s:${a.supplierId}`}|${a.key}`, a.id]));
  const pairs = await db.select({ supplierId: purchases.supplierId, productId: purchases.productId, date: purchases.date }).from(purchases);
  return db.transaction(async (tx) => {
    const events: Parameters<typeof logEvents>[2] = [];
    let created = 0;
    const articleFor = async (owner: { companyId: string | null; supplierId: string | null }, v: { code: string | null; name: string; unit: string | null; specs?: Record<string, string>; source: string; firstSeen: string | null; lastSeen: string | null }) => {
      const key = articleKey(v.code, v.name);
      const scope = `${canon(owner.companyId) ?? `s:${owner.supplierId}`}|${key}`;
      const known = byKey.get(scope);
      if (known) {
        // Seen again: when it was last seen moves on, nothing else.
        if (v.lastSeen) await tx.update(supplierArticles).set({ lastSeen: v.lastSeen, updatedAt: new Date() }).where(and(eq(supplierArticles.id, known)));
        return known;
      }
      const [row] = await tx.insert(supplierArticles).values({ companyId: canon(owner.companyId), supplierId: owner.supplierId, code: v.code, name: v.name, key, statedSpecs: v.specs ?? {}, unit: v.unit, source: v.source, firstSeen: v.firstSeen, lastSeen: v.lastSeen }).returning({ id: supplierArticles.id });
      byKey.set(scope, row.id);
      created++;
      events.push({ action: "create", entity: "supplier_article", entityId: row.id, newValue: v.name, field: v.source, source: "sync" });
      return row.id;
    };
    for (const { sp, supplier, product } of links) {
      // The supplier as the record it was bought from: its company is the canonical supplier's.
      const dates = pairs.filter((p) => p.supplierId === sp.supplierId && p.productId === sp.productId).map((p) => String(p.date)).sort();
      const id = await articleFor({ companyId: supplier.companyId, supplierId: supplier.id }, { code: sp.supplierSku, name: sp.supplierProductName?.trim() || product.name, unit: product.unit, specs: (sp.specs as Record<string, string> | null) ?? {}, source: "invoice", firstSeen: dates[0] ?? null, lastSeen: dates.at(-1) ?? null });
      await tx.update(supplierProducts).set({ articleId: id }).where(eq(supplierProducts.id, sp.id));
      // What an invoice the user approved says: this article is this product.
      if (dates.length) {
        const [has] = await tx.select({ id: articleLinks.id }).from(articleLinks).where(and(eq(articleLinks.articleId, id), eq(articleLinks.productId, sp.productId), eq(articleLinks.state, "active")));
        if (!has) await tx.insert(articleLinks).values({ articleId: id, productId: sp.productId, type: "identical", state: "active", decidedByType: "import", decidedBy: null, reason: null });
      }
    }
    for (const { offer, company } of offers) {
      const name = offer.grade && !offer.productName.includes(offer.grade) ? `${offer.productName} ${offer.grade}` : offer.productName;
      const seen = offer.offeredOn ? String(offer.offeredOn) : offer.createdAt.toISOString().slice(0, 10);
      const id = await articleFor({ companyId: company, supplierId: null }, { code: offer.productCode, name, unit: offer.unit, specs: offer.specs ?? {}, source: "offer", firstSeen: seen, lastSeen: seen });
      await tx.update(rfqOffers).set({ articleId: id }).where(eq(rfqOffers.id, offer.id));
      // What a person already said of this line becomes the article's memory: carried over by the app (decided_by_type
      // "system"), with the person's own words as they wrote them.
      const type = offer.productId ? linkTypeOf(offer.compatibility as Compatibility) : null;
      if (type && offer.productId) {
        const [has] = await tx.select({ id: articleLinks.id }).from(articleLinks).where(and(eq(articleLinks.articleId, id), eq(articleLinks.productId, offer.productId), eq(articleLinks.state, "active")));
        if (!has) await tx.insert(articleLinks).values({ articleId: id, productId: offer.productId, type, state: "active", decidedByType: "system", decidedBy: null, reason: offer.compatibilityNote });
      }
    }
    for (const { article, company } of portal) {
      const id = await articleFor({ companyId: company, supplierId: null }, { code: article.code, name: article.name, unit: article.unit, source: "portal", firstSeen: article.createdAt.toISOString().slice(0, 10), lastSeen: null });
      await tx.update(orderProducts).set({ articleId: id }).where(eq(orderProducts.id, article.id));
    }
    await logEvents(tx as unknown as DB, SYSTEM, events);
    return { created, tied: links.length + offers.length + portal.length };
  });
}

/**
 * A person said what an offer is to a product: the article remembers it, as a new version of what was said before
 * (the earlier stays, superseded). A compatibility that says nothing ("to analyse") withdraws the memory.
 */
export async function rememberOfferDecision(tx: DB, offerId: string, productId: string | null, compatibility: Compatibility, note: string | null, actor: Actor): Promise<void> {
  const [offer] = await tx.select({ articleId: rfqOffers.articleId }).from(rfqOffers).where(eq(rfqOffers.id, offerId));
  if (!offer?.articleId || !productId) return;
  const type = linkTypeOf(compatibility);
  const [before] = await tx.select().from(articleLinks).where(and(eq(articleLinks.articleId, offer.articleId), eq(articleLinks.productId, productId), eq(articleLinks.state, "active")));
  if (before?.type === "identical") return;
  if (before && before.type === type && (before.reason ?? null) === (note ?? null)) return;
  if (before) await tx.update(articleLinks).set({ state: type ? "superseded" : "withdrawn" }).where(eq(articleLinks.id, before.id));
  if (type) await tx.insert(articleLinks).values({ articleId: offer.articleId, productId, type, state: "active", decidedByType: actor.type, decidedBy: actor.id, reason: note, supersedesId: before?.id ?? null });
}

/** After a write that may bring new invoices, offers or articles: their articles and invoices follow. Never fails the request. */
export function keepArticlesInSync(): void {
  after(async () => {
    try {
      const db = await getDb();
      await syncArticles(db);
      await syncInvoices(db);
    } catch (err) {
      console.error("[articles]", err);
    }
  });
}

// ---------------- Reading ----------------

export interface ProductArticle {
  articleId: string;
  company: { id: string | null; name: string };
  code: string | null;
  name: string;
  source: string;
  lastSeen: string | null;
  type: ArticleLinkType | null;
  /** Who said it: an invoice approved at import, a person, the app carrying over a person's word. */
  decidedByType: string | null;
  decidedBy: string | null;
  reason: string | null;
  /** Offer lines of this article for this product, and purchases of it. */
  offers: number;
  purchases: number;
}

/**
 * The suppliers' articles of one product: the ones it is bought as (identical), and the articles of other companies a
 * person or an offer tied to it, each with what it is to the product. One product, several suppliers' articles.
 */
export async function readProductArticles(db: DB, productId: string, t: T = en): Promise<ProductArticle[]> {
  const [links, offerRows, spRows, buys] = await Promise.all([
    db.select().from(articleLinks).where(and(eq(articleLinks.productId, productId), eq(articleLinks.state, "active"))),
    db.select({ articleId: rfqOffers.articleId }).from(rfqOffers).where(eq(rfqOffers.productId, productId)),
    db.select({ articleId: supplierProducts.articleId, supplierId: supplierProducts.supplierId }).from(supplierProducts).where(eq(supplierProducts.productId, productId)),
    db.select({ supplierId: purchases.supplierId }).from(purchases).where(eq(purchases.productId, productId)),
  ]);
  const ids = [...new Set([...links.map((l) => l.articleId), ...offerRows.map((o) => o.articleId), ...spRows.map((s) => s.articleId)].filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const [articles, comps] = await Promise.all([db.select().from(supplierArticles), db.select({ id: companies.id, name: companies.name }).from(companies)]);
  const canon = await companyCanon(db);
  const name = new Map(comps.map((c) => [c.id, c.name]));
  return ids
    .map((id): ProductArticle | null => {
      const a = articles.find((x) => x.id === id);
      if (!a) return null;
      const link = links.find((l) => l.articleId === id) ?? null;
      const company = canon(a.companyId);
      const suppliersOf = spRows.filter((s) => s.articleId === id).map((s) => s.supplierId);
      return {
        articleId: id,
        company: { id: company, name: (company && name.get(company)) ?? t("Unknown company") },
        code: a.code,
        name: a.name,
        source: a.source,
        lastSeen: a.lastSeen ? String(a.lastSeen) : null,
        type: (link?.type as ArticleLinkType | undefined) ?? null,
        decidedByType: link?.decidedByType ?? null,
        decidedBy: link?.decidedBy ?? null,
        reason: link?.reason ?? null,
        offers: offerRows.filter((o) => o.articleId === id).length,
        purchases: buys.filter((b) => suppliersOf.includes(b.supplierId)).length,
      };
    })
    .filter((x): x is ProductArticle => !!x)
    .sort((x, y) => Number(y.type === "identical") - Number(x.type === "identical") || y.purchases - x.purchases || x.company.name.localeCompare(y.company.name));
}

/** What a person said before about an article, for each product: the memory a new offer line is read with. */
export async function articleMemory(db: DB, articleIds: string[]): Promise<Map<string, { productId: string; type: ArticleLinkType; decidedBy: string | null; decidedByType: string; createdAt: string; reason: string | null }[]>> {
  const out = new Map<string, { productId: string; type: ArticleLinkType; decidedBy: string | null; decidedByType: string; createdAt: string; reason: string | null }[]>();
  if (!articleIds.length) return out;
  const rows = await db.select().from(articleLinks).where(eq(articleLinks.state, "active"));
  for (const r of rows) {
    if (!articleIds.includes(r.articleId)) continue;
    out.set(r.articleId, [...(out.get(r.articleId) ?? []), { productId: r.productId, type: r.type as ArticleLinkType, decidedBy: r.decidedBy, decidedByType: r.decidedByType, createdAt: r.createdAt.toISOString(), reason: r.reason }]);
  }
  return out;
}

// ---------------- Invoices ----------------

/**
 * Every purchase with an invoice number gets its invoice: one per supplier and number (`invoiceKey`, the same the
 * import uses to recognise an invoice on file), with the document it was read from when there is one.
 */
export async function syncInvoices(db: DB): Promise<{ created: number; tied: number }> {
  const loose = await db
    .select({ id: purchases.id, supplierId: purchases.supplierId, ref: purchases.invoiceReference, date: purchases.date, documentId: importSessions.documentId })
    .from(purchases)
    .leftJoin(importItems, eq(purchases.importItemId, importItems.id))
    .leftJoin(importSessions, eq(importItems.sessionId, importSessions.id))
    .where(isNull(purchases.invoiceId));
  const todo = loose.filter((p) => p.ref?.trim());
  if (!todo.length) return { created: 0, tied: 0 };
  const known = await db.select().from(invoices);
  const byKey = new Map(known.map((i) => [invoiceKey(i.supplierId, i.number), i]));
  const groups = new Map<string, typeof todo>();
  for (const p of todo) groups.set(invoiceKey(p.supplierId, p.ref), [...(groups.get(invoiceKey(p.supplierId, p.ref)) ?? []), p]);
  return db.transaction(async (tx) => {
    let created = 0;
    const events: Parameters<typeof logEvents>[2] = [];
    for (const [key, lines] of groups) {
      let invoice = byKey.get(key);
      const date = lines.map((l) => String(l.date)).sort()[0] ?? null;
      const documentId = lines.find((l) => l.documentId)?.documentId ?? null;
      if (!invoice) {
        [invoice] = await tx.insert(invoices).values({ supplierId: lines[0].supplierId, number: lines[0].ref!.trim(), date, documentId }).returning();
        byKey.set(key, invoice);
        created++;
        events.push({ action: "create", entity: "invoice", entityId: invoice.id, newValue: invoice.number, source: "sync" });
      } else if ((date && (!invoice.date || date < String(invoice.date))) || (!invoice.documentId && documentId)) {
        await tx.update(invoices).set({ date: date && (!invoice.date || date < String(invoice.date)) ? date : invoice.date, documentId: invoice.documentId ?? documentId, updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
      }
      for (const l of lines) await tx.update(purchases).set({ invoiceId: invoice.id }).where(and(eq(purchases.id, l.id), isNull(purchases.invoiceId)));
    }
    await logEvents(tx as unknown as DB, SYSTEM, events);
    return { created, tied: todo.length };
  });
}
