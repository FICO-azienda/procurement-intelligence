/**
 * Product Mapper: from the products as the invoices wrote them to an ordered
 * catalogue — what each one is (category › subcategory), the family it belongs
 * to and which variant it is, a name people can read, and which products may
 * be the same one written twice.
 *
 * Rules, in the order in which they are trusted:
 *   1. the words of the name (lib/catalog/taxonomy.ts);
 *   2. the supplier's own codes and barcodes (same code, same sizes = same product);
 *   3. the numbers in the name: a different size is a different product;
 *   4. the supplier: its other descriptions with the same code, what it sells
 *      in the same unit, its name;
 *   5. spelling: one word written differently.
 * What the rules can't tell is asked, never guessed. Every result has a level:
 *   high    the name itself says it — can be confirmed in bulk;
 *   medium  read from the supplier's context, or the name was shortened — look at it;
 *   low     nothing says what it is — the user decides.
 *
 * Nothing here writes: it proposes. Prices, quantities, suppliers and dates
 * are never touched — a mapping only changes how a product is called and filed.
 */
import { basePrice, baseTotal, isPriced, windowStart, type Dataset } from "../analytics";
import { codeKey, normalizeKey, productTokens } from "../import/normalize/text";
import { en, type Msg, type T } from "../i18n";
import { boughtSameDay } from "./apart";
import { withoutPackNotes } from "./attributes";
import { classify } from "./classify";
import { cleanName } from "./clean";
import { separate, type DescriptionParts } from "./identity";
import { KIND_LABEL, isProductKind, isStrategic, type ProductKind } from "./kinds";
import { macroGroups, type MacroGroup } from "./macro";
import { differByOneWord } from "./propose";
import { matchTokens, numbersOf, sameNumbers } from "./specs";
import { allSubs, categorize, subByKey, type WordHit } from "./taxonomy";

export type Level = "high" | "medium" | "low";

export const LEVEL_LABEL: Record<Level, Msg> = { high: "High", medium: "Medium", low: "Low" };

export interface MapInput {
  id: string;
  name: string;
  kind: ProductKind;
  unit: string;
  /** True once the user confirmed what the product is: its name and place are no longer proposals. */
  mapped: boolean;
  category: string | null;
  subcategory: string | null;
  family: string | null;
  /** The family is a macro product the user confirmed (its versions differ by something they named). */
  macro?: boolean;
  variant: string | null;
  /** Who it is bought from, largest spend first. */
  suppliers: { id: string; name: string }[];
  /** Every description found on the documents. */
  aliases: { text: string; supplierId: string | null; supplierSku: string | null; ean: string | null }[];
  /** Spend of the last 12 months, EUR. */
  spend: number;
  /** Current unit price, EUR. */
  price: number | null;
  /** Every priced purchase: who, when and at what unit price. What was billed on the same day at two prices is two products. */
  days?: { supplierId: string; date: string; price: number }[];
}

export interface Mapping {
  productId: string;
  /** The name today, and the one proposed. */
  current: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  /** The subcategory's key in the taxonomy; null for a category the company wrote itself, or none. */
  subKey: string | null;
  kind: ProductKind;
  family: string | null;
  variant: string | null;
  level: Level;
  /** How the category was found. */
  by: "words" | "code" | "supplier" | "user" | "stored" | "none";
  /** Why it is not "high", in plain words. */
  reason: string | null;
  mapped: boolean;
  spend: number;
  supplierId: string | null;
  supplierName: string | null;
  /** Every description the documents wrote for it: the raw source, never changed. */
  originals: string[];
  /** Words of those descriptions that are the supplier's own name: who sold it, not what it is. */
  supplierTerms: string[];
  /** The supplier's own codes: in the description, in front of it, or the document's article code. */
  supplierCodes: string[];
  /**
   * named: the words and the grade say what it is · supplier_code: the words say the kind of thing, and only the
   * supplier's article code tells it apart · unidentified: the words name a material that can be several different
   * things and nothing says which.
   */
  identity: Identity;
  /** For an unidentified product: the few things it could be (taxonomy subcategory keys). */
  options: string[];
  /** Where it stands in the cleanup: confirmed already, safe to confirm in bulk, to look at, or to be told what it is. */
  group: CleanupGroup;
}

export type Identity = "named" | "supplier_code" | "unidentified";
export type CleanupGroup = "done" | "confident" | "review" | "unclassified";
export const GROUP_LABEL: Record<CleanupGroup, Msg> = { done: "Confirmed|cleanup", confident: "Auto-confident", review: "Needs review", unclassified: "Needs classification" };

export interface DuplicateGroup {
  key: string;
  productIds: string[];
  /** high: the codes or the text say it · possible: it looks like it. */
  level: "high" | "possible";
  reason: string;
  suggestion: "merge" | null;
  proposedName: string;
  spend: number;
}

/** Products the user is asked about together: one answer covers them all. */
export interface ReviewCard {
  key: string;
  /** check: a proposal read from the context · classify: nothing says what they are. */
  type: "check" | "classify";
  productIds: string[];
  supplierName: string | null;
  subKey: string | null;
  kind: ProductKind | null;
  reason: string;
  spend: number;
  /** What the product could be, when the words name something that can be several things: at most three, never chosen by the software. */
  options: string[];
}

export interface FamilySummary {
  name: string;
  category: string | null;
  subcategory: string | null;
  productIds: string[];
  spend: number;
}

export interface MapAnalysis {
  products: Mapping[];
  duplicates: DuplicateGroup[];
  /** Articles that may be versions of one product: proposed, never grouped by themselves (lib/catalog/macro.ts). */
  macros: MacroGroup[];
  cards: ReviewCard[];
  families: FamilySummary[];
  totals: {
    analysed: number;
    spend: number;
    confirmed: number;
    high: number;
    highSpend: number;
    medium: number;
    low: number;
    inDuplicates: number;
    review: number;
    reviewSpend: number;
    /** Not confirmed yet, by where each stands in the cleanup. */
    groups: Record<CleanupGroup, number>;
  };
  /** How many products, largest first, make up each share of the spend. */
  pareto: { share: number; products: number; reached: number }[];
}

export interface MapOptions {
  /** Pairs the user said are two products. */
  separated?: [string, string][];
  /** What the user said a product is: a subcategory key, or a kind when it is not a product to compare. */
  answers?: Map<string, string>;
  t?: T;
}

/** The catalogue as the engine reads it: every product with its suppliers, descriptions, 12-month spend and last price. */
export function toMapInput(
  data: Dataset,
  aliases: { productId: string; alias: string; supplierId: string | null; supplierSku: string | null; ean: string | null }[],
  familyName: Map<string, string>,
  asOf: string,
  /** The families the user confirmed as macro products. */
  macroFamilies: Set<string> = new Set(),
): MapInput[] {
  const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));
  const start = windowStart(asOf);
  return data.products.map((p) => {
    const own = data.purchases.filter((x) => x.productId === p.id);
    const bySupplier = new Map<string, number>();
    for (const x of own) bySupplier.set(x.supplierId, (bySupplier.get(x.supplierId) ?? 0) + (isPriced(x) ? baseTotal(x) : 0));
    const last = [...own].reverse().find(isPriced);
    return {
      id: p.id,
      name: p.name,
      kind: isProductKind(p.kind) ? p.kind : "needs_review",
      unit: p.unit,
      mapped: p.mapped ?? false,
      category: p.category,
      subcategory: p.subcategory ?? null,
      family: p.familyId ? (familyName.get(p.familyId) ?? null) : null,
      macro: !!p.familyId && macroFamilies.has(p.familyId),
      variant: p.variant ?? null,
      suppliers: [...bySupplier.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => ({ id, name: supplierName.get(id) ?? "" })),
      aliases: aliases.filter((a) => a.productId === p.id).map((a) => ({ text: a.alias, supplierId: a.supplierId, supplierSku: a.supplierSku, ean: a.ean })),
      spend: own.filter((x) => x.date > start).reduce((s, x) => s + (isPriced(x) ? baseTotal(x) : 0), 0),
      price: last ? basePrice(last) : null,
      days: own.filter(isPriced).map((x) => ({ supplierId: x.supplierId, date: x.date, price: basePrice(x) })),
    };
  });
}

// ---------------- Reading a name ----------------

interface Tok {
  text: string;
  norm: string;
  /** Where it starts in the normalised name; -1 when it has no letters or digits. */
  start: number;
}

const STOP = new Set(["conf", "confezione", "pezzi", "diam", "diametro", "spessore", "dim", "art", "articolo", "cod", "codice", "misura", "formato", "colore", "durata"]);
const CONNECTORS = new Set(["per", "di", "da", "x", "del", "della", "dei", "delle", "in", "con", "a", "e", "for", "of"]);
const MARKER = /^(?:art|articolo|cod|codice)\.?$/i;
/** A run of this many codes and numbers in front of a name is the supplier's article code, not the product's name. */
const LONG_CODE = 6;
const SIZE_LABEL = /^(?:f\.?to|formato|dim\.?(?:mm|cm)?)\.?$/i;
const SEGMENT_NOISE = new Set(["dim", "mm", "cm", "x", "f", "to", "fto", "formato"]);

const isReal = (tok: Tok | undefined) => !!tok && /^[a-z]{4,}$/.test(tok.norm) && !STOP.has(tok.norm);
const isDash = (tok: Tok) => /^[-–—.]+$/.test(tok.text);
const stemOf = (norm: string) => (norm.length >= 5 ? norm.replace(/[aeio]$/, "") : norm);
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
const sum = <V,>(xs: V[], get: (x: V) => number) => xs.reduce((s, x) => s + get(x), 0);

function groupBy<V>(items: V[], key: (v: V) => string): Map<string, V[]> {
  const out = new Map<string, V[]>();
  for (const item of items) {
    const k = key(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(item);
  }
  return out;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** "A - B - A": what a later part repeats is dropped (export files often print the size twice). */
function dropRepeats(text: string): string {
  const parts = text.split(/\s+-\s+/);
  if (parts.length < 2) return text;
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const tokens = productTokens(part).filter((t) => !SEGMENT_NOISE.has(t));
    if (kept.length === 0 || tokens.some((t) => !seen.has(t))) kept.push(part);
    for (const t of tokens) seen.add(t);
  }
  return kept.join(" - ");
}

/** The text a product is read from: its name — or the full description, when the name was cut short — without the supplier's own name and codes. */
function baseText(p: MapInput): { base: string; parts: DescriptionParts } {
  let s = p.name;
  if (s.endsWith("…")) {
    const head = normalizeKey(s.slice(0, -1));
    const full = p.aliases.map((a) => cleanName(a.text, 1000)).find((a) => normalizeKey(a).startsWith(head));
    if (full) s = full;
  }
  s = dropRepeats(s)
    .replace(/\b(art|cod)\.(?=\S)/gi, "$1. ")
    .replace(/(\d)\s*[xX×]\s*(?=\d)/g, "$1x")
    .replace(/\s+/g, " ")
    .trim();
  // The supplier's own name and codes inside the product's ("Paraffina SER 52/54 (XXF)") say who sells it and how it calls it, not what it is.
  const parts = separate(s, { names: p.suppliers.map((x) => x.name), skus: p.aliases.map((a) => a.supplierSku) });
  return { base: parts.body, parts };
}

function tokenize(text: string): Tok[] {
  let at = 0;
  return text.split(" ").map((word) => {
    const norm = normalizeKey(word);
    if (!norm) return { text: word, norm, start: -1 };
    const tok = { text: word, norm, start: at };
    at += norm.length + 1;
    return tok;
  });
}

type By = Mapping["by"];

interface Class {
  category: string;
  subcategory: string | null;
  subKey: string | null;
}

interface Reading {
  p: MapInput;
  base: string;
  toks: Tok[];
  hit: WordHit | null;
  /** Tokens of the word that names the product. */
  anchor: [number, number] | null;
  /** The noun and the words that follow it, as stems: ["candel", "liturgic", "altar"]. */
  path: string[];
  /** The token where each element of the path ends. */
  ends: number[];
  /** How much of the path is the family's name (or, alone, the product's noun). */
  depth: number;
  cls: Class | null;
  by: By;
  kind: ProductKind;
  reason: string | null;
  family: string | null;
  /** A long supplier code in front of the name was left out of the proposal. */
  dropped: boolean;
  /** The supplier's name and codes taken out of the description before reading it. */
  parts: DescriptionParts;
  /** A word to put in front of a name that has no noun. */
  noun: string | null;
  /** Tokens the noun in front already says ("Legno" under "Stoppino legno"). */
  skip: Set<number>;
}

function read(p: MapInput): Reading {
  const { base, parts } = baseText(p);
  const toks = tokenize(base);
  const r: Reading = { p, base, toks, hit: null, anchor: null, path: [], ends: [], depth: 0, cls: null, by: "none", kind: p.kind, reason: null, family: null, dropped: false, parts, noun: null, skip: new Set() };
  const hit = categorize(base);
  if (!hit) return r;
  const inside = toks.map((tok, i) => (tok.start >= 0 && tok.start < hit.at + hit.length && tok.start + tok.norm.length > hit.at ? i : -1)).filter((i) => i >= 0);
  if (!inside.length) return r;
  r.hit = hit;
  r.anchor = [inside[0], inside[inside.length - 1]];
  r.path = [hit.word.stem];
  r.ends = [r.anchor[1]];
  // The words right after the noun are part of what it is: "Contenitori per ceri", "Candela liturgica altare".
  let i = r.anchor[1] + 1;
  while (r.path.length < 5 && i < toks.length) {
    if (CONNECTORS.has(toks[i].norm) && isReal(toks[i + 1])) i++;
    if (!isReal(toks[i])) break;
    r.path.push(stemOf(toks[i].norm));
    r.ends.push(i);
    i++;
  }
  return r;
}

/** The noun and its words as people write them: "Scat. Americana" → "Scatola americana". */
function phraseText(r: Reading, depth: number, family = false): string {
  if (!r.anchor || !r.hit) return "";
  const [from, to] = r.anchor;
  const word = r.hit.word;
  const noun = word.as && !r.toks[from].norm.startsWith(word.stem) ? word.as : r.toks.slice(from, to + 1).map((t) => t.text.replace(/[.,;:]+$/, "")).join(" ");
  const rest = r.toks.slice(to + 1, r.ends[depth - 1] + 1).map((t) => (t.norm === "x" ? "per" : t.text.replace(/[.,;:]+$/, "")));
  const text = [noun, ...rest].join(" ");
  return family ? sentence(text) : text;
}

/** Products that share a noun and the words after it are a family; what is left of each name is its variant. */
function growFamilies(members: Reading[], depth: number) {
  const rest: Reading[] = [];
  for (const [stem, group] of groupBy(members, (m) => m.path[depth] ?? "")) {
    if (stem && group.length >= 2) growFamilies(group, depth + 1);
    else rest.push(...group);
  }
  if (rest.length >= 2) {
    const name = mostCommon(rest.map((r) => phraseText(r, depth, true)));
    for (const r of rest) {
      r.family = name;
      r.depth = depth;
    }
  } else for (const r of rest) r.depth = r.path.length;
}

const tidyTok = (tok: Tok) => tok.text;
const clean = (parts: string[]) =>
  parts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—.,]+/, "")
    .replace(/[\s\-–—,]+$/, "")
    .replace(/(?<=\S{2})\.$/, "")
    .trim();

/** The pieces of a name around its noun: what comes before, the noun's phrase, what comes after. */
function pieces(r: Reading) {
  const [from] = r.anchor!;
  const end = r.ends[Math.max(r.depth, 1) - 1];
  const keep = (tok: Tok, i: number, all: Tok[]) => !(SIZE_LABEL.test(tok.text) && /\d/.test(all[i + 1]?.text ?? ""));
  const leadAll = r.toks.slice(0, from);
  const marked = leadAll.length > 0 && MARKER.test(leadAll[0].text);
  const lead = leadAll.slice(marked ? 1 : 0).filter(keep);
  // After the noun, the same noun again ("… - Scatola - …") adds nothing.
  const said = new Set(r.path.slice(0, Math.max(r.depth, 1)));
  const tail = r.toks.slice(end + 1).filter((tok, i, all) => keep(tok, i, all) && !(isReal(tok) && (said.has(stemOf(tok.norm)) || tok.norm.startsWith(r.path[0]))));
  const leadWords = lead.filter((t) => !isDash(t));
  // An article code in front ("ART. LC TR.", "F60/8N -") goes after the noun; a word in front ("Natural wax") stays.
  const moved = leadWords.length > 0 && (marked || !isReal(leadWords[0]));
  const longCode = moved && leadWords.length >= LONG_CODE && !leadWords.some(isReal);
  return { lead, tail, leadWords, marked, moved, longCode, phrase: r.family ?? phraseText(r, Math.max(r.depth, 1)) };
}

function compose(r: Reading, keepCode: boolean): { name: string; variant: string | null } {
  if (!r.anchor) {
    // With a noun in front, "ART." has nothing left to introduce; alone, the name stays as written.
    const words = r.toks.filter((tok, i) => !r.skip.has(i) && !(r.noun && i === 0 && MARKER.test(tok.text)));
    const firstWord = words.findIndex(isReal);
    // "TL 10 15 A 1 0 P 30 CC 12 Cicogna Best Choice 30x12": the code in front is the supplier's, the rest is the product.
    const body = r.dropped && !keepCode && firstWord >= LONG_CODE ? words.slice(firstWord) : words;
    const text = clean(body.map(tidyTok));
    return { name: clean([r.noun ?? "", text]), variant: r.family ? text : null };
  }
  const x = pieces(r);
  // The supplier's article code in front is left out of the name when something else tells the product apart (a size, a
  // grade, a word): it stays on file as the supplier's code. It comes back only where two names would otherwise be one.
  const codeLead = x.moved && (x.marked || x.leadWords.some((tok) => /[a-z]/i.test(tok.text)));
  const dropCode = (x.longCode || (codeLead && x.tail.some((tok) => !isDash(tok)))) && !keepCode;
  const lead = dropCode ? [] : x.moved ? x.leadWords : x.lead;
  // A code moved from the front goes last: "Vino bianco … Santa Messa 5 CT 6 BT.CC.1000".
  const tail = x.tail.map(tidyTok);
  const parts = x.moved ? [x.phrase, clean(tail), ...lead.map(tidyTok)] : [...lead.map(tidyTok), x.phrase, ...tail];
  const variant = clean([clean(x.tail.filter((t) => !isDash(t)).map(tidyTok)), ...(dropCode ? [] : x.leadWords.map(tidyTok))]);
  return { name: clean(parts), variant: r.family && variant ? variant : null };
}

// ---------------- The catalogue ----------------

/** Units and markers that add nothing to what a description names: "30 CL" and "30", "ART. LC" and "LC". */
const LOOSE_NOISE = new Set(["cl", "ml", "cc", "lt", "mm", "cm", "mt", "kg", "gr", "pz", "pcs", "art", "articolo", "cod", "codice", "per", "di", "da", "x"]);
/** The same words whatever their order, a word cut short ("cont" for "contenitore") standing for the whole one. */
function sameWords(a: string[], b: string[]): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  const left = [...b];
  const take = (test: (x: string) => boolean) => {
    const i = left.findIndex(test);
    if (i >= 0) left.splice(i, 1);
    return i >= 0;
  };
  const rest = a.filter((tok) => !take((x) => x === tok));
  const short = (x: string, y: string) => /^[a-z]{3,}$/.test(x) && y.length > x.length && y.startsWith(x);
  return rest.every((tok) => take((x) => short(tok, x) || short(x, tok)));
}

const samePrice = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.01;

class Sets {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x) ?? x;
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  join(a: string, b: string) {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function mapCatalogue(input: MapInput[], options: MapOptions = {}): MapAnalysis {
  const t = options.t ?? en;
  const products = input.filter((p) => isStrategic(p.kind));
  const readings = products.map(read);
  const labelToSub = new Map(allSubs().flatMap((ref) => [[normalizeKey(t(ref.sub.label)), ref] as const, [normalizeKey(ref.sub.label), ref] as const]));
  const classOf = (subKey: string): Class => {
    const ref = subByKey(subKey)!;
    return { category: t(ref.category.label), subcategory: t(ref.sub.label), subKey };
  };
  const supplierOf = (r: Reading) => r.p.suppliers[0] ?? null;

  // ---- 1. What the user confirmed, what the user answered, what the words say.
  for (const r of readings) {
    const answer = options.answers?.get(r.p.id);
    if (r.p.mapped) {
      r.by = "stored";
      r.cls = r.p.category ? { category: r.p.category, subcategory: r.p.subcategory, subKey: labelToSub.get(normalizeKey(r.p.subcategory))?.sub.key ?? null } : null;
      r.family = r.p.family;
    } else if (answer && subByKey(answer)) {
      r.by = "user";
      r.cls = classOf(answer);
      r.kind = subByKey(answer)!.category.kind;
      if (!r.hit || r.hit.sub.key !== answer) {
        // The user knows better than the words: the name's own noun no longer says what it is.
        // A word that could mean several things ("wax") is replaced by what the user said it is.
        if (r.hit?.sub.ask && r.anchor) for (let i = r.anchor[0]; i <= r.anchor[1]; i++) r.skip.add(i);
        r.anchor = null;
        r.hit = null;
        r.path = [];
        if (!isReal(r.toks.find((tok) => !MARKER.test(tok.text)))) r.noun = t(subByKey(answer)!.sub.noun);
      }
    } else if (answer) {
      r.by = "user";
      r.kind = answer as ProductKind;
    } else if (r.hit) {
      r.by = "words";
      r.cls = classOf(r.hit.sub.key);
      r.kind = r.hit.category.kind;
    }
  }

  // ---- 2. The supplier's context, for names that say no noun.
  const known = () => readings.filter((r) => r.cls && supplierOf(r));
  for (const r of readings.filter((x) => x.by === "none")) {
    const supplier = supplierOf(r);
    if (!supplier) continue;
    const words = classify({ text: r.base, supplierName: null });
    if (words.by === "words" && !isStrategic(words.kind)) {
      r.kind = words.kind;
      r.reason = t("The words suggest this is not a product to compare, but {kind}.", { kind: t(KIND_LABEL[words.kind]).toLowerCase() });
      continue;
    }
    const siblings = known().filter((k) => k.by !== "code" && k.by !== "supplier" && supplierOf(k)!.id === supplier.id);
    // The same code in front of another description that names the product ("TL … Tealight 18x12").
    const first = r.toks[0];
    const run = r.toks.findIndex(isReal);
    const sameCode = first && /^[a-z]{1,4}$/.test(first.norm) && run >= LONG_CODE ? siblings.find((k) => k.hit && k.toks[0]?.norm === first.norm) : undefined;
    if (sameCode) {
      r.by = "code";
      r.cls = sameCode.cls;
      r.kind = sameCode.kind;
      r.dropped = true;
      r.noun = phraseText(sameCode, 1);
      r.reason = t("Read as {what}: another description of {supplier} with the same code in front says so. The code was left out of the name.", { what: r.cls!.subcategory ?? r.cls!.category, supplier: supplier.name });
      continue;
    }
    // What this supplier's other products in the same unit are, when they agree.
    const sameUnit = siblings.filter((k) => k.p.unit === r.p.unit);
    const total = sum(sameUnit, (k) => Math.max(k.p.spend, 1));
    const bySub = [...groupBy(sameUnit, (k) => `${k.cls!.category}|${k.cls!.subcategory ?? ""}`).values()].sort((a, b) => sum(b, (k) => Math.max(k.p.spend, 1)) - sum(a, (k) => Math.max(k.p.spend, 1)));
    if (bySub.length && sum(bySub[0], (k) => Math.max(k.p.spend, 1)) / total >= 0.7) {
      r.by = "supplier";
      r.cls = bySub[0][0].cls;
      r.kind = bySub[0][0].kind;
      r.reason = t("Read as {what}: that is what {supplier} sells you in the same unit.", { what: r.cls!.subcategory ?? r.cls!.category, supplier: supplier.name });
      continue;
    }
    const named = categorize(supplier.name);
    if (named) {
      r.by = "supplier";
      r.cls = classOf(named.sub.key);
      r.kind = named.category.kind;
      r.reason = t("Read as {what} from the supplier's name.", { what: r.cls.subcategory ?? r.cls.category });
    }
  }

  // ---- 3. Families: the same noun and the same words after it.
  const open = readings.filter((r) => !r.p.mapped);
  for (const group of groupBy(open.filter((r) => r.anchor && r.cls?.subKey), (r) => `${r.cls!.subKey}:${r.path[0]}`).values()) growFamilies(group, 1);
  // A name with no noun of its own, read from its supplier's context, may belong to one of that supplier's families.
  const nounless = groupBy(open.filter((r) => !r.anchor && r.cls && supplierOf(r)), (r) => `${supplierOf(r)!.id}|${r.cls!.category}|${r.cls!.subcategory ?? ""}`);
  for (const group of nounless.values()) {
    const first = group[0];
    const relatives = readings.filter((k) => k.family && (k.anchor || k.p.mapped) && supplierOf(k)?.id === supplierOf(first)!.id && k.cls?.subcategory === first.cls!.subcategory);
    const sizes = [...groupBy(relatives, (k) => k.family!).entries()].map(([name, members]) => ({ name, n: members.length, stems: new Set(tokenize(name).map((tok) => stemOf(tok.norm))) }));
    const left: Reading[] = [];
    for (const r of group) {
      // Its own words are in the family's name: "Legno NF 19.1x128" under "Stoppino legno".
      const sharing = sizes.filter((f) => r.toks.some((tok) => isReal(tok) && f.stems.has(stemOf(tok.norm))));
      // Written like the rest of the range ("ART. 10.50 …" among "ART. … Contenitori per ceri"), or after the same code.
      const dominant = sizes.find((f) => f.n / relatives.length >= 0.8);
      const sameShape = MARKER.test(r.toks[0]?.text ?? "") || r.by === "code" || r.by === "user";
      const family = sharing.length === 1 ? sharing[0] : sameShape && dominant ? dominant : null;
      if (!family) {
        left.push(r);
        continue;
      }
      r.family = family.name;
      r.noun = family.name;
      r.toks.forEach((tok, i) => isReal(tok) && family.stems.has(stemOf(tok.norm)) && r.skip.add(i));
    }
    // Several products of one supplier that only the user (or the supplier's name) could place: a family named after what they are.
    if (left.length >= 2 && sizes.length === 0) for (const r of left) r.family = first.cls!.subcategory ?? first.cls!.category;
  }

  // ---- 3b. Who sold it, how it calls it, and whether anything else says what the product is.
  const readIdentity = (r: Reading) => {
    const x = r.anchor ? pieces(r) : null;
    const first = r.toks.findIndex(isReal);
    // What stands in front of the noun is the supplier's article code when it is marked as one ("ART. LC TR."), when it is a long run of codes, or when it has letters in it ("F60/8N"); numbers alone ("52/54") are a grade.
    const leadIsCode = !!x && x.moved && (x.marked || x.longCode || x.leadWords.some((tok) => /[a-z]/i.test(tok.text)));
    const article = leadIsCode ? clean(x!.leadWords.map(tidyTok)) : r.dropped && first >= LONG_CODE ? clean(r.toks.slice(0, first).map(tidyTok)) : "";
    const inText = [...(article ? [article] : []), ...r.parts.codes];
    const codes = [...new Set([...inText, ...r.p.aliases.map((a) => (a.supplierSku ?? "").trim()).filter(Boolean)])];
    // What is left to tell it apart, once the noun, the supplier's name and its codes are set aside.
    const spec = x ? x.tail.some((tok) => !isDash(tok)) || (x.moved && !leadIsCode) : r.toks.some((tok, i) => !r.skip.has(i) && !!tok.norm && !MARKER.test(tok.text));
    const ask = (r.cls?.subKey ? subByKey(r.cls.subKey)?.sub.ask : null) ?? null;
    const identity: Identity = r.p.mapped || !r.cls || spec || !inText.length ? "named" : ask && r.by !== "user" ? "unidentified" : "supplier_code";
    return { identity, codes, inText, appended: leadIsCode, options: identity === "unidentified" ? ask!.slice(0, 3) : [] };
  };
  const identities = new Map(readings.map((r) => [r.p.id, readIdentity(r)]));

  // ---- 4. Names, each one different from every other.
  const named = new Map<string, { name: string; variant: string | null }>();
  for (const r of open) {
    const id = identities.get(r.p.id)!;
    const proposal = compose(r, false);
    // Nothing says which one it is: it keeps the name it has until someone does. No name is made up from a code.
    if (id.identity === "unidentified") named.set(r.p.id, { name: r.p.name, variant: null });
    // Only the supplier's code tells it apart: the code stays, visibly, until a specification is on file.
    else if (id.identity === "supplier_code" && !id.appended && r.parts.codes.length) named.set(r.p.id, { name: `${proposal.name} ${r.parts.codes[0]}`, variant: r.family ? clean([proposal.variant ?? "", r.parts.codes[0]]) : null });
    else named.set(r.p.id, proposal);
  }
  const taken = (id: string, name: string) => readings.some((k) => k.p.id !== id && normalizeKey(k.p.mapped ? k.p.name : named.get(k.p.id)!.name) === normalizeKey(name));
  for (const r of open) {
    if (!taken(r.p.id, named.get(r.p.id)!.name)) continue;
    // Shortened to the same name as another product: the code that was left out is what tells them apart.
    const twins = open.filter((k) => normalizeKey(named.get(k.p.id)!.name) === normalizeKey(named.get(r.p.id)!.name));
    for (const k of twins) {
      const full = compose(k, true);
      named.set(k.p.id, taken(k.p.id, full.name) ? { name: k.p.name, variant: full.variant } : full);
    }
  }

  // ---- 5. The same product written twice.
  const separated = new Set((options.separated ?? []).map(([a, b]) => pairKey(a, b)));
  const facts = readings.map((r) => {
    const codes = new Map<string, Set<string>>();
    for (const a of r.p.aliases) {
      const code = codeKey(a.supplierSku);
      if (!code || !a.supplierId) continue;
      if (!codes.has(a.supplierId)) codes.set(a.supplierId, new Set());
      codes.get(a.supplierId)!.add(code);
    }
    return {
      r,
      suppliers: new Set(r.p.suppliers.map((s) => s.id)),
      codes,
      eans: new Set(r.p.aliases.map((a) => codeKey(a.ean)).filter(Boolean)),
      key: normalizeKey(r.base),
      spec: normalizeKey(withoutPackNotes(r.base)),
      numbers: numbersOf(r.base),
      tokens: matchTokens(r.base),
      // Every word and letter counts here ("C5" is not "C5A"); only units and markers are left out.
      loose: normalizeKey(r.base).replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").split(" ").filter((tok) => tok && !/^\d+$/.test(tok) && !LOOSE_NOISE.has(tok)),
    };
  });
  // A code written on three or more products is the supplier's code for a whole range, not for one article.
  const codeUse = new Map<string, number>();
  for (const f of facts) for (const [supplierId, codes] of f.codes) for (const code of codes) codeUse.set(`${supplierId}|${code}`, (codeUse.get(`${supplierId}|${code}`) ?? 0) + 1);
  const specific = (f: (typeof facts)[number]) => new Set([...f.codes].flatMap(([supplierId, codes]) => [...codes].map((code) => `${supplierId}|${code}`)).filter((k) => (codeUse.get(k) ?? 0) <= 2));

  // One supplier, one day, two prices: two products, however alike the names. Such a pair is never proposed as one.
  const sameDay = boughtSameDay(readings.flatMap((r) => (r.p.days ?? []).map((d) => ({ productId: r.p.id, ...d }))));
  const sets = new Sets();
  const links: { a: string; level: "high" | "possible"; reason: string; suggestion: "merge" | null }[] = [];
  const link = (a: string, b: string, level: "high" | "possible", reason: string, suggestion: "merge" | null) => {
    sets.join(a, b);
    links.push({ a, level, reason, suggestion });
  };
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const [a, b] = [facts[i], facts[j]];
      if (a.r.p.unit !== b.r.p.unit || separated.has(pairKey(a.r.p.id, b.r.p.id)) || sameDay.get(pairKey(a.r.p.id, b.r.p.id))?.different) continue;
      const [ida, idb] = [a.r.p.id, b.r.p.id];
      const price = samePrice(a.r.p.price, b.r.p.price);
      if ([...a.eans].some((e) => b.eans.has(e))) {
        link(ida, idb, "high", t("Same barcode"), "merge");
        continue;
      }
      const sameSupplier = [...a.suppliers].some((s) => b.suppliers.has(s));
      if (!sameSupplier) {
        if (a.key === b.key && a.tokens.length >= 2) link(ida, idb, "possible", t("Same description from two suppliers"), "merge");
        continue;
      }
      const [ca, cb] = [specific(a), specific(b)];
      const sharedCode = [...ca].some((c) => cb.has(c));
      if (a.key === b.key) link(ida, idb, "high", t("Same description, written twice"), "merge");
      else if (sharedCode && sameNumbers(a.numbers, b.numbers)) link(ida, idb, "high", t("Same supplier code, same sizes"), "merge");
      else if (a.spec === b.spec && (sharedCode || price)) link(ida, idb, "possible", t("Same product and sizes: only the packing note is different"), price ? "merge" : null);
      else if (ca.size > 0 && cb.size > 0 && !sharedCode) continue;
      else if (sameNumbers(a.numbers, b.numbers) && differByOneWord(a.tokens, b.tokens)) link(ida, idb, "possible", t("Almost the same description: one word is written differently"), price ? "merge" : null);
      // "CONT LC TR 30", "LC TR CONTENITORE 30 CL": the order of the words, a unit left out and an abbreviation do not make another product.
      else if (sameNumbers(a.numbers, b.numbers) && sameWords(a.loose, b.loose)) link(ida, idb, "possible", t("The same words and sizes, in another order or abbreviated"), price ? "merge" : null);
    }
  }
  const linksOf = groupBy(links, (l) => sets.find(l.a));
  const groups = groupBy(
    readings.filter((r) => linksOf.has(sets.find(r.p.id))),
    (r) => sets.find(r.p.id),
  );
  const duplicates: DuplicateGroup[] = [...groups.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([root, members]) => {
      const info = linksOf.get(root) ?? [];
      const sorted = [...members].sort((x, y) => y.p.spend - x.p.spend);
      const top = sorted[0];
      const packing = info.some((x) => x.reason === t("Same product and sizes: only the packing note is different"));
      const name = top.p.mapped ? top.p.name : named.get(top.p.id)!.name;
      return {
        key: `dup_${sorted.map((m) => m.p.id).sort().join("_").slice(0, 80)}`,
        productIds: sorted.map((m) => m.p.id),
        level: info.every((x) => x.level === "high") ? ("high" as const) : ("possible" as const),
        reason: info[0]?.reason ?? "",
        suggestion: info.every((x) => x.suggestion === "merge") ? ("merge" as const) : null,
        proposedName: packing ? withoutPackNotes(name) : name,
        spend: sum(sorted, (m) => m.p.spend),
      };
    })
    .sort((a, b) => b.spend - a.spend);
  const inDuplicates = new Set(duplicates.flatMap((d) => d.productIds));

  // ---- 6. The result, product by product.
  const mappings: Mapping[] = readings
    .map((r): Mapping => {
      const supplier = supplierOf(r);
      const id = identities.get(r.p.id)!;
      const seen = new Set<string>();
      const originals = [r.p.name, ...r.p.aliases.map((a) => a.text)].map((x) => x.trim()).filter((x) => x && !seen.has(normalizeKey(x)) && !!seen.add(normalizeKey(x)));
      const base = { productId: r.p.id, current: r.p.name, spend: r.p.spend, supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? null, originals, supplierTerms: [...new Set(r.parts.supplierTerms)], supplierCodes: id.codes };
      if (r.p.mapped) return { ...base, name: r.p.name, category: r.p.category, subcategory: r.p.subcategory, subKey: r.cls?.subKey ?? null, kind: r.p.kind, family: r.p.family, variant: r.p.variant, level: "high", by: "stored", reason: null, mapped: true, identity: "named", options: [], group: "done" };
      const proposal = named.get(r.p.id)!;
      const who = supplier?.name ?? t("the supplier");
      if (id.identity === "unidentified") {
        const reason = t("The words say it is {what}, not which one. {codes}: how {supplier} calls it, not what it is made of. It keeps its name until a data sheet or your answer says what it is.", { what: (r.cls!.subcategory ?? r.cls!.category).toLowerCase(), codes: id.inText.join(", "), supplier: who });
        return { ...base, name: r.p.name, category: r.cls!.category, subcategory: null, subKey: r.cls!.subKey, kind: r.kind, family: null, variant: null, level: "low", by: r.by, reason, mapped: false, identity: "unidentified", options: id.options, group: "unclassified" };
      }
      const shortened = !!r.anchor && pieces(r).longCode && normalizeKey(proposal.name) !== normalizeKey(compose(r, true).name);
      const byCode = id.identity === "supplier_code" && r.by !== "user";
      const level: Level = r.by === "user" ? "high" : r.by === "words" ? (shortened || byCode ? "medium" : "high") : r.cls ? "medium" : "low";
      const reason =
        r.reason ??
        (shortened
          ? t("The name started with a long supplier code: we kept the readable part. The original stays linked as written.")
          : byCode
            ? t("Only the article code of {supplier} ({code}) tells it apart from the others: the code stays in the name until a size or a specification is on file.", { supplier: who, code: id.inText[0] })
            : level === "low"
              ? t("Nothing in the name says what this is.")
              : null);
      const group: CleanupGroup = inDuplicates.has(r.p.id) || level === "medium" ? "review" : level === "high" ? "confident" : "unclassified";
      return { ...base, name: proposal.name, category: r.cls?.category ?? null, subcategory: r.cls?.subcategory ?? null, subKey: r.cls?.subKey ?? null, kind: r.kind, family: r.family, variant: proposal.variant, level, by: r.by, reason, mapped: false, identity: id.identity, options: [], group };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));

  // ---- 7. What to ask: one card per supplier and proposal, the largest spend first.
  const toAsk = mappings.filter((m) => !m.mapped && m.level !== "high" && !inDuplicates.has(m.productId));
  // A product nothing identifies is asked about on its own: one supplier's waxes need not be the same wax.
  const cards: ReviewCard[] = [...groupBy(toAsk, (m) => `${m.supplierId}|${m.identity === "unidentified" ? `ask:${m.productId}` : m.level === "low" ? `low:${m.kind}` : m.subKey ?? m.category}|${m.by}|${m.identity}`).values()]
    .map((ms) => ({
      key: `card_${ms.map((m) => m.productId).sort().join("_").slice(0, 80)}`,
      type: ms[0].level === "low" ? ("classify" as const) : ("check" as const),
      productIds: ms.map((m) => m.productId),
      supplierName: ms[0].supplierName,
      subKey: ms[0].subKey,
      kind: ms[0].level === "low" && !isStrategic(ms[0].kind) ? ms[0].kind : null,
      reason: ms[0].reason ?? "",
      spend: sum(ms, (m) => m.spend),
      options: ms[0].options,
    }))
    .sort((a, b) => b.spend - a.spend);

  const families: FamilySummary[] = [...groupBy(mappings.filter((m) => m.family), (m) => `${normalizeKey(m.family)}|${normalizeKey(m.subcategory ?? m.category)}`).values()]
    .map((ms) => ({ name: ms[0].family!, category: ms[0].category, subcategory: ms[0].subcategory, productIds: ms.map((m) => m.productId), spend: sum(ms, (m) => m.spend) }))
    .sort((a, b) => b.spend - a.spend);

  const pending = mappings.filter((m) => !m.mapped);
  const high = pending.filter((m) => m.level === "high" && !inDuplicates.has(m.productId));
  const spend = sum(mappings, (m) => m.spend);
  const pareto = [0.5, 0.8, 0.9].map((share) => {
    let running = 0;
    let n = 0;
    for (const m of mappings) {
      if (spend <= 0 || running / spend >= share) break;
      running += m.spend;
      n++;
    }
    return { share, products: n, reached: spend > 0 ? running / spend : 0 };
  });

  // ---- 8. Articles that may be versions of one product: the same supplier, unit and family, names that begin alike.
  const byId = new Map(readings.map((r) => [r.p.id, r.p]));
  const macros = macroGroups(
    mappings
      .filter((m) => !inDuplicates.has(m.productId) && m.group !== "unclassified" && m.supplierId && (m.subcategory ?? m.category))
      .map((m) => ({
        id: m.productId,
        name: m.name,
        family: m.family,
        filed: !!byId.get(m.productId)!.macro,
        scope: `${m.supplierId}|${byId.get(m.productId)!.unit}|${normalizeKey(m.subcategory ?? m.category)}`,
        supplierId: m.supplierId,
        supplierName: m.supplierName,
        unit: byId.get(m.productId)!.unit,
        price: byId.get(m.productId)!.price,
        spend: m.spend,
      })),
    { separated, sameDay, t },
  );

  return {
    products: mappings,
    duplicates,
    macros,
    cards,
    families,
    totals: {
      analysed: mappings.length,
      spend,
      confirmed: mappings.length - pending.length,
      high: high.length,
      highSpend: sum(high, (m) => m.spend),
      medium: pending.filter((m) => m.level === "medium").length,
      low: pending.filter((m) => m.level === "low").length,
      inDuplicates: pending.filter((m) => inDuplicates.has(m.productId)).length,
      review: toAsk.length,
      reviewSpend: sum(toAsk, (m) => m.spend),
      groups: { done: mappings.length - pending.length, confident: pending.filter((m) => m.group === "confident").length, review: pending.filter((m) => m.group === "review").length, unclassified: pending.filter((m) => m.group === "unclassified").length },
    },
    pareto,
  };
}

/** The mapping of one product, with every other product as context. */
export const mappingOf = (analysis: MapAnalysis, productId: string) => analysis.products.find((m) => m.productId === productId) ?? null;
