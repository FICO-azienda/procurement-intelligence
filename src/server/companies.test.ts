/**
 * Companies and their roles on real in-memory Postgres: every record gets its
 * company once, the same VAT number ties archives together, a resemblance is
 * only proposed, a person's word is kept and can be taken back. Mock companies.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { addCompanyContact, companyOfRecord, readCompanies, readCompany, relateCompanies, removeCompanyContact, syncCompanies, undoCompanyRelation } from "./companies";

let db: DB;
const ME = { type: "user" as const, id: "Mock Person" };
const ids: Record<string, string> = {};
// Everything of a record but the pointer to its company (and the time it was last written).
const strip = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "companyId" && k !== "updatedAt")));

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [ser] = await db.insert(schema.suppliers).values({ name: "Mock Cere S.p.A.", vatNumber: "IT00000000019", country: "Italy" }).returning();
  const [serOld] = await db.insert(schema.suppliers).values({ name: "MOCK CERE SPA", country: "Italy", mergedIntoId: ser.id }).returning();
  const [other] = await db.insert(schema.suppliers).values({ name: "Mock Cere S.r.l.", vatNumber: "IT00000000027", country: "Italy" }).returning();
  const made = await db.insert(schema.products).values([1, 2, 3].map((i) => ({ name: `Mock container ${i}`, sku: `MC${i}`, unit: "pcs", kind: "component" }))).returning();
  await db.insert(schema.supplierCandidates).values(made.map((p) => ({ productId: p.id, name: "Mock Plast d.o.o.", website: "https://www.mockplast.example/", country: "Slovenia" })));
  const [dir] = await db.insert(schema.marketSuppliers).values({ market: "plastic_candle_containers", name: "Mock Plast", website: "https://mockplast.example/en", evidenceUrl: "https://mockplast.example/en/products" }).returning();
  const [reply] = await db.insert(schema.rfqSuppliers).values({ name: "Mock Cere Spa", vatNumber: "00000000019" }).returning();
  Object.assign(ids, { ser: ser.id, serOld: serOld.id, other: other.id, dir: dir.id, reply: reply.id, product: made[0].id });
}, 60_000);

describe("every record gets its company", () => {
  it("once, without touching anything of the records but the pointer", async () => {
    const before = { suppliers: await db.select().from(schema.suppliers), candidates: await db.select().from(schema.supplierCandidates), directory: await db.select().from(schema.marketSuppliers), replies: await db.select().from(schema.rfqSuppliers) };
    expect(await syncCompanies(db)).toEqual({ created: 4, linked: 0 });
    // Run again: nothing to do.
    expect(await syncCompanies(db)).toEqual({ created: 0, linked: 0 });
    const after = { suppliers: await db.select().from(schema.suppliers), candidates: await db.select().from(schema.supplierCandidates), directory: await db.select().from(schema.marketSuppliers), replies: await db.select().from(schema.rfqSuppliers) };
    for (const k of Object.keys(before) as (keyof typeof before)[]) expect(strip(after[k] as never)).toEqual(strip(before[k] as never));
    // Each step logged as the app's rules, never as a person.
    expect((await db.select().from(schema.auditEvents)).every((e) => e.actorType === "system" && e.entity === "company")).toBe(true);
  });

  it("the same VAT number in two archives and a merged record are one company; another VAT number is another company", async () => {
    const ser = await companyOfRecord(db, "supplier", ids.ser);
    expect(await companyOfRecord(db, "supplier", ids.serOld)).toBe(ser);
    expect(await companyOfRecord(db, "reply", ids.reply)).toBe(ser);
    expect(await companyOfRecord(db, "supplier", ids.other)).not.toBe(ser);
    const detail = (await readCompany(db, ser!))!;
    expect(detail).toMatchObject({ name: "Mock Cere S.p.A.", vatNumber: "IT00000000019", roles: { supplier: 1, reply: 1 } });
    expect(detail.otherNames).toEqual([]);
  });

  it("the candidates of one company for three products are one company; the directory's record of it is a proposal", async () => {
    const { companies, proposals } = await readCompanies(db);
    const plast = companies.find((c) => c.name === "Mock Plast d.o.o.")!;
    expect(plast.roles.candidate).toBe(3);
    const dir = await companyOfRecord(db, "directory", ids.dir);
    expect(dir).not.toBe(plast.id);
    expect(proposals.map((p) => [p.a, p.b].sort())).toContainEqual([plast.id, dir].sort());
    expect(proposals.every((p) => !p.automatic)).toBe(true);
  });
});

describe("what a person says", () => {
  it("'the same company' is a pointer, taken back whole; two VAT numbers are never one company", async () => {
    const plast = (await readCompanies(db)).companies.find((c) => c.name === "Mock Plast d.o.o.")!;
    const dir = (await companyOfRecord(db, "directory", ids.dir))!;
    await relateCompanies(db, plast.id, dir, "same_company", "Same site, same address", ME);
    expect(await companyOfRecord(db, "directory", ids.dir)).toBe(plast.id);
    const detail = (await readCompany(db, plast.id))!;
    expect(detail.roles).toMatchObject({ candidate: 3, directory: 1 });
    expect(detail.merged).toHaveLength(1);
    // The pair is no longer proposed.
    expect((await readCompanies(db)).proposals.some((p) => [p.a, p.b].includes(dir))).toBe(false);
    await undoCompanyRelation(db, detail.merged[0].relationId!, ME);
    expect(await companyOfRecord(db, "directory", ids.dir)).toBe(dir);

    const ser = (await companyOfRecord(db, "supplier", ids.ser))!;
    const other = (await companyOfRecord(db, "supplier", ids.other))!;
    await expect(relateCompanies(db, ser, other, "same_company", null, ME)).rejects.toThrow(/different VAT numbers/);
    await relateCompanies(db, ser, other, "same_group", "Sister companies", ME);
    expect((await readCompany(db, ser))!.relations).toMatchObject([{ relation: "same_group", other: { id: other }, note: "Sister companies" }]);
  });

  it("a contact is written by a person, with where it came from, and taken off with its row in the log", async () => {
    const ser = (await companyOfRecord(db, "supplier", ids.ser))!;
    await expect(addCompanyContact(db, ser, { name: "", email: "" }, ME)).rejects.toThrow(/at least/);
    const id = await addCompanyContact(db, ser, { name: "Mock Buyer Desk", email: "Sales@Mock-Cere.example", role: "Sales" }, ME);
    expect((await readCompany(db, ser))!.contactList).toMatchObject([{ name: "Mock Buyer Desk", email: "sales@mock-cere.example", source: "manual", createdBy: "Mock Person" }]);
    await removeCompanyContact(db, id, ME);
    expect((await readCompany(db, ser))!.contactList).toEqual([]);
    const [logged] = (await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entity, "company_contact"))).filter((e) => e.action === "delete");
    expect(logged.oldValue).toContain("Mock Buyer Desk");
  });
});
