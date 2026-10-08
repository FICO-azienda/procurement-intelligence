/**
 * Who sold it is not what was bought — and what the supplier calls it is not
 * what the product is. A description on an invoice is raw source data: this
 * reads it apart into the seller's own name, the seller's own codes, and what
 * is left, which is the product.
 *
 *   "Paraffina SER 52/54 (XXF)", sold by SER S.p.A.
 *     seller's name   SER
 *     seller's code   XXF
 *     the product     Paraffina 52/54
 *
 * Rules, each one a pattern that can't mean anything else:
 *   - a word of the seller's company name is the seller, unless it is also a
 *     word for a product, a material or a colour — and unless nothing but a
 *     model code would be left (a brand and its model: "3M DP490" stays);
 *   - a short code in brackets, a number of five digits or more, and the
 *     article code the document itself gives are the seller's codes;
 *   - grades, sizes, weights and every other number are the specification and
 *     are never touched: "52/54" is not "56/58".
 *
 * Nothing here decides what a product is, and nothing is stored: the
 * description as written stays on file, and this is read from it each time.
 * No language model is called.
 */
import { codeKey, companyKey, normalizeKey } from "../import/normalize/text";
import { withoutPackNotes } from "./attributes";
import { matchTokens, numbersOf, sameNumbers } from "./specs";
import { categorize } from "./taxonomy";

export interface SellerContext {
  /** Every name the seller is known by. */
  names: (string | null | undefined)[];
  /** The article codes the documents give for this description. */
  skus?: (string | null | undefined)[];
}

export interface DescriptionParts {
  original: string;
  /** Words of the description that are the seller's own name. */
  supplierTerms: string[];
  /** The seller's own codes found in the description. */
  codes: string[];
  /** What is left: the product. */
  body: string;
  /** The seller's name was left in: it is the brand of a product nothing else names. */
  brandKept: boolean;
}

const UNITS = new Set(["kg", "gr", "g", "ml", "cl", "cc", "lt", "l", "mm", "cm", "mt", "m", "pz", "pcs", "nr", "n", "ct", "my"]);
const PLAIN = /^(?:bianc[oa]|ross[oa]|blu|giall[oa]|verde|ner[oa]|trasparente|neutr[oa]|white|red|blue|yellow|green|black|transparent|vetro|alluminio|policarbonato|polipropilene|pp|pe|pvc|pet|legno|cartone|metallo|plastica|cotone|glass|aluminium|wood|cotton|italia|italy|europa|europe|group|gruppo|international|industria|industrie|candle|candles)$/;
const BRACKET_CODE = /^\(([A-Z0-9][A-Z0-9./-]{1,7})\)[.,;:]?$/;
const LONG_NUMBER = /^\d{5,}[.,;:]?$/;
const isRealWord = (norm: string) => /^[a-z]{4,}$/.test(norm);

/** The words a company name is made of that could only mean the company. */
export function sellerWords(names: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const name of names) for (const word of companyKey(name).split(" ")) if (word.length >= 3 && !PLAIN.test(word) && !categorize(word)) out.add(word);
  return out;
}

export function separate(text: string | null | undefined, seller: SellerContext): DescriptionParts {
  const original = (text ?? "").replace(/\s+/g, " ").trim();
  const own = sellerWords(seller.names);
  const skus = new Set((seller.skus ?? []).map((s) => codeKey(s)).filter((s) => s.length >= 3));
  const words = original.split(" ").filter(Boolean);
  const supplierTerms: string[] = [];
  const codes: string[] = [];
  const kept: string[] = [];
  words.forEach((word, i) => {
    const norm = normalizeKey(word);
    const bare = word.replace(/[.,;:]+$/, "");
    const bracket = BRACKET_CODE.exec(word);
    if (own.has(norm)) supplierTerms.push(bare);
    else if (bracket && /[A-Z]/.test(bracket[1]) && !UNITS.has(bracket[1].toLowerCase()) && !PLAIN.test(bracket[1].toLowerCase())) codes.push(bracket[1]);
    // A long bare number is a code unless a unit next to it makes it a quantity ("12000 pz").
    else if (LONG_NUMBER.test(word) && !UNITS.has(normalizeKey(words[i + 1])) && !UNITS.has(normalizeKey(words[i - 1]))) codes.push(bare);
    else if (skus.has(codeKey(word)) && /\d/.test(word)) codes.push(bare);
    else kept.push(word);
  });
  // Without the seller's name only a code would be left: the name is a brand and its model, and stays as written.
  const body = kept.join(" ");
  const says = kept.some((w) => isRealWord(normalizeKey(w))) || !!categorize(body);
  if (supplierTerms.length && !says) return { original, supplierTerms: [], codes: [], body: original, brandKept: true };
  return { original, supplierTerms, codes, body: kept.length ? body : original, brandKept: false };
}

// ---------------- The same product, written by someone else ----------------

export interface Identity {
  /** The taxonomy subcategory its words name. Null: nothing says what it is. */
  subKey: string | null;
  /** Its grades and sizes, in order. */
  numbers: string[];
  /** The other words that describe it, as stems. */
  words: string[];
  codes: string[];
}

const FILLER = new Set(["per", "di", "da", "del", "della", "dei", "delle", "in", "con", "a", "e", "x", "for", "of", "the", "and", "with", "art", "articolo", "cod", "codice", "tipo", "type"]);
/** How much a bag or a carton holds: packaging, not the grade of what is inside. In "52-54 KG 25" the weight is 25, not 54. */
const WEIGHT = /\b(?:da\s+)?(?:kg|gr|g|lt|l)\.?\s*\d+(?:[.,]\d+)?\b|(?<![\d/\-.,])\b\d+(?:[.,]\d+)?\s*(?:kg|gr|g|lt)\b/gi;
const stem = (word: string) => (word.length >= 5 ? word.replace(/[aeio]$/, "") : word);

export function identityOf(text: string | null | undefined, seller: SellerContext = { names: [] }): Identity {
  const parts = separate(text, seller);
  const body = withoutPackNotes(parts.body).replace(WEIGHT, " ");
  const hit = categorize(body);
  // Short codes count too: "LC TR" and "LC A B V" are not the same article, and "C12" is not "B12".
  const words = [...new Set(matchTokens(body).filter((tok) => /^[a-z]+$/.test(tok) && !FILLER.has(tok) && !UNITS.has(tok) && !categorize(tok)).map(stem))].sort();
  return { subKey: hit?.sub.key ?? null, numbers: numbersOf(body), words, codes: parts.codes };
}

/**
 * same       the words name the same thing and the grades are the same;
 * likely     the same thing and the same grades, but one says something the other does not;
 * other_spec the same thing in another grade or size: the same family, not the same product;
 * unrelated  nothing ties them.
 */
export type IdentityMatch = "same" | "likely" | "other_spec" | "unrelated";

export function compareIdentity(a: Identity, b: Identity): { match: IdentityMatch; differences: string[] } {
  const differences = [...a.words.filter((w) => !b.words.includes(w)), ...b.words.filter((w) => !a.words.includes(w))];
  if (!a.subKey || !b.subKey || a.subKey !== b.subKey) return { match: "unrelated", differences };
  if (a.numbers.length && b.numbers.length) {
    if (!sameNumbers(a.numbers, b.numbers)) return { match: "other_spec", differences };
    return { match: differences.length ? "likely" : "same", differences };
  }
  // No grade on either side: only the very same words say the same product.
  if (!a.numbers.length && !b.numbers.length && a.words.length && !differences.length) return { match: "same", differences };
  return { match: "unrelated", differences };
}
