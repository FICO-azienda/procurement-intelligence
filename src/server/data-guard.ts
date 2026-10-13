/**
 * What the database holds, and what may be wiped. The app starts on a demo
 * dataset; from the moment a company puts anything of its own in it — an
 * imported file, a purchase typed by hand, an answer to a request, a
 * candidate, a person — the data is the company's and nothing in the app may
 * clear it or replace it with the demo: not a button, not an action, not a
 * script run by mistake.
 *
 *   empty  nothing on file
 *   demo   only what the demo dataset writes (every purchase and quote says
 *          so in `source`), and nothing added to it
 *   real   anything else
 */
import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import type { Msg } from "@/lib/i18n";

export type DataState = "empty" | "demo" | "real";

export class DataGuardError extends Error {}

export const REAL_DATA_KEPT: Msg = "This is your company's data: it cannot be cleared or replaced with the demo data from the app.";

export async function dataState(db: DB): Promise<DataState> {
  const [r] = (
    await db.execute(sql`
      select
        (select count(*) from suppliers)::int as suppliers,
        (select count(*) from products)::int as products,
        (select count(*) from purchases)::int as purchases,
        (select count(*) from quotes)::int as quotes,
        (select count(*) from purchases where source <> 'demo')::int as own_purchases,
        (select count(*) from quotes where source <> 'demo')::int as own_quotes,
        (select count(*) from import_sessions)::int as imports,
        (select count(*) from rfq_suppliers)::int as replies,
        (select count(*) from supplier_candidates)::int as candidates,
        (select count(*) from market_suppliers)::int as directory,
        (select count(*) from users)::int as people,
        (select count(*) from orders)::int as orders
    `)
  ).rows as Record<string, number>[];
  const n = (k: string) => Number(r?.[k] ?? 0);
  if (n("own_purchases") || n("own_quotes") || n("imports") || n("replies") || n("candidates") || n("directory") || n("people") || n("orders")) return "real";
  // The demo is known by its purchases and quotes. Suppliers or products with none of them were typed in by someone.
  if (n("purchases") || n("quotes")) return "demo";
  return n("suppliers") || n("products") ? "real" : "empty";
}

/** Throws unless the data may be wiped: an empty database or the untouched demo. */
export async function mustBeDisposable(db: DB): Promise<void> {
  if ((await dataState(db)) === "real") throw new DataGuardError(REAL_DATA_KEPT);
}
