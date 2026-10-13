/**
 * Backups the app makes by itself, of the embedded database: the whole of the
 * data written out by the database (server/transfer.ts), compressed, in a
 * dated folder under `<data>/backups/auto/`.
 *
 *  - before a migration is applied to a database that already holds data: a
 *    change of structure never reaches the data without a copy made a moment
 *    before, and if the copy cannot be written the migration is not applied;
 *  - once a day, while the data is the company's own.
 *
 * A backup is the same thing an export is: `npm run data:import -- <folder>`
 * loads it into an empty database and checks it on arrival. The documents on
 * file and the research files are plain files next to the database and are
 * not in it. The copies live on the same disk as the data: they protect from
 * a wrong click or a wrong migration, not from losing the computer.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { dataState } from "./data-guard";
import { dump, type TransferManifest } from "./transfer";

/** How many of each kind are kept: older ones are removed when a new one is written. */
export const BACKUPS_KEPT = { daily: 14, migration: 10 } as const;

const stamp = (d = new Date()) => d.toISOString().replace(/[:T]/g, "-").slice(0, 16);

/** Writes the whole of the data to `<root>/backups/auto/<stamp>-<reason>/` and says where. */
export async function writeBackup(db: DB, root: string, reason: string, now = new Date()): Promise<{ dir: string; manifest: TransferManifest }> {
  const lines: string[] = [];
  for await (const line of dump(db)) lines.push(line);
  const manifest = (JSON.parse(lines[0]) as { manifest: TransferManifest }).manifest;
  const dir = path.join(root, "backups", "auto", `${stamp(now)}-${reason}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "data.ndjson.gz"), gzipSync(lines.join("\n") + "\n"));
  writeFileSync(path.join(dir, "MANIFEST.json"), JSON.stringify({ ...manifest, reason, writtenAt: now.toISOString() }, null, 2) + "\n");
  return { dir, manifest };
}

/** The automatic backups on file, the newest first. */
export function listBackups(root: string): { name: string; dir: string; kind: "daily" | "migration" }[] {
  const base = path.join(root, "backups", "auto");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(base, e.name, "MANIFEST.json")))
    .map((e) => ({ name: e.name, dir: path.join(base, e.name), kind: e.name.endsWith("-daily") ? ("daily" as const) : ("migration" as const) }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function pruneBackups(root: string): void {
  for (const kind of ["daily", "migration"] as const) {
    for (const old of listBackups(root).filter((b) => b.kind === kind).slice(BACKUPS_KEPT[kind])) rmSync(old.dir, { recursive: true, force: true });
  }
}

/** The migrations the code has and the database has not applied yet. Zero on a database that was never migrated: there is nothing to protect in it. */
export async function pendingMigrations(db: DB, migrationsFolder: string): Promise<{ pending: number; last: string | null }> {
  let entries: { tag: string }[] = [];
  try {
    entries = (JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] }).entries;
  } catch {
    return { pending: 0, last: null };
  }
  const applied = await db
    .execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)
    .then((r) => Number((r.rows[0] as { n: number }).n))
    .catch(() => 0);
  if (applied === 0) return { pending: 0, last: null };
  return { pending: Math.max(0, entries.length - applied), last: entries.at(-1)?.tag ?? null };
}

/** Before a change of structure reaches data already on file: a copy first — or no migration. */
export async function backupBeforeMigrations(db: DB, root: string, migrationsFolder: string): Promise<string | null> {
  const { pending, last } = await pendingMigrations(db, migrationsFolder);
  if (!pending) return null;
  if ((await dataState(db).catch(() => "real" as const)) === "empty") return null;
  const { dir } = await writeBackup(db, root, `before-${last ?? "migration"}`);
  pruneBackups(root);
  return dir;
}

/** One copy a day of the company's own data. The demo is not worth a copy. */
export async function dailyBackup(db: DB, root: string, now = new Date()): Promise<string | null> {
  const today = now.toISOString().slice(0, 10);
  if (listBackups(root).some((b) => b.kind === "daily" && b.name.startsWith(today))) return null;
  if ((await dataState(db)) !== "real") return null;
  const { dir } = await writeBackup(db, root, "daily", now);
  pruneBackups(root);
  return dir;
}
