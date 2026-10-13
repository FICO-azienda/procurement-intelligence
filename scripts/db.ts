/**
 * npm run db:reset  → wipe everything and reload the demo dataset
 * npm run db:clear  → wipe everything (start from zero with real data)
 * tsx scripts/db.ts language it → set the interface language (the Pages demo builds one copy per language)
 *
 * With the local database, stop `npm run dev` first: the embedded Postgres
 * can only be opened by one process at a time.
 *
 * `reset` and `clear` are for the demo dataset. On a database that holds a
 * company's own data both stop and say so: nothing here deletes real data.
 * Whoever truly means to start again from nothing moves the data folder away
 * by hand, after a backup (`npm run data:export`) — a deliberate act, not a
 * command that can be typed by mistake.
 */
import { getDb } from "../src/db";
import { clearAll, seedDemo } from "../src/db/seed";
import { dataState } from "../src/server/data-guard";
import { settings } from "../src/db/schema";
import { isLocale } from "../src/lib/i18n";

async function main() {
  const command = process.argv[2];
  if (command === "language") {
    const language = process.argv[3];
    if (!isLocale(language)) throw new Error(`Unknown language: ${language}`);
    const db = await getDb();
    await db.insert(settings).values({ id: 1, language }).onConflictDoUpdate({ target: settings.id, set: { language } });
    console.log(`Language: ${language}.`);
    process.exit(0);
  }
  if (command !== "reset" && command !== "clear") {
    console.error("Usage: tsx scripts/db.ts <reset|clear>");
    process.exit(1);
  }
  const db = await getDb();
  if ((await dataState(db)) === "real") {
    console.error("\n✗ This database holds a company's own data: `db:" + command + "` only works on the demo dataset or on an empty database. Nothing was changed.");
    process.exit(1);
  }
  await clearAll(db);
  if (command === "reset") await seedDemo(db);
  console.log(command === "reset" ? "Demo data loaded." : "All data cleared.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
