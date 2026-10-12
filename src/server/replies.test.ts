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
import { ReplyError, checkReplies, importReplies, readReplies, setOfferValidation, updateReplyCompany, updateReplyThread } from "./replies";

let db: DB;
const FILE = "mock-replies.json";
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
  const [product] = await db.insert(schema.products).values({ name: "Wick 12", sku: "W12", unit: "kg", kind: "component" }).returning();
  await db.insert(schema.supplierCandidates).values({ productId: product.id, name: "Mock Wicks", website: "http://www.mockwicks.example/", country: "Germany" });
  await db.insert(schema.marketSuppliers).values({ market: "plastic_candle_containers", name: "Mock Wax Kimya", website: "https://mockwax.example/", evidenceUrl: "https://mockwax.example/" });
  expect(own.id).toBeTruthy();
}, 30_000);

describe("checking a file", () => {
  it("says what the load would do and writes nothing", async () => {
    const before = await counts();
    const { plan, loaded } = await checkReplies(db, mockFile());
    expect(loaded).toBe(false);
    expect(plan.counts).toMatchObject({ create: 3, update: 0, offersNew: 2, messagesNew: 3, elsewhere: 2 });
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
    expect(a).toMatchObject({ productName: "MOCK A", unitPrice: 1.5, currency: "EUR", unit: "kg", quantity: 20000, incoterm: "CFR", destination: "Mockport", validUntil: "2026-03-15", validation: "required", sourceDocument: "proforma.pdf" });
    // A price in dollars free on board stays a price in dollars free on board.
    expect(b).toMatchObject({ unitPrice: 1.25, currency: "USD", incoterm: "FOB", destination: "Mockharbour", validUntil: "2026-03-17" });
  });

  it("points out the buyer's other records of the same company", async () => {
    expect((await company("Mock Wicks GmbH")).elsewhere).toMatchObject([{ where: "candidate", certain: true, products: [{ name: "Wick 12" }] }]);
    expect((await company("Mock Wax Kimya A.Ş.")).elsewhere).toMatchObject([{ where: "directory", certain: true }]);
    expect((await company("Mock Hobby Shop")).elsewhere).toEqual([]);
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
    await updateReplyThread(db, wicks.threads[0].id, { kind: "sent", date: "2026-03-12", summary: "Sent two references with diameters", reference: null, status: "awaiting_reply", nextAction: "Wait for the samples", categories: ["Wicks"] });
    await updateReplyCompany(db, wicks.id, { name: "Mock Wicks GmbH", email: "sales@mockwicks.example" });

    const after = await company("Mock Wicks GmbH");
    expect(after).toMatchObject({ email: "sales@mockwicks.example", confirmed: ["email"] });
    expect(after.threads[0]).toMatchObject({ status: "awaiting_reply", statusText: null, nextAction: "Wait for the samples", categories: ["Wicks"] });
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

  it("is the only thing that validates an offer", async () => {
    const [offer] = (await company("Mock Wax Kimya A.Ş.")).threads[0].offers;
    await setOfferValidation(db, offer.id, "not_equivalent");
    expect((await company("Mock Wax Kimya A.Ş.")).threads[0].offers[0].validation).toBe("not_equivalent");
    await importReplies(db, mockFile(), { file: FILE });
    expect((await company("Mock Wax Kimya A.Ş.")).threads[0].offers[0].validation).toBe("not_equivalent");
  });

  it("needs something to record, and a name for a company", async () => {
    const wax = await company("Mock Wax Kimya A.Ş.");
    await expect(updateReplyThread(db, wax.threads[0].id, { kind: "note", date: "2026-03-12", summary: " ", reference: null, status: "quote_received" })).rejects.toBeInstanceOf(ReplyError);
    await expect(updateReplyCompany(db, wax.id, { name: " " })).rejects.toBeInstanceOf(ReplyError);
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
    const [row] = await readDirectory(db, "plastic_candle_containers");
    expect(row.links).toMatchObject({ rfq: "answered", replyId: (await company("Mock Wax Kimya A.Ş.")).id, current: false, candidateFor: [] });
  });

  it("left the buyer's suppliers, candidates, quotes and directories as they were", async () => {
    expect(await counts()).toMatchObject({ companies: 3, suppliers: 1, candidates: 1, quotes: 0, directory: 1 });
  });
});
