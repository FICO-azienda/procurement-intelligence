/**
 * The workspace's data, taken out of one installation and put into another —
 * whole, and checked on arrival (src/server/transfer.ts).
 *
 *   npm run data:export                      from the app running on this computer → ./.data/exports/<day>/
 *   npm run data:import -- <folder>          into this computer's database, which must hold nothing
 *                                            (--data-root <folder>: another place than ./.data, to try it out)
 *
 * Export reads through the running app (http://localhost:3100, or --from
 * <address>): the embedded database is never opened by a second process, so
 * the app must be running. The folder holds everything — invoices, prices,
 * accounts, the documents on file: it is as private as the data, and belongs
 * in no public place.
 *
 * Import makes the target itself: the embedded database in ./.data/pglite
 * (or PGLITE_DIR), or the Postgres named by DATABASE_URL. It refuses a
 * target that already holds data; the app must be stopped while it runs.
 */
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import type { DB } from "../src/db";
import * as schema from "../src/db/schema";
import { restore, type TransferManifest } from "../src/server/transfer";

const root = process.cwd();
const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined);
const fail = (why: string): never => {
  console.error(`\n✗ ${why}`);
  process.exit(1);
};
const count = (dir: string): number => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0) : 0);
const say = (m: TransferManifest) =>
  `  ${Object.values(m.tables).reduce((a, b) => a + b, 0)} rows in ${Object.keys(m.tables).length} tables · ${m.purchases.lines} purchase lines of ${m.purchases.invoices} invoices, total ${m.purchases.total ?? "0"}\n` +
  `  suppliers ${m.tables.suppliers} · products ${m.tables.products} · candidates ${m.tables.supplier_candidates} · companies that answered ${m.tables.rfq_suppliers} · prices stated ${m.tables.rfq_offers}`;

async function exportData() {
  const from = flag("--from") ?? "http://localhost:3100";
  const out = path.resolve(flag("--out") ?? path.join(root, ".data", "exports", new Date().toISOString().slice(0, 10)));
  const res = await fetch(`${from}/export/data`).catch(() => null);
  if (!res || !res.ok) fail(`The app did not answer at ${from} (${res ? res.status : "not reachable"}): start it, and where it asks for a sign-in take the data out on the computer it runs on.`);
  const text = await res!.text();
  const manifest = (JSON.parse(text.slice(0, text.indexOf("\n"))) as { manifest: TransferManifest }).manifest;
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "data.ndjson"), text);
  // The documents on file and the research files are plain files: copied as they are.
  const files = process.env.FILE_STORAGE_DIR ?? path.join(root, ".data", "files");
  const research = path.join(root, ".data", "research");
  if (existsSync(files)) cpSync(files, path.join(out, "files"), { recursive: true });
  if (existsSync(research)) cpSync(research, path.join(out, "research"), { recursive: true });
  writeFileSync(path.join(out, "MANIFEST.json"), JSON.stringify({ ...manifest, documents: count(path.join(out, "files")), researchFiles: count(path.join(out, "research")) }, null, 2) + "\n");
  console.log(`\n✓ Exported to ${out}\n${say(manifest)}\n  documents on file ${count(path.join(out, "files"))} · research files ${count(path.join(out, "research"))}\n\n  This folder holds private data: hand it over privately, and never put it in a public repository.`);
}

async function importData() {
  const from = path.resolve(rest.find((a, i) => !a.startsWith("--") && !(rest[i - 1] ?? "").startsWith("--")) ?? "");
  // Where this installation keeps its data: the database, the documents on file and the research files, side by side.
  const dataRoot = path.resolve(flag("--data-root") ?? path.join(root, ".data"));
  const file = path.join(from, "data.ndjson");
  if (!existsSync(file) || !statSync(file).isFile()) fail(`No data.ndjson in ${from}: give the folder an export made.`);
  const migrationsFolder = path.join(root, "drizzle");
  let db: DB;
  let close: () => Promise<void>;
  let where: string;
  if (process.env.DATABASE_URL) {
    const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
    const pg = drizzlePostgres(client, { schema });
    await migratePostgres(pg, { migrationsFolder });
    db = pg as unknown as DB;
    close = () => client.end();
    where = "the Postgres database named by DATABASE_URL";
  } else {
    const dir = path.resolve(flag("--into") ?? process.env.PGLITE_DIR ?? path.join(dataRoot, "pglite"));
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    const lite = drizzlePglite(client, { schema });
    await migratePglite(lite, { migrationsFolder });
    db = lite as unknown as DB;
    close = () => client.close();
    where = dir;
  }
  try {
    const { manifest } = await restore(db, createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity }));
    if (!process.env.DATABASE_URL) {
      const files = process.env.FILE_STORAGE_DIR ?? path.join(dataRoot, "files");
      if (existsSync(path.join(from, "files"))) cpSync(path.join(from, "files"), files, { recursive: true });
      if (existsSync(path.join(from, "research"))) cpSync(path.join(from, "research"), path.join(dataRoot, "research"), { recursive: true });
    }
    console.log(`\n✓ Loaded into ${where}, and checked against what was exported on ${manifest.exportedAt.slice(0, 10)}\n${say(manifest)}${process.env.DATABASE_URL ? "\n  The documents on file were not copied: with a shared database they belong in a shared file store (SUPABASE_URL)." : ""}`);
  } catch (err) {
    await close();
    fail((err as Error).message);
  }
  await close();
}

if (command === "export") exportData().catch((e) => fail((e as Error).message));
else if (command === "import") importData().catch((e) => fail((e as Error).message));
else fail("Usage: npm run data:export [-- --from <address> --out <folder>]  |  npm run data:import -- <folder> [--into <database folder>]");
