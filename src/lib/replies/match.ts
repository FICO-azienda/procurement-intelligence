/**
 * Which of the buyer's products an offer could be an alternative for — a
 * proposal, worked out from what both say and never stored: a person confirms
 * it or says it is not for that product.
 *
 * A proposal needs the same kind of thing (the catalogue's own subcategory,
 * read from the offer's words) in the same unit — or in a unit of the same
 * measure that converts exactly (a price per tonne for a product bought by the
 * kilo): then it is proposed, the price stays as written, and the offer is not
 * comparable until it is in the product's unit. That alone says nothing of
 * equivalence: it is "not analysed". When both carry a grade written as a
 * range (52/54, 56–58 °C) the proposal says how they stand — and a grade that
 * does not overlap is proposed as another grade, never as the same product.
 * Similar names decide nothing, and "validated" is never proposed.
 */
import { categorize } from "../catalog/taxonomy";
import { en, type T } from "../i18n";
import { normalizeUnit, unitsPer } from "../import/normalize/units";
import type { Compatibility, ReplyOffer } from "./types";

export interface MatchProduct {
  id: string;
  name: string;
  unit: string;
  /** The built-in subcategory it is filed under today (CategoryNaming.subKeyOf). Null: not classified. */
  subKey: string | null;
}

export interface Suggestion {
  productId: string;
  productName: string;
  /** How the two stand, as far as their own words say. Never "validated". */
  compatibility: Exclude<Compatibility, "validated" | "sample_to_test">;
  reasons: string[];
}

type Range = [number, number];

/** Grades written as a range of two numbers: "52/54", "56–58 °C", "51-54". Decimals and percentages are not grades. */
export function rangesIn(text: string | null | undefined): Range[] {
  const out: Range[] = [];
  for (const m of (text ?? "").matchAll(/(?<![\d.,])(\d{2,3})\s*[/–-]\s*(\d{2,3})(?![\d.,]|\s*%)/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a < b && b - a <= 20 && !out.some((r) => r[0] === a && r[1] === b)) out.push([a, b]);
  }
  return out;
}

const say = ([a, b]: Range) => `${a}–${b}`;


export function suggestFor(offer: Pick<ReplyOffer, "productName" | "grade" | "category" | "unit" | "specs" | "declinedProductIds">, products: MatchProduct[], t: T = en): Suggestion[] {
  const kind = categorize([offer.productName, offer.grade, offer.category].filter(Boolean).join(" "))?.sub.key ?? null;
  if (!kind) return [];
  // The grade the offer declares: its melting point when it states one, else the range in its own name.
  const declared = rangesIn(offer.specs.melting_point);
  const stated = declared.length ? declared : rangesIn([offer.grade, offer.productName].filter(Boolean).join(" "));
  const out: Suggestion[] = [];
  for (const p of products) {
    // The same unit written two ways ("pz", "pcs") is the same unit; t and kg, or "1.000 pz" and pieces, convert exactly. Boxes and rolls never do.
    const factor = unitsPer(offer.unit, p.unit);
    const sameUnit = factor === 1 && normalizeUnit(offer.unit) === normalizeUnit(p.unit);
    if (p.subKey !== kind || factor == null || offer.declinedProductIds.includes(p.id)) continue;
    const same = sameUnit
      ? t("Same kind of product and same unit as {product}.", { product: p.name })
      : t("Same kind of product as {product}, quoted per {unit} where you buy per {productUnit}: the price stays as written.", { product: p.name, unit: offer.unit, productUnit: p.unit });
    const [mine] = rangesIn(p.name);
    if (!mine || !stated.length) {
      out.push({ productId: p.id, productName: p.name, compatibility: "not_analyzed", reasons: [same, t("Nothing says how close the two are: to analyse.")] });
      continue;
    }
    if (stated.length > 1) {
      out.push({ productId: p.id, productName: p.name, compatibility: "awaiting_specs", reasons: [same, t("Its documents state two different ranges ({a} and {b}): the right data sheet is needed before anything is said.", { a: say(stated[0]), b: say(stated[1]) })] });
      continue;
    }
    const [theirs] = stated;
    const overlap = Math.min(mine[1], theirs[1]) - Math.max(mine[0], theirs[0]);
    if (overlap <= 0) out.push({ productId: p.id, productName: p.name, compatibility: "not_equivalent", reasons: [t("It declares {theirs}; your product is {mine}: another grade.", { theirs: say(theirs), mine: say(mine) })] });
    else if (theirs[0] === mine[0] && theirs[1] === mine[1]) out.push({ productId: p.id, productName: p.name, compatibility: "possible", reasons: [same, t("It declares {theirs}, the grade of your product: to verify on its data sheet and on a sample.", { theirs: say(theirs) })] });
    else out.push({ productId: p.id, productName: p.name, compatibility: "possible", reasons: [same, t("It declares {theirs}, which only partly matches your {mine}: to verify on its data sheet and on a sample.", { theirs: say(theirs), mine: say(mine) })] });
  }
  return out;
}

/** The catalogue category a conversation's own category names ("Wicks and yarns" → wicks), read by the catalogue's words. Null: it names none. */
export const categoryKeyOf = (text: string | null | undefined): string | null => categorize(text)?.category.key ?? null;
