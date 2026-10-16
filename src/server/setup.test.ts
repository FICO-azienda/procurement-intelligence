/**
 * A new installation names no company: it starts empty, asks who it is, and
 * writes the answer once — on real in-memory Postgres, with a mock company.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { ownCompany, readSettings } from "@/lib/data";
import { rfqText } from "@/lib/sourcing/rfq";
import { readDestinations } from "./destinations";
import { ensureWorkspaceOrg } from "./orgs";
import { setupCompany } from "./setup";

let db: DB;
const me = { type: "user" as const, id: "Mock Person" };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}, 60_000);

describe("a new installation", () => {
  it("names no company until it says who it is", async () => {
    const s = await readSettings(db);
    expect([s.companyName, s.configured]).toEqual(["", false]);
    expect(ownCompany(s).names).toEqual([]);
    expect((await ensureWorkspaceOrg(db)).name).toBe("");
  });

  it("writes the first start once: the company, its language, its town as a destination nobody confirmed yet", async () => {
    expect(await setupCompany(db, { companyName: "", country: "", language: "en" }, me)).toMatchObject({ errors: { companyName: expect.any(String), country: expect.any(String) } });
    expect((await readSettings(db)).configured).toBe(false);

    expect(await setupCompany(db, { companyName: "Mock Candles S.r.l.", country: "Italy", vatNumber: "IT01234567890", deliveryCity: "Mockville", deliveryProvince: "MV", language: "it" }, me)).toEqual({});
    const s = await readSettings(db);
    expect([s.companyName, s.country, s.vatNumber, s.language, s.configured, s.deliveryPlace]).toEqual(["Mock Candles S.r.l.", "Italy", "IT01234567890", "it", true, "Mockville (MV)"]);
    expect(ownCompany(s)).toEqual({ names: ["Mock Candles S.r.l."], vats: ["IT01234567890"] });
    const [d] = await readDestinations(db);
    expect([d.city, d.province, d.country, d.isDefault, d.confirmedAt]).toEqual(["Mockville", "MV", "Italy", true, null]);
    // The company's organisation carries the name it gave itself.
    expect((await ensureWorkspaceOrg(db)).name).toBe("Mock Candles S.r.l.");
    // Who wrote what, and when.
    const log = await db.select().from(schema.auditEvents);
    expect(log.filter((e) => e.entity === "settings").map((e) => [e.field, e.newValue, e.actorId])).toEqual([
      ["companyName", "Mock Candles S.r.l.", "Mock Person"],
      ["country", "Italy", "Mock Person"],
      ["vatNumber", "IT01234567890", "Mock Person"],
    ]);
  });

  it("asked again, changes the facts and leaves the destinations on file alone", async () => {
    await setupCompany(db, { companyName: "Mock Candles S.r.l.", country: "Italy", vatNumber: "IT01234567890", deliveryCity: "Elsewhere", language: "en" }, me);
    expect((await readDestinations(db)).map((d) => d.city)).toEqual(["Mockville"]);
  });

  it("a request for quotation of a company with no name says 'we', and signs with nobody's name", () => {
    const line = { productName: "Mock wax 52/54", unit: "kg", specifications: {}, tiers: [] } as unknown as Parameters<typeof rfqText>[0]["lines"][number];
    const draft = rfqText({ lines: [line], deliveryCountry: "Italy", companyName: "", userName: null, supplierName: "Mock Supplier" });
    expect(draft.body).toContain("We are looking for a supplier of the product below");
    expect(draft.body.trimEnd().endsWith("Thank you, and best regards")).toBe(true);
  });
});

describe("the code", () => {
  it("names no company of its own: each installation says who it is", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(full);
      }
    };
    walk(path.join(process.cwd(), "src"));
    const named = files.filter((f) => /Cereria Cicogna|cereria-cicogna/i.test(readFileSync(f, "utf8"))).map((f) => path.relative(process.cwd(), f));
    expect(named).toEqual([]);
  });
});
