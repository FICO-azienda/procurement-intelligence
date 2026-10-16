/**
 * How far two things are the same thing technically — one engine for the
 * offers (replies/match.ts) and for the buyer's own products (relations).
 * Identity (identity.ts) answers another question — "is this the product I
 * have?" — and stays strict: 52/54 is not 52/56. Here the question is "could
 * one stand for the other?", and the answer is only ever a proposal:
 *
 *  - the same kind of thing (the catalogue's subcategory) in a unit that
 *    converts, or nothing is said at all;
 *  - grades written as ranges: the same → a possible equivalent; overlapping
 *    → a possible equivalent, the difference said; apart → the same family,
 *    another grade; two different ranges in one source → nothing is said
 *    until the right data sheet comes;
 *  - a similar name, a price or a supplier's code never decide.
 *
 * Only a person validates an equivalence, says an alternative is usable for an
 * application, or that two things are not equivalent (`product_relations`).
 */
import { unitsPer } from "../import/normalize/units";
import type { Msg } from "../i18n";

export type Range = [number, number];

/** Grades written as two numbers a few units apart ("52/54", "51–54 °C"): not a percentage, not a size. */
export function rangesIn(text: string | null | undefined): Range[] {
  const out: Range[] = [];
  for (const m of (text ?? "").matchAll(/(?<![\d.,])(\d{2,3})\s*[/–-]\s*(\d{2,3})(?![\d.,]|\s*%)/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a < b && b - a <= 20 && !out.some((r) => r[0] === a && r[1] === b)) out.push([a, b]);
  }
  return out;
}

export const sayRange = ([a, b]: Range) => `${a}–${b}`;

export type GradeFit = "same" | "overlap" | "apart" | "contradictory" | "unknown";

/** How two grades stand: one range on each side is needed, and a source that states two is a contradiction. */
export function gradeFit(mine: Range[], theirs: Range[]): { fit: GradeFit; mine: Range | null; theirs: Range | null } {
  if (theirs.length > 1 || mine.length > 1) return { fit: "contradictory", mine: mine[0] ?? null, theirs: theirs[0] ?? null };
  const [a, b] = [mine[0], theirs[0]];
  if (!a || !b) return { fit: "unknown", mine: a ?? null, theirs: b ?? null };
  if (a[0] === b[0] && a[1] === b[1]) return { fit: "same", mine: a, theirs: b };
  const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  return { fit: overlap > 0 ? "overlap" : "apart", mine: a, theirs: b };
}

/** What the rules may propose between two of the buyer's products; the rest only a person says. */
export type ProposedRelation = "possible_equivalent" | "same_family";

/** Every relation a person can record. "Equivalent validated" and "technical alternative" are for one application. */
export const RELATION_TYPES = ["possible_equivalent", "equivalent_validated", "same_family", "technical_alternative", "not_equivalent"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
export const isRelationType = (v: unknown): v is RelationType => typeof v === "string" && (RELATION_TYPES as readonly string[]).includes(v);
export const RELATION_TYPE_LABEL: Record<RelationType, Msg> = {
  possible_equivalent: "Possible equivalent, to verify",
  equivalent_validated: "Equivalent, validated",
  same_family: "Same family, another grade",
  technical_alternative: "Technical alternative",
  not_equivalent: "Not equivalent",
};
/** Said only by a person, with the application it was judged for and the reason. */
export const NEEDS_APPLICATION: RelationType[] = ["equivalent_validated", "technical_alternative"];

export interface TechnicalItem {
  id: string;
  name: string;
  unit: string;
  subKey: string | null;
  /** The grade a source declares (a melting point), when it states one: read before the name. */
  declared?: string | null;
}

/**
 * What two items are to each other on paper. Null: not the same kind of thing, or in units that do not convert —
 * nothing is proposed. The reason is a stored-message template with its values.
 */
export function technicalRelation(a: TechnicalItem, b: TechnicalItem): { relation: ProposedRelation | null; fit: GradeFit; reason: { text: Msg; values: Record<string, string> } } | null {
  if (!a.subKey || a.subKey !== b.subKey || unitsPer(a.unit, b.unit) == null) return null;
  const read = (x: TechnicalItem) => (rangesIn(x.declared).length ? rangesIn(x.declared) : rangesIn(x.name));
  const g = gradeFit(read(a), read(b));
  switch (g.fit) {
    case "same":
      return { relation: "possible_equivalent", fit: g.fit, reason: { text: "Both declare {grade}: they could stand for each other, to verify on the data sheets.", values: { grade: sayRange(g.mine!) } } };
    case "overlap":
      return { relation: "possible_equivalent", fit: g.fit, reason: { text: "{a} and {b} only partly match: to verify on the data sheets and on a sample.", values: { a: sayRange(g.mine!), b: sayRange(g.theirs!) } } };
    case "apart":
      return { relation: "same_family", fit: g.fit, reason: { text: "{a} and {b}: the same kind of thing in another grade.", values: { a: sayRange(g.mine!), b: sayRange(g.theirs!) } } };
    case "contradictory":
      return { relation: null, fit: g.fit, reason: { text: "Two different grades are stated: the right data sheet is needed before anything is said.", values: {} } };
    default:
      return { relation: "same_family", fit: g.fit, reason: { text: "The same kind of thing; nothing says the grade of both.", values: {} } };
  }
}
