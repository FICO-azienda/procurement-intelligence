/** CSV exports: /export/products · suppliers · opportunities · product-dataset · price-history?product= · comparison?product= */
import { getDataset, getIntel, getT } from "@/lib/data";
import { datasetRows } from "@/lib/dataset/profile";
import { getPriorityDataset } from "@/server/product-data";
import { comparisonCsv, opportunitiesCsv, priceHistoryCsv, productsCsv, suppliersCsv, toCsv } from "@/lib/intel/csv";

export async function GET(req: Request, ctx: RouteContext<"/export/[kind]">) {
  const { kind } = await ctx.params;
  const productId = new URL(req.url).searchParams.get("product");
  const [data, intel, t] = await Promise.all([getDataset(), getIntel(), getT()]);
  const pi = productId ? intel.products.find((p) => p.product.id === productId) : undefined;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  let csv: string | null = null;
  let name = kind;
  if (kind === "products") csv = productsCsv(intel, data, t);
  else if (kind === "suppliers") csv = suppliersCsv(intel, t);
  else if (kind === "opportunities") csv = opportunitiesCsv(intel, data, t);
  else if (kind === "product-dataset") {
    // The database stays the source of truth: this is a copy to read offline.
    const { rows } = await getPriorityDataset();
    const [headers, ...lines] = datasetRows(rows.map((r) => r.profile), t);
    csv = toCsv(headers, lines);
  }
  else if (kind === "price-history" && pi) {
    csv = priceHistoryCsv(pi, data, t);
    name = `price-history-${slug(pi.product.sku)}`;
  } else if (kind === "comparison" && pi) {
    csv = comparisonCsv(pi, t);
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

