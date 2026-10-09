/**
 * From the lines of an import whose product is not known yet, to a proposal:
 * which descriptions are the same product, what each product is, and where
 * the user has to decide.
 *
 *   confident  one click confirms them all: descriptions that are the same
 *              text written twice, or carry the same supplier code and the
 *              same sizes; and spend that is not a product (transport,
 *              utilities, services), kept as one item per supplier and kind.
 *   questions  what nobody can decide without looking: two descriptions that
 *              may be one product, lines nobody could classify.
 *
 * Names alone never merge two products: a number that differs (1204 / 1206)
 * keeps them apart unless the supplier's own code says they are one — and
 * even then the user is asked. Nothing here writes to the database.
 */
import { codeKey, tidy } from "../import/normalize/text";
import { ratio } from "../import/match/similarity";
import { en, type Msg, type Params, type T } from "../i18n";
import { SAME_PRICE } from "./apart";
import { cleanName } from "./clean";
import { classify, dominantKind } from "./classify";
import { KIND_GROUP_LABEL, isStrategic, type ProductKind } from "./kinds";
import { matchKey, matchTokens, numbersOf, sameNumbers, wordsKey } from "./specs";

export interface CatalogLine {
  id: string;
  supplierId: string;
  supplierName: string;
  /** The product as the document writes it. */
  text: string;
  category?: string | null;
  supplierSku?: string | null;
  /** Our own code, when the supplier prints it. */
  ownSku?: string | null;
  ean?: string | null;
  /** Normalised unit, null when the file has none we know. */
  unit: string | null;
  unitPrice: number | null;
  /** What the line cost, in EUR (0 when not known). */
  amount: number;
  /** The day of the document: two descriptions billed on one day at two prices are two products. */
  date?: string | null;
}

/** One description from one supplier, with every line that uses it. */
export interface Mention {
  key: string;
  supplierId: string;
  supplierName: string;
  /** The description, as written most often. */
  text: string;
  /** Every spelling found (case, spaces and punctuation aside, they are the same text). */
  texts: string[];
  numbers: string[];
  codes: string[];
  ownCodes: string[];
  eans: string[];
  unit: string | null;
  /** Typical unit price (median). */
  price: number | null;
  /** Each day it was billed, and at what price. */
  days: { date: string; price: number }[];
  lines: number;
  amount: number;
  itemIds: string[];
  kind: ProductKind;
  /** How the kind was decided: the line's words, what the supplier sells, or not at all. */
  by: "words" | "supplier" | "none";
}

/** A product (or an item of spend) to create, with the descriptions that become its aliases. */
export interface Draft {
  key: string;
  name: string;
  kind: ProductKind;
  strategic: boolean;
  unit: string;
  /** Our code for it, when the supplier printed one. */
  sku: string | null;
  /** Why several descriptions are one product (null for a single description). */
  reason: Msg | null;
  mentions: Mention[];
  descriptions: number;
  lines: number;
  amount: number;
  supplierIds: string[];
}

export interface Question {
  key: string;
  /** same: these may be one product · kind: nobody could say what these are. */
  type: "same" | "kind";
  drafts: Draft[];
  reason: Msg;
  params?: Params;
  /** What the evidence points to; the user decides. */
  suggestion: "merge" | "separate" | null;
  /** The name the product would take if merged. */
  mergedName: string;
  supplierIds: string[];
  lines: number;
  amount: number;
}

export interface Analysis {
  /** Distinct descriptions, as written. */
  descriptions: number;
  lines: number;
  amount: number;
  confident: Draft[];
  questions: Question[];
  /** Descriptions put together with at least another one, with no doubt. */
  grouped: number;
  /** Among `confident`: products to compare and negotiate / other company spend. */
  products: number;
  otherSpend: number;
}

export interface ProposeOptions {
  /** A kind decided by the user for the lines of a supplier nobody could classify. */
  kindBySupplier?: Map<string, ProductKind>;
  t?: T;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const median = (ns: number[]) => (ns.length ? [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)] : null);
const mostCommon = <V,>(values: V[]): V | null => {
  const counts = new Map<V, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const samePrice = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.005;

function buildMentions(lines: CatalogLine[]): Mention[] {
  const groups = new Map<string, CatalogLine[]>();
  for (const l of lines) {
    const text = matchKey(l.text) || `code ${codeKey(l.supplierSku ?? l.ownSku ?? l.ean)}`;
    const key = `${l.supplierId}|${text}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  return [...groups.entries()].map(([key, ls]) => {
    const texts = [...new Set(ls.map((l) => tidy(l.text)).filter(Boolean))];
    const text = mostCommon(ls.map((l) => tidy(l.text)).filter(Boolean)) ?? ls[0].supplierSku ?? "";
    const set = (pick: (l: CatalogLine) => string | null | undefined) => [...new Set(ls.map((l) => codeKey(pick(l))).filter(Boolean))];
    return {
      key,
      supplierId: ls[0].supplierId,
      supplierName: ls[0].supplierName,
      text,
      texts,
      numbers: numbersOf(text),
      codes: set((l) => l.supplierSku),
      ownCodes: [...new Set(ls.map((l) => tidy(l.ownSku)).filter(Boolean))],
      eans: set((l) => l.ean),
      unit: mostCommon(ls.map((l) => l.unit).filter((u): u is string => !!u)),
      price: median(ls.map((l) => l.unitPrice).filter((p): p is number => p != null)),
      days: ls.filter((l) => l.date && l.unitPrice != null && l.unitPrice > 0).map((l) => ({ date: l.date!, price: l.unitPrice! })),
      lines: ls.length,
      amount: ls.reduce((s, l) => s + l.amount, 0),
      itemIds: ls.map((l) => l.id),
      kind: "needs_review" as ProductKind,
      by: "none" as const,
    };
  });
}

/** Sets each mention's kind: its own words first, then what the supplier's clear lines are. */
function classifyMentions(mentions: Mention[], lines: CatalogLine[], overrides?: Map<string, ProductKind>) {
  const category = new Map<string, string | null>();
  for (const l of lines) if (l.category) category.set(`${l.supplierId}|${matchKey(l.text)}`, l.category);
  const own = mentions.map((m) => classify({ text: m.text, category: category.get(m.key), supplierName: m.supplierName }));
  const bySupplier = new Map<string, { kind: ProductKind | null; amount: number }[]>();
  mentions.forEach((m, i) => {
    if (!bySupplier.has(m.supplierId)) bySupplier.set(m.supplierId, []);
    bySupplier.get(m.supplierId)!.push({ kind: own[i].by === "words" ? own[i].kind : null, amount: m.amount });
  });
  mentions.forEach((m, i) => {
    let c = own[i];
    if (c.by === "none" || (c.by === "words" && c.kind === "other")) {
      c = classify({ text: m.text, category: category.get(m.key), supplierName: m.supplierName, supplierKind: dominantKind(bySupplier.get(m.supplierId)!) });
    }
    const decided = c.by === "none" ? overrides?.get(m.supplierId) : undefined;
    m.kind = decided ?? c.kind;
    m.by = decided ? "supplier" : c.by;
  });
}

/** What the names of a group have in common, when they share a beginning ("Candela Liturgica Altare"). */
function commonName(names: string[]): string | null {
  const words = names.map((n) => n.split(" "));
  const shared: string[] = [];
  for (let i = 0; i < words[0].length; i++) {
    if (!words.every((w) => w[i] === words[0][i])) break;
    shared.push(words[0][i]);
  }
  while (shared.length && !/[a-zà-ÿ]{2}/i.test(shared[shared.length - 1])) shared.pop();
  const name = cleanName(shared.join(" "));
  return shared.length >= 2 && /[a-zà-ÿ]{3}/i.test(name) ? name : null;
}

function makeDraft(mentions: Mention[], reason: Msg | null, t: T, spend?: { supplierName: string; kind: ProductKind }): Draft {
  const sorted = [...mentions].sort((a, b) => b.lines - a.lines || b.amount - a.amount);
  const top = sorted[0];
  const names = [...new Set(sorted.map((m) => cleanName(m.text)))];
  let name: string;
  if (spend) {
    // Spend that is not a product: named after what it is and who is paid.
    const what = names.length === 1 ? cleanName(top.text, 70) : t(KIND_GROUP_LABEL[spend.kind]);
    name = `${what} — ${tidy(spend.supplierName).slice(0, 60)}`;
  } else {
    name = names.length > 1 && !sameNumbers(sorted[0].numbers, sorted[sorted.length - 1].numbers) ? (commonName(names) ?? names[0]) : names[0];
  }
  const units = sorted.flatMap((m) => (m.unit ? Array<string>(m.lines).fill(m.unit) : []));
  const oneUnit = new Set(units).size === 1 && units.length === sorted.reduce((s, m) => s + m.lines, 0);
  const ownCodes = [...new Set(sorted.flatMap((m) => m.ownCodes))];
  const kind = spend?.kind ?? [...mentions].sort((a, b) => b.amount - a.amount)[0].kind;
  return {
    key: `d_${hash(sorted.map((m) => m.key).sort().join("\n"))}`,
    name,
    kind,
    strategic: isStrategic(kind),
    // A product is priced in its most common unit; spend with mixed units has none that means anything.
    unit: spend ? (oneUnit ? units[0] : "pcs") : (mostCommon(units) ?? "pcs"),
    sku: !spend && ownCodes.length === 1 ? ownCodes[0] : null,
    reason,
    mentions: sorted,
    descriptions: sorted.reduce((s, m) => s + m.texts.length, 0),
    lines: sorted.reduce((s, m) => s + m.lines, 0),
    amount: sorted.reduce((s, m) => s + m.amount, 0),
    supplierIds: [...new Set(sorted.map((m) => m.supplierId))],
  };
}

/** "Keep them apart": one product per description of a group the engine had put together. */
export const splitDraft = (draft: Draft, t: T = en): Draft[] => (draft.strategic && draft.mentions.length > 1 ? draft.mentions.map((m) => makeDraft([m], null, t)) : [draft]);

/** One long word written slightly differently, everything else equal: a typo or an abbreviation. */
export function differByOneWord(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const diff = a.map((t, i) => [t, b[i]] as const).filter(([x, y]) => x !== y);
  if (diff.length !== 1) return false;
  const [x, y] = diff[0];
  if (/\d/.test(x) || /\d/.test(y)) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return (long.length >= 6 && ratio(x, y) >= 0.8) || (short.length >= 4 && long.startsWith(short));
}

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

export function proposeProducts(lines: CatalogLine[], options: ProposeOptions = {}): Analysis {
  const t = options.t ?? en;
  const mentions = buildMentions(lines);
  classifyMentions(mentions, lines, options.kindBySupplier);

  const drafts: Draft[] = [];
  const questions: Question[] = [];
  const question = (type: Question["type"], ds: Draft[], reason: Msg, suggestion: Question["suggestion"], params?: Params): Question => ({
    key: `q_${hash(ds.map((d) => d.key).sort().join("\n"))}`,
    type,
    drafts: ds,
    reason,
    params,
    suggestion,
    mergedName: makeDraft(ds.flatMap((d) => d.mentions), null, t).name,
    supplierIds: [...new Set(ds.flatMap((d) => d.supplierIds))],
    lines: ds.reduce((s, d) => s + d.lines, 0),
    amount: ds.reduce((s, d) => s + d.amount, 0),
  });

  // ---- Spend that is not a product: one item per supplier and kind.
  const spend = new Map<string, Mention[]>();
  for (const m of mentions.filter((m) => m.by !== "none" && !isStrategic(m.kind))) {
    const key = `${m.supplierId}|${m.kind}`;
    if (!spend.has(key)) spend.set(key, []);
    spend.get(key)!.push(m);
  }
  for (const ms of spend.values()) drafts.push(makeDraft(ms, ms.length > 1 ? "Same kind of spend from the same supplier" : null, t, { supplierName: ms[0].supplierName, kind: ms[0].kind }));

  // ---- Products: the same text, or the same code with the same sizes, is the same product.
  const goods = mentions.filter((m) => m.by === "none" || isStrategic(m.kind));
  const sure = new Sets();
  const why = new Map<string, Msg>();
  const maybe: { a: Mention; b: Mention; reason: Msg; suggestion: Question["suggestion"] }[] = [];
  for (let i = 0; i < goods.length; i++) {
    for (let j = i + 1; j < goods.length; j++) {
      const [a, b] = [goods[i], goods[j]];
      const sameSupplier = a.supplierId === b.supplierId;
      const sharedCode = sameSupplier && a.codes.some((c) => b.codes.includes(c));
      const sharedEan = a.eans.some((e) => b.eans.includes(e));
      const sharedOwn = a.ownCodes.some((c) => b.ownCodes.includes(c));
      const numbers = sameNumbers(a.numbers, b.numbers);
      const price = samePrice(a.price, b.price) && a.unit === b.unit;
      const join = (reason: Msg) => {
        sure.join(a.key, b.key);
        why.set(sure.find(a.key), reason);
      };
      // One supplier, one day, two prices: two products, whatever else they share. Neither joined nor asked about.
      if (sameSupplier && a.days.some((x) => b.days.some((y) => x.date === y.date && Math.abs(x.price - y.price) > Math.min(x.price, y.price) * SAME_PRICE))) continue;
      if (sharedOwn) join("Same code of ours on the supplier's invoice");
      else if (sharedEan) join("Same barcode");
      else if (sharedCode && numbers) join("Same supplier code, same sizes");
      else if (a.by === "none" || b.by === "none" || (a.ownCodes.length && b.ownCodes.length)) continue;
      else if (sharedCode) maybe.push({ a, b, reason: "Same supplier code, but the sizes written are different", suggestion: price ? "merge" : "separate" });
      else if (!sameSupplier && a.key.split("|")[1] === b.key.split("|")[1] && matchTokens(a.text).length >= 2) {
        maybe.push({ a, b, reason: "Same description from two suppliers", suggestion: "merge" });
      } else if (sameSupplier && numbers && !(a.codes.length && b.codes.length) && differByOneWord(matchTokens(a.text), matchTokens(b.text))) {
        maybe.push({ a, b, reason: "Almost the same description: one word is written differently", suggestion: price ? "merge" : null });
      } else if (sameSupplier && !numbers && price && !a.codes.length && !b.codes.length && wordsKey(a.text) === wordsKey(b.text) && a.numbers.length === b.numbers.length && a.numbers.filter((n, k) => n !== b.numbers[k]).length === 1) {
        maybe.push({ a, b, reason: "Same words, unit and price: only one number is different", suggestion: "separate" });
      }
    }
  }
  const sets = new Map<string, Mention[]>();
  for (const m of goods) {
    const root = sure.find(m.key);
    if (!sets.has(root)) sets.set(root, []);
    sets.get(root)!.push(m);
  }
  const goodsDrafts = [...sets.entries()].map(([root, ms]) => makeDraft(ms, ms.length > 1 ? (why.get(root) ?? null) : null, t));
  const draftOf = new Map<string, Draft>();
  for (const d of goodsDrafts) for (const m of d.mentions) draftOf.set(m.key, d);

  // Doubts link drafts into groups to decide together (seventeen sizes of one article are one question).
  const doubt = new Sets();
  const doubtInfo = new Map<string, { reason: Msg; suggestion: Question["suggestion"] }>();
  for (const q of maybe) {
    const [da, db] = [draftOf.get(q.a.key)!, draftOf.get(q.b.key)!];
    if (da === db) continue;
    doubt.join(da.key, db.key);
    const root = doubt.find(da.key);
    const before = doubtInfo.get(root) ?? doubtInfo.get(da.key) ?? doubtInfo.get(db.key);
    // One doubtful link is enough to stop suggesting a merge for the whole group.
    doubtInfo.set(root, before ? { reason: before.reason, suggestion: before.suggestion === q.suggestion ? q.suggestion : null } : { reason: q.reason, suggestion: q.suggestion });
  }
  const doubtGroups = new Map<string, Draft[]>();
  for (const d of goodsDrafts) {
    const root = doubt.find(d.key);
    if (!doubtGroups.has(root)) doubtGroups.set(root, []);
    doubtGroups.get(root)!.push(d);
  }
  const unknownBySupplier = new Map<string, Draft[]>();
  for (const [root, ds] of doubtGroups) {
    if (ds.length > 1) {
      const info = doubtInfo.get(root) ?? [...doubtInfo.entries()].find(([k]) => doubt.find(k) === root)?.[1];
      questions.push(question("same", ds, info?.reason ?? "Similar descriptions", info?.suggestion ?? null));
      continue;
    }
    const d = ds[0];
    if (d.mentions.some((m) => m.by === "none")) {
      const supplier = d.mentions[0].supplierId;
      if (!unknownBySupplier.has(supplier)) unknownBySupplier.set(supplier, []);
      unknownBySupplier.get(supplier)!.push(d);
    } else drafts.push(d);
  }
  for (const ds of unknownBySupplier.values()) questions.push(question("kind", ds, "Nothing in these lines says what they are", null));

  const count = (ds: Draft[]) => ds.reduce((s, d) => s + d.descriptions, 0);
  questions.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  drafts.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return {
    descriptions: mentions.reduce((s, m) => s + m.texts.length, 0),
    lines: lines.length,
    amount: lines.reduce((s, l) => s + l.amount, 0),
    confident: drafts,
    questions,
    grouped: count(drafts.filter((d) => d.descriptions > 1)),
    products: drafts.filter((d) => d.strategic).length,
    otherSpend: drafts.filter((d) => !d.strategic).length,
  };
}
