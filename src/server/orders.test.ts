/**
 * Direct Order on a real in-memory Postgres, end to end: a supplier is
 * invited and registers, gives its company data once, opens an article,
 * states the six conditions and switches orders on; the buyer requests an
 * order, the supplier accepts it, both see it, the buyer orders again on the
 * conditions of the day. Then everything that must be refused. Every company,
 * person, article and price here is a mock.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { reorderNotes } from "@/lib/orders/flow";
import { EMPTY_TERMS, PERMISSIONS, type Principal, type Terms } from "@/lib/orders/types";
import { AuthError, principalOf, signIn, startSession } from "./auth";
import type { Mail, Mailer } from "./mail";
import { askConditions, catalogProposals, readListings, readPortal, saveOrderProduct, saveTerms, setAudience, setCustomerOrdering, setProductOrders, termsProposals, tieListing, withdrawReserved } from "./order-catalog";
import { acceptOrder, cancelOrder, completeOrder, createOrder, decideProposal, expireDue, markNotificationsRead, pendingCount, proposeChanges, readNotifications, readOrder, readOrders, rejectOrder, sendDraft } from "./orders";
import { OrgError, acceptConditions, acceptInvite, addUser, ensureWorkspaceOrg, inviteCompany, readInvite, readOrg, sendEmailCode, verifyEmailCode } from "./orgs";

let db: DB;
const TODAY = "2026-10-12";
const PASSWORD = "mock-password-1";
const ids: Record<string, string> = {};
let buyer: Principal;
let seller: Principal;
let rival: Principal;
let otherBuyer: Principal;

/** A mock mailer: it keeps what it was asked to send, and sends nothing. */
const sent: Mail[] = [];
const mockMailer: Mailer = { name: "mock", send: async (mail) => void sent.push(mail) };

const TERMS: Terms = {
  ...EMPTY_TERMS, unitPrice: 1.45, currency: "EUR", taxesIncluded: false, minQuantity: 1000, quantityStep: 500, leadTime: "7_14", delivery: "DAP", deliveryPlace: "Mock Town", incotermsVersion: "2020",
  payment: "30_days", validUntil: "2026-12-31",
};

const counts = async () => ({
  purchases: (await db.select().from(schema.purchases)).length,
  quotes: (await db.select().from(schema.quotes)).length,
  suppliers: (await db.select().from(schema.suppliers)).length,
  products: (await db.select().from(schema.products)).length,
  candidates: (await db.select().from(schema.supplierCandidates)).length,
  replies: (await db.select().from(schema.rfqSuppliers)).length,
  offers: (await db.select().from(schema.rfqOffers)).length,
  directory: (await db.select().from(schema.marketSuppliers)).length,
});
let before: Awaited<ReturnType<typeof counts>>;

const key = () => crypto.randomUUID();
const request = (over: Partial<Parameters<typeof createOrder>[2]> = {}) => createOrder(db, buyer, { idempotencyKey: key(), orderProductId: ids.article, quantity: 22000, destinationId: ids.destination, wantedDate: null, notes: null, send: true, ...over }, TODAY);
const listing = async (who: Principal = buyer, today = TODAY) => (await readListings(db, who, { orderProductId: ids.article }, today))[0];
/** A second registered supplier, to check that one never reads the other. */
async function register(supplierId: string, company: string, email: string): Promise<Principal> {
  const invite = await inviteCompany(db, buyer, { kind: "supplier", id: supplierId }, email);
  const made = await acceptInvite(db, invite.token, { register: { companyName: company, vatNumber: "IT00000000009", taxCode: null, address: "9 Mock Road", postalCode: "00009", city: "Mock City", province: null, country: "Italy", userName: "Mock Person", email, password: PASSWORD } });
  return (await principalOf(db, (await startSession(db, made.userId!, made.orgId)).token, "supplier"))!;
}

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.settings).values({ id: 1, companyName: "Mock Buyer S.r.l.", country: "Italy", vatNumber: "IT00000000000", userName: "Mock User", directOrder: true });
  const [wax] = await db.insert(schema.suppliers).values({ name: "Mock Wax Supplier S.p.A.", country: "Italy", vatNumber: "IT00000000001" }).returning();
  const [other] = await db.insert(schema.suppliers).values({ name: "Mock Rival Supplier GmbH", country: "Germany" }).returning();
  const [paraffin] = await db.insert(schema.products).values({ name: "Mock paraffin 52/54", sku: "PAR-5254", unit: "kg", kind: "direct_material" }).returning();
  const [freight] = await db.insert(schema.products).values({ name: "Mock transport", sku: "TR", unit: "pcs", kind: "logistics" }).returning();
  await db.insert(schema.purchases).values([
    { productId: paraffin.id, supplierId: wax.id, date: "2026-09-21", quantity: "22000", unit: "kg", unitPrice: "1.48", totalAmount: "32560", paymentTermsDays: 60, originalDescription: "MOCK PARAFFIN FULLY REFINED 52/54" },
    { productId: freight.id, supplierId: wax.id, date: "2026-09-21", quantity: "1", unit: "pcs", unitPrice: "300", totalAmount: "300" },
  ]);
  await db.insert(schema.productAliases).values({ productId: paraffin.id, supplierId: wax.id, alias: "MOCK PARAFFIN FULLY REFINED 52/54", normalized: "mock paraffin fully refined 52 54", supplierSku: "MW-5254" });
  const [destination] = await db.insert(schema.deliveryDestinations).values({ city: "Mock Town", country: "Italy", isDefault: true }).returning();
  const [elsewhere] = await db.insert(schema.deliveryDestinations).values({ city: "Another Mock Town", country: "Italy" }).returning();
  const [reply] = await db.insert(schema.rfqSuppliers).values({ name: "Mock Wicks GmbH", country: "Germany", email: "sales@mockwicks.example" }).returning();
  const [thread] = await db.insert(schema.rfqThreads).values({ supplierId: reply.id, reference: "MOCK-RFQ-1", status: "quote_received", leadTime: "about three weeks" }).returning();
  await db.insert(schema.rfqOffers).values({ threadId: thread.id, key: "wick-12", productName: "Mock wick", grade: "12", productCode: "MW-W12", unitPrice: "9.5", currency: "EUR", unit: "kg", moq: "200", incoterm: "CFR", destination: "Mock Port", paymentTerms: "30 days", offeredOn: "2026-10-01", validUntil: "2026-11-30" });
  Object.assign(ids, { wax: wax.id, rivalRecord: other.id, paraffin: paraffin.id, destination: destination.id, elsewhere: elsewhere.id, reply: reply.id });
  const org = await ensureWorkspaceOrg(db);
  buyer = { side: "buyer", orgId: org.id, orgName: org.name, userId: null, name: "Mock User", permissions: [...PERMISSIONS.buyer], actorType: "user" };
  before = await counts();
}, 30_000);

describe("1–2. a supplier is invited, registers and gives its company data once", () => {
  it("a company in the buyer's records is not a registered company", async () => {
    expect(await db.select().from(schema.organizations).where(eq(schema.organizations.kind, "supplier"))).toHaveLength(0);
    expect((await readOrg(db, buyer.orgId))?.name).toBe("Mock Buyer S.r.l.");
  });

  it("only a buyer who may manage the channel can invite, and the link is kept as a hash", async () => {
    await expect(inviteCompany(db, { ...buyer, permissions: ["order.send"] }, { kind: "supplier", id: ids.wax }, "sales@mockwax.example")).rejects.toThrow(/not allowed/);
    await expect(inviteCompany(db, buyer, { kind: "supplier", id: ids.wax }, "not an address")).rejects.toThrow(/email/);
    const first = await inviteCompany(db, buyer, { kind: "supplier", id: ids.wax }, "Sales@MockWax.example");
    const second = await inviteCompany(db, buyer, { kind: "supplier", id: ids.wax }, "sales@mockwax.example");
    ids.invite = second.token;
    expect((await readInvite(db, first.token))?.state).toBe("revoked");
    expect(await readInvite(db, second.token)).toMatchObject({ state: "open", companyName: "Mock Wax Supplier S.p.A.", buyerName: "Mock Buyer S.r.l.", email: "sales@mockwax.example" });
    expect(await readInvite(db, "no-such-link")).toBeNull();
    expect((await db.select().from(schema.orgInvites)).some((i) => i.tokenHash === second.token)).toBe(false);
  });

  it("accepting the invitation makes the company, its first person and the channel — and changes nothing of the buyer's records", async () => {
    const register = { companyName: "Mock Wax Supplier S.p.A.", vatNumber: "IT00000000001", taxCode: null, address: "1 Mock Road", postalCode: "00001", city: "Mock City", province: "MC", country: "Italy", userName: "Mock Seller", email: "sales@mockwax.example", password: PASSWORD };
    await expect(acceptInvite(db, ids.invite, { register: { ...register, password: "short" } })).rejects.toThrow(/at least/);
    await expect(acceptInvite(db, ids.invite, { register: { ...register, vatNumber: null } })).rejects.toThrow(/VAT number or the tax code/);
    const made = await acceptInvite(db, ids.invite, { register });
    ids.relationship = made.relationshipId;
    await expect(acceptInvite(db, ids.invite, { register: { ...register, email: "other@mockwax.example" } })).rejects.toThrow(/accepted already/);
    expect((await readInvite(db, ids.invite))?.state).toBe("accepted");
    expect(await counts()).toEqual(before);
    expect((await readNotifications(db, buyer)).map((n) => n.kind)).toEqual(["supplier_registered"]);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, made.userId!));
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("the person signs in with the password; a wrong one, or the wrong side, is nobody", async () => {
    await expect(signIn(db, "sales@mockwax.example", "wrong-password-1", "supplier")).rejects.toThrow(AuthError);
    await expect(signIn(db, "nobody@mockwax.example", PASSWORD, "supplier")).rejects.toThrow(/not right/);
    await expect(signIn(db, "sales@mockwax.example", PASSWORD, "buyer")).rejects.toThrow(/not right/);
    const session = await signIn(db, "SALES@mockwax.example", PASSWORD, "supplier");
    seller = (await principalOf(db, session.token, "supplier"))!;
    expect(seller).toMatchObject({ side: "supplier", orgName: "Mock Wax Supplier S.p.A.", name: "Mock Seller", actorType: "supplier" });
    expect(await principalOf(db, session.token, "buyer")).toBeNull();
    expect(await principalOf(db, "made-up-token", "supplier")).toBeNull();
    expect((await db.select().from(schema.authSessions)).some((s) => s.tokenHash === session.token)).toBe(false);
  });

  it("what is still missing is asked once: a verified address and the service conditions", async () => {
    expect((await readOrg(db, seller.orgId))!.gaps).toEqual(["email", "conditions"]);
  });

  it("an address is verified only with the code sent to it — and with no way to send, it is not", async () => {
    expect(await sendEmailCode(db, seller, null)).toEqual({ sent: false, to: null });
    expect((await readOrg(db, seller.orgId))!.gaps).toContain("email");
    expect(await sendEmailCode(db, seller, mockMailer)).toEqual({ sent: true, to: "sales@mockwax.example" });
    const code = /\b(\d{6})\b/.exec(sent.at(-1)!.text)![1];
    await expect(verifyEmailCode(db, seller, code === "000000" ? "111111" : "000000")).rejects.toThrow(/not the code/);
    await verifyEmailCode(db, seller, code);
    expect((await readOrg(db, seller.orgId))!.gaps).toEqual(["conditions"]);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, seller.userId!)))[0].emailCodeHash).toBeNull();
  });

  it("the conditions of the service are accepted by a named person, with the version", async () => {
    await expect(acceptConditions(db, { ...seller, permissions: ["order.respond"] })).rejects.toThrow(OrgError);
    await acceptConditions(db, seller);
    const org = (await readOrg(db, seller.orgId))!;
    expect(org.gaps).toEqual([]);
    expect(org.conditionsAccepted).toMatchObject({ by: "Mock Seller" });
  });
});

describe("3–5. the supplier opens an article, states the six conditions and switches orders on", () => {
  it("what it already billed to the customer is offered in its own words — materials only, and no price", async () => {
    const offered = await catalogProposals(db, seller);
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ source: "invoice", name: "MOCK PARAFFIN FULLY REFINED 52/54", code: "MW-5254", unit: "kg", buyerProductId: ids.paraffin });
    expect(JSON.stringify(offered)).not.toContain("1.48");
  });

  it("an article that says too little, or is not confirmed, is in the catalogue and cannot be ordered", async () => {
    ids.article = await saveOrderProduct(db, seller, { code: "MW-5254", name: "Paraffin", description: null, unit: "kg", specConfirmed: true, from: { relationshipId: ids.relationship, buyerProductId: ids.paraffin } });
    expect((await readPortal(db, seller, TODAY)).products[0].identityGaps).toEqual(["description"]);
    await expect(saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: TERMS, confirm: true }, TODAY)).rejects.toThrow(/not precise enough/);
    await saveOrderProduct(db, seller, { id: ids.article, code: "MW-5254", name: "Paraffin 52/54", description: "Fully refined paraffin wax, melting point 52–54 °C", unit: "kg", specConfirmed: false });
    expect((await readPortal(db, seller, TODAY)).products[0].identityGaps).toEqual(["confirmation"]);
    await saveOrderProduct(db, seller, { id: ids.article, code: "MW-5254", name: "Paraffin 52/54", description: "Fully refined paraffin wax, melting point 52–54 °C", unit: "kg", specConfirmed: true });
    expect((await readPortal(db, seller, TODAY)).products[0].identityGaps).toEqual([]);
    expect(await listing()).toMatchObject({ state: "catalog_ready", terms: null, buyerProductId: ids.paraffin });
  });

  it("what it stated to this customer before is proposed for this customer only, with where it comes from", async () => {
    const proposed = await termsProposals(db, seller, ids.article);
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ kind: "invoice", date: "2026-09-21", relationshipId: ids.relationship, customerName: "Mock Buyer S.r.l.", values: { unitPrice: 1.48, currency: "EUR", payment: "60_days" } });
    // Proposing is not stating: nothing is in force yet.
    expect((await readPortal(db, seller, TODAY)).products[0].base).toBeNull();
  });

  it("a field missing is named, and nothing is switched on", async () => {
    await expect(saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: { ...TERMS, validUntil: null }, confirm: true }, TODAY)).rejects.toThrow("Still missing: the price validity.");
    await saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: { ...TERMS, validUntil: null }, confirm: false }, TODAY);
    const article = (await readPortal(db, seller, TODAY)).products[0];
    expect(article).toMatchObject({ state: "catalog_ready", missing: ["validity"], enabled: false });
    // The buyer is not shown conditions nobody confirmed.
    expect(await listing()).toMatchObject({ state: "catalog_ready", terms: null });
    await expect(request()).rejects.toThrow(/cannot be ordered right now/);
  });

  it("a date already past, or a minimum that is not a whole number of steps, cannot be confirmed", async () => {
    await expect(saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: { ...TERMS, validUntil: "2026-10-01" }, confirm: true }, TODAY)).rejects.toThrow(/already past/);
    await expect(saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: { ...TERMS, quantityStep: 300 }, confirm: true }, TODAY)).rejects.toThrow(/whole number of steps/);
  });

  it("only who may change conditions can confirm them", async () => {
    await expect(saveTerms(db, { ...seller, permissions: ["order.respond"] }, { orderProductId: ids.article, relationshipId: null, terms: TERMS, confirm: true }, TODAY)).rejects.toThrow(/not allowed/);
    await expect(saveTerms(db, buyer, { orderProductId: ids.article, relationshipId: null, terms: TERMS, confirm: true }, TODAY)).rejects.toThrow(/not yours/);
  });

  it("the six conditions confirmed: Order Ready, with who confirmed and when", async () => {
    const saved = await saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: TERMS, confirm: true }, TODAY);
    expect(saved.state).toBe("order_ready");
    const article = (await readPortal(db, seller, TODAY)).products[0];
    expect(article).toMatchObject({ state: "order_ready", enabled: true, missing: [] });
    expect(article.base).toMatchObject({ confirmed: true, confirmedBy: "Mock Seller" });
    // The earlier, unconfirmed version is closed and kept.
    expect(await db.select().from(schema.orderTerms)).toHaveLength(2);
  });
});

describe("6–9. an authorised customer requests an order", () => {
  it("the customer sees the article on its own product, Order Ready, with the conditions", async () => {
    const [seen] = await readListings(db, buyer, { productId: ids.paraffin }, TODAY);
    expect(seen).toMatchObject({ state: "order_ready", supplierName: "Mock Wax Supplier S.p.A.", code: "MW-5254", unit: "kg", reserved: false, record: { kind: "supplier", id: ids.wax } });
    expect(seen.terms).toMatchObject({ unitPrice: 1.45, currency: "EUR", minQuantity: 1000, payment: "30_days" });
  });

  it("a quantity under the minimum, or off its steps, is refused", async () => {
    await expect(request({ quantity: 500 })).rejects.toThrow("The minimum order is 1000 kg.");
    await expect(request({ quantity: 1250 })).rejects.toThrow(/steps of 500 kg/);
    await expect(request({ wantedDate: "2026-10-01" })).rejects.toThrow(/in the past/);
    expect(await db.select().from(schema.orders)).toHaveLength(0);
  });

  it("the request goes out once, however many times it is sent", async () => {
    const one = key();
    const [a, b] = await Promise.all([request({ idempotencyKey: one, notes: "Mock note" }), request({ idempotencyKey: one, notes: "Mock note" })]);
    const again = await request({ idempotencyKey: one });
    expect(new Set([a.id, b.id, again.id]).size).toBe(1);
    expect([a.created, b.created, again.created].filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(schema.orders)).toHaveLength(1);
    ids.order = a.id;
    expect(a.number).toBe("DO-2026-0001");
    const order = (await readOrder(db, buyer, ids.order, TODAY))!;
    expect(order).toMatchObject({ status: "pending_supplier", expiresOn: "2026-10-26", buyerNotes: "Mock note", can: ["cancel"] });
    expect(order.amounts).toMatchObject({ goods: 31900, total: 31900, transport: { state: "included" }, open: [] });
    expect(order.terms).toMatchObject({ unitPrice: 1.45, unit: "kg", reserved: false });
  });

  it("the supplier is told — with the order's number and the customer's name, and no figure", async () => {
    const [notice] = await readNotifications(db, seller);
    expect(notice).toMatchObject({ kind: "order_received", orderId: ids.order, read: false, params: { number: "DO-2026-0001", company: "Mock Buyer S.r.l." } });
    expect(JSON.stringify(notice.params)).not.toMatch(/1\.45|22000|31900/);
    expect(await pendingCount(db, seller)).toBe(1);
  });
});

describe("10–12. the supplier accepts, and both companies see the order", () => {
  it("a person who may not answer orders cannot accept", async () => {
    await expect(acceptOrder(db, { ...seller, permissions: ["terms.edit"] }, ids.order, {}, TODAY)).rejects.toThrow(/not allowed/);
    await expect(acceptOrder(db, buyer, ids.order, {}, TODAY)).rejects.toThrow(/not yours/);
  });

  it("accepting confirms the order once: a second acceptance is refused", async () => {
    const tries = await Promise.allSettled([acceptOrder(db, seller, ids.order, { deliveryDate: "2026-10-22" }, TODAY), acceptOrder(db, seller, ids.order, { deliveryDate: "2026-10-22" }, TODAY)]);
    expect(tries.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((tries.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toMatch(/moved on/);
    await expect(acceptOrder(db, seller, ids.order, {}, TODAY)).rejects.toThrow(/moved on/);
    expect((await db.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, ids.order))).filter((e) => e.action === "accept")).toHaveLength(1);
  });

  it("the customer sees it confirmed, with the date of acceptance and the conditions as accepted", async () => {
    const order = (await readOrder(db, buyer, ids.order, TODAY))!;
    expect(order).toMatchObject({ status: "confirmed", deliveryDate: "2026-10-22", expiresOn: null, can: ["complete"] });
    expect(order.confirmedAt).toBeTruthy();
    expect(order.confirmed).toMatchObject({ number: "DO-2026-0001", how: "accepted_as_written", confirmedBy: { side: "supplier", name: "Mock Seller" }, line: { quantity: 22000, unitPrice: 1.45 }, terms: { payment: "30_days" }, amounts: { total: 31900 } });
    expect((await readNotifications(db, buyer))[0]).toMatchObject({ kind: "order_accepted", orderId: ids.order });
  });

  it("both see the history, each event with its author and its time", async () => {
    for (const who of [buyer, seller]) {
      const order = (await readOrder(db, who, ids.order, TODAY))!;
      expect(order.events.map((e) => [e.action, e.side, e.actorName])).toEqual([["create", "buyer", "Mock User"], ["send", "buyer", "Mock User"], ["accept", "supplier", "Mock Seller"]]);
      expect(order.events.every((e) => !!e.at)).toBe(true);
    }
    expect((await readOrders(db, seller, TODAY)).map((o) => o.number)).toEqual(["DO-2026-0001"]);
    // The supplier is not told which of the customer's own products the article is.
    expect((await readOrder(db, seller, ids.order, TODAY))!.line.buyerProductId).toBeNull();
    expect((await readOrder(db, buyer, ids.order, TODAY))!.line.buyerProductId).toBe(ids.paraffin);
  });
});

describe("a price changed after an order was confirmed", () => {
  it("holds for new orders and does not reach the confirmed one", async () => {
    await saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: { ...TERMS, unitPrice: 1.52, payment: "60_days" }, confirm: true }, TODAY);
    expect((await listing()).terms).toMatchObject({ unitPrice: 1.52, payment: "60_days" });
    const order = (await readOrder(db, buyer, ids.order, TODAY))!;
    expect(order.line.unitPrice).toBe(1.45);
    expect(order.terms.payment).toBe("30_days");
    expect(order.confirmed).toMatchObject({ line: { unitPrice: 1.45 }, amounts: { total: 31900 } });
  });

  it("the database itself refuses to rewrite a confirmed order or an event", async () => {
    await expect(db.update(schema.orders).set({ confirmed: { tampered: true } }).where(eq(schema.orders.id, ids.order))).rejects.toThrow();
    await expect(db.execute(sql`update order_events set note = 'tampered' where order_id = ${ids.order}`)).rejects.toThrow();
    expect((await readOrder(db, buyer, ids.order, TODAY))!.confirmed).toMatchObject({ number: "DO-2026-0001" });
  });
});

describe("13–14. ordering again checks price and conditions anew", () => {
  it("the new order takes the conditions in force today, and says what changed", async () => {
    const past = (await readOrder(db, buyer, ids.order, TODAY))!;
    const now = await listing();
    const notes = reorderNotes({ unitPrice: past.line.unitPrice, currency: past.line.currency, quantity: past.line.quantity, unit: past.line.unit, terms: past.terms }, now.terms!, { price: (n, c) => `${n} ${c}` });
    expect(notes.join(" ")).toMatch(/1\.52 EUR.*1\.45 EUR/);
    expect(notes).toHaveLength(2);
    const again = await request({ quantity: past.line.quantity, destinationId: past.destinationId! });
    ids.second = again.id;
    expect(again.number).toBe("DO-2026-0002");
    const order = (await readOrder(db, buyer, again.id, TODAY))!;
    expect(order.line.unitPrice).toBe(1.52);
    expect(order.amounts.goods).toBe(33440);
  });
});

describe("a proposal of changes", () => {
  it("is never an order by itself", async () => {
    await expect(proposeChanges(db, seller, ids.second, {}, null, TODAY)).rejects.toThrow(/what you would change/);
    await expect(proposeChanges(db, seller, ids.second, { quantity: 22000 }, null, TODAY)).rejects.toThrow(/what you would change/);
    await proposeChanges(db, seller, ids.second, { quantity: 20000, deliveryDate: "2026-10-22" }, "20,000 kg available now", TODAY);
    const order = (await readOrder(db, buyer, ids.second, TODAY))!;
    expect(order.status).toBe("pending_buyer_approval");
    expect(order.confirmed).toBeNull();
    expect(order.line.quantity).toBe(22000);
    expect(order.proposal).toMatchObject({ changes: { quantity: 20000, deliveryDate: "2026-10-22" }, note: "20,000 kg available now", specChange: false, after: { line: { quantity: 20000 } }, amountsAfter: { goods: 30400 } });
    expect((await readNotifications(db, buyer))[0].kind).toBe("changes_proposed");
    // While the customer decides, the supplier can do nothing more to it.
    await expect(acceptOrder(db, seller, ids.second, {}, TODAY)).rejects.toThrow(/moved on/);
    expect(await pendingCount(db, buyer)).toBe(1);
  });

  it("refused by the customer, the request is back with the supplier as first written", async () => {
    expect(await decideProposal(db, buyer, ids.second, false, { note: "We need all of it" })).toBe("pending_supplier");
    const order = (await readOrder(db, seller, ids.second, TODAY))!;
    expect(order).toMatchObject({ status: "pending_supplier", proposal: null });
    expect(order.line.quantity).toBe(22000);
    expect((await readNotifications(db, seller))[0].kind).toBe("changes_rejected");
  });

  it("another article needs the customer's approval of the specification, in so many words", async () => {
    ids.other = await saveOrderProduct(db, seller, { code: "MW-5658", name: "Paraffin 56/58", description: "Fully refined paraffin wax, melting point 56–58 °C", unit: "kg", specConfirmed: true });
    ids.vague = await saveOrderProduct(db, seller, { code: null, name: "Wax", description: null, unit: "kg", specConfirmed: false });
    await expect(proposeChanges(db, seller, ids.second, { product: { orderProductId: ids.vague, name: "Wax", unit: "kg" } }, null, TODAY)).rejects.toThrow(/not precise enough/);
    // What the page sends about the article is not taken at its word: it is read from the catalogue.
    await proposeChanges(db, seller, ids.second, { product: { orderProductId: ids.other, name: "Something else entirely", unit: "t" }, unitPrice: 1.55 }, null, TODAY);
    const pending = (await readOrder(db, buyer, ids.second, TODAY))!;
    expect(pending.proposal).toMatchObject({ specChange: true, after: { line: { code: "MW-5658", name: "Paraffin 56/58", unit: "kg", unitPrice: 1.55 } } });
    await expect(decideProposal(db, buyer, ids.second, true, {})).rejects.toThrow(/approve its specification/);
    expect(await decideProposal(db, buyer, ids.second, true, { specApproved: true })).toBe("confirmed");
    const order = (await readOrder(db, seller, ids.second, TODAY))!;
    expect(order).toMatchObject({ status: "confirmed", line: { code: "MW-5658", unitPrice: 1.55, quantity: 22000 } });
    expect(order.confirmed).toMatchObject({ how: "changes_accepted", confirmedBy: { side: "buyer" }, line: { code: "MW-5658" } });
    expect((await readNotifications(db, seller))[0].kind).toBe("changes_accepted");
    await expect(decideProposal(db, buyer, ids.second, true, { specApproved: true })).rejects.toThrow(/no changes waiting/);
  });
});

describe("declining, cancelling, receiving", () => {
  it("the supplier declines with a reason, and the customer is told", async () => {
    const order = await request();
    await expect(rejectOrder(db, seller, order.id, "  ")).rejects.toThrow(/why you decline/);
    await rejectOrder(db, seller, order.id, "No stock this month");
    const seen = (await readOrder(db, buyer, order.id, TODAY))!;
    expect(seen).toMatchObject({ status: "rejected", can: [] });
    expect(seen.events.at(-1)).toMatchObject({ action: "reject", note: "No stock this month", side: "supplier" });
    expect((await readNotifications(db, buyer))[0].kind).toBe("order_rejected");
  });

  it("the customer cancels a request that is not an order yet — never a confirmed one", async () => {
    const order = await request();
    await cancelOrder(db, buyer, order.id, null);
    expect((await readOrder(db, seller, order.id, TODAY))!.status).toBe("cancelled");
    expect((await readNotifications(db, seller))[0].kind).toBe("order_cancelled");
    await expect(cancelOrder(db, buyer, ids.order, null)).rejects.toThrow(/moved on/);
    await expect(cancelOrder(db, seller, order.id, null)).rejects.toThrow(/not yours/);
  });

  it("the customer marks a confirmed order as received", async () => {
    await completeOrder(db, buyer, ids.order);
    expect((await readOrder(db, seller, ids.order, TODAY))!.status).toBe("completed");
    await expect(completeOrder(db, buyer, ids.order)).rejects.toThrow(/moved on/);
  });

  it("a draft is the customer's alone, and goes out on the conditions of the day it is sent", async () => {
    const draft = await request({ send: false });
    expect(draft.status).toBe("draft");
    expect(await readOrder(db, seller, draft.id, TODAY)).toBeNull();
    expect((await readOrders(db, seller, TODAY)).some((o) => o.id === draft.id)).toBe(false);
    await saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: { ...TERMS, unitPrice: 1.5 }, confirm: true }, TODAY);
    expect(await sendDraft(db, buyer, draft.id, TODAY)).toEqual({ sent: false, refreshed: true });
    expect((await readOrder(db, buyer, draft.id, TODAY))!).toMatchObject({ status: "draft", line: { unitPrice: 1.5 } });
    expect(await sendDraft(db, buyer, draft.id, TODAY)).toEqual({ sent: true, refreshed: false });
    expect((await readOrder(db, seller, draft.id, TODAY))!.status).toBe("pending_supplier");
    await cancelOrder(db, buyer, draft.id, null);
  });
});

describe("transport the conditions do not cover", () => {
  it("there is no total, and the supplier closes it in so many words or with a charge", async () => {
    const order = await request({ destinationId: ids.elsewhere });
    const seen = (await readOrder(db, seller, order.id, TODAY))!;
    expect(seen.amounts).toMatchObject({ goods: 33000, total: null, transport: { state: "to_confirm" } });
    expect(seen.amounts.open).toHaveLength(1);
    await expect(acceptOrder(db, seller, order.id, {}, TODAY)).rejects.toThrow(/do not cover transport to Another Mock Town/);
    await expect(proposeChanges(db, seller, order.id, { deliveryDate: "2026-10-30" }, null, TODAY)).rejects.toThrow(/State the transport/);
    await proposeChanges(db, seller, order.id, { transportCost: 450 }, null, TODAY);
    expect((await readOrder(db, buyer, order.id, TODAY))!.proposal!.amountsAfter).toMatchObject({ total: 33450, transport: { state: "stated", amount: 450 } });
    await decideProposal(db, buyer, order.id, true, {});
    expect((await readOrder(db, buyer, order.id, TODAY))!).toMatchObject({ status: "confirmed", transportCost: 450, amounts: { total: 33450 } });

    const second = await request({ destinationId: ids.elsewhere });
    await acceptOrder(db, seller, second.id, { transportConfirmed: true }, TODAY);
    expect((await readOrder(db, buyer, second.id, TODAY))!).toMatchObject({ status: "confirmed", transportCost: 0, amounts: { total: 33000, transport: { state: "stated", amount: 0 } } });
  });

  it("a delivery later than the customer asked is a change, not an acceptance", async () => {
    const order = await request({ wantedDate: "2026-10-20" });
    await expect(acceptOrder(db, seller, order.id, { deliveryDate: "2026-10-25" }, TODAY)).rejects.toThrow(/later date is a change/);
    await acceptOrder(db, seller, order.id, {}, TODAY);
    expect((await readOrder(db, buyer, order.id, TODAY))!.deliveryDate).toBe("2026-10-20");
  });
});

describe("when an article cannot be ordered", () => {
  it("a price past its date stops it by itself — the article and its history stay", async () => {
    const later = "2027-01-02";
    expect((await listing(buyer, later)).state).toBe("expired");
    await expect(createOrder(db, buyer, { idempotencyKey: key(), orderProductId: ids.article, quantity: 22000, destinationId: ids.destination, wantedDate: null, notes: null, send: true }, later)).rejects.toThrow(/cannot be ordered right now/);
    expect((await readPortal(db, seller, later)).products.find((p) => p.id === ids.article)).toMatchObject({ state: "expired", enabled: true });
    expect((await readOrder(db, buyer, ids.order, later))!.status).toBe("completed");
  });

  it("the customer asks for the conditions to be renewed — once", async () => {
    await saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: { ...TERMS, validUntil: TODAY }, confirm: true }, TODAY);
    const tomorrow = "2026-10-13";
    expect((await listing(buyer, tomorrow)).state).toBe("expired");
    await db.update(schema.orderTerms).set({ validUntil: "2026-10-11" }).where(eq(schema.orderTerms.validUntil, TODAY));
    expect(await askConditions(db, buyer, ids.article)).toEqual({ asked: true });
    expect(await askConditions(db, buyer, ids.article)).toEqual({ asked: false });
    expect((await readNotifications(db, seller))[0]).toMatchObject({ kind: "update_requested", orderProductId: ids.article, params: { company: "Mock Buyer S.r.l.", product: "Paraffin 52/54" } });
    await saveTerms(db, seller, { orderProductId: ids.article, relationshipId: null, terms: TERMS, confirm: true }, TODAY);
    expect((await listing()).state).toBe("order_ready");
  });

  it("the supplier pauses new orders and takes them up again", async () => {
    await setProductOrders(db, seller, ids.article, "suspend");
    expect((await listing()).state).toBe("suspended");
    await expect(request()).rejects.toThrow(/cannot be ordered right now/);
    await setProductOrders(db, seller, ids.article, "resume");
    expect((await listing()).state).toBe("order_ready");
  });

  it("a customer the supplier did not pick does not see the article at all", async () => {
    await setAudience(db, seller, ids.article, "selected", []);
    expect(await listing()).toBeUndefined();
    expect(await readListings(db, buyer, { productId: ids.paraffin }, TODAY)).toEqual([]);
    await expect(request()).rejects.toThrow(/not available to you/);
    await setAudience(db, seller, ids.article, "selected", [ids.relationship]);
    expect((await listing()).state).toBe("order_ready");
    expect((await listing()).buyerProductId).toBe(ids.paraffin);
    await setAudience(db, seller, ids.article, "all", []);
  });

  it("a customer the supplier stopped taking orders from reads 'suspended'", async () => {
    await setCustomerOrdering(db, seller, ids.relationship, "blocked");
    expect((await listing()).state).toBe("suspended");
    await expect(request()).rejects.toThrow(/cannot be ordered right now/);
    await setCustomerOrdering(db, seller, ids.relationship, "allowed");
    expect((await listing()).state).toBe("order_ready");
  });
});

describe("what belongs to another company", () => {
  beforeAll(async () => {
    rival = await register(ids.rivalRecord, "Mock Rival Supplier GmbH", "sales@mockrival.example");
    // A second customer of the same supplier. This installation is one buyer's workspace: the other is made here, as a mock.
    const [org] = await db.insert(schema.organizations).values({ kind: "buyer", name: "Mock Other Buyer Ltd" }).returning();
    const [rel] = await db.insert(schema.tradeRelationships).values({ buyerOrgId: org.id, supplierOrgId: seller.orgId }).returning();
    ids.otherRelationship = rel.id;
    otherBuyer = { side: "buyer", orgId: org.id, orgName: org.name, userId: null, name: "Mock Other User", permissions: [...PERMISSIONS.buyer], actorType: "user" };
  });

  it("a price reserved to one customer is read by that customer alone", async () => {
    await expect(saveTerms(db, seller, { orderProductId: ids.article, relationshipId: ids.relationship, terms: { ...TERMS, unitPrice: 1.39 }, confirm: false }, TODAY)).rejects.toThrow(/when you confirm/);
    await saveTerms(db, seller, { orderProductId: ids.article, relationshipId: ids.relationship, terms: { ...TERMS, unitPrice: 1.39 }, confirm: true }, TODAY);
    expect(await listing(buyer)).toMatchObject({ reserved: true, terms: { unitPrice: 1.39 } });
    const others = await readListings(db, otherBuyer, {}, TODAY);
    expect(others.find((l) => l.orderProductId === ids.article)).toMatchObject({ reserved: false, terms: { unitPrice: 1.45 }, buyerProductId: null });
    expect(JSON.stringify(others)).not.toContain("1.39");
    const order = await request();
    expect((await readOrder(db, buyer, order.id, TODAY))!).toMatchObject({ line: { unitPrice: 1.39 }, terms: { reserved: true } });
    await cancelOrder(db, buyer, order.id, null);
    await withdrawReserved(db, seller, ids.article, ids.relationship);
    expect(await listing(buyer)).toMatchObject({ reserved: false, terms: { unitPrice: 1.45 } });
    // What was stated to one customer is never proposed for another.
    expect((await termsProposals(db, seller, ids.article)).every((p) => p.relationshipId === ids.relationship)).toBe(true);
  });

  it("an order exists only for the two companies it is between", async () => {
    for (const stranger of [rival, otherBuyer]) {
      expect(await readOrder(db, stranger, ids.order, TODAY)).toBeNull();
      expect(await readOrders(db, stranger, TODAY)).toEqual([]);
      expect(await readNotifications(db, stranger)).not.toContainEqual(expect.objectContaining({ orderId: ids.order }));
    }
    const open = await request();
    await expect(acceptOrder(db, rival, open.id, {}, TODAY)).rejects.toThrow(/does not exist, or is not your company's/);
    await expect(rejectOrder(db, rival, open.id, "Mock reason")).rejects.toThrow(/does not exist/);
    await expect(proposeChanges(db, rival, open.id, { unitPrice: 0.01 }, null, TODAY)).rejects.toThrow(/does not exist/);
    await expect(cancelOrder(db, otherBuyer, open.id, null)).rejects.toThrow(/does not exist/);
    expect((await readOrder(db, buyer, open.id, TODAY))!.status).toBe("pending_supplier");
    await cancelOrder(db, buyer, open.id, null);
  });

  it("a supplier reads and changes only its own articles, conditions and customers", async () => {
    expect((await readPortal(db, rival, TODAY)).products).toEqual([]);
    expect((await readPortal(db, rival, TODAY)).customers.map((c) => c.name)).toEqual(["Mock Buyer S.r.l."]);
    await expect(saveTerms(db, rival, { orderProductId: ids.article, relationshipId: null, terms: { ...TERMS, unitPrice: 0.01 }, confirm: true }, TODAY)).rejects.toThrow(/not in your catalogue/);
    await expect(saveOrderProduct(db, rival, { id: ids.article, code: "X", name: "Mock takeover", description: null, unit: "kg", specConfirmed: true })).rejects.toThrow(/not in your catalogue/);
    await expect(setProductOrders(db, rival, ids.article, "suspend")).rejects.toThrow(/not in your catalogue/);
    await expect(setCustomerOrdering(db, rival, ids.relationship, "blocked")).rejects.toThrow(/no channel with your company/);
    await expect(termsProposals(db, rival, ids.article)).rejects.toThrow(/not in your catalogue/);
    // What the customer buys from one supplier is not offered to another: the rival billed nothing.
    expect(await catalogProposals(db, rival)).toEqual([]);
    expect((await listing()).terms).toMatchObject({ unitPrice: 1.45 });
  });

  it("each side's functions refuse the other side, and a buyer ties only what it may see", async () => {
    await expect(readPortal(db, buyer, TODAY)).rejects.toThrow(/not yours/);
    await expect(readListings(db, seller, {}, TODAY)).rejects.toThrow(/not yours/);
    await expect(createOrder(db, seller, { idempotencyKey: key(), orderProductId: ids.article, quantity: 22000, destinationId: ids.destination, wantedDate: null, notes: null, send: true }, TODAY)).rejects.toThrow(/not yours/);
    await expect(tieListing(db, otherBuyer, ids.article, ids.paraffin)).resolves.toBeUndefined();
    await tieListing(db, otherBuyer, ids.article, null);
    await setAudience(db, seller, ids.article, "selected", [ids.relationship]);
    await expect(tieListing(db, otherBuyer, ids.article, ids.paraffin)).rejects.toThrow(/not available to you/);
    await setAudience(db, seller, ids.article, "all", []);
  });

  it("a member gets only the permissions given, and only of the company's own side; an admin gets them all", async () => {
    const id = await addUser(db, seller, { name: "Mock Clerk", email: "clerk@mockwax.example", password: PASSWORD, permissions: ["order.respond", "order.send", "made.up"] });
    const clerk = (await principalOf(db, (await startSession(db, id, seller.orgId)).token, "supplier"))!;
    expect(clerk.permissions).toEqual(["order.respond"]);
    await expect(saveTerms(db, clerk, { orderProductId: ids.article, relationshipId: null, terms: TERMS, confirm: true }, TODAY)).rejects.toThrow(/not allowed/);
    await expect(addUser(db, clerk, { name: "Mock Friend", email: "friend@mockwax.example", password: PASSWORD, permissions: [] })).rejects.toThrow(/not allowed/);
    await expect(addUser(db, seller, { name: "Mock Twin", email: "CLERK@mockwax.example", password: PASSWORD, permissions: [] })).rejects.toThrow(/belongs to your company already/);
    const chief = await addUser(db, seller, { name: "Mock Chief", email: "chief@mockwax.example", password: PASSWORD, role: "admin", permissions: [] });
    expect((await principalOf(db, (await startSession(db, chief, seller.orgId)).token, "supplier"))!.permissions).toEqual([...PERMISSIONS.supplier]);
    expect((await readOrg(db, seller.orgId))!.users.map((u) => [u.name, u.role])).toEqual([["Mock Seller", "admin"], ["Mock Clerk", "member"], ["Mock Chief", "admin"]]);
  });

  it("one person can belong to several companies: one account, a role in each, one company at a time", async () => {
    // The rival takes on the same clerk: the account they have is used, and its password is not replaced.
    const id = await addUser(db, rival, { name: "Ignored", email: "clerk@mockwax.example", password: "another-password-1", role: "admin", permissions: [] });
    await expect(signIn(db, "clerk@mockwax.example", "another-password-1", "supplier")).rejects.toThrow(/not right/);
    const last = await signIn(db, "clerk@mockwax.example", PASSWORD, "supplier");
    expect(last.orgId).toBe(rival.orgId);
    const atRival = (await principalOf(db, last.token, "supplier"))!;
    expect(atRival).toMatchObject({ orgName: "Mock Rival Supplier GmbH", name: "Mock Clerk", permissions: [...PERMISSIONS.supplier] });
    const first = await signIn(db, "clerk@mockwax.example", PASSWORD, "supplier", undefined, seller.orgId);
    const atWax = (await principalOf(db, first.token, "supplier"))!;
    expect(atWax).toMatchObject({ orgName: "Mock Wax Supplier S.p.A.", permissions: ["order.respond"] });
    // Each session reads only its own company — the person is the same, the company is not.
    expect((await readPortal(db, atRival, TODAY)).products).toEqual([]);
    expect((await readOrders(db, atRival, TODAY))).toEqual([]);
    expect((await readOrders(db, atWax, TODAY)).length).toBeGreaterThan(0);
    // Switched off in one company, they are nobody there and still somebody in the other.
    const { setUserDisabled } = await import("./orgs");
    await setUserDisabled(db, seller, id, true);
    expect(await principalOf(db, first.token, "supplier")).toBeNull();
    expect(await principalOf(db, last.token, "supplier")).not.toBeNull();
    await expect(signIn(db, "clerk@mockwax.example", PASSWORD, "supplier", undefined, seller.orgId)).resolves.toMatchObject({ orgId: rival.orgId });
    await expect(setUserDisabled(db, seller, seller.userId!, true)).rejects.toThrow(/your own account/);
  });
});

describe("a request nobody answers", () => {
  it("lapses by itself after its days, said as the app's own doing, and both are told", async () => {
    const order = await request();
    expect(await expireDue(db, "2026-10-26")).toBe(0);
    const seen = (await readOrder(db, buyer, order.id, "2026-10-27"))!;
    expect(seen.status).toBe("expired");
    expect(seen.events.at(-1)).toMatchObject({ action: "expire", actorType: "system", side: null, actorName: null });
    expect((await readNotifications(db, buyer))[0]).toMatchObject({ kind: "order_expired", orderId: order.id });
    expect((await readNotifications(db, seller))[0]).toMatchObject({ kind: "order_expired", orderId: order.id });
    await expect(acceptOrder(db, seller, order.id, {}, "2026-10-27")).rejects.toThrow(/moved on/);
  });

  it("notifications are marked read by the company they are for", async () => {
    expect((await readNotifications(db, seller)).some((n) => !n.read)).toBe(true);
    await markNotificationsRead(db, rival);
    expect((await readNotifications(db, seller)).some((n) => !n.read)).toBe(true);
    await markNotificationsRead(db, seller);
    expect((await readNotifications(db, seller)).every((n) => n.read)).toBe(true);
  });
});

describe("with what the app already had", () => {
  it("a company that answered a request can be invited too, and its own quotation is proposed back to it", async () => {
    const invite = await inviteCompany(db, buyer, { kind: "reply", id: ids.reply }, "sales@mockwicks.example");
    const made = await acceptInvite(db, invite.token, { register: { companyName: "Mock Wicks GmbH", vatNumber: "DE000000002", taxCode: null, address: "2 Mock Strasse", postalCode: "00002", city: "Mock Stadt", province: null, country: "Germany", userName: "Mock Wick Seller", email: "sales@mockwicks.example", password: PASSWORD } });
    const wicks = (await principalOf(db, (await startSession(db, made.userId!, made.orgId)).token, "supplier"))!;
    const offered = await catalogProposals(db, wicks);
    expect(offered).toEqual([expect.objectContaining({ source: "reply_offer", name: "Mock wick 12", code: "MW-W12", unit: "kg", buyerProductId: null })]);
    const article = await saveOrderProduct(db, wicks, { code: "MW-W12", name: "Mock wick 12", description: "Flat braided cotton wick, size 12", unit: "kg", specConfirmed: true });
    const [proposed] = await termsProposals(db, wicks, article);
    // Its terms were CFR: kept in words, never read as DAP — and what could not be read into a choice stays as written.
    expect(proposed).toMatchObject({ kind: "reply_offer", date: "2026-10-01", values: { unitPrice: 9.5, currency: "EUR", minQuantity: 200, delivery: "other", deliveryNote: "CFR Mock Port", payment: "30_days", validUntil: "2026-11-30" }, asWritten: { leadTime: "about three weeks" } });
    // Still nothing can be ordered: the company has not verified its address nor accepted the conditions.
    await expect(saveTerms(db, wicks, { orderProductId: article, relationshipId: null, terms: { ...TERMS, ...proposed.values, quantityStep: null, transportIncluded: true }, confirm: true }, TODAY)).rejects.toThrow(/your company still needs/);
    expect((await readListings(db, buyer, { orderProductId: article }, TODAY))[0]).toMatchObject({ state: "catalog_ready", terms: null, record: { kind: "reply", id: ids.reply } });
  });

  it("no purchase, quotation, supplier, product, candidate or reply was written or changed by any of this", async () => {
    expect(await counts()).toEqual(before);
    expect((await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, ids.wax)))[0]).toMatchObject({ name: "Mock Wax Supplier S.p.A.", vatNumber: "IT00000000001" });
    expect((await db.select().from(schema.purchases)).map((p) => p.unitPrice).sort()).toEqual(["1.480000", "300.000000"]);
  });

  it("every write of a company or an article is in the change log with its author", async () => {
    const log = await db.select().from(schema.auditEvents);
    expect(log.find((e) => e.action === "confirm_conditions")).toMatchObject({ actorType: "supplier", actorId: "Mock Seller", entity: "order_terms" });
    expect(log.find((e) => e.action === "invite")).toMatchObject({ actorType: "user", actorId: "Mock User" });
    expect(log.find((e) => e.action === "accept_conditions")).toMatchObject({ actorType: "supplier" });
    expect(log.filter((e) => e.action === "register")).toHaveLength(3);
  });
});
