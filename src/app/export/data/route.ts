/**
 * The whole of the workspace's data as one file, read through the running
 * app's own connection (server/transfer.ts): what `npm run data:export`
 * fetches. It holds everything — invoices, prices, accounts — so it answers
 * only to the workspace: where the workspace asks for a sign-in the proxy
 * lets nobody else through, and an admin's session is required here too.
 */
import { connection } from "next/server";
import { getDb } from "@/db";
import { workspaceAccess } from "@/lib/auth/cookie";
import { dump } from "@/server/transfer";
import { workspacePrincipal } from "@/server/session";

export async function GET() {
  await connection();
  if (workspaceAccess() === "login") {
    const who = await workspacePrincipal();
    if (!who || !who.permissions.includes("company.manage")) return new Response("Only an admin of the workspace can take the data out.", { status: 403 });
  }
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
