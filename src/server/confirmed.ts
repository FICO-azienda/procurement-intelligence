/** What people confirmed in the product dataset, for the parts of the app that compute with it (requests, research, true cost). */
import { inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { productDataFields } from "@/db/schema";
import { readNumber } from "@/lib/dataset/profile";

/**
 * The quantities a person confirmed, by product: what requests, research and
 * the true cost use before any figure the software works out.
 */
export async function confirmedQuantities(db: DB): Promise<Map<string, { annual: number | null; typicalOrder: number | null }>> {
  const rows = await db.select({ productId: productDataFields.productId, field: productDataFields.field, value: productDataFields.value }).from(productDataFields).where(inArray(productDataFields.field, ["annual_volume", "typical_order"]));
  const out = new Map<string, { annual: number | null; typicalOrder: number | null }>();
  for (const r of rows) {
    const q = out.get(r.productId) ?? { annual: null, typicalOrder: null };
    if (r.field === "annual_volume") q.annual = readNumber(r.value);
    else q.typicalOrder = readNumber(r.value);
    out.set(r.productId, q);
  }
  return out;
}
