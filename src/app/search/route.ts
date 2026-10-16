/** Global search: /search?q=… → results for the command bar. */
import { routeAccess } from "@/server/guard";
import { getDataset, getIntel, getLearning, getT } from "@/lib/data";
import { search } from "@/lib/search";

export async function GET(req: Request) {
  // A signed-in person of the buyer — any one to read; the permission named to download.
  const access = await routeAccess(null);
  if (access.response) return access.response;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) return Response.json({ results: [] });
  const [data, intel, learning, t] = await Promise.all([getDataset(), getIntel(), getLearning(), getT()]);
  return Response.json({ results: search(q, data, intel, learning, t) }, { headers: { "Cache-Control": "no-store" } });
}
