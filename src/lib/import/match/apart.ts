/**
 * Two lines of one supplier on one day, written differently and priced
 * differently, are two products (lib/catalog/apart.ts). When the automatic
 * matching would put them under the same product, it is taken back for the
 * lines whose description is not already known for that product: they are
 * asked about, or proposed as new products — never filed together unseen.
 */
import { SAME_PRICE } from "../../catalog/apart";
import type { Msg } from "../../i18n";
import { normalizeKey, productKey } from "../normalize/text";
import type { MatchResult } from "./index";

interface Row {
  supplierId: string | null;
  productId: string | null;
  productMatch: MatchResult | null;
  productResolution: string | null;
  data: { date?: string | null; unitPrice?: number | null; productName?: string | null; description?: string | null; supplierName?: string | null };
}

/** Matches that rest on what is already on file for the product: a code, a name, a description confirmed before. */
const KNOWN: Msg[] = ["Same SKU", "Supplier's product code", "Recognised from a previous confirmation", "Same name", "Supplier's product name"];
const TWO_PRODUCTS: Msg = "Another line of the same day, at a different price, is that product: two lines at two prices are two products";

export function keepApart<R extends Row>(rows: R[]): R[] {
  const target = (r: R) => (r.productResolution && r.productResolution !== "auto" ? null : (r.productId ?? (r.productMatch?.status === "probable" ? r.productMatch.id : null)));
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const product = target(r);
    const seller = r.supplierId ?? normalizeKey(r.data.supplierName);
    if (!product || !seller || !r.data.date || !(Number(r.data.unitPrice) > 0)) return;
    const key = `${seller}|${r.data.date}|${product}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  });
  const out = [...rows];
  for (const members of groups.values()) {
    const text = (i: number) => productKey(rows[i].data.productName ?? rows[i].data.description);
    const prices = members.map((i) => Number(rows[i].data.unitPrice));
    if (new Set(members.map(text)).size < 2 || Math.max(...prices) <= Math.min(...prices) * (1 + SAME_PRICE)) continue;
    const known = members.filter((i) => rows[i].productMatch?.status === "exact" && KNOWN.includes(rows[i].productMatch!.reason));
    // The descriptions already on file for the product keep it; a description nobody confirmed does not join them at another price.
    const keep = new Set(known.map(text));
    const price = (i: number) => Number(rows[i].data.unitPrice);
    for (const i of members) {
      if (keep.has(text(i))) continue;
      // With nothing on file to go by, the first description keeps the proposal and the others are asked anew.
      if (!known.length && text(i) === text(members[0])) continue;
      const kept = known.length ? known : [members[0]];
      if (kept.every((k) => Math.abs(price(k) - price(i)) <= Math.min(price(k), price(i)) * SAME_PRICE)) continue;
      out[i] = { ...rows[i], productId: null, productResolution: null, productMatch: { status: "none", id: null, confidence: 0, reason: TWO_PRODUCTS, alternatives: [] } };
    }
  }
  return out;
}
