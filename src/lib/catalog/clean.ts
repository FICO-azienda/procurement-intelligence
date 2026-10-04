/**
 * A readable product name from the text of an invoice line: decoration and
 * shouting removed, nothing technical touched. "** TRECCIOLINO ST 18/08" →
 * "Trecciolino ST 18/08". The original text is kept elsewhere (as an alias and
 * on every purchase): this is only the name people read.
 */
import { tidy } from "../import/normalize/text";

const ENTITIES: Record<string, string> = { "&apos;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&nbsp;": " " };
const SMALL_WORDS = new Set(["di", "da", "del", "della", "dei", "delle", "per", "con", "in", "al", "alla", "e", "a", "su", "the", "of", "for", "and", "with", "x"]);

export function cleanName(text: string | null | undefined, maxLength = 120): string {
  let s = tidy((text ?? "").replace(/&(apos|quot|amp|lt|gt|nbsp|#39);/g, (e) => ENTITIES[e] ?? e));
  // Asterisks, bullets and dashes used as markers at either end.
  s = s.replace(/^[\s*•·#>_\-–—.,;:]+/, "").replace(/[\s*•·#>_\-–—,;:]+$/, "");
  s = tidy(s.replace(/\s+([,;:])/g, "$1"));
  if (!s) return "";
  // Mostly capitals: capitalise the words, leave codes, sizes and abbreviations as they are.
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const capitals = letters.replace(/[^A-ZÀ-Ý]/g, "").length;
  if (letters.length > 0 && capitals / letters.length >= 0.7) {
    const words = s.split(" ");
    const isWord = (w: string | undefined) => !!w && /^\(?[A-ZÀ-Ý']{4,}[.,)]?$/.test(w);
    s = words
      .map((word, i) => {
        const core = word.replace(/^\(/, "").replace(/[.,)]$/, "");
        if (!/^[A-ZÀ-Ý']+$/.test(core)) return word; // digits, symbols or lower case: a code, a size, already written properly
        // "PER", "DI", "E" between two words are just words; next to a code they may be part of it.
        if (SMALL_WORDS.has(core.toLowerCase())) return isWord(words[i - 1]) && isWord(words[i + 1]) ? word.toLowerCase() : word;
        if (core.length <= 3) return word; // TG, ST, PP, BIA: abbreviations that mean something
        return word.replace(/[A-ZÀ-Ý']+/, (w) => w[0] + w.slice(1).toLowerCase());
      })
      .join(" ");
  }
  return s.length > maxLength ? `${s.slice(0, maxLength - 1).trimEnd()}…` : s;
}
