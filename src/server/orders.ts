/**
 * Order requests and what becomes of them. Rules that must hold:
 *
 *  - every function takes who is acting as the server established it. An order
 *    is read and moved only by the two companies it is between: to anybody
 *    else it does not exist. A draft exists for the buyer alone;
 *  - a status changes only through a transition of lib/orders/flow.ts, checked
 *    here against the order as it is in the database at that instant: of two
 *    people moving the same order at once, one goes through and the other is
 *    told the order has moved on. An order is never confirmed twice;
 *  - the same request sent twice — a double click, a retry — is one order
 *    (`idempotency_key`);
 *  - a request is made on the conditions in force when it is sent, copied in.
 *    Once both companies said yes, the whole order is written once
 *    (`confirmed`) and nothing rewrites it: not a new price list, not this
 *    code (the database refuses too);
 *  - every movement is an event with its author and its time, only ever added;
 *  - a notification names the order and the other company — no price, no
 *    quantity — and is read only by the company it is for;
 *  - nothing here writes a purchase, a quotation, a supplier or a product, and
 *    nothing is sent outside the app.
 */
import { and, desc, eq, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { deliveryDestinations, notifications, orderEvents, orderLines, orderProducts, orderProposals, orders, organizations, tradeRelationships } from "@/db/schema";
import { en, type T } from "@/lib/i18n";
import { TRANSITIONS, actionsFor, applyChanges, changedFields, expiryFrom, needsSpecApproval, orderAmounts, readChanges, refusal, type Amounts, type OrderDraft } from "@/lib/orders/flow";
import { checkQuantity, identityGaps } from "@/lib/orders/ready";
import {
  EMPTY_TERMS, NAMES_A_PLACE, OPEN_STATUSES, ORDER_CONFIG, isNotificationKind, isOrderStatus,
  type NotificationKind, type OrderAction, type OrderStatus, type Principal, type ProposalChanges, type TermsSnapshot,
} from "@/lib/orders/types";
import { OrderError, readListings } from "./order-catalog";
import { must, type RecordRef } from "./orgs";

export { OrderError };

const num = (v: string | null) => (v == null ? null : Number(v));
const clean = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
};
const isDay = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;

export interface DestinationSnap {
  recipient: string | null;
  address: string | null;
  postalCode: string | null;
  city: string;
  province: string | null;
  country: string | null;
  unloading: string | null;
  restrictions: string | null;
  /** Whether a person had confirmed the address when the request was written. */
  confirmed: boolean;
}

const toSnap = (v: unknown): DestinationSnap => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : null);
  return { recipient: s("recipient"), address: s("address"), postalCode: s("postalCode"), city: s("city") ?? "", province: s("province"), country: s("country"), unloading: s("unloading"), restrictions: s("restrictions"), confirmed: o.confirmed === true };
};

const toTermsSnap = (v: unknown): TermsSnapshot => ({ ...EMPTY_TERMS, unit: "", termsId: null, reserved: false, ...((v && typeof v === "object" ? v : {}) as Partial<TermsSnapshot>) });

// ---------------- Notifications ----------------

async function notify(tx: Tx, orgId: string, kind: NotificationKind, v: { orderId?: string; orderProductId?: string; params: Record<string, string> }) {
  await tx.insert(notifications).values({ orgId, kind, orderId: v.orderId ?? null, orderProductId: v.orderProductId ?? null, params: v.params });
}

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  orderId: string | null;
  orderProductId: string | null;
  params: Record<string, string>;
  at: string;
  read: boolean;
}

/** What the principal's company should know, the latest first. Never another company's. */
export async function readNotifications(db: DB, who: Principal, limit = 30): Promise<NotificationView[]> {
  const rows = await db.select().from(notifications).where(eq(notifications.orgId, who.orgId)).orderBy(desc(notifications.createdAt)).limit(limit);
  return rows.filter((r) => isNotificationKind(r.kind)).map((r) => ({ id: r.id, kind: r.kind as NotificationKind, orderId: r.orderId, orderProductId: r.orderProductId, params: r.params, at: r.createdAt.toISOString(), read: r.readAt != null }));
}

/** Marks as read the notifications of the principal's company — all of them, or those of one order. */
export async function markNotificationsRead(db: DB, who: Principal, only?: { orderId?: string; orderProductId?: string }): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.orgId, who.orgId), isNull(notifications.readAt), only?.orderId ? eq(notifications.orderId, only.orderId) : undefined, only?.orderProductId ? eq(notifications.orderProductId, only.orderProductId) : undefined));
}

// ---------------- Reading ----------------

export interface OrderLine {
  orderProductId: string | null;
  buyerProductId: string | null;
  code: string | null;
  name: string;
  description: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  currency: string;
}

export interface ProposalView {
  id: string;
  changes: ProposalChanges;
  note: string | null;
  status: "pending" | "accepted" | "rejected";
  createdBy: string | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface OrderEventView {
  id: string;
  at: string;
  actorType: string;
  actorName: string | null;
  /** Which of the two companies acted. Null: the app's own rules. */
  side: "buyer" | "supplier" | null;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
}

export interface OrderView {
  id: string;
  number: string;
  status: OrderStatus;
  relationshipId: string;
  buyer: { orgId: string; name: string; vatNumber: string | null };
  supplier: { orgId: string; name: string; vatNumber: string | null };
  /** The buyer's own record of the supplier — for the buyer's pages only. */
  record: RecordRef | null;
  line: OrderLine;
  terms: TermsSnapshot;
  destination: DestinationSnap;
  destinationId: string | null;
  wantedDate: string | null;
  buyerNotes: string | null;
  transportCost: number | null;
  /** The delivery date the supplier gave, once there is one. */
  deliveryDate: string | null;
  amounts: Amounts;
  /** The changes waiting for the customer's answer, and the order as it would be with them. */
  proposal: (ProposalView & { after: OrderDraft; amountsAfter: Amounts; specChange: boolean }) | null;
  proposals: ProposalView[];
  events: OrderEventView[];
  /** The order as both companies confirmed it: written once. */
  confirmed: Record<string, unknown> | null;
  confirmedAt: string | null;
  expiresOn: string | null;
  createdBy: string | null;
  createdAt: string;
  sentAt: string | null;
  /** What the principal can still do to it. */
  can: OrderAction[];
}

const toLine = (r: LineRow): OrderLine => ({ orderProductId: r.orderProductId, buyerProductId: r.buyerProductId, code: r.code, name: r.name, description: r.description, unit: r.unit, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice), currency: r.currency });

const amountsOf = (line: Pick<OrderLine, "quantity" | "unitPrice" | "currency" | "unit">, terms: TermsSnapshot, destination: DestinationSnap, transportCost: number | null, t: T) =>
  orderAmounts({ quantity: line.quantity, unitPrice: line.unitPrice, currency: line.currency, unit: line.unit, terms, destinationCity: destination.city || null, transportCost }, t);

const toProposal = (p: typeof orderProposals.$inferSelect): ProposalView => ({
  id: p.id, changes: readChanges(p.changes), note: p.note, status: p.status === "accepted" || p.status === "rejected" ? p.status : "pending", createdBy: p.createdBy, createdAt: p.createdAt.toISOString(),
  decidedBy: p.decidedBy, decidedAt: p.decidedAt?.toISOString() ?? null, decisionNote: p.decisionNote,
});

/** Whether an order is this principal's company's to see: one of the two it is between — and a draft only its writer's side. */
const mine = (o: OrderRow, who: Principal) => (who.side === "buyer" ? o.buyerOrgId === who.orgId : o.supplierOrgId === who.orgId && o.status !== "draft");

async function views(db: DB, who: Principal, rows: OrderRow[], detail: boolean, t: T): Promise<OrderView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const orgIds = [...new Set(rows.flatMap((r) => [r.buyerOrgId, r.supplierOrgId]))];
  const [lines, props, events, orgs, rels] = await Promise.all([
    db.select().from(orderLines).where(inArray(orderLines.orderId, ids)).orderBy(orderLines.position),
    db.select().from(orderProposals).where(inArray(orderProposals.orderId, ids)).orderBy(desc(orderProposals.createdAt)),
    detail ? db.select().from(orderEvents).where(inArray(orderEvents.orderId, ids)).orderBy(orderEvents.at) : Promise.resolve([]),
    db.select().from(organizations).where(inArray(organizations.id, orgIds)),
    who.side === "buyer" ? db.select().from(tradeRelationships).where(eq(tradeRelationships.buyerOrgId, who.orgId)) : Promise.resolve([]),
  ]);
  const org = (id: string) => {
    const o = orgs.find((x) => x.id === id)!;
    return { orgId: o.id, name: o.name, vatNumber: o.vatNumber };
  };
  return rows.flatMap((r) => {
    const row = lines.find((l) => l.orderId === r.id);
    if (!row || !isOrderStatus(r.status)) return [];
    const line = toLine(row);
    const terms = toTermsSnap(r.terms);
    const destination = toSnap(r.destination);
    const transportCost = num(r.transportCost);
    const all = props.filter((p) => p.orderId === r.id).map(toProposal);
    const pending = r.status === "pending_buyer_approval" ? (all.find((p) => p.status === "pending") ?? null) : null;
    const after = pending ? applyChanges({ line, terms, transportCost, deliveryDate: r.deliveryDate }, pending.changes) : null;
    const rel = rels.find((x) => x.id === r.relationshipId);
    return [
      {
        id: r.id,
        number: r.number,
        status: r.status,
        relationshipId: r.relationshipId,
        buyer: org(r.buyerOrgId),
        supplier: org(r.supplierOrgId),
        record: rel?.supplierId ? { kind: "supplier", id: rel.supplierId } : rel?.rfqSupplierId ? { kind: "reply", id: rel.rfqSupplierId } : null,
        // The buyer's own product is the buyer's business: the supplier is not told which it is.
        line: who.side === "supplier" ? { ...line, buyerProductId: null } : line,
        terms,
        destination,
        destinationId: who.side === "buyer" ? r.destinationId : null,
        wantedDate: r.wantedDate,
        buyerNotes: r.buyerNotes,
        transportCost,
        deliveryDate: r.deliveryDate,
        amounts: amountsOf(line, terms, destination, transportCost, t),
        proposal: pending && after ? { ...pending, after, amountsAfter: amountsOf(after.line, after.terms, destination, after.transportCost, t), specChange: needsSpecApproval(pending.changes) } : null,
        proposals: all,
        events: events
          .filter((e) => e.orderId === r.id)
          .map((e) => ({ id: e.id, at: e.at.toISOString(), actorType: e.actorType, actorName: e.actorName, side: e.actorOrgId === r.buyerOrgId ? ("buyer" as const) : e.actorOrgId === r.supplierOrgId ? ("supplier" as const) : null, action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note })),
        confirmed: r.confirmed,
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
        expiresOn: r.expiresOn,
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
        can: actionsFor(r.status, who),
      } satisfies OrderView,
    ];
  });
}

/** The orders of the principal's company, the latest first. A supplier never sees a draft. */
export async function readOrders(db: DB, who: Principal, today: string, t: T = en): Promise<OrderView[]> {
  await expireDue(db, today);
  const rows = await db.select().from(orders).where(who.side === "buyer" ? eq(orders.buyerOrgId, who.orgId) : eq(orders.supplierOrgId, who.orgId)).orderBy(desc(orders.createdAt));
  return views(db, who, rows.filter((r) => mine(r, who)), false, t);
}

/** One order, with its history — or null when it is not this company's: it is not said whether it exists. */
export async function readOrder(db: DB, who: Principal, id: string, today: string, t: T = en): Promise<OrderView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await expireDue(db, today);
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row || !mine(row, who)) return null;
  return (await views(db, who, [row], true, t))[0] ?? null;
}

// ---------------- Moving an order ----------------

async function load(db: DB | Tx, who: Principal, id: string, t: T): Promise<{ order: OrderRow; line: LineRow }> {
  const [order] = /^[0-9a-f-]{36}$/i.test(id) ? await db.select().from(orders).where(eq(orders.id, id)) : [];
  const [line] = order ? await db.select().from(orderLines).where(eq(orderLines.orderId, order.id)).orderBy(orderLines.position).limit(1) : [];
  if (!order || !line || !mine(order, who)) throw new OrderError(t("This order does not exist, or is not your company's."));
  return { order, line };
}

/**
 * One transition: allowed for this person on the order as it is, then written
 * only if the order is still as it was read (status and version). The event
 * goes in the same transaction.
 */
async function move(tx: Tx, order: OrderRow, action: OrderAction, who: Principal | "system", patch: Partial<typeof orders.$inferInsert>, event: { note?: string | null; data?: Record<string, unknown> }, t: T): Promise<OrderStatus> {
  if (!isOrderStatus(order.status)) throw new OrderError(t("This order cannot be changed."));
  const why = refusal(action, order.status, who, t);
  if (why) throw new OrderError(why);
  const to = TRANSITIONS[action].to;
  const moved = await tx
    .update(orders)
    .set({ ...patch, status: to, version: order.version + 1, updatedAt: new Date() })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status), eq(orders.version, order.version)))
    .returning({ id: orders.id });
  if (!moved.length) throw new OrderError(t("The order has moved on in the meantime: it can no longer be changed this way."));
  await tx.insert(orderEvents).values({
    orderId: order.id,
    actorType: who === "system" ? "system" : who.actorType,
    actorOrgId: who === "system" ? null : who.orgId,
    actorUserId: who === "system" ? null : who.userId,
    actorName: who === "system" ? null : who.name,
    action,
    fromStatus: order.status,
    toStatus: to,
    note: event.note ?? null,
    data: event.data ?? null,
  });
  return to;
}

/** Requests nobody answered in time lapse by themselves: the app's own doing, said as such, and both companies are told. */
export async function expireDue(db: DB, today: string, t: T = en): Promise<number> {
  const due = await db.select().from(orders).where(and(inArray(orders.status, [...OPEN_STATUSES]), lt(orders.expiresOn, today)));
  let n = 0;
  for (const order of due) {
    try {
      await db.transaction(async (tx) => {
        await move(tx, order, "expire", "system", {}, {}, t);
        for (const orgId of [order.buyerOrgId, order.supplierOrgId]) await notify(tx, orgId, "order_expired", { orderId: order.id, params: { number: order.number } });
      });
      n++;
    } catch (err) {
      // Somebody moved it at the same instant: then it did not lapse.
      if (!(err instanceof OrderError)) throw err;
    }
  }
  return n;
}

async function names(db: DB | Tx, order: Pick<OrderRow, "buyerOrgId" | "supplierOrgId">) {
  const rows = await db.select().from(organizations).where(inArray(organizations.id, [order.buyerOrgId, order.supplierOrgId]));
  const of = (id: string) => rows.find((r) => r.id === id)!;
  return { buyer: of(order.buyerOrgId), supplier: of(order.supplierOrgId) };
}

/** The order as it stands at the instant both companies have said yes: everything a later reader needs, on its own. */
function snapshot(order: OrderRow, draft: OrderDraft, companies: Awaited<ReturnType<typeof names>>, amounts: Amounts, by: Principal, how: "accepted_as_written" | "changes_accepted", at: Date, proposalId: string | null) {
  return {
    number: order.number,
    how,
    confirmedAt: at.toISOString(),
    confirmedBy: { side: by.side, company: by.orgName, name: by.name },
    buyer: { name: companies.buyer.name, vatNumber: companies.buyer.vatNumber },
    supplier: { name: companies.supplier.name, vatNumber: companies.supplier.vatNumber },
    line: draft.line,
    terms: draft.terms,
    destination: order.destination,
    wantedDate: order.wantedDate,
    deliveryDate: draft.deliveryDate,
    transportCost: draft.transportCost,
    amounts: { goods: amounts.goods, currency: amounts.currency, transport: amounts.transport, total: amounts.total, taxesIncluded: amounts.taxesIncluded },
    buyerNotes: order.buyerNotes,
    proposalId,
  };
}

// ---------------- The buyer ----------------

export interface OrderInput {
  /** Made up once by the page that sends the request: the same request sent twice is one order. */
  idempotencyKey: string;
  orderProductId: string;
  quantity: number;
  destinationId: string;
  wantedDate: string | null;
  notes: string | null;
  /** false: written down as a draft, which the supplier does not see. */
  send: boolean;
}

/**
 * A request for an article that is Order Ready for this buyer, on the
 * conditions in force at this instant. The quantity must respect the minimum
 * and its steps; the destination is one of the buyer's own.
 */
export async function createOrder(db: DB, who: Principal, v: OrderInput, today: string, t: T = en): Promise<{ id: string; number: string; status: OrderStatus; created: boolean }> {
  must(who, "buyer", "order.send", t);
  const key = clean(v.idempotencyKey);
  if (!key) throw new OrderError(t("The request could not be identified: reload the page and try again."));
  const same = async () => (await db.select().from(orders).where(and(eq(orders.buyerOrgId, who.orgId), eq(orders.idempotencyKey, key))))[0];
  const before = await same();
  if (before) return { id: before.id, number: before.number, status: before.status as OrderStatus, created: false };

  const [listing] = await readListings(db, who, { orderProductId: v.orderProductId }, today, t);
  if (!listing) throw new OrderError(t("This article is not available to you."));
  if (listing.state !== "order_ready" || !listing.terms) throw new OrderError(t("This article cannot be ordered right now: its conditions are not complete, have expired, or the supplier paused orders."));
  const terms = listing.terms;
  const quantity = checkQuantity(v.quantity, terms, listing.unit, t);
  if (!quantity.ok) throw new OrderError(quantity.message);
  const [destination] = await db.select().from(deliveryDestinations).where(eq(deliveryDestinations.id, v.destinationId));
  if (!destination) throw new OrderError(t("Choose where the goods go."));
  if (v.wantedDate != null && (!isDay(v.wantedDate) || v.wantedDate < today)) throw new OrderError(t("The delivery date wanted cannot be in the past."));

  const snap: TermsSnapshot = { ...terms, unit: listing.unit, termsId: listing.termsId, reserved: listing.reserved };
  const where: DestinationSnap = {
    recipient: destination.recipient, address: destination.address, postalCode: destination.postalCode, city: destination.city, province: destination.province, country: destination.country,
    unloading: destination.unloading, restrictions: destination.restrictions, confirmed: destination.confirmedAt != null,
  };
  const prefix = `DO-${today.slice(0, 4)}-`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [{ last }] = await tx.select({ last: sql<string | null>`max(${orders.number})` }).from(orders).where(and(eq(orders.buyerOrgId, who.orgId), like(orders.number, `${prefix}%`)));
        const number = `${prefix}${String((last ? Number(last.slice(prefix.length)) : 0) + 1).padStart(4, "0")}`;
        const [row] = await tx
          .insert(orders)
          .values({
            number, relationshipId: listing.relationshipId, buyerOrgId: who.orgId, supplierOrgId: listing.supplierOrgId, status: "draft", idempotencyKey: key, destinationId: destination.id, destination: where as unknown as Record<string, unknown>,
            wantedDate: v.wantedDate, buyerNotes: clean(v.notes), terms: snap as unknown as Record<string, unknown>, termsId: listing.termsId, createdBy: who.name,
          })
          .returning();
        await tx.insert(orderLines).values({ orderId: row.id, orderProductId: listing.orderProductId, buyerProductId: listing.buyerProductId, code: listing.code, name: listing.name, description: listing.description, unit: listing.unit, quantity: String(v.quantity), unitPrice: String(terms.unitPrice), currency: terms.currency! });
        await tx.insert(orderEvents).values({ orderId: row.id, actorType: who.actorType, actorOrgId: who.orgId, actorUserId: who.userId, actorName: who.name, action: "create", toStatus: "draft" });
        let status: OrderStatus = "draft";
        if (v.send) {
          status = await move(tx, row, "send", who, { sentAt: new Date(), expiresOn: expiryFrom(today, ORDER_CONFIG.requestExpiryDays) }, {}, t);
          await notify(tx, listing.supplierOrgId, "order_received", { orderId: row.id, params: { number, company: who.orgName } });
        }
        return { id: row.id, number, status, created: true };
      });
    } catch (err) {
      if (err instanceof OrderError) throw err;
      // The same request arrived twice at the same instant: the other one made the order.
      const twin = await same();
      if (twin) return { id: twin.id, number: twin.number, status: twin.status as OrderStatus, created: false };
      // Two requests of the same buyer took the same number: the next one is free.
      if (attempt >= 3) throw err;
    }
  }
}

/**
 * Sends a draft. A draft is not a commitment of anybody: it goes out on the
 * conditions in force now. When they changed since it was written, the draft
 * takes the new ones and is not sent — the buyer reads them first.
 */
export async function sendDraft(db: DB, who: Principal, orderId: string, today: string, t: T = en): Promise<{ sent: boolean; refreshed: boolean }> {
  must(who, "buyer", "order.send", t);
  const { order, line } = await load(db, who, orderId, t);
  const why = refusal("send", order.status as OrderStatus, who, t);
  if (why) throw new OrderError(why);
  const [listing] = line.orderProductId ? await readListings(db, who, { orderProductId: line.orderProductId }, today, t) : [];
  if (!listing || listing.state !== "order_ready" || !listing.terms) throw new OrderError(t("This article cannot be ordered right now: its conditions are not complete, have expired, or the supplier paused orders."));
  if (listing.termsId !== order.termsId) {
    const snap: TermsSnapshot = { ...listing.terms, unit: listing.unit, termsId: listing.termsId, reserved: listing.reserved };
    await db.transaction(async (tx) => {
      await tx.update(orders).set({ terms: snap as unknown as Record<string, unknown>, termsId: listing.termsId, updatedAt: new Date() }).where(and(eq(orders.id, order.id), eq(orders.status, "draft")));
      await tx.update(orderLines).set({ unitPrice: String(listing.terms!.unitPrice), currency: listing.terms!.currency!, code: listing.code, name: listing.name, description: listing.description, unit: listing.unit }).where(eq(orderLines.id, line.id));
      await tx.insert(orderEvents).values({ orderId: order.id, actorType: "system", action: "refresh_conditions", note: "The supplier's conditions changed since the draft was written." });
    });
    return { sent: false, refreshed: true };
  }
  const quantity = checkQuantity(Number(line.quantity), listing.terms, listing.unit, t);
  if (!quantity.ok) throw new OrderError(quantity.message);
  if (order.wantedDate && order.wantedDate < today) throw new OrderError(t("The delivery date wanted cannot be in the past."));
  await db.transaction(async (tx) => {
    await move(tx, order, "send", who, { sentAt: new Date(), expiresOn: expiryFrom(today, ORDER_CONFIG.requestExpiryDays) }, {}, t);
    await notify(tx, order.supplierOrgId, "order_received", { orderId: order.id, params: { number: order.number, company: who.orgName } });
  });
  return { sent: true, refreshed: false };
}

/** The buyer withdraws a request that is not an order yet. A confirmed order is not cancelled with a click. */
export async function cancelOrder(db: DB, who: Principal, orderId: string, reason: string | null, t: T = en): Promise<void> {
  must(who, "buyer", "order.send", t);
  const { order } = await load(db, who, orderId, t);
  await db.transaction(async (tx) => {
    await move(tx, order, "cancel", who, { expiresOn: null }, { note: clean(reason) }, t);
    await tx.update(orderProposals).set({ status: "rejected", decidedBy: who.name, decidedAt: new Date(), decisionNote: "cancelled" }).where(and(eq(orderProposals.orderId, order.id), eq(orderProposals.status, "pending")));
    if (order.status !== "draft") await notify(tx, order.supplierOrgId, "order_cancelled", { orderId: order.id, params: { number: order.number, company: who.orgName } });
  });
}

/** The buyer says the goods arrived. */
export async function completeOrder(db: DB, who: Principal, orderId: string, t: T = en): Promise<void> {
  must(who, "buyer", "order.send", t);
  const { order } = await load(db, who, orderId, t);
  await db.transaction(async (tx) => {
    await move(tx, order, "complete", who, {}, {}, t);
    await notify(tx, order.supplierOrgId, "order_completed", { orderId: order.id, params: { number: order.number, company: who.orgName } });
  });
}

/**
 * The buyer answers the supplier's changes. Yes: the order is confirmed as
 * changed — and when the changes bring another article, only with an approval
 * of the specification said in so many words. No: the request goes back to
 * the supplier as it was first written.
 */
export async function decideProposal(db: DB, who: Principal, orderId: string, accept: boolean, v: { specApproved?: boolean; note?: string | null }, t: T = en): Promise<OrderStatus> {
  must(who, "buyer", "order.send", t);
  const { order, line } = await load(db, who, orderId, t);
  const [proposal] = await db.select().from(orderProposals).where(and(eq(orderProposals.orderId, order.id), eq(orderProposals.status, "pending"))).orderBy(desc(orderProposals.createdAt)).limit(1);
  if (!proposal) throw new OrderError(t("There are no changes waiting for your answer on this order."));
  const changes = readChanges(proposal.changes);
  const decided = { decidedBy: who.name, decidedAt: new Date(), decisionNote: clean(v.note) };
  if (!accept) {
    return db.transaction(async (tx) => {
      const to = await move(tx, order, "reject_changes", who, {}, { note: clean(v.note), data: { proposalId: proposal.id } }, t);
      await tx.update(orderProposals).set({ ...decided, status: "rejected" }).where(eq(orderProposals.id, proposal.id));
      await notify(tx, order.supplierOrgId, "changes_rejected", { orderId: order.id, params: { number: order.number, company: who.orgName } });
      return to;
    });
  }
  if (needsSpecApproval(changes) && v.specApproved !== true) throw new OrderError(t("These changes bring another article: approve its specification in so many words before accepting."));
  const destination = toSnap(order.destination);
  const draft = applyChanges({ line: toLine(line), terms: toTermsSnap(order.terms), transportCost: num(order.transportCost), deliveryDate: order.deliveryDate }, changes);
  const amounts = amountsOf(draft.line, draft.terms, destination, draft.transportCost, t);
  const companies = await names(db, order);
  const at = new Date();
  return db.transaction(async (tx) => {
    const to = await move(
      tx,
      order,
      "accept_changes",
      who,
      {
        terms: draft.terms as unknown as Record<string, unknown>, transportCost: draft.transportCost == null ? null : String(draft.transportCost), deliveryDate: draft.deliveryDate, expiresOn: null, confirmedAt: at,
        confirmed: snapshot(order, draft, companies, amounts, who, "changes_accepted", at, proposal.id) as unknown as Record<string, unknown>,
      },
      { note: clean(v.note), data: { proposalId: proposal.id, specApproved: needsSpecApproval(changes) ? true : undefined } },
      t,
    );
    await tx.update(orderLines).set({ orderProductId: draft.line.orderProductId, code: draft.line.code, name: draft.line.name, description: draft.line.description, unit: draft.line.unit, quantity: String(draft.line.quantity), unitPrice: String(draft.line.unitPrice) }).where(eq(orderLines.id, line.id));
    await tx.update(orderProposals).set({ ...decided, status: "accepted" }).where(eq(orderProposals.id, proposal.id));
    await notify(tx, order.supplierOrgId, "changes_accepted", { orderId: order.id, params: { number: order.number, company: who.orgName } });
    return to;
  });
}

// ---------------- The supplier ----------------

/**
 * The supplier accepts a request as it was written: the order is confirmed.
 * What the request leaves open must be closed in so many words — that the
 * price holds delivered to the customer's destination — and a delivery date
 * later than the one asked is a change, not an acceptance.
 */
export async function acceptOrder(db: DB, who: Principal, orderId: string, v: { deliveryDate?: string | null; transportConfirmed?: boolean }, today: string, t: T = en): Promise<void> {
  must(who, "supplier", "order.respond", t);
  const { order, line } = await load(db, who, orderId, t);
  const why = refusal("accept", order.status as OrderStatus, who, t);
  if (why) throw new OrderError(why);
  const terms = toTermsSnap(order.terms);
  const destination = toSnap(order.destination);
  let transportCost = num(order.transportCost);
  if (amountsOf(toLine(line), terms, destination, transportCost, t).open.length) {
    if (v.transportConfirmed !== true) throw new OrderError(t("Your conditions do not cover transport to {where}: confirm that the price holds delivered there, or propose a change.", { where: destination.city }));
    transportCost = 0;
  }
  const given = clean(v.deliveryDate);
  if (given && (!isDay(given) || given < today)) throw new OrderError(t("The delivery date cannot be in the past."));
  if (given && order.wantedDate && given > order.wantedDate) throw new OrderError(t("The customer asked for delivery by {date}: a later date is a change — use “Propose changes”.", { date: order.wantedDate }));
  const deliveryDate = given ?? order.wantedDate ?? null;
  if (!deliveryDate && terms.leadTime === "on_schedule") throw new OrderError(t("Your lead time is “on schedule”: say the delivery date."));
  const draft: OrderDraft = { line: toLine(line), terms, transportCost, deliveryDate };
  const amounts = amountsOf(draft.line, terms, destination, transportCost, t);
  const companies = await names(db, order);
  const at = new Date();
  await db.transaction(async (tx) => {
    await move(
      tx,
      order,
      "accept",
      who,
      { transportCost: transportCost == null ? null : String(transportCost), deliveryDate, expiresOn: null, confirmedAt: at, confirmed: snapshot(order, draft, companies, amounts, who, "accepted_as_written", at, null) as unknown as Record<string, unknown> },
      { data: { deliveryDate, transportConfirmed: v.transportConfirmed === true ? true : undefined } },
      t,
    );
    await notify(tx, order.buyerOrgId, "order_accepted", { orderId: order.id, params: { number: order.number, company: who.orgName } });
  });
}

/**
 * The supplier proposes changes: nothing is confirmed, the customer answers.
 * A proposal must change something, close what the request left open, and —
 * when it brings another article — bring one of the supplier's own that says
 * exactly what it is.
 */
export async function proposeChanges(db: DB, who: Principal, orderId: string, raw: unknown, note: string | null, today: string, t: T = en): Promise<void> {
  must(who, "supplier", "order.respond", t);
  const { order, line } = await load(db, who, orderId, t);
  const why = refusal("propose", order.status as OrderStatus, who, t);
  if (why) throw new OrderError(why);
  const changes = readChanges(raw);
  const current = toLine(line);
  const terms = toTermsSnap(order.terms);
  if (changes.unitPrice === current.unitPrice) delete changes.unitPrice;
  if (changes.quantity === current.quantity) delete changes.quantity;
  if (changes.deliveryDate && changes.deliveryDate < today) throw new OrderError(t("The delivery date cannot be in the past."));
  if (changes.delivery && NAMES_A_PLACE.includes(changes.delivery.term) && !changes.delivery.place) throw new OrderError(t("These delivery terms name a place: say which."));
  if (changes.delivery?.term === "other" && !changes.delivery.note) throw new OrderError(t("Say what the delivery terms are."));
  if (changes.payment?.term === "other" && !changes.payment.note) throw new OrderError(t("Say what the payment terms are."));
  if (changes.product) {
    // The article proposed is read from the supplier's own catalogue, never taken as the page sent it.
    const [other] = await db.select().from(orderProducts).where(and(eq(orderProducts.id, changes.product.orderProductId), eq(orderProducts.supplierOrgId, who.orgId)));
    if (!other || other.id === current.orderProductId) throw new OrderError(t("Choose another article of your catalogue."));
    if (identityGaps({ code: other.code, name: other.name, description: other.description, specConfirmed: other.specConfirmedAt != null }).length) throw new OrderError(t("This article is not precise enough to be proposed: complete its code and technical description first."));
    changes.product = { orderProductId: other.id, code: other.code, name: other.name, description: other.description, unit: other.unit };
  }
  if (!changedFields(changes).length) throw new OrderError(t("Say what you would change."));
  const after = applyChanges({ line: current, terms, transportCost: num(order.transportCost), deliveryDate: order.deliveryDate }, changes);
  const open = amountsOf(after.line, after.terms, toSnap(order.destination), after.transportCost, t).open;
  if (open.length) throw new OrderError(t("State the transport for this order — zero if it is in the price: {why}", { why: open[0] }));
  await db.transaction(async (tx) => {
    await move(tx, order, "propose", who, { expiresOn: expiryFrom(today, ORDER_CONFIG.requestExpiryDays) }, { note: clean(note), data: { fields: changedFields(changes) } }, t);
    await tx.insert(orderProposals).values({ orderId: order.id, changes: changes as unknown as Record<string, unknown>, note: clean(note), createdBy: who.name });
    await notify(tx, order.buyerOrgId, "changes_proposed", { orderId: order.id, params: { number: order.number, company: who.orgName } });
  });
}

/** The supplier declines a request, and says why. */
export async function rejectOrder(db: DB, who: Principal, orderId: string, reason: string, t: T = en): Promise<void> {
  must(who, "supplier", "order.respond", t);
  const { order } = await load(db, who, orderId, t);
  const said = clean(reason);
  if (!said) throw new OrderError(t("Say why you decline: your customer reads it."));
  await db.transaction(async (tx) => {
    await move(tx, order, "reject", who, { expiresOn: null }, { note: said }, t);
    await notify(tx, order.buyerOrgId, "order_rejected", { orderId: order.id, params: { number: order.number, company: who.orgName } });
  });
}

/** How many orders wait for the principal's company to do something. */
export async function pendingCount(db: DB, who: Principal): Promise<number> {
  const waiting: OrderStatus = who.side === "supplier" ? "pending_supplier" : "pending_buyer_approval";
  const rows = await db.select({ id: orders.id }).from(orders).where(and(who.side === "supplier" ? eq(orders.supplierOrgId, who.orgId) : eq(orders.buyerOrgId, who.orgId), or(eq(orders.status, waiting))));
  return rows.length;
}
