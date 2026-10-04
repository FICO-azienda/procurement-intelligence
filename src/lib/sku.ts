/**
 * Internal product codes for people who don't have one: generated from the
 * name, so creating a product never stops at "what is its SKU?".
 */
import { tidy } from "./import/normalize/text";

/** "Paraffina 58/60" → "PAR-58-60" */
export function suggestSku(name: string): string {
  const words = tidy(name)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  return words
    .map((w) => (/\d/.test(w) ? w : w.slice(0, 3)))
    .join("-")
    .slice(0, 24);
}

/** The suggestion, with "-2", "-3"… when another product already uses it. */
export function uniqueSku(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((s) => s.toUpperCase()));
  const base = suggestSku(name) || "ITEM";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 20)}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
