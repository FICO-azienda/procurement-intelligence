/**
 * The numbers in a product name are its specification: 52/54, 1204, 300 ml,
 * Ø 80, 100x150. Two names that differ in a number are two products until
 * someone says otherwise, however alike the words.
 */
import { normalizeKey, productTokens } from "../import/normalize/text";

/** The numbers of a text, in order, each written one way: "08" = "8", "2,5" = "2.5". */
export function numbersOf(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(/\d+(?:[.,]\d+)?/g)) {
    const [whole, decimals = ""] = m[0].replace(",", ".").split(".");
    const d = decimals.replace(/0+$/, "");
    out.push((whole.replace(/^0+(?=\d)/, "") || "0") + (d ? `.${d}` : ""));
  }
  return out;
}

export const sameNumbers = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * The words and numbers that identify a product, in order: case, accents,
 * punctuation and filler words dropped ("Contenitori x ceri" = "CONTENITORI
 * PER CERI"; "52/54" = "52-54"). Two texts with the same key are the same
 * description written twice.
 */
export function matchTokens(text: string | null | undefined): string[] {
  const tokens = productTokens(text);
  const isNumber = (t: string | undefined) => !!t && /^\d+$/.test(t);
  // "x" between words stands for "per"; between numbers it is a size (30 x 12) and stays.
  return tokens.filter((t, i) => t !== "x" || (isNumber(tokens[i - 1]) && isNumber(tokens[i + 1])));
}
export const matchKey = (text: string | null | undefined) => matchTokens(text).join(" ");

/** The words only, numbers left out: what two sizes of one article have in common. */
export const wordsKey = (text: string | null | undefined) =>
  matchTokens(text)
    .filter((t) => !/^\d+$/.test(t))
    .join(" ");

export { normalizeKey };
