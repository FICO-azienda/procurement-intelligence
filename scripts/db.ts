/**
 * npm run db:reset  → wipe everything and reload the demo dataset
 * npm run db:clear  → wipe everything (start from zero with real data)
 * tsx scripts/db.ts language it → set the interface language (the Pages demo builds one copy per language)
 *
 * With the local database, stop `npm run dev` first: the embedded Postgres
 * can only be opened by one process at a time. (The same actions are also
 * available in the app under Import → Data.)
 */
import { getDb } from "../src/db";
import { clearAll, seedDemo } from "../src/db/seed";
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
  await clearAll(db);
  if (command === "reset") await seedDemo(db);
  console.log(command === "reset" ? "Demo data loaded." : "All data cleared.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
