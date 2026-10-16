/**
 * Database connection.
 *
 * - No DATABASE_URL  → local embedded Postgres (PGlite) stored in .data/pglite.
 *   A brand-new database starts empty: the company says who it is on its first
 *   start, and loads the demo itself if it only wants to look around. Only the
 *   public read-only demo (NEXT_PUBLIC_STATIC_DEMO) or SEED_DEMO=1 fills a new
 *   database with the demo, once.
 * - DATABASE_URL set → any Postgres (e.g. Supabase). Same schema/migrations.
 *   Never auto-seeded.
 *
 * Migrations in ./drizzle are applied on startup in both cases. On the
 * embedded database a migration never reaches data already on file without a
 * copy made a moment before (server/backup.ts), and the company's own data is
 * copied once a day.
 *
 * The embedded database belongs to one process: the app. A build refuses to
 * open it, and so does a test run — tests work on databases of their own.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";
import { backupBeforeMigrations, dailyBackup } from "../server/backup";
import { seedDemo } from "./seed";

export type DB = PgliteDatabase<typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

// Survive Next.js hot reloads: one connection per process.
const globalForDb = globalThis as unknown as { __db?: Promise<DB>; __migrations?: number; __backupDay?: string };

/** Where the embedded database lives, and next to it the documents on file and the backups. */
const dataDir = () => process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
const dataRoot = () => path.dirname(dataDir());

/** When the list of migrations last changed: a new one is applied without restarting the dev server. */
const migrationsStamp = () => {
  try {
    return statSync(/*turbopackIgnore: true*/ path.join(migrationsFolder, "meta", "_journal.json")).mtimeMs;
  } catch {
    return 0;
  }
};

export function getDb(): Promise<DB> {
  // A build is another process: it must never open the data. A page that reads the database while it is being built
  // would open the embedded database a second time, next to the app that is running on it — which damages it. Every
  // page that reads data asks for the request first (`connection()`), so that it is only ever rendered when asked for.
  if (process.env.NEXT_PHASE === "phase-production-build") return Promise.reject(new Error("The database is not opened while the app is being built: the page that asked for it must wait for a request (connection())."));
  // Tests make their own databases, in memory. A test that reached for the app's connection would open the company's data: refused.
  if (process.env.VITEST && !process.env.PGLITE_DIR && !process.env.DATABASE_URL) return Promise.reject(new Error("Tests never open the app's database: make one in memory (new PGlite()) or point PGLITE_DIR at a copy."));
  if (!globalForDb.__db) {
    globalForDb.__migrations = migrationsStamp();
    globalForDb.__db = connect().catch((err) => {
      globalForDb.__db = undefined;
      throw err;
    });
  } else if (process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL) {
    // In development the connection outlives code reloads: a migration added meanwhile is applied here.
    const stamp = migrationsStamp();
    if (stamp !== globalForDb.__migrations) {
      globalForDb.__migrations = stamp;
      const opened = globalForDb.__db;
      globalForDb.__db = opened.then(async (db) => {
        try {
          // A copy first: if it cannot be written, the migration is not applied.
          await backupBeforeMigrations(db, dataRoot(), migrationsFolder);
          await migratePglite(db, { migrationsFolder });
        } catch (err) {
          // A migration that cannot be applied now — its file still being written, the list half-edited — must not
          // take the connection down with it: the connection stays as it was, and the next request tries again.
          globalForDb.__migrations = undefined;
          globalForDb.__db = opened;
          throw err;
        }
        return db;
      });
    }
  }
  keepDailyBackup(globalForDb.__db);
  return globalForDb.__db;
}

/** Once a day, after the response is on its way: a copy of the company's data. A failure is said in the log and tried again on a later request. */
function keepDailyBackup(opened: Promise<DB>) {
  if (process.env.DATABASE_URL || process.env.VITEST) return;
  const today = new Date().toISOString().slice(0, 10);
  if (globalForDb.__backupDay === today) return;
  globalForDb.__backupDay = today;
  opened
    .then((db) => dailyBackup(db, dataRoot()))
    .then((dir) => dir && console.log(`[backup] daily copy written to ${dir}`))
    .catch((err) => {
      globalForDb.__backupDay = undefined;
      console.error("[backup] the daily copy could not be written", err);
    });
}

async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // prepare: false keeps it compatible with Supabase's transaction pooler.
    const db = drizzlePostgres(postgres(url, { prepare: false }), { schema });
    await migratePostgres(db, { migrationsFolder });
    // Query-builder API is identical across drivers.
    return db as unknown as DB;
  }

  const dir = dataDir();
  // Runtime data folder, not app code: keep it out of build file tracing.
  const isNew = !existsSync(/*turbopackIgnore: true*/ dir);
  mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const db = drizzlePglite(new PGlite(dir), { schema });
  // Data already on file: a copy before any change of structure reaches it.
  if (!isNew) await backupBeforeMigrations(db, dataRoot(), migrationsFolder);
  await migratePglite(db, { migrationsFolder });
  if (isNew && (process.env.NEXT_PUBLIC_STATIC_DEMO === "1" || process.env.SEED_DEMO === "1")) await seedDemo(db);
  return db;
}
