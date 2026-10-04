/** Serves an original uploaded file ("View source"). */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { unwrapSigned } from "@/lib/import/extract/p7m";
import { getStorage } from "@/lib/storage";

export async function GET(_req: Request, ctx: RouteContext<"/documents/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) return new Response("This file is no longer available.", { status: 404 });
  let bytes = await getStorage().get(doc.storagePath);
  if (!bytes) return new Response("This file is no longer available.", { status: 404 });
  let { filename, mimeType } = doc;
  // A signed file can't be opened without signature software: what people want to see is the document inside.
  if (/\.p7m$/i.test(filename)) {
    try {
      bytes = unwrapSigned(bytes);
      filename = filename.replace(/\.p7m$/i, "");
      mimeType = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? "application/pdf" : "application/xml";
    } catch {
      // Can't be opened: hand over the file as it was uploaded.
    }
  }
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": mimeType ?? "application/octet-stream",
      // Only a PDF is shown in the browser: an XML file from outside is always a download.
      "Content-Disposition": `${mimeType === "application/pdf" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
