/**
 * Macro product and variants: fewer, cleaner products instead of one per way
 * of writing an article — without ever folding two different articles into
 * one to tidy the catalogue.
 *
 *   category › product family (subcategory) › MACRO PRODUCT › variant ›
 *   supplier's product › description on the invoice
 *
 * A macro product is what several articles of one supplier have in common
 * when their names begin (and end) the same way and only a word or two in
 * between changes: "Contenitori per ceri 30/2" in TR, Bi and BLU. In the
 * database it is the product's family, and what changes is the variant.
 *
 * The rules:
 *   - the evidence is read together: the same supplier, the same unit, the
 *     same product family, names that share their beginning, and prices that
 *     sit together. A price alone never ties two articles: a glass and a lid
 *     can cost the same;
 *   - what changes is named only when the words say it (a colour written in
 *     full, a size, a capacity); abbreviations nobody could be sure of (TR,
 *     BIA, A B V) are shown as they are and the user is asked;
 *   - nothing is grouped by itself: every group is a proposal with three
 *     answers — one product (merge), versions of one product (variants), or
 *     different products (keep separate).
 */
import * as f from "../format";
import { en, type Msg, type T } from "../i18n";
import { normalizeKey } from "../import/normalize/text";

export const VARIANT_BYS = ["size", "colour", "material", "grade", "capacity", "other"] as const;
export type VariantBy = (typeof VARIANT_BYS)[number];
export const isVariantBy = (v: unknown): v is VariantBy => typeof v === "string" && (VARIANT_BYS as readonly string[]).includes(v);
export const VARIANT_BY_LABEL: Record<VariantBy, Msg> = { size: "Size", colour: "Colour", material: "Material", grade: "Grade", capacity: "Capacity", other: "Something else" };

/** Starting assumptions, to calibrate on real catalogues. */
export const MACRO_CONFIG = {
  /** What tells a variant apart is short: beyond this many words, two names are two products. */
  maxVariantWords: 2,
  /** Prices within this share of each other are "the same price" (rounding, a discount, a period). */
  samePrice: 0.03,
  /** A price this many times above or below the others' is not a version of the same thing. */
  priceBand: 2,
};
export type MacroConfig = typeof MACRO_CONFIG;

export interface MacroItem {
  id: string;
  name: string;
  /** The family it is filed under today (or would be), if any. */
  family: string | null;
  /** That family is a macro product the user confirmed: its own name is beginning enough for a new version to join it. */
  filed?: boolean;
  /** What two products must share to be compared at all: supplier, unit and product family. */
  scope: string;
  supplierId: string | null;
  supplierName: string | null;
  unit: string;
  price: number | null;
  spend: number;
}

export interface MacroMember {
  productId: string;
  name: string;
  /** What tells it apart inside the macro product. Null: the plain article, with nothing added. */
  variant: string | null;
  price: number | null;
  spend: number;
}

export interface MacroGroup {
  key: string;
  /** The macro product proposed: short, without the supplier, what the names have in common. */
  name: string;
  supplierName: string | null;
  unit: string;
  members: MacroMember[];
  /** Names that begin the same way, at a price too far from the others to be a version of the same thing. */
  leftOut: MacroMember[];
  /** What changes between the members, when the words say it. Null: nothing on file can tell. */
  differs: VariantBy | null;
  /** Every variant says it in full; false when it was read from some and guessed for the rest. */
  differsSure: boolean;
  samePrice: boolean;
  /** What the evidence leans to. Null: only the user can tell. */
  suggestion: "variants" | "merge" | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  spend: number;
}

interface Tok {
  text: string;
  key: string;
  /** Written attached to the word before it ("5.50BLU"): shown that way again. */
  glued?: boolean;
}

const NUMBER = /^\d+(?:[.,/]\d+)*$/;
/** A number with a word stuck to it: "5.50BLU", "30pz", "10CB". One letter stuck to a number is part of the model ("60L", "20T") and stays. */
const STUCK = /^(\d+(?:[.,/]\d+)*)([A-Za-zÀ-ÿ]{2,})$/;
const keyOf = (text: string) => text.toLowerCase().replace(/^[("'“”]+|[)"'“”]+$/g, "");
const textOf = (toks: Tok[]) => toks.map((x, i) => (i > 0 && !x.glued ? " " : "") + x.text).join("");

/**
 * A name as the words it is made of, each written one way whatever the
 * document did: "60 L BLU" = "60L BLU", "LC 1" = "LC1", "5.50BLU" = "5.50 BLU",
 * "A B V" one code. Sizes and fractions stay whole.
 */
export function nameTokens(name: string, family: string | null): Tok[] {
  const words: Tok[] = [];
  for (const raw of name.split(/\s+/)) {
    const word = raw.replace(/[.,;:]+$/, "");
    if (!/[A-Za-zÀ-ÿ0-9]/.test(word)) continue;
    const m = STUCK.exec(word);
    if (m) words.push({ text: m[1], key: "" }, { text: m[2], key: "", glued: true });
    else words.push({ text: word, key: "" });
  }
  const toks: Tok[] = [];
  for (const word of words) {
    const last = toks.at(-1);
    // A run of single letters is one code: "A B V".
    if (/^[A-Za-z]$/.test(word.text) && last && /^(?:[A-Za-z] )+[A-Za-z]$|^[A-Za-z]$/.test(last.text) && !NUMBER.test(last.text)) last.text += ` ${word.text}`;
    else toks.push({ ...word });
  }
  // One letter after a number, one digit after a short code: the model's own name, written with or without the space ("60 L", "LC 1").
  const out: Tok[] = [];
  for (const tok of toks) {
    const last = out.at(-1);
    if (last && !tok.glued && ((/^[A-Za-z]$/.test(tok.text) && NUMBER.test(last.text)) || (/^\d$/.test(tok.text) && /^[A-Za-z]{2,3}$/.test(last.text)))) last.text += tok.text;
    else out.push(tok);
  }
  for (const tok of out) tok.key = keyOf(tok.text.replace(/ /g, ""));
  // The family's words come first wherever the name wrote them: "LAMPADE Contenitori per ceri" reads like its range.
  const fam = (family ?? "").split(/\s+/).filter(Boolean).map(keyOf);
  if (fam.length) {
    const at = out.findIndex((_, i) => fam.every((k, j) => out[i + j]?.key === k));
    if (at > 0) out.unshift(...out.splice(at, fam.length));
  }
  return out;
}

const UNIT = /^(?:ml|cl|cc|lt|l|mm|cm|mt|m|my|kg|gr|g|pz|pcs)$/i;
const COLOUR = /^(?:bianc[oa]|ross[oa]|blu|giall[oa]|verde|ner[oa]|trasparente|neutr[oa]|arancio(?:ne)?|rosa|viola|grigi[oa]|oro|argento|white|red|blue|yellow|green|black|transparent|clear)$/i;
const MATERIAL = /^(?:vetro|alluminio|policarbonato|polipropilene|pp|pe|pvc|pet|legno|cartone|metallo|plastica|cotone|glass|aluminium|wood|cotton)$/i;
const CAPACITY = /^\d+(?:[.,]\d+)?\s*(?:ml|cl|cc|lt|l)$/i;
const SIZE = /^(?:\d+(?:[.,]\d+)?)(?:\s*[x×/]\s*\d+(?:[.,]\d+)?)*(?:\s*(?:mm|cm|mt|m|my))?$/i;

/** What a variant's own words say it is. Null: an abbreviation or a code nobody could be sure of. */
function kindOf(variant: string): VariantBy | null {
  if (CAPACITY.test(variant)) return "capacity";
  if (SIZE.test(variant)) return "size";
  const words = variant.split(" ");
  if (words.every((w) => COLOUR.test(w))) return "colour";
  if (words.every((w) => MATERIAL.test(w))) return "material";
  return null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const SEP = "\u0001";

export function macroGroups(items: MacroItem[], options: { separated?: Set<string>; t?: T; cfg?: MacroConfig } = {}): MacroGroup[] {
  const t = options.t ?? en;
  const cfg = options.cfg ?? MACRO_CONFIG;
  const separated = options.separated ?? new Set<string>();
  const read = items.map((item) => {
    const toks = nameTokens(item.name, item.family);
    const fam = (item.family ?? "").split(/\s+/).filter(Boolean).map(keyOf);
    // The shared beginning must say more than the family does: one more word than the family's, or two words at least.
    const min = fam.length && fam.every((k, i) => toks[i]?.key === k) ? fam.length + (item.filed ? 0 : 1) : 2;
    return { item, toks, min };
  });
  const count = new Map<string, number>();
  const prefixKey = (scope: string, toks: Tok[], n: number) => `${scope}${SEP}${toks.slice(0, n).map((x) => x.key).join(SEP)}`;
  for (const r of read) for (let n = 1; n <= r.toks.length; n++) count.set(prefixKey(r.item.scope, r.toks, n), (count.get(prefixKey(r.item.scope, r.toks, n)) ?? 0) + 1);

  // Each product goes with the longest beginning it shares with another one.
  const byPrefix = new Map<string, { n: number; rows: typeof read }>();
  for (const r of read) {
    for (let n = r.toks.length; n >= r.min; n--) {
      const key = prefixKey(r.item.scope, r.toks, n);
      if ((count.get(key) ?? 0) < 2) continue;
      const g = byPrefix.get(key) ?? { n, rows: [] };
      g.rows.push(r);
      byPrefix.set(key, g);
      break;
    }
  }

  const drafts: { name: string; rows: { r: (typeof read)[number]; middle: Tok[] }[]; leftOut: (typeof read)[number][] }[] = [];
  for (const g of byPrefix.values()) {
    if (g.rows.length < 2) continue;
    // A price far from the others' is another thing with a similar name ("LC2 ELET" among the "LC").
    const prices = g.rows.map((r) => r.item.price).filter((p): p is number => p != null && p > 0);
    const mid = prices.length ? median(prices) : null;
    const far = (r: (typeof read)[number]) => mid != null && r.item.price != null && r.item.price > 0 && (r.item.price > mid * cfg.priceBand || r.item.price < mid / cfg.priceBand);
    const rows = g.rows.filter((r) => !far(r));
    if (rows.length < 2) continue;
    const rests = rows.map((r) => r.toks.slice(g.n));
    let suffix = 0;
    while (rests.every((rest) => rest.length > suffix) && rests.every((rest) => rest.at(-1 - suffix)!.key === rests[0].at(-1 - suffix)!.key)) suffix++;
    // A unit after a number belongs to the number: "30 cl" and "50 cl" differ by a capacity, they do not share a "cl".
    if (suffix > 0 && UNIT.test(rests[0].at(-suffix)!.text) && rests.every((rest) => rest.length > suffix && /\d$/.test(rest.at(-suffix - 1)!.text))) suffix--;
    const middles = rests.map((rest) => rest.slice(0, rest.length - suffix));
    // Short, and each one different from the others: otherwise these are not versions of one thing (or they are the same name twice).
    if (middles.some((m) => m.length > cfg.maxVariantWords)) continue;
    if (new Set(middles.map((m) => m.map((x) => x.key).join(SEP))).size !== middles.length) continue;
    const top = [...rows].sort((a, b) => b.item.spend - a.item.spend)[0];
    const name = textOf([...top.toks.slice(0, g.n), ...(suffix ? top.toks.slice(top.toks.length - suffix).map((x, i) => (i === 0 ? { ...x, glued: false } : x)) : [])]);
    // Already filed that way: nothing to ask. A new article that begins the same way is still proposed, next to the ones already there.
    const filed = (r: (typeof read)[number]) => normalizeKey(r.item.family) === normalizeKey(name);
    if (rows.every(filed)) continue;
    // The user said two of them are different products: the group is not proposed again.
    if (rows.some((a, i) => rows.slice(i + 1).some((b) => separated.has(pairKey(a.item.id, b.item.id)) && !(filed(a) && filed(b))))) continue;
    drafts.push({ name, rows: rows.map((r, i) => ({ r, middle: middles[i] })), leftOut: g.rows.filter(far) });
  }

  // An ending that comes back on several articles of one supplier is a version marker, not another way of writing one article.
  const endingUse = new Map<string, number>();
  for (const d of drafts) for (const key of new Set(d.rows.filter((x) => x.middle.length).map((x) => `${x.r.item.supplierId}${SEP}${x.middle.map((m) => m.key).join(SEP)}`))) endingUse.set(key, (endingUse.get(key) ?? 0) + 1);

  // What an ending means, where a group of the same supplier says it in full: "BLU" next to "TR" and "BIA" makes those colours too — a reading, not a certainty.
  const endKey = (supplierId: string | null, variant: string) => `${supplierId}${SEP}${keyOf(variant.replace(/ /g, ""))}`;
  const learned = new Map<string, VariantBy>();
  for (const d of drafts) {
    const variants = d.rows.filter((x) => x.middle.length).map((x) => textOf(x.middle.map((m, i) => (i === 0 ? { ...m, glued: false } : m))));
    const kind = variants.map(kindOf).find((k) => k === "colour" || k === "material");
    if (kind) for (const v of variants) if (!learned.has(endKey(d.rows[0].r.item.supplierId, v))) learned.set(endKey(d.rows[0].r.item.supplierId, v), kind);
  }

  return drafts
    .map((d): MacroGroup => {
      const member = (r: (typeof read)[number], middle: Tok[]): MacroMember => ({ productId: r.item.id, name: r.item.name, variant: middle.length ? textOf(middle.map((x, i) => (i === 0 ? { ...x, glued: false } : x))) : null, price: r.item.price, spend: r.item.spend });
      const members = d.rows.map((x) => member(x.r, x.middle)).sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
      const item = d.rows[0].r.item;
      const said = members.filter((m) => m.variant).map((m) => kindOf(m.variant!));
      const kinds = members.filter((m) => m.variant).map((m) => kindOf(m.variant!) ?? learned.get(endKey(item.supplierId, m.variant!)) ?? null);
      const known = kinds.filter((k): k is VariantBy => !!k);
      const counts = new Map<VariantBy, number>();
      for (const k of known) counts.set(k, (counts.get(k) ?? 0) + 1);
      const differs = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const differsSure = !!differs && said.every((k) => k === differs);
      const prices = members.map((m) => m.price).filter((p): p is number => p != null && p > 0);
      const samePrice = prices.length === members.length && Math.max(...prices) <= Math.min(...prices) * (1 + cfg.samePrice);
      const repeated = d.rows.filter((x) => x.middle.length).every((x) => (endingUse.get(`${x.r.item.supplierId}${SEP}${x.middle.map((m) => m.key).join(SEP)}`) ?? 0) >= 2);
      const example = members.find((m) => m.variant && kindOf(m.variant) === differs)?.variant ?? null;
      const endings = members.filter((m) => m.variant).map((m) => m.variant!);
      const suggestion: MacroGroup["suggestion"] = differs || !samePrice || repeated ? "variants" : null;
      const confidence: MacroGroup["confidence"] = differsSure ? "high" : suggestion ? "medium" : "low";
      const unit = item.unit;
      const reason = [
        t("Same supplier, same unit, and names that begin the same way."),
        samePrice ? t("All at the same price ({price}).", { price: `${f.price(prices[0])}/${unit}` }) : prices.length >= 2 ? t("Prices from {low} to {high}.", { low: `${f.price(Math.min(...prices))}/${unit}`, high: `${f.price(Math.max(...prices))}/${unit}` }) : t("Not every price is on file."),
        differsSure
          ? t("What changes is written in full: {what}.", { what: t(VARIANT_BY_LABEL[differs!]).toLowerCase() })
          : differs && example
            ? t("What changes looks like {what}: “{example}” says so; the other endings are abbreviations we cannot read for sure.", { what: t(VARIANT_BY_LABEL[differs]).toLowerCase(), example })
            : differs
              ? t("What changes looks like {what}: the same endings ({list}) stand next to one written in full on other articles of this supplier.", { what: t(VARIANT_BY_LABEL[differs]).toLowerCase(), list: endings.filter((v) => learned.has(endKey(item.supplierId, v))).join(", ") })
            : repeated
              ? t("The same endings ({list}) come back on other articles of this supplier: versions of an article, not other ways of writing it.", { list: endings.join(", ") })
              : samePrice
                ? t("At one price they may be the same article written in several ways, or versions sold at the same price: only you can tell.")
                : t("Different prices: not one article written in several ways. What changes is an abbreviation we cannot read."),
      ].join(" ");
      return {
        key: `macro_${members.map((m) => m.productId).sort().join("_").slice(0, 80)}`,
        name: d.name,
        supplierName: item.supplierName,
        unit,
        members,
        leftOut: d.leftOut.map((r) => member(r, [])),
        differs,
        differsSure,
        samePrice,
        suggestion,
        confidence,
        reason,
        spend: members.reduce((s, m) => s + m.spend, 0),
      };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}

/** What is left of a product's name once the macro product's words are taken out: its variant. */
export function variantOf(name: string, macro: string): string | null {
  const own = new Set(nameTokens(macro, null).map((x) => x.key));
  const rest = nameTokens(name, null).filter((x) => !own.has(x.key));
  return rest.length ? textOf(rest.map((x, i) => (i === 0 ? { ...x, glued: false } : x))) : null;
}
