/**
 * A workspace's data moved whole from one database to another: every table,
 * every row, every value as it was — on real in-memory Postgres. Mock data only.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { TransferError, dump, manifestOf, restore } from "./transfer";

const fresh = async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
};
const everything = async (db: DB) => {
  const out: Record<string, string> = {};
  for (const t of Object.keys((await manifestOf(db)).tables)) out[t] = ((await db.execute(sql.raw(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)::text as rows from "${t}" t`))).rows[0] as { rows: string }).rows;
  return out;
};

let source: DB;
let lines: string[];

beforeAll(async () => {
  source = await fresh();
  await source.insert(schema.settings).values({ id: 1, companyName: "Mock Buyer S.r.l.", language: "it" });
  const [a] = await source.insert(schema.suppliers).values({ name: "Mock Supplier A S.p.A.", vatNumber: "IT00000000001" }).returning();
  // A record that points to another of the same table, written before it: order must not matter.
  const [b] = await source.insert(schema.suppliers).values({ name: "Mock Supplier A", mergedIntoId: a.id }).returning();
  const [p] = await source.insert(schema.products).values({ name: "Mock paraffin 52/54", sku: "PAR", unit: "kg", kind: "direct_material", specs: { "Melting point": "52–54 °C", note: 'with "quotes" and è' }, currentSupplierId: a.id }).returning();
  for (let i = 0; i < 620; i++) await source.insert(schema.purchases).values({ productId: p.id, supplierId: i % 2 ? a.id : b.id, date: `2026-0${1 + (i % 9)}-1${i % 9}`, quantity: "1000.5", unit: "kg", unitPrice: "1.482917", totalAmount: "1483.658459", invoiceReference: `MOCK-${i % 40}` });
  const [org] = await source.insert(schema.organizations).values({ kind: "buyer", isWorkspace: true, name: "Mock Buyer S.r.l." }).returning();
  const [user] = await source.insert(schema.users).values({ name: "Mock User", email: "mock.user@example.com", passwordHash: "scrypt$mock$mock" }).returning();
  await source.insert(schema.orgMembers).values({ orgId: org.id, userId: user.id, role: "admin" });
  await source.insert(schema.authSessions).values({ userId: user.id, orgId: org.id, tokenHash: "mock-hash", expiresAt: new Date(Date.now() + 60_000) });
  lines = [];
  for await (const l of dump(source)) lines.push(l);
}, 60_000);

describe("moving a workspace's data", () => {
  it("writes out every table but the sign-ins, in pieces, with what to check on arrival", async () => {
    const { manifest } = JSON.parse(lines[0]) as { manifest: Awaited<ReturnType<typeof manifestOf>> };
    expect(manifest.tables).toMatchObject({ purchases: 620, suppliers: 2, products: 1, settings: 1, users: 1, org_members: 1 });
    expect(manifest.tables).not.toHaveProperty("auth_sessions");
    expect(manifest.purchases).toEqual({ lines: 620, invoices: 40, total: "919868.244580" });
    expect(lines.filter((l) => l.startsWith('{"table":"purchases"')).length).toBe(3);
    expect(lines.join("\n")).not.toContain("mock-hash");
  });

  it("arrives whole and unchanged: every table equal, value for value", async () => {
    const target = await fresh();
    const { loaded } = await restore(target, lines);
    expect(loaded.purchases).toBe(620);
    expect(await everything(target)).toEqual(await everything(source));
    // To the last decimal, and with the pointer between two records of the same table.
    expect((await target.select().from(schema.purchases).limit(1))[0]).toMatchObject({ unitPrice: "1.482917", totalAmount: "1483.658459", quantity: "1000.5000" });
    expect((await target.select().from(schema.suppliers)).filter((s) => s.mergedIntoId)).toHaveLength(1);
    expect((await target.select().from(schema.products))[0].specs).toEqual({ "Melting point": "52–54 °C", note: 'with "quotes" and è' });
    // Nobody is signed in on the other machine.
    expect(await target.select().from(schema.authSessions)).toEqual([]);
  }, 60_000);

  it("is loaded only into a database that holds nothing", async () => {
    const target = await fresh();
    await target.insert(schema.suppliers).values({ name: "Mock Already There" });
    await expect(restore(target, lines)).rejects.toThrow(/already holds data/);
    expect(await target.select().from(schema.purchases)).toEqual([]);
  }, 60_000);

  it("leaves nothing behind when what arrives is not what left", async () => {
    const target = await fresh();
    const short = lines.filter((l, i) => !(l.startsWith('{"table":"purchases"') && i === lines.findIndex((x) => x.startsWith('{"table":"purchases"'))));
    await expect(restore(target, short)).rejects.toBeInstanceOf(TransferError);
    const broken = await fresh();
    await expect(restore(broken, [lines[0], '{"table":"no_such_table","rows":[]}'])).rejects.toThrow(/does not have/);
    expect((await manifestOf(broken)).tables.suppliers).toBe(0);
    await expect(restore(await fresh(), ["{}"])).rejects.toThrow(/not a data transfer file/);
  }, 60_000);
});
