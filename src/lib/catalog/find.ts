/**
 * Finding a product while typing: by its name, by a code, or by any way a
 * document wrote it — capitals, accents and a wrong letter do not matter.
 *
 *   "52/54"      the paraffin of that grade
 *   "wax"        what is called wax in its name, or was billed as "WAX …"
 *   "bicchiere"  the glasses, also where an invoice wrote "BICCH."
 *   "parafina"   paraffin, one letter short
 *
 * Every word typed must be found somewhere in the product. Words are compared
 * as whole words first, then as the beginning of one, then with a letter
 * wrong; numbers are never read with a digit wrong ("52" is not "53"). No
 * language model is called, and nothing is stored: it runs on what the page
 * already holds.
 */
import { normalizeKey } from "../import/normalize/text";

export interface Findable {
  id: string;
  name: string;
  /** A code written on it: the supplier's article code, the company's own. */
  code?: string | null;
  /** Every other way it is written. */
  terms?: string[];
  spend?: number;
}

export interface Found<P> {
  item: P;
  score: number;
  /** What was found when it is not in the name: the description or the code that matched, as written. */
  via: string | null;
}

/** How sure a word found in the name is, against one found in a code or in a description of a document. */
const WEIGHT = { name: 100, code: 70, term: 55 } as const;
const MATCH = { whole: 1, start: 0.8, inside: 0.5, short: 0.45, typo: 0.4, typoStart: 0.35 } as const;

interface Words {
  tokens: string[];
  /** The same without spaces: "LC 1" is found by "lc1", "52/54" only where 52 comes before 54. */
  compact: string;
}
const words = (text: string | null | undefined): Words => {
  const tokens = normalizeKey(text).split(" ").filter(Boolean);
  return { tokens, compact: tokens.join("") };
};

interface Index {
  name: Words;
  code: Words;
  terms: { text: string; words: Words }[];
}
const INDEX = new WeakMap<object, Index>();
function indexOf(item: Findable): Index {
  let index = INDEX.get(item);
  if (!index) INDEX.set(item, (index = { name: words(item.name), code: words(item.code), terms: (item.terms ?? []).map((text) => ({ text, words: words(text) })) }));
  return index;
}

const lettersOnly = (s: string) => /^[a-z]+$/.test(s);
/** One wrong letter in a word of four, two in a long one. */
const typosAllowed = (length: number) => (length >= 8 ? 2 : length >= 4 ? 1 : 0);

/** Letters to change, add, drop or swap to turn one word into the other — given up as soon as it is more than `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2] + 1);
      next.push(d);
      least = Math.min(least, d);
    }
    if (least > max) return max + 1;
    before = row;
    row = next;
  }
  return row[b.length];
}

/** How well a typed word is found among the words of a text: 1 the whole word, 0 not there. */
function wordScore(typed: string, tokens: string[]): number {
  let best = 0;
  const typos = lettersOnly(typed) ? typosAllowed(typed.length) : 0;
  for (const token of tokens) {
    let s = 0;
    if (token === typed) s = MATCH.whole;
    else if (token.startsWith(typed)) s = MATCH.start;
    else if (typed.length >= 3 && token.includes(typed)) s = MATCH.inside;
    // A document cut the word short: "bicch" is "bicchiere".
    else if (token.length >= 4 && lettersOnly(token) && typed.startsWith(token)) s = MATCH.short;
    // A slip is rarely on the first letter: asking for it keeps "wick" from being read as "pick".
    else if (typos && lettersOnly(token) && token[0] === typed[0]) {
      if (editDistance(typed, token, typos) <= typos) s = MATCH.typo;
      // …or the beginning of a longer word, typed with a letter wrong.
      else if (typed.length >= 5 && token.length > typed.length && editDistance(typed, token.slice(0, typed.length), typos) <= typos) s = MATCH.typoStart;
    }
    if (s > best) best = s;
    if (best === MATCH.whole) break;
  }
  return best;
}

/** A word found whole or from its beginning; found inside or cut short; found with a letter wrong. */
const rank = (match: number) => (match >= MATCH.start ? 3 : match >= MATCH.short ? 2 : match > 0 ? 1 : 0);

export function findProducts<P extends Findable>(items: P[], query: string | null | undefined): Found<P>[] {
  const typed = words(query);
  if (!typed.tokens.length) return [];
  // Written together or apart, it is the same: "tg1206" is "TG 1206", and "52/54" is 52 followed by 54.
  const joinable = typed.compact.length >= 3 && (typed.tokens.length > 1 || (/[a-z]/.test(typed.compact) && /\d/.test(typed.compact)));
  const found: (Found<P> & { quality: number })[] = [];
  for (const item of items) {
    const index = indexOf(item);
    const joined = {
      name: joinable && index.name.compact.includes(typed.compact) ? 0.85 : 0,
      code: joinable && index.code.compact.includes(typed.compact) ? 0.85 : 0,
      term: joinable ? (index.terms.find((x) => x.words.compact.includes(typed.compact)) ?? null) : null,
    };
    let score = 0;
    let quality = 3;
    let outside: { weight: number; text: string } | null = null;
    for (const word of typed.tokens) {
      const inName = Math.max(wordScore(word, index.name.tokens), joined.name);
      const inCode = Math.max(wordScore(word, index.code.tokens), joined.code);
      let inTerm = 0;
      let term: string | null = null;
      for (const x of index.terms) {
        const s = Math.max(wordScore(word, x.words.tokens), joined.term === x ? 0.85 : 0);
        if (s > inTerm) [inTerm, term] = [s, x.text];
      }
      const best = Math.max(inName * WEIGHT.name, inCode * WEIGHT.code, inTerm * WEIGHT.term);
      quality = Math.min(quality, rank(Math.max(inName, inCode, inTerm)));
      if (!best) break;
      score += best;
      // Found better outside the name: say where, so that the result explains itself.
      if (best > inName * WEIGHT.name) {
        const inCodeW = inCode * WEIGHT.code;
        const inTermW = inTerm * WEIGHT.term;
        const text = inCodeW >= inTermW ? item.code! : term!;
        if (!outside || Math.max(inCodeW, inTermW) > outside.weight) outside = { weight: Math.max(inCodeW, inTermW), text };
      }
    }
    if (!quality) continue;
    // The words in the order they were typed, side by side: the product meant, before the ones that only contain them.
    if (typed.tokens.length > 1 && joined.name) score += 40;
    found.push({ item, score: score / typed.tokens.length, via: outside?.text ?? null, quality });
  }
  // A word with a letter wrong is a second guess: shown only when nothing is found as typed.
  const asTyped = found.filter((x) => x.quality >= 2);
  return (asTyped.length ? asTyped : found)
    .sort((a, b) => b.score - a.score || (b.item.spend ?? 0) - (a.item.spend ?? 0) || a.item.name.localeCompare(b.item.name, undefined, { numeric: true }))
    .map(({ item, score, via }) => ({ item, score, via }));
}

/** The categories and subcategories a few typed words name: every word must begin, or nearly be, a word of the name. */
export function findNames<N extends { name: string }>(nodes: N[], query: string | null | undefined): N[] {
  const typed = words(query);
  if (!typed.tokens.length) return [];
  return nodes
    .map((node) => {
      const tokens = words(node.name).tokens;
      const scores = typed.tokens.map((word) => wordScore(word, tokens));
      // A category is named by the beginning of its words ("imb", "paraf"), or nearly: not by letters found in the middle.
      return { node, score: scores.every((s) => s > 0 && s !== MATCH.inside && s !== MATCH.short) ? scores.reduce((a, b) => a + b, 0) : 0 };
    })
    .filter((x) => x.score > 0)
    // Between two names the words fit as well, the shorter one is the one meant.
    .sort((a, b) => b.score - a.score || a.node.name.length - b.node.name.length)
    .map((x) => x.node);
}
