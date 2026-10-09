/**
 * Two lines of one supplier on one day at two prices are two products,
 * however alike their descriptions: a supplier does not bill the same article
 * twice, on the same day, at two prices. It is the strongest thing an invoice
 * says about two similar names, and it is never overruled by how much they
 * resemble each other.
 *
 * The same day at the same price says less — two colours of an article often
 * cost the same — but still that the supplier wrote two lines, not one.
 */

export interface BoughtLine {
  productId: string;
  supplierId: string;
  /** ISO date of the purchase. */
  date: string;
  /** Unit price, on one basis for all the lines. */
  price: number;
}

export interface SameDay {
  date: string;
  /** The two prices, the lower first. */
  low: number;
  high: number;
  /** Different prices: two products, with no exception. False: billed apart at one price. */
  different: boolean;
}

/** Prices closer than this are one price written with more or fewer decimals. */
export const SAME_PRICE = 0.005;

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** For every two products one supplier billed on the same day: the latest day it happened at different prices, or else at the same price. */
export function boughtSameDay(lines: BoughtLine[]): Map<string, SameDay> {
  const byDay = new Map<string, BoughtLine[]>();
  for (const line of lines) {
    if (!(line.price > 0)) continue;
    const key = `${line.supplierId}|${line.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(line);
  }
  const out = new Map<string, SameDay>();
  for (const day of byDay.values()) {
    for (let i = 0; i < day.length; i++) {
      for (let j = i + 1; j < day.length; j++) {
        const [a, b] = [day[i], day[j]];
        if (a.productId === b.productId) continue;
        const [low, high] = a.price <= b.price ? [a.price, b.price] : [b.price, a.price];
        const found: SameDay = { date: a.date, low, high, different: high > low * (1 + SAME_PRICE) };
        const key = pairKey(a.productId, b.productId);
        const known = out.get(key);
        // A day at different prices settles it; among equals, the latest day is the one shown.
        if (!known || (found.different && !known.different) || (found.different === known.different && found.date > known.date)) out.set(key, found);
      }
    }
  }
  return out;
}

/** The evidence that some two of these products are different ones, if any: different prices first. */
export function apartAmong(ids: string[], sameDay: Map<string, SameDay>): { a: string; b: string; evidence: SameDay } | null {
  let best: { a: string; b: string; evidence: SameDay } | null = null;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const evidence = sameDay.get(pairKey(ids[i], ids[j]));
      if (!evidence) continue;
      if (!best || (evidence.different && !best.evidence.different)) best = { a: ids[i], b: ids[j], evidence };
    }
  }
  return best;
}
