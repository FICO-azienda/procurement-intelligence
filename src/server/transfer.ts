/**
 * Moving a workspace's data from one database to another, whole: to give a
 * colleague the same data on their own computer, or to move from the
 * embedded database to a shared Postgres. Rules that must hold:
 *
 *  - the copy is made by the database itself, never by this code: every row
 *    is written out as the JSON Postgres makes of it and read back by
 *    Postgres into the same types — no number, date or text passes through a
 *    conversion of ours on the way;
 *  - it is read through the running app's own connection: the embedded
 *    database is never opened by a second process;
 *  - it is loaded only into a database that holds nothing, in one
 *    transaction: either the whole of it is there or none of it;
 *  - what was loaded is counted against what was written out, table by
 *    table, and the purchases' total is compared to the cent: a transfer that
 *    does not match says so and is not a transfer;
 *  - sign-ins are not data: nobody is signed in on another machine. Accounts
 *    travel, with their password hashes — the file is as private as the data.
 */
import { sql } from "drizzle-orm";
import type { DB } from "@/db";

/** Left behind: live sessions of this machine's browsers. */
const NOT_DATA = new Set(["auth_sessions"]);
const CHUNK = 250;

export interface TransferManifest {
  format: 1;
  exportedAt: string;
  /** The last migration applied where the data comes from: the target must be at the same one. */
  migration: string | null;
  tables: Record<string, number>;
  purchases: { lines: number; invoices: number; total: string | null };
}

const tablesOf = async (db: DB) => (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => (r as { table_name: string }).table_name).filter((t) => !NOT_DATA.has(t));

export async function manifestOf(db: DB): Promise<TransferManifest> {
  const tables: Record<string, number> = {};
  for (const t of await tablesOf(db)) tables[t] = Number(((await db.execute(sql.raw(`select count(*)::int as n from "${t}"`))).rows[0] as { n: number }).n);
  const [p] = (await db.execute(sql`select count(*)::int as lines, count(distinct (supplier_id, invoice_reference))::int as invoices, sum(total_amount)::text as total from purchases`)).rows as { lines: number; invoices: number; total: string | null }[];
  const [m] = (await db.execute(sql`select hash from drizzle.__drizzle_migrations order by created_at desc limit 1`).catch(() => ({ rows: [] }))).rows as { hash: string }[];
  return { format: 1, exportedAt: new Date().toISOString(), migration: m?.hash ?? null, tables, purchases: { lines: Number(p.lines), invoices: Number(p.invoices), total: p.total } };
}

const line = (table: string, rows: string) => `{"table":"${table}","rows":${rows}}`;
const PREFIX = /^\{"table":"([a-z_0-9]+)","rows":/;

/** The whole of the data, one line of text at a time: the manifest first, then every table in pieces. */
export async function* dump(db: DB): AsyncGenerator<string> {
  const manifest = await manifestOf(db);
  yield JSON.stringify({ manifest });
  for (const [table, count] of Object.entries(manifest.tables)) {
    for (let offset = 0; offset < count; offset += CHUNK) {
      const [row] = (await db.execute(sql.raw(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text as rows from (select * from "${table}" order by 1 limit ${CHUNK} offset ${offset}) t`))).rows as { rows: string }[];
      yield line(table, row.rows);
    }
  }
}

export class TransferError extends Error {}

/**
 * Loads a dump into a database that holds nothing, all of it or none, and
 * checks what arrived against the manifest. The target must have the same
 * migrations applied — and none of its own data.
 */
export async function restore(db: DB, lines: Iterable<string> | AsyncIterable<string>): Promise<{ manifest: TransferManifest; loaded: Record<string, number> }> {
  const before = await manifestOf(db);
  const busy = Object.entries(before.tables).filter(([, n]) => n > 0).map(([t]) => t);
  if (busy.length) throw new TransferError(`The target database already holds data (${busy.slice(0, 5).join(", ")}${busy.length > 5 ? "…" : ""}): a transfer is loaded only into an empty one.`);
  let manifest: TransferManifest | null = null;
  await db.transaction(async (tx) => {
    // Rows arrive table by table, not in the order their references need: references are checked by the count at the end, and nothing of it stays if that fails.
    await tx.execute(sql`set local session_replication_role = replica`);
    for await (const text of lines) {
      if (!text.trim()) continue;
      if (!manifest) {
        manifest = (JSON.parse(text) as { manifest: TransferManifest }).manifest;
        if (!manifest || manifest.format !== 1) throw new TransferError("This is not a data transfer file.");
        if (manifest.migration && before.migration && manifest.migration !== before.migration) throw new TransferError("The data comes from another version of the app: bring both to the same version (git pull) and try again.");
        continue;
      }
      const table = PREFIX.exec(text)?.[1];
      if (!table || !(table in before.tables)) throw new TransferError(`The file names a table this version of the app does not have${table ? `: ${table}` : ""}.`);
      // The rows are handed back to the database as the text it wrote: it reads them into its own types.
      const rows = text.slice(text.indexOf('"rows":') + 7, -1);
      await tx.execute(sql`insert into ${sql.raw(`"${table}"`)} select * from jsonb_populate_recordset(null::${sql.raw(`"${table}"`)}, ${rows}::jsonb)`);
    }
    if (!manifest) throw new TransferError("The file is empty.");
    // Counted before anything is kept: a transfer that does not match is undone with the transaction, and the target stays empty.
    const arrived = await manifestOf(tx as unknown as DB);
    const expected: TransferManifest = manifest;
    const wrong = Object.keys(expected.tables).filter((t) => (arrived.tables[t] ?? -1) !== expected.tables[t]);
    if (wrong.length || arrived.purchases.total !== expected.purchases.total) {
      throw new TransferError(`The data that arrived is not the data that left: ${wrong.map((t) => `${t} ${arrived.tables[t] ?? 0} instead of ${expected.tables[t]}`).join(", ") || `purchases total ${arrived.purchases.total} instead of ${expected.purchases.total}`}. Nothing was loaded.`);
    }
  });
  const after = await manifestOf(db);
  return { manifest: manifest!, loaded: after.tables };
}
