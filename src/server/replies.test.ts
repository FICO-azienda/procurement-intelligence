/**
 * Replies to requests for quotation on a real in-memory Postgres: a file is
 * checked without writing, loaded all at once, and loading it again changes
 * nothing; no company becomes a supplier and no price becomes a quote; what a
 * person wrote survives the next file. The data is a mock (lib/replies/fixtures.ts).
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { mockFile } from "@/lib/replies/fixtures";
import { readDirectory } from "./markets";
import type { Actor } from "@/lib/replies/types";
import { correctAttribution, readAudit } from "./audit";
import { readDestinations, saveDestination } from "./destinations";
import {
  ReplyError, addReplyDocument, checkReplies, decideCompanyLink, decideOffer, declineSuggestion, importReplies, linkOffer, readOffer, readProductOffers, readReplies, saveLanded, setOfferCompatibility, unlinkOffer,
  updateReplyCompany, updateReplyThread,
} from "./replies";
import { readSettings } from "@/lib/data";

let db: DB;
const FILE = "mock-replies.json";
const ME: Actor = { type: "user", id: "Mock User" };
const AI: Actor = { type: "ai", id: "assistant" };
const ids: Record<string, string> = {};
const counts = async () => ({
  companies: (await db.select().from(schema.rfqSuppliers)).length,
  threads: (await db.select().from(schema.rfqThreads)).length,
  offers: (await db.select().from(schema.rfqOffers)).length,
  messages: (await db.select().from(schema.rfqMessages)).length,
  suppliers: (await db.select().from(schema.suppliers)).length,
  candidates: (await db.select().from(schema.supplierCandidates)).length,
  quotes: (await db.select().from(schema.quotes)).length,
  directory: (await db.select().from(schema.marketSuppliers)).length,
});
const company = async (name: string) => (await readReplies(db)).find((c) => c.name === name)!;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [own] = await db.insert(schema.suppliers).values({ name: "Mock Current Supplier S.r.l.", country: "Italy" }).returning();
  const [product] = await db.insert(schema.products).values({ name: "Wick 12", sku: "W12", unit: "kg", kind: "component", category: "Wicks and wick parts", subcategory: "Wicks", mappedAt: new Date() }).returning();
  await db.insert(schema.supplierCandidates).values({ productId: product.id, name: "Mock Wicks", website: "http://www.mockwicks.example/", country: "Germany" });
  const [paraffin] = await db.insert(schema.products).values({ name: "Mock paraffin 58/60", sku: "PAR", unit: "kg", kind: "direct_material", category: "Waxes and paraffin", subcategory: "Paraffin", mappedAt: new Date() }).returning();
  await db.insert(schema.purchases).values({ productId: paraffin.id, supplierId: own.id, date: "2026-02-10", quantity: "40000", unit: "kg", unitPrice: "1.6", totalAmount: "64000", originalDescription: "MOCK PARAFFIN 58/60" });
  await db.insert(schema.settings).values({ id: 1, companyName: "Mock Buyer S.r.l.", country: "Italy" });
  const [look] = await db.insert(schema.marketSuppliers).values({ market: "plastic_candle_containers", name: "Mock Hobby Shop Brothers", country: "France", evidenceUrl: "https://mockhobbybrothers.example/" }).returning();
  Object.assign(ids, { paraffin: paraffin.id, wick: product.id, own: own.id, look: look.id });
  await db.insert(schema.marketSuppliers).values({ market: "plastic_candle_containers", name: "Mock Wax Kimya", website: "https://mockwax.example/", evidenceUrl: "https://mockwax.example/" });
  expect(own.id).toBeTruthy();
}, 30_000);

describe("checking a file", () => {
  it("says what the load would do and writes nothing", async () => {
    const before = await counts();
    const { plan, loaded } = await checkReplies(db, mockFile());
    expect(loaded).toBe(false);
    expect(plan.counts).toMatchObject({ create: 3, update: 0, offersNew: 2, messagesNew: 3, elsewhere: 3 });
    expect(plan.rejected).toHaveLength(3);
    expect(await counts()).toEqual(before);
  });

  it("refuses what is not a file of replies", async () => {
    await expect(checkReplies(db, "{}")).rejects.toBeInstanceOf(ReplyError);
    await expect(checkReplies(db, JSON.stringify({ suppliers: [] }))).rejects.toBeInstanceOf(ReplyError);
  });
});

describe("loading it", () => {
  it("adds the companies, their conversations, the offers and the messages — and nothing anywhere else", async () => {
    const before = await counts();
    const { loaded } = await importReplies(db, mockFile(), { file: FILE });
    expect(loaded).toBe(true);
    expect(await counts()).toEqual({ ...before, companies: 3, threads: 3, offers: 2, messages: 3 });
  });

  it("keeps every company as written, with where it stands and what it was read from", async () => {
    const wax = await company("Mock Wax Kimya A.Ş.");
    expect(wax).toMatchObject({ country: "Turkey", email: "sales@mockwax.example", contactName: "Ada Mock", vatNumber: "TR1234567890", companyType: "Declared manufacturer", sourceFile: FILE });
    const [thread] = wax.threads;
    expect(thread).toMatchObject({ reference: "MOCK-WAX-1", categories: ["Waxes"], status: "quote_received", statusText: "PREZZO RICEVUTO · NON FINALIZZATO", moq: "20.000 kg per grade", samples: null, priority: "Urgente" });
    expect(thread.messages).toMatchObject([{ date: "2026-03-10", kind: "reply", status: "quote_received", reference: "https://mail.example/thread/1", attachments: "proforma.pdf", source: "file" }]);
    const [row] = await db.select().from(schema.rfqThreads).where(eq(schema.rfqThreads.id, thread.id));
    expect(row.original).toMatchObject({ supplier_id: "MOCK-WAX-1", import_status: "Candidate — price not orderable", quote_validated: false });
  });

  it("keeps each price in its own currency, on its own terms, to validate", async () => {
    const [a, b] = (await company("Mock Wax Kimya A.Ş.")).threads[0].offers;
    expect(a).toMatchObject({ productName: "MOCK A", unitPrice: 1.5, currency: "EUR", unit: "kg", quantity: 20000, incoterm: "CFR", destination: "Mockport", validUntil: "2026-03-15", compatibility: "not_analyzed", productId: null, sourceDocument: "proforma.pdf" });
    // A price in dollars free on board stays a price in dollars free on board.
    expect(b).toMatchObject({ unitPrice: 1.25, currency: "USD", incoterm: "FOB", destination: "Mockharbour", validUntil: "2026-03-17" });
  });

  it("points out the buyer's other records of the same company", async () => {
    expect((await company("Mock Wicks GmbH")).elsewhere).toMatchObject([{ where: "candidate", certain: true, products: [{ name: "Wick 12" }] }]);
    expect((await company("Mock Wax Kimya A.Ş.")).elsewhere).toMatchObject([{ where: "directory", certain: true }]);
    // A resemblance is said, and decides nothing.
    expect((await company("Mock Hobby Shop")).elsewhere).toMatchObject([{ where: "directory", certain: false, decided: null }]);
  });

  it("changes nothing when loaded again", async () => {
    const before = await counts();
    const { plan } = await importReplies(db, mockFile(), { file: FILE });
    expect(plan.counts).toMatchObject({ create: 0, update: 0, unchanged: 3, offersNew: 0, offersKnown: 2, messagesNew: 0 });
    expect(await counts()).toEqual(before);
  });
});

describe("what a person says", () => {
  it("goes in the history, and a later file does not take it back", async () => {
    const wicks = await company("Mock Wicks GmbH");
    await updateReplyThread(db, wicks.threads[0].id, { kind: "sent", date: "2026-03-12", summary: "Sent two references with diameters", reference: null, status: "awaiting_reply", nextAction: "Wait for the samples", followUpOn: "2026-03-20", categories: ["Wicks"] }, ME);
    await updateReplyCompany(db, wicks.id, { name: "Mock Wicks GmbH", email: "sales@mockwicks.example" }, ME);

    const after = await company("Mock Wicks GmbH");
    expect(after).toMatchObject({ email: "sales@mockwicks.example", confirmed: ["email"] });
    expect(after.threads[0]).toMatchObject({ status: "awaiting_reply", statusText: null, nextAction: "Wait for the samples", followUpOn: "2026-03-20", categories: ["Wicks"] });
    expect(after.threads[0].messages.map((m) => [m.date, m.kind, m.status, m.source])).toEqual([
      ["2026-03-09", "reply", "needs_information", "file"],
      ["2026-03-12", "sent", "awaiting_reply", "manual"],
    ]);

    const { plan } = await importReplies(db, mockFile(), { file: FILE });
    const row = plan.companies.find((c) => c.reference === "MOCK-WICK-1")!;
    expect(row.action).toBe("unchanged");
    expect(row.kept.map((k) => [k.field, k.reason])).toEqual([["email", "confirmed"], ["status", "confirmed"], ["nextAction", "confirmed"], ["categories", "confirmed"]]);
    expect((await company("Mock Wicks GmbH")).threads[0].status).toBe("awaiting_reply");
  });

  it("is the only thing that says how far an offer is the product bought — with its reason", async () => {
    const [offer] = (await company("Mock Wax Kimya A.Ş.")).threads[0].offers;
    await expect(setOfferCompatibility(db, offer.id, { compatibility: "possible", note: " " }, ME)).rejects.toBeInstanceOf(ReplyError);
    // Equivalence is said of a product: not of an offer tied to none.
    await expect(setOfferCompatibility(db, offer.id, { compatibility: "validated", note: "Sample tested" }, ME)).rejects.toBeInstanceOf(ReplyError);
    await setOfferCompatibility(db, offer.id, { compatibility: "awaiting_specs", note: "Data sheet asked on 12/03" }, ME);
    expect((await company("Mock Wax Kimya A.Ş.")).threads[0].offers[0]).toMatchObject({ compatibility: "awaiting_specs", compatibilityNote: "Data sheet asked on 12/03" });
    await importReplies(db, mockFile(), { file: FILE });
    expect((await company("Mock Wax Kimya A.Ş.")).threads[0].offers[0].compatibility).toBe("awaiting_specs");
    await setOfferCompatibility(db, offer.id, { compatibility: "not_analyzed", note: null }, ME);
  });

  it("needs something to record, and a name for a company", async () => {
    const wax = await company("Mock Wax Kimya A.Ş.");
    await expect(updateReplyThread(db, wax.threads[0].id, { kind: "note", date: "2026-03-12", summary: " ", reference: null, status: "quote_received" }, ME)).rejects.toBeInstanceOf(ReplyError);
    await expect(updateReplyCompany(db, wax.id, { name: " " }, ME)).rejects.toBeInstanceOf(ReplyError);
  });
});

describe("a later file", () => {
  it("adds a line quoted again at another price next to the first, and a second request as its own conversation", async () => {
    const later = mockFile((f) => {
      f.metadata.snapshot_date = "2026-03-20";
      f.suppliers = [
        { ...f.suppliers[0], verified_at: "2026-03-20", source_email_url: "https://mail.example/thread/9", offer_summary: "Corrected price for one grade" },
        { ...f.suppliers[0], supplier_id: "MOCK-WAX-2", category: "Blends", status: "RICHIEDE SPECIFICHE", reply_group: "", verified_at: "2026-03-20", source_email_url: "https://mail.example/thread/10" },
      ];
      f.quotations = [{ ...f.quotations[0], price_per_kg: 1.4 }];
      f.excluded = [];
    });
    const { plan } = await importReplies(db, later, { file: "mock-replies-2.json" });
    expect(plan.counts).toMatchObject({ create: 0, update: 2, offersNew: 1, messagesNew: 2 });
    const wax = await company("Mock Wax Kimya A.Ş.");
    expect(wax.threads.map((t) => [t.reference, t.status])).toEqual([["MOCK-WAX-1", "quote_received"], ["MOCK-WAX-2", "needs_information"]]);
    expect(wax.threads[0].offers.map((o) => o.unitPrice)).toEqual([1.5, 1.25, 1.4]);
    expect(wax.threads[0].messages).toHaveLength(2);
    expect(wax.threads[0].offerSummary).toBe("Corrected price for one grade");
  });

  it("lets a market directory say the company answered, with the way to what it wrote", async () => {
    const row = (await readDirectory(db, "plastic_candle_containers")).find((r) => r.name === "Mock Wax Kimya")!;
    expect(row.links).toMatchObject({ rfq: "answered", replyId: (await company("Mock Wax Kimya A.Ş.")).id, current: false, candidateFor: [] });
  });

  it("left the buyer's suppliers, candidates, quotes and directories as they were", async () => {
    expect(await counts()).toMatchObject({ companies: 3, suppliers: 1, candidates: 1, quotes: 0, directory: 2 });
  });
});

describe("one company, several records", () => {
  it("ties what is surely the same without a second record, and asks about what only resembles", async () => {
    const hobby = await company("Mock Hobby Shop");
    const wicks = await company("Mock Wicks GmbH");
    // TEST A: the company that answered is the candidate already on file — pointed out, one record each, nothing copied.
    expect(wicks.elsewhere).toMatchObject([{ where: "candidate", certain: true, products: [{ name: "Wick 12" }] }]);
    expect(await counts()).toMatchObject({ companies: 3, candidates: 1 });

    await decideCompanyLink(db, hobby.id, { where: "directory", id: ids.look }, "same", ME);
    expect((await company("Mock Hobby Shop")).elsewhere).toMatchObject([{ where: "directory", certain: true, decided: "same" }]);
    expect((await readDirectory(db, "plastic_candle_containers")).find((r) => r.id === ids.look)!.links).toMatchObject({ rfq: "answered", replyId: hobby.id });

    await decideCompanyLink(db, hobby.id, { where: "directory", id: ids.look }, "group", ME);
    expect((await company("Mock Hobby Shop")).elsewhere).toMatchObject([{ certain: false, decided: "group" }]);
    await decideCompanyLink(db, hobby.id, { where: "directory", id: ids.look }, "different", ME);
    expect((await company("Mock Hobby Shop")).elsewhere).toMatchObject([{ certain: false, decided: "different" }]);
    expect((await readDirectory(db, "plastic_candle_containers")).find((r) => r.id === ids.look)!.links).toMatchObject({ rfq: "none", replyId: null });
    await decideCompanyLink(db, hobby.id, { where: "directory", id: ids.look }, null, ME);
    expect((await company("Mock Hobby Shop")).elsewhere).toMatchObject([{ certain: false, decided: null }]);
    // The records themselves were never touched.
    expect((await db.select().from(schema.marketSuppliers).where(eq(schema.marketSuppliers.id, ids.look)))[0].name).toBe("Mock Hobby Shop Brothers");
  });
});

describe("an offer and one of the buyer's products", () => {
  const offers = async () => (await company("Mock Wax Kimya A.Ş.")).threads[0].offers;
  const page = async () => (await readProductOffers(db, ids.paraffin))!;

  it("proposes the offers of the same kind for it, each for what it is — and compares none (TEST C, D)", async () => {
    const p = await page();
    // MOCK A declares 58–60 °C, the product's grade: a possible alternative, proposed, to verify. It is expired, and says so.
    expect(p.toVerify.map((v) => [v.offer.productName, v.offer.unitPrice, v.link, v.compatibility, v.state])).toEqual([
      ["MOCK B", 1.25, "proposed", "not_analyzed", "expired"],
      ["MOCK A", 1.4, "proposed", "possible", "expired"],
    ]);
    // The first price of MOCK A was replaced by a later one: it is history, not an offer.
    expect(p.history.map((v) => [v.offer.unitPrice, v.state])).toEqual([[1.5, "superseded"]]);
    expect(p.comparable).toEqual([]);
    expect(p.toVerify[0].shortfalls).toEqual(["not_linked", "compatibility", "expired", "landed"]);
    // Nothing was written by proposing.
    expect((await offers()).every((o) => o.productId == null)).toBe(true);
    // The wick product gets none of the paraffin offers, and the company that answered about wicks is "no price yet".
    const wick = (await readProductOffers(db, ids.wick))!;
    expect([wick.toVerify.length, wick.otherGrades.length]).toEqual([0, 0]);
    expect(wick.awaitingPrice).toMatchObject([{ company: { name: "Mock Wicks GmbH" }, basis: "candidate" }]);
    // A company that answered about the product's category and said no is counted, not listed: its category is read by the catalogue's own words.
    const hobby = await company("Mock Hobby Shop");
    await updateReplyThread(db, hobby.threads[0].id, { kind: "note", date: "2026-03-13", summary: null, reference: null, status: null, categories: ["Stoppini"] }, ME);
    expect((await readProductOffers(db, ids.wick))!.notSuitable).toBe(1);
    expect((await readProductOffers(db, ids.paraffin))!.notSuitable).toBe(0);
  });

  it("links an offer as an alternative to verify — never as an equivalent — and can decline or take it back", async () => {
    const all = await offers();
    const a = all.find((o) => o.unitPrice === 1.4)!;
    const b = all.find((o) => o.productName === "MOCK B")!;
    const now = async () => (await offers()).find((o) => o.id === a.id)!;
    await linkOffer(db, a.id, ids.paraffin, { compatibility: "validated", note: "should not pass" }, ME);
    expect(await now()).toMatchObject({ productId: ids.paraffin, compatibility: "not_analyzed" });
    await linkOffer(db, a.id, ids.paraffin, { compatibility: "possible", note: "Declares 58–60 °C" }, ME);
    expect((await page()).toVerify.find((v) => v.offer.id === a.id)).toMatchObject({ link: "linked", compatibility: "possible", reasons: ["Declares 58–60 °C"] });
    await declineSuggestion(db, b.id, ids.paraffin, ME);
    expect((await page()).toVerify.some((v) => v.offer.id === b.id)).toBe(false);
    await unlinkOffer(db, a.id, ME);
    expect(await now()).toMatchObject({ productId: null, compatibility: "not_analyzed", compatibilityNote: null });
  });

  it("keeps another grade out of the ranking, however complete its figures (TEST D)", async () => {
    const other = mockFile((f) => {
      f.metadata.snapshot_date = "2026-04-01";
      f.suppliers = [{ ...f.suppliers[0], verified_at: "2026-04-01", source_email_url: "https://mail.example/thread/20" }];
      f.quotations = [
        { supplier_id: "MOCK-WAX-1", product: "MOCK HARD", grade: "62/64", category: "Paraffin", price_per_kg: 1.2, currency: "EUR", quantity_kg: 20000, incoterm: "DAP", destination: "Mocktown", melting_point: "62–64°C", validity: "31/12/2099" },
        { supplier_id: "MOCK-WAX-1", product: "MOCK SAME", grade: "58/60", category: "Paraffin", price_per_kg: 1.45, currency: "EUR", quantity_kg: 20000, incoterm: "DAP", destination: "Mocktown", melting_point: "58–60°C", validity: "31/12/2099" },
        { supplier_id: "MOCK-WAX-1", product: "MOCK FOB", grade: "58/60", category: "Paraffin", price_per_kg: 1.1, currency: "USD", quantity_kg: 20000, incoterm: "FOB", destination: "Mockharbour", melting_point: "58–60°C", validity: "31/12/2099" },
      ];
      f.excluded = [];
    });
    await importReplies(db, other, { file: "mock-replies-3.json" });
    const p = await page();
    expect(p.otherGrades.map((v) => v.offer.productName)).toEqual(["MOCK HARD"]);
    expect(p.comparable).toEqual([]);
  });

  it("compares an offer only once it is validated, valid and whole to the plant (TEST E, F)", async () => {
    await saveDestination(db, { city: "Mocktown", country: "Italy" }, ME);
    const all = await offers();
    const same = all.find((o) => o.productName === "MOCK SAME")!;
    const fob = all.find((o) => o.productName === "MOCK FOB")!;
    const old = all.find((o) => o.productName === "MOCK A" && o.unitPrice === 1.4)!;
    for (const o of [same, fob, old]) {
      await linkOffer(db, o.id, ids.paraffin, {}, ME);
      await setOfferCompatibility(db, o.id, { compatibility: "validated", note: "Sample tested in production, 02/04" }, ME);
    }
    // Turkey is outside the customs area: delivered to the plant still leaves duty and clearance to state.
    expect((await page()).comparable).toEqual([]);
    await saveLanded(db, same.id, { input: { duty: { amount: 0, per: "percent", status: "confirmed", source: "A.TR certificate", date: "2026-04-02" }, clearance: { amount: 0.01, per: "unit", currency: "EUR", status: "estimated", source: "forwarder", date: "2026-04-02" } } }, ME);
    const p = await page();
    expect(p.comparable.map((v) => [v.offer.productName, v.state, v.landed.total, v.landed.estimated])).toEqual([["MOCK SAME", "validated", 1.46, true]]);
    // A price free on board in dollars is not set next to a price delivered: its cost is not whole.
    const f = p.toVerify.find((v) => v.offer.id === fob.id)!;
    expect(f).toMatchObject({ state: "commercial_review", shortfalls: ["landed"] });
    expect(f.landed.missing).toEqual(["goods", "freight", "insurance", "duty", "clearance", "inland"]);
    // An expired offer stays on file and is not an active one, validated or not.
    expect(p.toVerify.find((v) => v.offer.id === old.id)).toMatchObject({ state: "expired", compatibility: "validated" });
  });

  it("keeps the earlier version of a line as history, and a refusal as a refusal", async () => {
    const p = await page();
    // MOCK A was quoted twice (1.5, then 1.4 in a later file): the first is history.
    expect(p.history.map((v) => [v.offer.productName, v.offer.unitPrice, v.state])).toEqual([["MOCK A", 1.5, "superseded"]]);
    const same = p.comparable[0].offer;
    await expect(decideOffer(db, same.id, { rejected: true, note: null }, ME)).rejects.toBeInstanceOf(ReplyError);
    await decideOffer(db, same.id, { rejected: true, note: "Minimum order too large" }, ME);
    expect((await page()).comparable).toEqual([]);
    expect((await readOffer(db, same.id))!).toMatchObject({ state: "rejected", product: { name: "Mock paraffin 58/60" } });
    await decideOffer(db, same.id, { rejected: false, note: null }, ME);
    expect((await page()).comparable).toHaveLength(1);
  });
});

describe("who did what", () => {
  it("says a file's doing is the file's, a person's is the person's, an assistant's is the assistant's (TEST G)", async () => {
    const wax = await company("Mock Wax Kimya A.Ş.");
    const events = await readAudit(db, [{ entity: "rfq_supplier", ids: [wax.id] }, { entity: "rfq_thread", ids: wax.threads.map((t) => t.id) }, { entity: "rfq_offer", ids: wax.threads.flatMap((t) => t.offers.map((o) => o.id)) }]);
    const created = events.filter((e) => e.action === "create");
    expect(created.length).toBeGreaterThan(5);
    expect(new Set(created.map((e) => e.actorType))).toEqual(new Set(["import"]));
    expect(created.map((e) => e.actorId)).toContain("mock-replies.json");
    // What a later file changed in a record on file is the file's too, with what it was before.
    expect(events.find((e) => e.action === "update" && e.field === "offerSummary" && e.actorId === "mock-replies-2.json")).toMatchObject({ actorType: "import", oldValue: "Two prices, 20 t each", newValue: "Corrected price for one grade" });
    expect(events.filter((e) => e.action === "link").every((e) => e.actorType === "user" && e.actorId === "Mock User")).toBe(true);

    await updateReplyThread(db, wax.threads[0].id, { kind: "note", date: "2026-04-03", summary: "Category added by the assistant", reference: null, status: null, categories: ["Waxes", "Blends"] }, AI);
    const after = await company("Mock Wax Kimya A.Ş.");
    expect(after.threads[0].messages.at(-1)).toMatchObject({ source: "assistant", summary: "Category added by the assistant" });
    const [change] = (await readAudit(db, [{ entity: "rfq_thread", ids: [wax.threads[0].id] }])).filter((e) => e.field === "categories");
    expect(change).toMatchObject({ actorType: "ai", actorId: "assistant", oldValue: "Waxes", newValue: "Waxes, Blends", attribution: "recorded" });
  });

  it("corrects a wrong attribution only with evidence, and keeps what it said before", async () => {
    const wicks = await company("Mock Wicks GmbH");
    const [event] = (await readAudit(db, [{ entity: "rfq_thread", ids: [wicks.threads[0].id] }])).filter((e) => e.action === "note");
    expect(event.actorType).toBe("user");
    await expect(correctAttribution(db, event.id, "ai", " ", ME)).rejects.toThrow();
    await correctAttribution(db, event.id, "ai", "Written by the assistant in the session of 12/03", AI);
    const events = await readAudit(db, [{ entity: "rfq_thread", ids: [wicks.threads[0].id] }]);
    expect(events.find((e) => e.id === event.id)).toMatchObject({ actorType: "ai", attribution: "corrected", originalActorType: "user", note: "Written by the assistant in the session of 12/03" });
    expect(events.find((e) => e.action === "attribution_corrected")).toMatchObject({ actorType: "ai", oldValue: "user", newValue: "ai" });
    // The history of the conversation says the same: the note is the assistant's there too.
    expect((await company("Mock Wicks GmbH")).threads[0].messages.find((m) => m.summary === event.newValue)).toMatchObject({ source: "assistant" });
  });
});

describe("documents and destinations", () => {
  it("knows a document on file from a link and from a name", async () => {
    const wax = await company("Mock Wax Kimya A.Ş.");
    const thread = wax.threads[0];
    await addReplyDocument(db, thread.id, { kind: "tds", name: "TDS mock.pdf" }, ME);
    await addReplyDocument(db, thread.id, { kind: "email", name: "The answer", url: "https://mail.example/thread/1" }, ME);
    const stored = await addReplyDocument(db, thread.id, { kind: "offer", name: "", file: { name: "proforma.pdf", bytes: new TextEncoder().encode("mock proforma"), mimeType: "application/pdf" } }, ME);
    // The same file again is the same document.
    expect(await addReplyDocument(db, thread.id, { kind: "offer", name: "again", file: { name: "copy.pdf", bytes: new TextEncoder().encode("mock proforma"), mimeType: "application/pdf" } }, ME)).toBe(stored);
    await expect(addReplyDocument(db, thread.id, { kind: "other", name: "x", url: "ftp://nowhere" }, ME)).rejects.toBeInstanceOf(ReplyError);
    const docs = (await company("Mock Wax Kimya A.Ş.")).threads[0].documents;
    expect(docs.map((d) => [d.kind, d.name, !!d.documentId, !!d.url])).toEqual([["tds", "TDS mock.pdf", false, false], ["email", "The answer", false, true], ["offer", "proforma.pdf", true, false]]);
  });

  it("keeps a destination a person wrote, un-confirms it when its address changes, and names the default in requests", async () => {
    const [town] = await readDestinations(db);
    expect(town).toMatchObject({ city: "Mocktown", isDefault: true, confirmedAt: null });
    expect((await readSettings(db)).deliveryPlace).toBe("Mocktown");
    await saveDestination(db, { id: town.id, address: "1 Mock Road", postalCode: "20000", province: "MK", confirmed: true }, ME);
    expect((await readDestinations(db))[0].confirmedAt).not.toBeNull();
    expect((await readSettings(db)).deliveryPlace).toBe("Mocktown (MK)");
    await saveDestination(db, { id: town.id, address: "2 Mock Road" }, ME);
    expect((await readDestinations(db))[0]).toMatchObject({ address: "2 Mock Road", confirmedAt: null });
    const second = await saveDestination(db, { city: "Otherville" }, ME);
    expect((await readDestinations(db)).map((d) => [d.city, d.isDefault])).toEqual([["Mocktown", true], ["Otherville", false]]);
    await saveDestination(db, { id: second, isDefault: true }, ME);
    expect((await readSettings(db)).deliveryPlace).toBe("Otherville");
    await saveDestination(db, { id: town.id, isDefault: true }, ME);
  });
});

describe("what was there before", () => {
  it("is as it was: purchases, suppliers, candidates, quotes (TEST I)", async () => {
    expect(await db.select().from(schema.purchases)).toMatchObject([{ productId: ids.paraffin, supplierId: ids.own, unitPrice: "1.600000", quantity: "40000.0000" }]);
    expect((await db.select().from(schema.suppliers)).map((s) => s.name)).toEqual(["Mock Current Supplier S.r.l."]);
    expect(await db.select().from(schema.quotes)).toEqual([]);
    expect(await db.select().from(schema.supplierCandidates)).toHaveLength(1);
    expect((await db.select().from(schema.products)).map((p) => p.name).sort()).toEqual(["Mock paraffin 58/60", "Wick 12"]);
  });
});
