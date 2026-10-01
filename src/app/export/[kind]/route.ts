/** CSV exports: /export/products · suppliers · opportunities · price-history?product= · comparison?product= */
import { getDataset, getIntel } from "@/lib/data";
import { comparisonCsv, opportunitiesCsv, priceHistoryCsv, productsCsv, suppliersCsv } from "@/lib/intel/csv";

export async function GET(req: Request, ctx: RouteContext<"/export/[kind]">) {
  const { kind } = await ctx.params;
  const productId = new URL(req.url).searchParams.get("product");
  const [data, intel] = await Promise.all([getDataset(), getIntel()]);
  const pi = productId ? intel.products.find((p) => p.product.id === productId) : undefined;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  let csv: string | null = null;
  let name = kind;
  if (kind === "products") csv = productsCsv(intel, data);
  else if (kind === "suppliers") csv = suppliersCsv(intel);
  else if (kind === "opportunities") csv = opportunitiesCsv(intel, data);
  else if (kind === "price-history" && pi) {
    csv = priceHistoryCsv(pi, data);
    name = `price-history-${slug(pi.product.sku)}`;
  } else if (kind === "comparison" && pi) {
    csv = comparisonCsv(pi);
    name = `supplier-comparison-${slug(pi.product.sku)}`;
  }
  if (csv == null) return new Response("Not found", { status: 404 });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${intel.asOf}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
