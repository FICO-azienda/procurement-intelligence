/**
 * A company's own data is never wiped by the app, and it is copied before
 * anything could change its structure — on real in-memory Postgres, with the
 * demo dataset and mock records only.
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { clearAll, seedDemo } from "@/db/seed";
import { BACKUPS_KEPT, backupBeforeMigrations, dailyBackup, listBackups, pendingMigrations, pruneBackups, writeBackup } from "./backup";
import { DataGuardError, dataState, mustBeDisposable } from "./data-guard";
import { manifestOf, restore } from "./transfer";

const migrationsFolder = path.join(process.cwd(), "drizzle");
const fresh = async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder });
  return db;
};
const count = async (db: DB) => Object.values((await manifestOf(db)).tables).reduce((a, b) => a + b, 0);
const ownPurchase = async (db: DB) => {
  const [s] = await db.select().from(schema.suppliers).limit(1);
  const [p] = await db.select().from(schema.products).limit(1);
  await db.insert(schema.purchases).values({ productId: p.id, supplierId: s.id, date: "2026-10-01", quantity: "10", unit: p.unit, unitPrice: "1.5", totalAmount: "15", source: "manual" });
};

describe("what the database holds", () => {
  it("tells nothing, the demo, and a company's own data apart", async () => {
    const db = await fresh();
    expect(await dataState(db)).toBe("empty");
    await seedDemo(db);
    expect(await dataState(db)).toBe("demo");
    await ownPurchase(db);
    expect(await dataState(db)).toBe("real");
  }, 60_000);

  it("takes anything a person added for the company's own: an upload, an answer, a candidate, a supplier typed by hand", async () => {
    for (const add of [
      (db: DB) => db.insert(schema.importSessions).values({ filename: "mock.csv", fileType: "csv", sourceType: "csv" }),
      (db: DB) => db.insert(schema.rfqSuppliers).values({ name: "Mock Answering Co" }),
      (db: DB) => db.insert(schema.marketSuppliers).values({ market: "plastic_candle_containers", name: "Mock Maker", evidenceUrl: "https://mock.example" }),
    ]) {
      const db = await fresh();
      await seedDemo(db);
      await add(db);
      expect(await dataState(db)).toBe("real");
    }
    const typed = await fresh();
    await typed.insert(schema.suppliers).values({ name: "Mock Typed Supplier" });
    expect(await dataState(typed)).toBe("real");
  }, 120_000);
});

describe("clearing everything", () => {
  it("works on the demo and on an empty database", async () => {
    const db = await fresh();
    await clearAll(db);
    await seedDemo(db);
    await clearAll(db);
    expect(await dataState(db)).toBe("empty");
  }, 60_000);

  it("is refused on a company's data, and not one row is touched", async () => {
    const db = await fresh();
    await seedDemo(db);
    await ownPurchase(db);
    const before = await count(db);
    await expect(clearAll(db)).rejects.toBeInstanceOf(DataGuardError);
    await expect(mustBeDisposable(db)).rejects.toBeInstanceOf(DataGuardError);
    expect(await count(db)).toBe(before);
    // Only a caller that says so in so many words — a test on its own database — goes through.
    await clearAll(db, { includingRealData: true });
    expect(await dataState(db)).toBe("empty");
  }, 60_000);
});

describe("backups the app makes by itself", () => {
  it("writes the whole of the data, and what it wrote loads back equal", async () => {
    const db = await fresh();
    await seedDemo(db);
    await ownPurchase(db);
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-backup-"));
    const { dir, manifest } = await writeBackup(db, root, "daily");
    expect(readdirSync(dir).sort()).toEqual(["MANIFEST.json", "data.ndjson.gz"]);
    expect(JSON.parse(readFileSync(path.join(dir, "MANIFEST.json"), "utf8")).purchases).toEqual(manifest.purchases);
    const target = await fresh();
    const lines = gunzipSync(readFileSync(path.join(dir, "data.ndjson.gz"))).toString("utf8").split("\n");
    const { loaded } = await restore(target, lines);
    expect(loaded).toEqual((await manifestOf(db)).tables);
  }, 60_000);

  it("copies the company's data once a day — never the demo, never twice", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-backup-"));
    const db = await fresh();
    await seedDemo(db);
    expect(await dailyBackup(db, root)).toBeNull();
    await ownPurchase(db);
    const day = new Date("2026-10-14T08:00:00Z");
    expect(await dailyBackup(db, root, day)).toContain("2026-10-14");
    expect(await dailyBackup(db, root, new Date("2026-10-14T17:00:00Z"))).toBeNull();
    expect(await dailyBackup(db, root, new Date("2026-10-15T08:00:00Z"))).toContain("2026-10-15");
    expect(listBackups(root).map((b) => b.kind)).toEqual(["daily", "daily"]);
  }, 60_000);

  it("keeps the newest and removes the rest", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-backup-"));
    const db = await fresh();
    await db.insert(schema.suppliers).values({ name: "Mock Typed Supplier" });
    for (let i = 0; i < BACKUPS_KEPT.daily + 3; i++) await writeBackup(db, root, "daily", new Date(Date.UTC(2026, 0, 1 + i, 8)));
    pruneBackups(root);
    const left = listBackups(root);
    expect(left).toHaveLength(BACKUPS_KEPT.daily);
    expect(left[0].name.startsWith("2026-01-17")).toBe(true);
  }, 60_000);

  it("makes a copy before a migration reaches data on file, and none when nothing is pending", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pi-backup-"));
    const db = await fresh();
    await seedDemo(db);
    expect((await pendingMigrations(db, migrationsFolder)).pending).toBe(0);
    expect(await backupBeforeMigrations(db, root, migrationsFolder)).toBeNull();
    // A database one migration behind: the last one is taken off its list, as if the code had just received it.
    await db.execute("delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)" as never);
    expect((await pendingMigrations(db, migrationsFolder)).pending).toBe(1);
    const dir = await backupBeforeMigrations(db, root, migrationsFolder);
    expect(dir).toContain("before-");
    expect(listBackups(root)[0].kind).toBe("migration");
    // A database never migrated holds nothing to protect.
    const blank = drizzle(new PGlite(), { schema }) as unknown as DB;
    expect((await pendingMigrations(blank, migrationsFolder)).pending).toBe(0);
  }, 60_000);
});
