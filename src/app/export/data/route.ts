/**
 * The whole of the workspace's data as one file, read through the running
 * app's own connection (server/transfer.ts): what `npm run data:export`
 * fetches. It holds everything — invoices, prices, accounts — so it answers
 * only to the workspace: where the workspace asks for a sign-in the proxy
 * lets nobody else through, and an admin's session is required here too.
 */
import { connection } from "next/server";
import { getDb } from "@/db";
import { routeAccess } from "@/server/guard";
import { dump } from "@/server/transfer";

export async function GET() {
  await connection();
  // The whole of the data, accounts included: only who manages the company (on its own computer, whoever sits at it).
  const access = await routeAccess("company.manage");
  if (access.response) return access.response;
  const db = await getDb();
  const lines = dump(db);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await lines.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value + "\n"));
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "content-disposition": `attachment; filename="procurement-data-${new Date().toISOString().slice(0, 10)}.ndjson"`, "cache-control": "no-store" } });
}
