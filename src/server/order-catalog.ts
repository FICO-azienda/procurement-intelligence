/**
 * What a supplier makes available to order, and to whom: its articles, their
 * commercial conditions, the customers allowed. Rules that must hold:
 *
 *  - every function takes who is acting as the server established it, and
 *    answers only about that company: a supplier reads and writes its own
 *    articles and conditions, a buyer reads only what its suppliers made
 *    available to it — conditions reserved to another customer are never
 *    loaded for it;
 *  - conditions are used for orders only once an authorised person of the
 *    supplier confirmed them. What is already known — the supplier's own
 *    quotations to a customer, its invoices to that customer — is proposed to
 *    be checked, for that customer only: nothing is switched on from a
 *    document, and one customer's price is never proposed as everyone's;
 *  - a change of conditions is a new row; the one before is closed and kept;
 *  - no record of the buyer (supplier, product, purchase, quotation, reply) is
 *    written here.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import {
  notifications, orderProductBuyers, orderProducts, orderTerms, orgInvites, organizations, productAliases, products, purchases, quotes, rfqOffers, rfqThreads, suppliers, tradeRelationships,
} from "@/db/schema";
import { isStrategic } from "@/lib/catalog/kinds";
import { en, type T } from "@/lib/i18n";
import { codeKey, normalizeKey } from "@/lib/import/normalize/text";
import { parsePaymentTerms } from "@/lib/import/normalize/terms";
import {
  deliveryFromIncoterm, identityGaps, leadTimeFromDays, listingState, minimumProblem, missingTerms, paymentFromDays, type IdentityGap, type TermsProposal,
} from "@/lib/orders/ready";
import {
  EMPTY_TERMS, INCOTERMS_VERSIONS, NAMES_A_PLACE, TERM_FIELD_MISSING, isDeliveryTerm, isLeadTime, isPaymentTerm, type ListingState, type Principal, type TermField, type Terms,
} from "@/lib/orders/types";
import { ORG_REQUIREMENT_LABEL } from "@/lib/orders/ready";
import { list, lowerFirst } from "@/lib/i18n";
import { canonicalIds } from "@/lib/suppliers/resolve";
import { logEvents } from "./audit";
import { actorOf, must, readOrg, type OrgView, type RecordRef } from "./orgs";

export class OrderError extends Error {}

const num = (v: string | null) => (v == null ? null : Number(v));
const str = (v: number | null | undefined) => (v == null ? null : String(v));
const clean = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
};

export const toTerms = (r: typeof orderTerms.$inferSelect): Terms => ({
  unitPrice: num(r.unitPrice),
  currency: r.currency,
  taxesIncluded: r.taxesIncluded,
  minQuantity: num(r.minQuantity),
  quantityStep: num(r.quantityStep),
  leadTime: isLeadTime(r.leadTime) ? r.leadTime : null,
  leadTimeNote: r.leadTimeNote,
  delivery: isDeliveryTerm(r.delivery) ? r.delivery : null,
  deliveryPlace: r.deliveryPlace,
  incotermsVersion: r.incotermsVersion,
  deliveryNote: r.deliveryNote,
  transportIncluded: r.transportIncluded,
  payment: isPaymentTerm(r.payment) ? r.payment : null,
  paymentNote: r.paymentNote,
  validUntil: r.validUntil,
});

/** Conditions as typed in, tidied: what a choice does not need is dropped, so that nothing stale travels with it. */
export function tidyTerms(v: Partial<Terms>): Terms {
  const t: Terms = { ...EMPTY_TERMS, ...v };
  const positive = (n: number | null) => (n != null && Number.isFinite(n) && n > 0 ? n : null);
  const delivery = isDeliveryTerm(t.delivery) ? t.delivery : null;
  const named = !!delivery && NAMES_A_PLACE.includes(delivery);
  return {
    unitPrice: positive(t.unitPrice),
    currency: clean(t.currency)?.toUpperCase() ?? null,
    taxesIncluded: typeof t.taxesIncluded === "boolean" ? t.taxesIncluded : null,
    minQuantity: positive(t.minQuantity),
    quantityStep: positive(t.quantityStep),
    leadTime: isLeadTime(t.leadTime) ? t.leadTime : null,
    leadTimeNote: clean(t.leadTimeNote),
    delivery,
    deliveryPlace: named ? clean(t.deliveryPlace) : null,
    incotermsVersion: named && (INCOTERMS_VERSIONS as readonly string[]).includes(t.incotermsVersion ?? "") ? t.incotermsVersion : null,
    deliveryNote: delivery === "other" ? clean(t.deliveryNote) : null,
    transportIncluded: delivery === "other" && typeof t.transportIncluded === "boolean" ? t.transportIncluded : null,
    payment: isPaymentTerm(t.payment) ? t.payment : null,
    paymentNote: clean(t.paymentNote),
    validUntil: /^\d{4}-\d{2}-\d{2}$/.test(t.validUntil ?? "") ? t.validUntil : null,
  };
}

// ---------------- One supplier's articles, conditions and customers ----------------

interface World {
  org: OrgView;
  products: (typeof orderProducts.$inferSelect)[];
  /** The conditions in force: one row per article for everyone, one per article and customer when reserved. */
  terms: (typeof orderTerms.$inferSelect)[];
  buyers: (typeof orderProductBuyers.$inferSelect)[];
  relationships: { id: string; buyerOrgId: string; buyerName: string; supplierId: string | null; rfqSupplierId: string | null; ordering: string }[];
}

async function worldOf(db: DB, supplierOrgId: string): Promise<World | null> {
  const org = await readOrg(db, supplierOrgId);
  if (!org || org.kind !== "supplier") return null;
  const [items, rels] = await Promise.all([
    db.select().from(orderProducts).where(eq(orderProducts.supplierOrgId, supplierOrgId)).orderBy(orderProducts.name),
    db
      .select({ id: tradeRelationships.id, buyerOrgId: tradeRelationships.buyerOrgId, buyerName: organizations.name, supplierId: tradeRelationships.supplierId, rfqSupplierId: tradeRelationships.rfqSupplierId, ordering: tradeRelationships.ordering })
      .from(tradeRelationships)
      .innerJoin(organizations, eq(tradeRelationships.buyerOrgId, organizations.id))
      .where(eq(tradeRelationships.supplierOrgId, supplierOrgId))
      .orderBy(organizations.name),
  ]);
  const ids = items.map((p) => p.id);
  const [terms, buyers] = ids.length
    ? await Promise.all([db.select().from(orderTerms).where(and(inArray(orderTerms.orderProductId, ids), isNull(orderTerms.replacedAt))), db.select().from(orderProductBuyers).where(inArray(orderProductBuyers.orderProductId, ids))])
    : [[], []];
  return { org, products: items, terms, buyers, relationships: rels };
}

export interface TermsView {
  id: string;
  terms: Terms;
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedBy: string | null;
}
const toView = (r: typeof orderTerms.$inferSelect): TermsView => ({ id: r.id, terms: toTerms(r), confirmed: r.confirmedAt != null, confirmedAt: r.confirmedAt?.toISOString() ?? null, confirmedBy: r.confirmedBy });

const baseOf = (w: World, productId: string) => w.terms.find((r) => r.orderProductId === productId && r.relationshipId == null) ?? null;
const reservedOf = (w: World, productId: string, relationshipId: string) => w.terms.find((r) => r.orderProductId === productId && r.relationshipId === relationshipId && r.confirmedAt != null) ?? null;
const tieOf = (w: World, productId: string, relationshipId: string) => w.buyers.find((b) => b.orderProductId === productId && b.relationshipId === relationshipId) ?? null;

/** Whether a customer may see an article at all: the supplier's choice — everyone it has a channel with, or the ones it picked. */
const visibleTo = (w: World, p: World["products"][number], relationshipId: string) => p.audience !== "selected" || tieOf(w, p.id, relationshipId)?.allowed === true;

/** The conditions that hold for a customer: its own when the supplier reserved some, else those for everyone. */
function effective(w: World, productId: string, relationshipId: string | null): { row: typeof orderTerms.$inferSelect; reserved: boolean } | null {
  const own = relationshipId ? reservedOf(w, productId, relationshipId) : null;
  if (own) return { row: own, reserved: true };
  const base = baseOf(w, productId);
  return base ? { row: base, reserved: false } : null;
}

const gapsOf = (p: World["products"][number]): IdentityGap[] => identityGaps({ code: p.code, name: p.name, description: p.description, specConfirmed: p.specConfirmedAt != null });

function stateFor(w: World, p: World["products"][number], relationshipId: string | null, today: string): ListingState {
  const rel = relationshipId ? w.relationships.find((r) => r.id === relationshipId) : null;
  const e = effective(w, p.id, relationshipId);
  return listingState(
    { enabled: p.enabledAt != null, suspended: p.suspendedAt != null, blocked: rel?.ordering === "blocked", orgGaps: w.org.gaps.length, identityGaps: gapsOf(p).length, terms: e ? toTerms(e.row) : null, confirmed: e?.row.confirmedAt != null },
    today,
  );
}

// ---------------- The supplier's view ----------------

export interface PortalProduct {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  unit: string;
  specConfirmed: boolean;
  audience: "all" | "selected";
  enabled: boolean;
  suspended: boolean;
  identityGaps: IdentityGap[];
  /** The conditions for every customer allowed, and which of the six are not complete. */
  base: TermsView | null;
  missing: TermField[];
  /** For a customer on those conditions. */
  state: ListingState;
  customers: { relationshipId: string; name: string; visible: boolean; blocked: boolean; reserved: TermsView | null; state: ListingState }[];
}

export interface Portal {
  org: OrgView;
  customers: { relationshipId: string; name: string; ordering: "allowed" | "blocked" }[];
  products: PortalProduct[];
}

export async function readPortal(db: DB, who: Principal, today: string, t: T = en): Promise<Portal> {
  must(who, "supplier", null, t);
  const w = (await worldOf(db, who.orgId))!;
  return {
    org: w.org,
    customers: w.relationships.map((r) => ({ relationshipId: r.id, name: r.buyerName, ordering: r.ordering === "blocked" ? "blocked" : "allowed" })),
    products: w.products.map((p) => {
      const base = baseOf(w, p.id);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        unit: p.unit,
        specConfirmed: p.specConfirmedAt != null,
        audience: p.audience === "selected" ? "selected" : "all",
        enabled: p.enabledAt != null,
        suspended: p.suspendedAt != null,
        identityGaps: gapsOf(p),
        base: base ? toView(base) : null,
        missing: missingTerms(base ? toTerms(base) : null),
        state: stateFor(w, p, null, today),
        customers: w.relationships.map((r) => {
          const reserved = reservedOf(w, p.id, r.id);
          return { relationshipId: r.id, name: r.buyerName, visible: visibleTo(w, p, r.id), blocked: r.ordering === "blocked", reserved: reserved ? toView(reserved) : null, state: stateFor(w, p, r.id, today) };
        }),
      };
    }),
  };
}

// ---------------- The buyer's view ----------------

export interface Listing {
  orderProductId: string;
  relationshipId: string;
  supplierOrgId: string;
  supplierName: string;
  /** The buyer's own record of the company. */
  record: RecordRef | null;
  code: string | null;
  name: string;
  description: string | null;
  unit: string;
  /** The buyer's product this article is. Null: not tied to one. */
  buyerProductId: string | null;
  state: ListingState;
  /** The conditions this buyer may order on — only once the supplier confirmed them. */
  terms: Terms | null;
  termsId: string | null;
  /** Reserved to this buyer: no other customer reads them. */
  reserved: boolean;
}

/** What the buyer's suppliers made available to it — for one of its products, for one channel, or all of it. */
export async function readListings(db: DB, who: Principal, filter: { productId?: string; relationshipId?: string; orderProductId?: string }, today: string, t: T = en): Promise<Listing[]> {
  must(who, "buyer", null, t);
  const rels = (await db.select().from(tradeRelationships).where(eq(tradeRelationships.buyerOrgId, who.orgId))).filter((r) => !filter.relationshipId || r.id === filter.relationshipId);
  const out: Listing[] = [];
  for (const rel of rels) {
    const w = await worldOf(db, rel.supplierOrgId);
    if (!w) continue;
    for (const p of w.products) {
      if (filter.orderProductId && p.id !== filter.orderProductId) continue;
      if (!visibleTo(w, p, rel.id)) continue;
      const tie = tieOf(w, p.id, rel.id);
      if (filter.productId && tie?.buyerProductId !== filter.productId) continue;
      const e = effective(w, p.id, rel.id);
      const confirmed = e?.row.confirmedAt != null;
      out.push({
        orderProductId: p.id,
        relationshipId: rel.id,
        supplierOrgId: w.org.id,
        supplierName: w.org.name,
        record: rel.supplierId ? { kind: "supplier", id: rel.supplierId } : rel.rfqSupplierId ? { kind: "reply", id: rel.rfqSupplierId } : null,
        code: p.code,
        name: p.name,
        description: p.description,
        unit: p.unit,
        buyerProductId: tie?.buyerProductId ?? null,
        state: stateFor(w, p, rel.id, today),
        terms: e && confirmed ? toTerms(e.row) : null,
        termsId: e && confirmed ? e.row.id : null,
        reserved: !!e && confirmed && e.reserved,
      });
    }
  }
  return out;
}

/** The buyer says which of its own products a supplier's article is — or that it is none. Nothing else of either is changed. */
export async function tieListing(db: DB, who: Principal, orderProductId: string, buyerProductId: string | null, t: T = en): Promise<void> {
  must(who, "buyer", "channel.manage", t);
  const [listing] = await readListings(db, who, { orderProductId }, "9999-12-31", t);
  if (!listing) throw new OrderError(t("This article is not available to you."));
  if (buyerProductId && !(await db.select({ id: products.id }).from(products).where(and(eq(products.id, buyerProductId), isNull(products.mergedIntoId)))).length) throw new OrderError(t("This product is no longer on file."));
  await db.transaction(async (tx) => {
    const [tie] = await tx.select().from(orderProductBuyers).where(and(eq(orderProductBuyers.orderProductId, orderProductId), eq(orderProductBuyers.relationshipId, listing.relationshipId)));
    if (tie) await tx.update(orderProductBuyers).set({ buyerProductId, updatedAt: new Date() }).where(eq(orderProductBuyers.id, tie.id));
    else await tx.insert(orderProductBuyers).values({ orderProductId, relationshipId: listing.relationshipId, buyerProductId, allowed: true });
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: buyerProductId ? "tie_product" : "untie_product", entity: "order_product", entityId: orderProductId, oldValue: tie?.buyerProductId ?? null, newValue: buyerProductId, source: "ui" }]);
  });
}

/**
 * The buyer asks the supplier for its conditions on an article that cannot be
 * ordered yet, or to renew the ones that expired: a notification in the
 * supplier's portal. Asked once — a request still unread is not repeated.
 */
export async function askConditions(db: DB, who: Principal, orderProductId: string, t: T = en): Promise<{ asked: boolean }> {
  must(who, "buyer", "order.send", t);
  const [listing] = await readListings(db, who, { orderProductId }, new Date().toISOString().slice(0, 10), t);
  if (!listing) throw new OrderError(t("This article is not available to you."));
  if (listing.state === "order_ready") return { asked: false };
  const kind = listing.state === "expired" ? "update_requested" : "conditions_requested";
  const waiting = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.orgId, listing.supplierOrgId), eq(notifications.orderProductId, orderProductId), eq(notifications.kind, kind), isNull(notifications.readAt)));
  if (waiting.length) return { asked: false };
  await db.insert(notifications).values({ orgId: listing.supplierOrgId, kind, orderProductId, params: { company: who.orgName, product: listing.name } });
  return { asked: true };
}

// ---------------- The supplier writes ----------------

async function ownProduct(db: DB, who: Principal, id: string, t: T) {
  const [row] = await db.select().from(orderProducts).where(and(eq(orderProducts.id, id), eq(orderProducts.supplierOrgId, who.orgId)));
  if (!row) throw new OrderError(t("This article is not in your catalogue."));
  return row;
}

async function ownRelationship(db: DB, who: Principal, id: string, t: T) {
  const [row] = await db.select().from(tradeRelationships).where(and(eq(tradeRelationships.id, id), eq(tradeRelationships.supplierOrgId, who.orgId)));
  if (!row) throw new OrderError(t("This customer has no channel with your company."));
  return row;
}

export interface ProductInput {
  id?: string | null;
  code: string | null;
  name: string;
  description: string | null;
  unit: string;
  /** The person confirms that code and description say exactly which article this is. */
  specConfirmed: boolean;
  /** Born from what a customer buys: the article is tied to that customer's product from the start. */
  from?: { relationshipId: string; buyerProductId: string } | null;
}

/** An article of the supplier's catalogue. Changing what identifies it un-confirms it, unless it is confirmed again. */
export async function saveOrderProduct(db: DB, who: Principal, v: ProductInput, t: T = en): Promise<string> {
  must(who, "supplier", "terms.edit", t);
  const name = clean(v.name);
  const unit = clean(v.unit);
  if (!name) throw new OrderError(t("The article needs a name."));
  if (!unit) throw new OrderError(t("Say the unit the article is sold in."));
  const values = { code: clean(v.code), name, description: clean(v.description), unit };
  const existing = v.id ? await ownProduct(db, who, v.id, t) : null;
  // A customer's product is taken along only when it really is something this company sold to that customer.
  const from = v.from && !existing && (await catalogProposals(db, who)).some((p) => p.relationshipId === v.from!.relationshipId && p.buyerProductId === v.from!.buyerProductId) ? v.from : null;
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    if (!existing) {
      const [row] = await tx
        .insert(orderProducts)
        .values({ supplierOrgId: who.orgId, ...values, specConfirmedAt: v.specConfirmed ? new Date() : null, specConfirmedBy: v.specConfirmed ? who.name : null })
        .returning({ id: orderProducts.id });
      if (from) await tx.insert(orderProductBuyers).values({ orderProductId: row.id, relationshipId: from.relationshipId, buyerProductId: from.buyerProductId, allowed: true });
      await logEvents(txDb, actorOf(who), [{ action: "create", entity: "order_product", entityId: row.id, newValue: [values.code, values.name].filter(Boolean).join(" · "), source: "portal" }]);
      return row.id;
    }
    const fields = ["code", "name", "description", "unit"] as const;
    const changed = fields.filter((f) => (values[f] ?? null) !== (existing[f] ?? null));
    const confirmed = v.specConfirmed ? (existing.specConfirmedAt && !changed.length ? existing.specConfirmedAt : new Date()) : changed.length ? null : existing.specConfirmedAt;
    await tx.update(orderProducts).set({ ...values, specConfirmedAt: confirmed, specConfirmedBy: confirmed ? (confirmed === existing.specConfirmedAt ? existing.specConfirmedBy : who.name) : null, updatedAt: new Date() }).where(eq(orderProducts.id, existing.id));
    await logEvents(txDb, actorOf(who), [
      ...changed.map((f) => ({ action: "update", entity: "order_product", entityId: existing.id, field: f, oldValue: existing[f], newValue: values[f], source: "portal" })),
      ...((confirmed == null) !== (existing.specConfirmedAt == null) ? [{ action: confirmed ? "confirm_specification" : "unconfirm_specification", entity: "order_product", entityId: existing.id, source: "portal" }] : []),
    ]);
    return existing.id;
  });
}

const TERM_COLUMNS = ["unitPrice", "currency", "taxesIncluded", "minQuantity", "quantityStep", "leadTime", "leadTimeNote", "delivery", "deliveryPlace", "incotermsVersion", "deliveryNote", "transportIncluded", "payment", "paymentNote", "validUntil"] as const;

/**
 * The conditions of an article — for every customer allowed, or reserved to
 * one. With `confirm`, an authorised person states them and authorises order
 * requests: they must be complete, within their date, and the company and the
 * article must have what orders need; the article is then switched on.
 * Without, they are written down for later (only the conditions for everyone,
 * and only while none are in force): nothing can be ordered on them.
 */
export async function saveTerms(db: DB, who: Principal, v: { orderProductId: string; relationshipId: string | null; terms: Partial<Terms>; confirm: boolean }, today: string, t: T = en): Promise<{ termsId: string; state: ListingState }> {
  must(who, "supplier", "terms.edit", t);
  const product = await ownProduct(db, who, v.orderProductId, t);
  if (v.relationshipId) await ownRelationship(db, who, v.relationshipId, t);
  const terms = tidyTerms(v.terms);
  const wrong = minimumProblem(terms, t);
  if (wrong) throw new OrderError(wrong);
  const w = (await worldOf(db, who.orgId))!;
  const current = w.terms.find((r) => r.orderProductId === product.id && (r.relationshipId ?? null) === (v.relationshipId ?? null)) ?? null;
  if (v.confirm) {
    const missing = missingTerms(terms);
    if (missing.length) throw new OrderError(t("Still missing: {what}.", { what: list(t, missing.map((m) => t(TERM_FIELD_MISSING[m]))) }));
    if (terms.validUntil! < today) throw new OrderError(t("The validity date is already past: give the day until which this price holds."));
    if (w.org.gaps.length) throw new OrderError(t("Before orders can be switched on, your company still needs: {what}.", { what: list(t, w.org.gaps.map((g) => lowerFirst(t(ORG_REQUIREMENT_LABEL[g])))) }));
    if (gapsOf(product).length) throw new OrderError(t("This article is not precise enough to be ordered yet: complete its code and technical description, and confirm them."));
  } else {
    if (v.relationshipId) throw new OrderError(t("Conditions reserved to a customer are saved when you confirm them."));
    if (current?.confirmedAt) throw new OrderError(t("These conditions are in force: to change them, confirm the new ones."));
  }
  const now = new Date();
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    if (current) await tx.update(orderTerms).set({ replacedAt: now }).where(eq(orderTerms.id, current.id));
    const [row] = await tx
      .insert(orderTerms)
      .values({
        orderProductId: product.id, relationshipId: v.relationshipId, unitPrice: str(terms.unitPrice), currency: terms.currency, taxesIncluded: terms.taxesIncluded, minQuantity: str(terms.minQuantity), quantityStep: str(terms.quantityStep),
        leadTime: terms.leadTime, leadTimeNote: terms.leadTimeNote, delivery: terms.delivery, deliveryPlace: terms.deliveryPlace, incotermsVersion: terms.incotermsVersion, deliveryNote: terms.deliveryNote, transportIncluded: terms.transportIncluded,
        payment: terms.payment, paymentNote: terms.paymentNote, validUntil: terms.validUntil, confirmedAt: v.confirm ? now : null, confirmedBy: v.confirm ? who.name : null,
      })
      .returning({ id: orderTerms.id });
    if (v.confirm) {
      // Confirming conditions is what switches orders on; an article that was paused stays paused until it is resumed.
      if (!product.enabledAt) await tx.update(orderProducts).set({ enabledAt: now, enabledBy: who.name, updatedAt: now }).where(eq(orderProducts.id, product.id));
      if (v.relationshipId) {
        const tie = tieOf(w, product.id, v.relationshipId);
        if (!tie) await tx.insert(orderProductBuyers).values({ orderProductId: product.id, relationshipId: v.relationshipId, allowed: true });
        else if (!tie.allowed) await tx.update(orderProductBuyers).set({ allowed: true, updatedAt: now }).where(eq(orderProductBuyers.id, tie.id));
      }
    }
    const before = current ? toTerms(current) : EMPTY_TERMS;
    const entityId = v.relationshipId ? `${product.id}:${v.relationshipId}` : product.id;
    await logEvents(txDb, actorOf(who), [
      ...TERM_COLUMNS.filter((f) => (before[f] ?? null) !== (terms[f] ?? null)).map((f) => ({ action: "update", entity: "order_terms", entityId, field: f, oldValue: before[f] == null ? null : String(before[f]), newValue: terms[f] == null ? null : String(terms[f]), source: "portal" })),
      ...(v.confirm ? [{ action: "confirm_conditions", entity: "order_terms", entityId, newValue: row.id, source: "portal" }] : []),
      ...(v.confirm && !product.enabledAt ? [{ action: "enable_orders", entity: "order_product", entityId: product.id, source: "portal" }] : []),
    ]);
    const after = (await worldOf(txDb, who.orgId))!;
    return { termsId: row.id, state: stateFor(after, after.products.find((p) => p.id === product.id)!, v.relationshipId, today) };
  });
}

/** The conditions reserved to a customer are withdrawn: that customer is back on the conditions for everyone. Kept as history. */
export async function withdrawReserved(db: DB, who: Principal, orderProductId: string, relationshipId: string, t: T = en): Promise<void> {
  must(who, "supplier", "terms.edit", t);
  await ownProduct(db, who, orderProductId, t);
  await db.transaction(async (tx) => {
    const closed = await tx.update(orderTerms).set({ replacedAt: new Date() }).where(and(eq(orderTerms.orderProductId, orderProductId), eq(orderTerms.relationshipId, relationshipId), isNull(orderTerms.replacedAt))).returning({ id: orderTerms.id });
    if (closed.length) await logEvents(tx as unknown as DB, actorOf(who), [{ action: "withdraw_conditions", entity: "order_terms", entityId: `${orderProductId}:${relationshipId}`, oldValue: closed[0].id, source: "portal" }]);
  });
}

/** Pauses new orders for an article, or takes them up again. Its page, its conditions and its orders stay as they are. */
export async function setProductOrders(db: DB, who: Principal, orderProductId: string, action: "suspend" | "resume", t: T = en): Promise<void> {
  must(who, "supplier", "terms.edit", t);
  const product = await ownProduct(db, who, orderProductId, t);
  if ((action === "suspend") === (product.suspendedAt != null)) return;
  await db.transaction(async (tx) => {
    await tx.update(orderProducts).set({ suspendedAt: action === "suspend" ? new Date() : null, updatedAt: new Date() }).where(eq(orderProducts.id, product.id));
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: action === "suspend" ? "suspend_orders" : "resume_orders", entity: "order_product", entityId: product.id, source: "portal" }]);
  });
}

/** Who may order an article: every customer the company has a channel with, or only the ones listed. */
export async function setAudience(db: DB, who: Principal, orderProductId: string, audience: "all" | "selected", allowed: string[], t: T = en): Promise<void> {
  must(who, "supplier", "terms.edit", t);
  const product = await ownProduct(db, who, orderProductId, t);
  const w = (await worldOf(db, who.orgId))!;
  const chosen = new Set(allowed.filter((id) => w.relationships.some((r) => r.id === id)));
  await db.transaction(async (tx) => {
    await tx.update(orderProducts).set({ audience, updatedAt: new Date() }).where(eq(orderProducts.id, product.id));
    if (audience === "selected") {
      // Said for every customer, so that a tie made for another reason never lets anybody in.
      for (const r of w.relationships) {
        const tie = tieOf(w, product.id, r.id);
        if (tie) await tx.update(orderProductBuyers).set({ allowed: chosen.has(r.id), updatedAt: new Date() }).where(eq(orderProductBuyers.id, tie.id));
        else await tx.insert(orderProductBuyers).values({ orderProductId: product.id, relationshipId: r.id, allowed: chosen.has(r.id) });
      }
    }
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: "set_audience", entity: "order_product", entityId: product.id, oldValue: product.audience, newValue: audience === "selected" ? `selected: ${[...chosen].length}` : "all", source: "portal" }]);
  });
}

/** The supplier takes, or stops taking, order requests from one customer. */
export async function setCustomerOrdering(db: DB, who: Principal, relationshipId: string, ordering: "allowed" | "blocked", t: T = en): Promise<void> {
  must(who, "supplier", "terms.edit", t);
  const rel = await ownRelationship(db, who, relationshipId, t);
  if (rel.ordering === ordering) return;
  await db.transaction(async (tx) => {
    await tx.update(tradeRelationships).set({ ordering, updatedAt: new Date() }).where(eq(tradeRelationships.id, rel.id));
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: "set_ordering", entity: "trade_relationship", entityId: rel.id, oldValue: rel.ordering, newValue: ordering, source: "portal" }]);
  });
}

// ---------------- What is already known ----------------

/** The supplier records of the buyer a channel stands for: the company's own record and the ones read as the same company. */
async function membersOf(db: DB, supplierId: string): Promise<string[]> {
  const rows = await db.select({ id: suppliers.id, mergedIntoId: suppliers.mergedIntoId }).from(suppliers);
  const canon = canonicalIds(rows);
  const one = canon.get(supplierId) ?? supplierId;
  return rows.filter((r) => (canon.get(r.id) ?? r.id) === one).map((r) => r.id);
}

export interface CatalogProposal {
  relationshipId: string;
  customerName: string;
  /** invoice: an article this company billed to the customer · reply_offer: one it quoted to the customer. */
  source: "invoice" | "reply_offer";
  buyerProductId: string | null;
  /** As this company wrote it on its own document. */
  name: string;
  code: string | null;
  unit: string;
  date: string | null;
}

/**
 * Articles the supplier could add to its catalogue without typing them: what
 * it already billed or quoted to a customer, in its own words. Only its own
 * documents to that customer — and no price: a price is proposed later, for
 * that customer only, when conditions are written.
 */
export async function catalogProposals(db: DB, who: Principal, t: T = en): Promise<CatalogProposal[]> {
  must(who, "supplier", null, t);
  const w = (await worldOf(db, who.orgId))!;
  const known = new Set(w.products.map((p) => `${codeKey(p.code)}|${normalizeKey(p.name)}`));
  const out: CatalogProposal[] = [];
  for (const rel of w.relationships) {
    const tied = new Set(w.buyers.filter((b) => b.relationshipId === rel.id && b.buyerProductId).map((b) => b.buyerProductId!));
    if (rel.supplierId) {
      const members = await membersOf(db, rel.supplierId);
      const [bought, aliases] = await Promise.all([
        db.select({ productId: purchases.productId, date: purchases.date, unit: purchases.unit, name: products.name, kind: products.kind, mergedIntoId: products.mergedIntoId }).from(purchases).innerJoin(products, eq(purchases.productId, products.id)).where(inArray(purchases.supplierId, members)).orderBy(desc(purchases.date)),
        db.select().from(productAliases).where(inArray(productAliases.supplierId, members)).orderBy(desc(productAliases.createdAt)),
      ]);
      const seen = new Set<string>();
      for (const b of bought) {
        if (seen.has(b.productId) || b.mergedIntoId || !isStrategic(b.kind)) continue;
        seen.add(b.productId);
        if (tied.has(b.productId)) continue;
        const alias = aliases.find((a) => a.productId === b.productId);
        out.push({ relationshipId: rel.id, customerName: rel.buyerName, source: "invoice", buyerProductId: b.productId, name: alias?.alias ?? b.name, code: alias?.supplierSku ?? null, unit: b.unit, date: b.date });
      }
    }
    if (rel.rfqSupplierId) {
      const offers = await db.select({ offer: rfqOffers }).from(rfqOffers).innerJoin(rfqThreads, eq(rfqOffers.threadId, rfqThreads.id)).where(eq(rfqThreads.supplierId, rel.rfqSupplierId)).orderBy(desc(rfqOffers.createdAt));
      const seen = new Set<string>();
      for (const { offer } of offers) {
        const key = `${codeKey(offer.productCode)}|${normalizeKey(offer.productName)}`;
        if (seen.has(key) || known.has(key)) continue;
        seen.add(key);
        out.push({ relationshipId: rel.id, customerName: rel.buyerName, source: "reply_offer", buyerProductId: null, name: [offer.productName, offer.grade].filter(Boolean).join(" "), code: offer.productCode, unit: offer.unit, date: offer.offeredOn });
      }
    }
  }
  return out;
}

/**
 * Conditions the supplier already stated to a customer for this article, to
 * be checked before they are confirmed: its quotation, its invoice. Each one
 * says where it comes from and holds for that customer only.
 */
export async function termsProposals(db: DB, who: Principal, orderProductId: string, t: T = en): Promise<(TermsProposal & { customerName: string })[]> {
  must(who, "supplier", "terms.edit", t);
  const product = await ownProduct(db, who, orderProductId, t);
  const w = (await worldOf(db, who.orgId))!;
  const out: (TermsProposal & { customerName: string })[] = [];
  for (const rel of w.relationships) {
    const tie = tieOf(w, product.id, rel.id);
    if (rel.supplierId && tie?.buyerProductId) {
      const members = await membersOf(db, rel.supplierId);
      const [[quote], [bill]] = await Promise.all([
        db.select().from(quotes).where(and(eq(quotes.productId, tie.buyerProductId), inArray(quotes.supplierId, members))).orderBy(desc(quotes.date)).limit(1),
        db.select().from(purchases).where(and(eq(purchases.productId, tie.buyerProductId), inArray(purchases.supplierId, members))).orderBy(desc(purchases.date)).limit(1),
      ]);
      if (quote)
        out.push({
          kind: "recorded_quote", date: quote.date, relationshipId: rel.id, customerName: rel.buyerName, asWritten: {},
          values: { unitPrice: Number(quote.unitPrice), currency: quote.currency, ...(quote.moq ? { minQuantity: Number(quote.moq) } : {}), ...(leadTimeFromDays(quote.leadTimeDays, t) ?? {}), ...(paymentFromDays(quote.paymentTermsDays, t) ?? {}), ...(deliveryFromIncoterm(quote.incoterm, null) ?? {}), ...(quote.validUntil ? { validUntil: quote.validUntil } : {}) },
        });
      if (bill && bill.unit === product.unit)
        out.push({
          kind: "invoice", date: bill.date, relationshipId: rel.id, customerName: rel.buyerName, asWritten: {},
          values: { unitPrice: Number(bill.unitPrice), currency: bill.currency, ...(paymentFromDays(bill.paymentTermsDays, t) ?? {}), ...(deliveryFromIncoterm(bill.incoterm, null) ?? {}) },
        });
    }
    if (rel.rfqSupplierId) {
      const rows = await db.select({ offer: rfqOffers, leadTime: rfqThreads.leadTime }).from(rfqOffers).innerJoin(rfqThreads, eq(rfqOffers.threadId, rfqThreads.id)).where(eq(rfqThreads.supplierId, rel.rfqSupplierId)).orderBy(desc(rfqOffers.createdAt));
      const match = rows.find(({ offer }) => offer.unit === product.unit && ((!!codeKey(offer.productCode) && codeKey(offer.productCode) === codeKey(product.code)) || normalizeKey([offer.productName, offer.grade].filter(Boolean).join(" ")) === normalizeKey(product.name)));
      if (match) {
        const o = match.offer;
        out.push({
          kind: "reply_offer", date: o.offeredOn, relationshipId: rel.id, customerName: rel.buyerName,
          asWritten: { ...(match.leadTime ? { leadTime: match.leadTime } : {}), ...(o.paymentTerms ? { payment: o.paymentTerms } : {}), ...(o.validity && !o.validUntil ? { validity: o.validity } : {}) },
          values: { unitPrice: Number(o.unitPrice), currency: o.currency, ...(o.moq ? { minQuantity: Number(o.moq) } : {}), ...(deliveryFromIncoterm(o.incoterm, o.destination) ?? {}), ...(paymentFromDays(parsePaymentTerms(o.paymentTerms), t) ?? {}), ...(o.validUntil ? { validUntil: o.validUntil } : {}) },
        });
      }
    }
  }
  return out;
}

// ---------------- The buyer's channel with one company ----------------

export interface Channel {
  /** The company registered and the channel is open. */
  relationship: { id: string; supplierOrgId: string; name: string; vatNumber: string | null; taxCode: string | null; ordering: "allowed" | "blocked"; since: string } | null;
  /** An invitation still waiting to be accepted. Its link is not kept: only that it exists. */
  invite: { id: string; email: string; createdAt: string; expiresAt: string } | null;
  /** What the company made available to this buyer. */
  listings: Listing[];
}

/** Where the buyer stands with one company it knows: not invited, invited, or registered — and what it can order from it. */
export async function readChannel(db: DB, who: Principal, ref: RecordRef, today: string, t: T = en): Promise<Channel> {
  must(who, "buyer", null, t);
  const [rel] = await db
    .select({ rel: tradeRelationships, org: organizations })
    .from(tradeRelationships)
    .innerJoin(organizations, eq(tradeRelationships.supplierOrgId, organizations.id))
    .where(and(eq(tradeRelationships.buyerOrgId, who.orgId), ref.kind === "supplier" ? eq(tradeRelationships.supplierId, ref.id) : eq(tradeRelationships.rfqSupplierId, ref.id)));
  if (rel)
    return {
      relationship: { id: rel.rel.id, supplierOrgId: rel.org.id, name: rel.org.name, vatNumber: rel.org.vatNumber, taxCode: rel.org.taxCode, ordering: rel.rel.ordering === "blocked" ? "blocked" : "allowed", since: rel.rel.createdAt.toISOString() },
      invite: null,
      listings: await readListings(db, who, { relationshipId: rel.rel.id }, today, t),
    };
  const [invite] = await db
    .select()
    .from(orgInvites)
    .where(and(eq(orgInvites.buyerOrgId, who.orgId), ref.kind === "supplier" ? eq(orgInvites.supplierId, ref.id) : eq(orgInvites.rfqSupplierId, ref.id), isNull(orgInvites.acceptedAt), isNull(orgInvites.revokedAt)))
    .orderBy(desc(orgInvites.createdAt))
    .limit(1);
  return { relationship: null, invite: invite && invite.expiresAt > new Date() ? { id: invite.id, email: invite.email, createdAt: invite.createdAt.toISOString(), expiresAt: invite.expiresAt.toISOString() } : null, listings: [] };
}
