/**
 * What the search box looks through, as one file — only for the read-only demo,
 * which has no server to ask: the snapshot saves it, and the demo searches in
 * the browser with the same `search()`. Everywhere else there is no such file.
 */
import { connection } from "next/server";
import { getDataset, getIntel, getLearning } from "@/lib/data";
import { searchCorpus } from "@/lib/search";
import { STATIC_DEMO } from "@/lib/static-demo";

export async function GET() {
  await connection();
  if (!STATIC_DEMO) return new Response("Not found", { status: 404 });
  const [data, intel, learning] = await Promise.all([getDataset(), getIntel(), getLearning()]);
  return Response.json(searchCorpus(data, intel, learning), { headers: { "Cache-Control": "no-store" } });
}
