/**
 * A schema change, made safely on a machine that holds real data and may have
 * the app running. The running app applies whatever is in ./drizzle as soon
 * as its list changes, so nothing is written there until it is whole and has
 * been tried:
 *
 *   npx tsx scripts/migrate-safe.ts <name> [--sql <file with statements to add>] [--staged]
 *
 *  1. the migration is generated in a staging folder (.data/migration-staging),
 *     never in ./drizzle;
 *  2. every migration, old and new, is applied to an empty database: the new
 *     one is whole and its SQL runs;
 *  3. it is applied to a copy of the real data, and every table that existed
 *     before must still hold the rows it held;
 *  4. the real data is backed up (.data/backups/<day>-before-<name>);
 *  5. only then it is published: the files first, the list last and in one
 *     move, so that the app never reads a list that names a file not there.
 *
 * If any step fails nothing is published and the real data is untouched. To
 * take a published migration back: stop the app, restore the backup folder
 * over the data folder, and remove the migration's three entries from
 * ./drizzle (the .sql, its snapshot, its line in meta/_journal.json).
 * With DATABASE_URL set the data is not a local folder: step 3 and 4 are
 * skipped, and said to be.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const root = process.cwd();
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--sql");
const extra = args.includes("--sql") ? args[args.indexOf("--sql") + 1] : null;
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error("Usage: npx tsx scripts/migrate-safe.ts <name_in_snake_case> [--sql <file>]");
  process.exit(1);
}

const live = path.join(root, "drizzle");
const staging = path.join(root, ".data", "migration-staging");
const staged = path.join(staging, "drizzle");
const dataDir = process.env.PGLITE_DIR ?? path.join(root, ".data", "pglite");
const fail = (why: string): never => {
  console.error(`\n✗ ${why}\n  Nothing was published; the data was not touched.`);
  process.exit(1);
};
const journalOf = (dir: string) => JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
const countAll = async (db: ReturnType<typeof drizzle>) => {
  const tables = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).rows.map((r) => (r as { table_name: string }).table_name);
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number(((await db.execute(sql.raw(`select count(*)::int as n from "${t}"`))).rows[0] as { n: number }).n);
  return out;
};

async function main() {
  // 1. Generate in staging — or take what was staged by hand (--staged), when a change had to be generated in several
  //    passes: drizzle-kit asks whether a table was renamed when one is dropped and another made, and cannot be answered here.
  let tag: string;
  let snapshot: string;
  if (args.includes("--staged")) {
    if (!existsSync(staged)) fail("Nothing is staged in .data/migration-staging/drizzle.");
    const entry = journalOf(staged).entries.at(-1)!;
    if (journalOf(staged).entries.length !== journalOf(live).entries.length + 1 || !entry.tag.endsWith(`_${name}`)) fail(`The staging folder must hold exactly one new migration, named …_${name}.`);
    tag = entry.tag;
    snapshot = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
  } else {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    cpSync(live, staged, { recursive: true });
    const before = journalOf(staged).entries.length;
    const config = path.join(root, "drizzle.staging.config.ts");
    writeFileSync(config, `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "postgresql", schema: "./src/db/schema.ts", out: "./.data/migration-staging/drizzle" });\n`);
    // No terminal is handed over: a question drizzle-kit would ask makes it stop, instead of waiting for ever.
    const made = spawnSync("npx", ["drizzle-kit", "generate", "--config", "drizzle.staging.config.ts"], { cwd: root, stdio: ["ignore", "inherit", "inherit"], timeout: 120_000 });
    rmSync(config, { force: true });
    if (made.status !== 0) fail("The migration could not be generated. If drizzle-kit asked whether a table or a column was renamed, generate it in passes and run this again with --staged.");
    const journal = journalOf(staged);
    if (journal.entries.length !== before + 1) fail(journal.entries.length === before ? "The schema has not changed: there is nothing to migrate." : "More than one migration was generated.");
    const entry = journal.entries.at(-1)!;
    tag = `${String(entry.idx).padStart(4, "0")}_${name}`;
    renameSync(path.join(staged, `${entry.tag}.sql`), path.join(staged, `${tag}.sql`));
    entry.tag = tag;
    writeFileSync(path.join(staged, "meta", "_journal.json"), JSON.stringify(journal, null, 2) + "\n");
    snapshot = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
  }
  if (extra) writeFileSync(path.join(staged, `${tag}.sql`), `${readFileSync(path.join(staged, `${tag}.sql`), "utf8").trimEnd()}\n--> statement-breakpoint\n${readFileSync(extra, "utf8").trim()}\n`);
  for (const f of [`${tag}.sql`, path.join("meta", snapshot)]) if (!existsSync(path.join(staged, f))) fail(`The staged migration is not whole: ${f} is missing.`);
  console.log(`\n1. Staged: ${tag}.sql`);

  // 2. Every migration on an empty database.
  const empty = drizzle(new PGlite());
  await migrate(empty, { migrationsFolder: staged }).catch((err) => fail(`It does not apply to an empty database: ${(err as Error).message}`));
  console.log(`2. Applies to an empty database (${Object.keys(await countAll(empty)).length} tables).`);

  // 3. On a copy of the real data.
  const local = !process.env.DATABASE_URL && existsSync(dataDir);
  if (local) {
    const copy = path.join(staging, "db");
    cpSync(dataDir, copy, { recursive: true });
    const client = new PGlite(copy);
    const db = drizzle(client);
    const then = await countAll(db);
    await migrate(db, { migrationsFolder: staged }).catch((err) => fail(`It does not apply to a copy of the data: ${(err as Error).message}`));
    const now = await countAll(db);
    await client.close();
    const lost = Object.keys(then).filter((t) => t in now && now[t] !== then[t]);
    const gone = Object.keys(then).filter((t) => !(t in now) && then[t] > 0);
    if (lost.length || gone.length) fail(`Rows would change on the real data: ${[...lost.map((t) => `${t} ${then[t]} → ${now[t]}`), ...gone.map((t) => `${t} dropped with ${then[t]} rows`)].join(", ")}`);
    console.log(`3. Applies to a copy of the data: ${Object.keys(then).length} tables keep their rows (${Object.values(then).reduce((a, b) => a + b, 0)} in all).`);

    // 4. Back up the real data.
    const backup = path.join(root, ".data", "backups", `${new Date().toISOString().slice(0, 10)}-before-${name}`);
    rmSync(backup, { recursive: true, force: true });
    mkdirSync(path.dirname(backup), { recursive: true });
    cpSync(dataDir, backup, { recursive: true });
    if (readdirSync(backup).length !== readdirSync(dataDir).length) fail("The backup is not whole.");
    console.log(`4. Backed up: ${path.relative(root, backup)}`);
  } else {
    console.log("3–4. Skipped: the data is not a local folder (DATABASE_URL), so it cannot be copied and tried here. Back it up with the database's own tools first.");
  }

  // 5. Publish: the files, then the list in one move.
  cpSync(path.join(staged, `${tag}.sql`), path.join(live, `${tag}.sql`));
  cpSync(path.join(staged, "meta", snapshot), path.join(live, "meta", snapshot));
  const next = path.join(live, "meta", "_journal.json.next");
  cpSync(path.join(staged, "meta", "_journal.json"), next);
  renameSync(next, path.join(live, "meta", "_journal.json"));
  rmSync(staging, { recursive: true, force: true });
  console.log(`5. Published: drizzle/${tag}.sql. The running app applies it on its next request; open a page to check it answers.`);
}

main().catch((err) => fail((err as Error).message));
