/** The whole of a market directory as a workbook: /export/market/<market>. A copy to work on offline — the database stays the source. */
import { connection } from "next/server";
import { getDb } from "@/db";
import { todayISO } from "@/lib/analytics";
import { getT } from "@/lib/data";
import { marketOf } from "@/lib/markets/types";
import { marketWorkbook } from "@/server/markets";

export async function GET(_req: Request, ctx: RouteContext<"/export/market/[market]">) {
  await connection();
  const { market } = await ctx.params;
  if (!marketOf(market)) return new Response("Not found", { status: 404 });
  const bytes = await marketWorkbook(await getDb(), market, await getT());
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${market.replace(/_/g, "-")}-suppliers-${todayISO()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
