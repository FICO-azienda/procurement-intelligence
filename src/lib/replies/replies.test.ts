/**
 * Replies to requests for quotation, read and planned: a status is read from
 * the words or not at all, a price keeps its currency and its delivery terms,
 * a company on file is never written twice, and what a person wrote stays.
 * The data is a mock (fixtures.ts): invented companies and prices.
 */
import { describe, expect, it } from "vitest";
import { mockFile } from "./fixtures";
import { planReplies, sameCompanyAs, summarise, type Known, type Records, type StoredCompany } from "./plan";
import { parseReplyFile, readStatus, readValidity, type ReplyFile } from "./read";
import { COMPANY_FIELDS, THREAD_FIELDS, deliveryOf, priorityRank, statusesOf, validityOf, type ReplyOffer } from "./types";

const read = (raw = mockFile()): ReplyFile => {
  const parsed = parseReplyFile(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.file;
};
const EMPTY: Records = { replies: [], suppliers: [], candidates: [], directory: [] };
const known = (o: Partial<Known> & { name: string }): Known => ({ id: o.name, country: null, website: null, email: null, phone: null, vatNumber: null, taxCode: null, ...o });

/** What is on file after a plan was loaded: enough to plan the next file against it. */
function stored(file: ReplyFile, change: (c: StoredCompany) => void = () => {}): Records {
  const replies = file.companies.map((c): StoredCompany => {
    const row = c as unknown as Record<string, string | null>;
    const company: StoredCompany = {
      ...known({ id: `id-${c.reference}`, name: c.name, country: c.country, website: c.website, email: c.email, phone: c.phone, vatNumber: c.vatNumber, taxCode: c.taxCode }),
      fields: Object.fromEntries(COMPANY_FIELDS.map((f) => [f, row[f] ?? null])) as StoredCompany["fields"],
      confirmed: [],
      checkedAt: c.checkedAt,
      threads: [
        {
          id: `th-${c.reference}`,
          reference: c.reference,
          categories: c.categories,
          confirmed: [],
          checkedAt: c.checkedAt,
          fields: Object.fromEntries(THREAD_FIELDS.map((f) => [f, row[f] ?? null])) as StoredCompany["threads"][number]["fields"],
          offerKeys: file.offers.filter((o) => o.reference === c.reference).map((o) => o.key),
          messageKeys: [["reply", c.checkedAt, c.sourceUrl ?? ""].join("|")],
        },
      ],
    };
    change(company);
    return company;
  });
  return { ...EMPTY, replies };
}

describe("reading a status", () => {
  it("reads it from the words, a refusal first", () => {
    expect(readStatus("PREZZO RICEVUTO · VERIFICA TECNICA", "PREZZO RICEVUTO", { excluded: false, priced: true })).toBe("quote_received");
    expect(readStatus("RICHIEDE SCELTA CODICI", "DA APPROFONDIRE", { excluded: false, priced: false })).toBe("needs_information");
    expect(readStatus("LISTINO PROMESSO · RICHIEDE SPECIFICHE", null, { excluded: false, priced: false })).toBe("needs_information");
    expect(readStatus("PRESA IN CARICO · IN ATTESA", "DA APPROFONDIRE", { excluded: false, priced: false })).toBe("awaiting_reply");
    expect(readStatus("RIFIUTO COMMERCIALE", "RISPOSTA NEGATIVA", { excluded: false, priced: false })).toBe("not_suitable");
    expect(readStatus("RICHIEDE SPECIFICHE", null, { excluded: true, priced: false })).toBe("not_suitable");
    expect(readStatus("Technical validation required", null, { excluded: false, priced: false })).toBe("technical_validation_required");
  });

  it("does not take prices found online for a price received, and guesses nothing it cannot read", () => {
    expect(readStatus("PREZZI SOLO ONLINE · DA SELEZIONARE", null, { excluded: false, priced: false })).toBe("needs_information");
    expect(readStatus("???", null, { excluded: false, priced: false })).toBeNull();
    expect(readStatus(null, null, { excluded: false, priced: true })).toBe("quote_received");
  });
});

describe("reading until when an offer holds", () => {
  it("reads a date, or a number of days from a date — and nothing else", () => {
    expect(readValidity("15/10/2026")).toBe("2026-10-15");
    expect(readValidity("7 gg da 12/10/2026")).toBe("2026-10-19");
    expect(readValidity("valid 30 days from 2026-01-15")).toBe("2026-02-14");
    expect(readValidity("Non dichiarata")).toBeNull();
    expect(readValidity("two weeks")).toBeNull();
    expect(readValidity(null)).toBeNull();
  });

  it("says whether it still holds: until its last day included", () => {
    expect(validityOf("2026-10-15", "2026-10-15")).toBe("open");
    expect(validityOf("2026-10-15", "2026-10-16")).toBe("expired");
    expect(validityOf(null, "2026-10-16")).toBe("unknown");
  });
});

describe("reading a file", () => {
  const file = read();

  it("keeps what can be read and sets aside the rest, with the reason", () => {
    expect(file.companies.map((c) => c.reference)).toEqual(["MOCK-WAX-1", "MOCK-WICK-1", "MOCK-OUT-1"]);
    expect(file.rejected.map((r) => `${r.kind}: ${r.name}`)).toEqual(["company: Mock Unreadable Ltd", "offer: MOCK-WAX-1 · MOCK C", "offer: MOCK-NOBODY · MOCK D"]);
    expect(file.rejected[0].reason).toContain("???");
    // A price with no currency is not a price yet: it is never taken for euro.
    expect(file.rejected[1].reason).toContain("currency");
    expect(file.repeated).toEqual(["MOCK-WAX-1 · MOCK B"]);
  });

  it("reads a company as written: nothing is filled in", () => {
    const [wax, wicks] = file.companies;
    expect(wax).toMatchObject({ name: "Mock Wax Kimya A.Ş.", country: "Turkey", contactName: "Ada Mock", status: "quote_received", statusText: "PREZZO RICEVUTO · NON FINALIZZATO", priority: "Urgente", attachments: "proforma.pdf", samples: null });
    expect(wax.vatNumber).toBe("TR1234567890");
    expect(wicks).toMatchObject({ categories: ["Wicks", "Wooden wicks"], status: "needs_information", phone: null, address: null, moq: null, checkedAt: "2026-03-09" });
  });

  it("puts back in their place the fields of a record whose columns slid by one, and says so", () => {
    const out = file.companies[2];
    expect(out).toMatchObject({ status: "not_suitable", sourceUrl: "https://mail.example/thread/3", priority: "Escluso", attachments: null });
    expect(out.notes).toBe("Leave out of industrial requests. Ticket 42. · EXCLUDED — retail");
    expect(out.warnings).toHaveLength(2);
    expect(out.original).toMatchObject({ source_email_url: "Escluso", notes: "https://mail.example/thread/3" });
  });

  it("reads one line per product quoted, each in its own currency and on its own terms", () => {
    expect(file.offers).toHaveLength(2);
    expect(file.offers[0]).toMatchObject({ productName: "MOCK A", unitPrice: 1.5, currency: "EUR", unit: "kg", quantity: 20000, incoterm: "CFR", destination: "Mockport", validUntil: "2026-03-15", specs: { melting_point: "58–60°C", oil_content: "0,5%", packaging: "Slabs" } });
    expect(file.offers[1]).toMatchObject({ unitPrice: 1.25, currency: "USD", incoterm: "FOB", validUntil: "2026-03-17", validity: "7 gg da 10/03/2026" });
  });

  it("is not fooled by something that is not a file of replies", () => {
    expect(parseReplyFile("not json").ok).toBe(false);
    expect(parseReplyFile(JSON.stringify({ kind: "market_suppliers" })).ok).toBe(false);
  });
});

describe("what a price includes", () => {
  it("is read from the delivery terms, and never turned into a delivered price", () => {
    expect(deliveryOf("FOB", "Dalian")).toMatchObject({ incoterm: "FOB", scope: "not_included" });
    expect(deliveryOf("CFR", "Salerno")).toMatchObject({ incoterm: "CFR", scope: "to_named_place", label: "Freight included to Salerno" });
    expect(deliveryOf("cif Genova", "Genova").text).toContain("delivery from there to you are not");
    expect(deliveryOf("DAP", "the plant")).toMatchObject({ scope: "delivered" });
    expect(deliveryOf(null, null)).toMatchObject({ incoterm: null, scope: "unknown" });
  });
});

describe("the same company", () => {
  it("is known by an identifier or by its name, and only suspected by a resemblance", () => {
    expect(sameCompanyAs(known({ name: "Mock Wax", vatNumber: "TR1234567890" }), known({ name: "Another name", vatNumber: "TR 123 456 7890" }))).toMatchObject({ certain: true });
    expect(sameCompanyAs(known({ name: "Mock Wax Kimya A.Ş." }), known({ name: "MOCK WAX KIMYA AS" }))).toMatchObject({ certain: true });
    expect(sameCompanyAs(known({ name: "Mock Wax S.r.l.", website: "https://mockwax.example", phone: "+39 02 1234567" }), known({ name: "Mockwax di Rossi Giovanni", website: "www.mockwax.example/", phone: "02 1234567" }))).toMatchObject({ certain: true });
    expect(sameCompanyAs(known({ name: "Jan Mockowski", country: "Poland" }), known({ name: "Mockowski Renata – Wyrób artykułów", country: "Polonia" }))).toMatchObject({ certain: false });
    // A word any company can carry says nothing, and neither does a family name in another country.
    expect(sameCompanyAs(known({ name: "Northern Plastics Ltd" }), known({ name: "Fabbrica Candele e Plastics del Sud S.r.l." }))).toBeNull();
    expect(sameCompanyAs(known({ name: "Jan Mockowski", country: "Poland" }), known({ name: "Mockowski Brothers Trading Inc", country: "United States" }))).toBeNull();
    // A shared mailbox is nobody's domain.
    expect(sameCompanyAs(known({ name: "Alpha", email: "alpha@gmail.com" }), known({ name: "Beta", email: "beta@gmail.com" }))).toBeNull();
  });
});

describe("the plan", () => {
  const file = read();

  it("adds what is new, with its offers and the message it was read from", () => {
    const plan = planReplies(file, EMPTY, "2026-03-11");
    expect(plan.counts).toMatchObject({ create: 3, update: 0, unchanged: 0, offersNew: 2, offersKnown: 0, messagesNew: 3, kept: 0 });
    expect(plan.counts.byStatus).toEqual({ quote_received: 1, needs_information: 1, not_suitable: 1 });
    expect(plan.companies[0].message).toMatchObject({ date: "2026-03-10", status: "quote_received", reference: "https://mail.example/thread/1", attachments: "proforma.pdf" });
    expect(summarise(plan).rows[0]).toMatchObject({ action: "create", offersNew: 2 });
  });

  it("changes nothing when the same file is read again", () => {
    const plan = planReplies(file, stored(file), "2026-03-12");
    expect(plan.counts).toMatchObject({ create: 0, update: 0, unchanged: 3, offersNew: 0, offersKnown: 2, messagesNew: 0 });
  });

  it("never writes twice a company that is on file under another request", () => {
    const next = read(mockFile((f) => {
      f.suppliers = [{ ...f.suppliers[0], supplier_id: "MOCK-WAX-9", name: "MOCK WAX KIMYA", category: "Blends", status: "RICHIEDE SPECIFICHE", reply_group: "", verified_at: "2026-04-01" }];
      f.quotations = [];
      f.excluded = [];
    }));
    const [row] = planReplies(next, stored(file), "2026-04-02").companies;
    expect(row).toMatchObject({ action: "update", supplierId: "id-MOCK-WAX-1", threadId: null, name: "Mock Wax Kimya A.Ş." });
    // A second request to the same company: its own conversation, with its own status.
    expect(row.thread.status).toBe("needs_information");
    expect(row.categories).toEqual(["Blends"]);
  });

  it("reads two records of one file as one new company", () => {
    const twice = read(mockFile((f) => {
      f.suppliers = [f.suppliers[1], { ...f.suppliers[1], supplier_id: "MOCK-WICK-2", categories: ["Lids"] }];
      f.quotations = [];
    }));
    const plan = planReplies(twice, EMPTY, "2026-03-11");
    expect(plan.companies.map((c) => [c.action, c.sameAs])).toEqual([["create", null], ["update", "MOCK-WICK-1"]]);
  });

  it("fills in what was empty, replaces what a newer file corrects, and never empties a value", () => {
    const newer = read(mockFile((f) => {
      Object.assign(f.suppliers[1], { phone: "+49 30 000000", products: "Cotton wicks only", next_action: "", verified_at: "2026-03-20" });
    }));
    const row = planReplies(newer, stored(file), "2026-03-21").companies[1];
    expect(row.action).toBe("update");
    expect(row.changes).toEqual([
      { field: "phone", from: null, to: "+49 30 000000" },
      { field: "products", from: "Cotton and wooden wicks", to: "Cotton wicks only" },
    ]);
    expect(row.thread).not.toHaveProperty("nextAction");
  });

  it("keeps what a person wrote, and what is newer than the file — and says what the file wanted", () => {
    const changed = read(mockFile((f) => {
      Object.assign(f.suppliers[1], { email: "other@mockwicks.example", status: "RIFIUTO COMMERCIALE" });
    }));
    const mine = stored(file, (c) => {
      c.confirmed = ["email"];
      c.threads[0].confirmed = ["status"];
    });
    const row = planReplies(changed, mine, "2026-03-11").companies[1];
    expect(row.kept).toEqual([
      { field: "email", stored: "info@mockwicks.example", incoming: "other@mockwicks.example", reason: "confirmed" },
      { field: "status", stored: "needs_information", incoming: "not_suitable", reason: "confirmed" },
    ]);
    expect(row.company).not.toHaveProperty("email");

    const older = read(mockFile((f) => {
      Object.assign(f.suppliers[1], { products: "An older reading", verified_at: "2026-01-01" });
    }));
    expect(planReplies(older, stored(file), "2026-03-11").companies[1].kept).toEqual([{ field: "products", stored: "Cotton and wooden wicks", incoming: "An older reading", reason: "older" }]);
  });

  it("adds a line quoted again at another price next to the first, which stays", () => {
    const repriced = read(mockFile((f) => {
      f.quotations[0].price_per_kg = 1.4;
    }));
    const row = planReplies(repriced, stored(file), "2026-03-11").companies[0];
    expect(row.offers.map((o) => o.unitPrice)).toEqual([1.4]);
    expect(row.offersKnown).toBe(1);
  });

  it("points out where else the buyer's records know the company, and touches none of them", () => {
    const records: Records = {
      ...EMPTY,
      suppliers: [known({ name: "Somebody Else S.p.A." })],
      candidates: [{ ...known({ name: "Mock Wicks", website: "http://www.mockwicks.example/" }), products: [{ id: "p1", name: "Wick 12" }] }],
      directory: [{ ...known({ name: "Mock Wicks GmbH & Co. KG", website: "https://mockwicks.example" }), market: "wicks" }],
    };
    const row = planReplies(file, records, "2026-03-11").companies[1];
    expect(row.action).toBe("create");
    expect(row.elsewhere.map((e) => [e.where, e.certain])).toEqual([["candidate", true], ["directory", true]]);
    expect(row.elsewhere[0].products).toEqual([{ id: "p1", name: "Wick 12" }]);
  });

  it("says a name resembles one on file, and still does not merge them", () => {
    const records: Records = { ...EMPTY, replies: stored(file).replies.map((r) => ({ ...r, name: "Mock Wicks Handel", website: null, email: null, threads: [] })).slice(1, 2) };
    const row = planReplies(file, records, "2026-03-11").companies[1];
    expect(row.action).toBe("create");
    expect(row.warnings.join(" ")).toContain("Mock Wicks Handel");
  });
});

describe("a conversation's statuses", () => {
  const offer = (validation: ReplyOffer["validation"]) => ({ validation }) as ReplyOffer;
  it("says a price received is still to validate until someone verified the product", () => {
    expect(statusesOf({ status: "quote_received", offers: [offer("required")] })).toEqual(["quote_received", "technical_validation_required"]);
    expect(statusesOf({ status: "quote_received", offers: [offer("validated"), offer("not_equivalent")] })).toEqual(["quote_received"]);
    expect(statusesOf({ status: "needs_information", offers: [] })).toEqual(["needs_information"]);
  });

  it("orders the work by the priority as written", () => {
    expect(["Media", null, "Urgente", "Bassa", "Alta", "Escluso"].sort((a, b) => priorityRank(a) - priorityRank(b))).toEqual(["Urgente", "Alta", "Media", "Bassa", null, "Escluso"]);
  });
});
