/**
 * Database connection.
 *
 * - No DATABASE_URL  → local embedded Postgres (PGlite) stored in .data/pglite.
 *   A brand-new local database is filled with demo data once; after that it is
 *   never re-seeded automatically (so clearing demo data sticks).
 * - DATABASE_URL set → any Postgres (e.g. Supabase). Same schema/migrations.
 *   Never auto-seeded.
 *
 * Migrations in ./drizzle are applied on startup in both cases.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";
import { seedDemo } from "./seed";

export type DB = PgliteDatabase<typeof schema>;

const migrationsFolder = path.join(process.cwd(), "drizzle");

// Survive Next.js hot reloads: one connection per process.
const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!globalForDb.__db) {
    globalForDb.__db = connect().catch((err) => {
      globalForDb.__db = undefined;
      throw err;
    });
  }
  return globalForDb.__db;
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

  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  // Runtime data folder, not app code: keep it out of build file tracing.
  const isNew = !existsSync(/*turbopackIgnore: true*/ dataDir);
  mkdirSync(/*turbopackIgnore: true*/ dataDir, { recursive: true });
  const db = drizzlePglite(new PGlite(dataDir), { schema });
  await migratePglite(db, { migrationsFolder });
  if (isNew) await seedDemo(db);
  return db;
}
