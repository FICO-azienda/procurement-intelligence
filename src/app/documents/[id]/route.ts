/** Serves an original uploaded file ("View source"). */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { getStorage } from "@/lib/storage";

export async function GET(_req: Request, ctx: RouteContext<"/documents/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) return new Response("This file is no longer available.", { status: 404 });
  const bytes = await getStorage().get(doc.storagePath);
  if (!bytes) return new Response("This file is no longer available.", { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": doc.mimeType ?? "application/octet-stream",
      "Content-Disposition": `${doc.mimeType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
