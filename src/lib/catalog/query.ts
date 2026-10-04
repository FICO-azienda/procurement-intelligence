/**
 * The product search box understands a few things a buyer would type, with no
 * language model: "paraffina", "vetro", "stoppini" (words, in any form),
 * "prodotti SER" (a supplier), "sopra 10k" / "over 10,000" (spend), "unico
 * fornitore" / "single source". What it understood is said back to the user.
 */
import { en, type T } from "../i18n";
import { companyKey, normalizeKey } from "../import/normalize/text";
import { categorize } from "./taxonomy";

export interface ProductQuestion {
  /** Words every result must contain, as stems ("stoppin" for stoppino, stoppini). */
  words: string[];
  minSpend: number | null;
  maxSpend: number | null;
  singleSource: boolean;
  supplierIds: string[];
  /** How the question was understood, to show under the box. Empty for a plain word search. */
  understood: string[];
}

const FILLERS = new Set(["prodotti", "prodotto", "products", "product", "articoli", "articolo", "con", "di", "da", "del", "della", "dei", "the", "with", "of", "from", "e", "il", "la", "i", "le", "un", "una", "a", "spesa", "spend", "annua", "annual", "euro", "eur", "all", "tutti"]);
const SINGLE = /\b(?:unico fornitore|un solo fornitore|fornitore unico|monofornitore|single source|single supplier|one supplier|sole source)\b/;
const AMOUNT = String.raw`(?:eur|euro)?\s*(\d+(?:[.,]\d+)*)\s*(k|mila|m|mln)?\b\s*(?:eur|euro)?`;
const OVER = new RegExp(String.raw`(?:\bsopra(?: i| gli| a)?|\boltre(?: i)?|\bpiu di|\bmaggiore di|\bover|\babove|\bmore than|>)\s*${AMOUNT}`);
const UNDER = new RegExp(String.raw`(?:\bsotto(?: i| a)?|\bmeno di|\binferiore a|\bunder|\bbelow|\bless than|<)\s*${AMOUNT}`);

/** "10k" → 10000, "10.000" → 10000, "2,5k" → 2500, "1.5m" → 1500000. */
function amount(digits: string, scale: string | undefined): number {
  const thousands = /^\d{1,3}(?:[.,]\d{3})+$/.test(digits);
  const n = Number(thousands ? digits.replace(/[.,]/g, "") : digits.replace(",", "."));
  return n * (scale === "k" || scale === "mila" ? 1_000 : scale === "m" || scale === "mln" ? 1_000_000 : 1);
}

/** What two forms of a word have in common: stoppino / stoppini → "stoppin"; boxes → "boxe". */
export const stem = (word: string) => (word.length >= 5 ? word.replace(/[aeios]$/, "") : word);

export function parseProductQuery(query: string | null | undefined, suppliers: { id: string; name: string }[], format: (n: number) => string = String, t: T = en): ProductQuestion {
  // Symbols that carry meaning are kept as words before the text is normalised.
  let s = ` ${normalizeKey((query ?? "").replace(/€/g, " eur ").replace(/>/g, " sopra ").replace(/</g, " sotto ").replace(/(\d)[.,](?=\d)/g, "$1DEC")).replace(/(\d)dec(?=\d)/g, "$1.")} `;
  const q: ProductQuestion = { words: [], minSpend: null, maxSpend: null, singleSource: false, supplierIds: [], understood: [] };
  const over = OVER.exec(s);
  if (over) {
    q.minSpend = amount(over[1], over[2]);
    s = s.replace(over[0], " ");
    q.understood.push(t("Spend over {amount}", { amount: format(q.minSpend) }));
  }
  const under = UNDER.exec(s);
  if (under) {
    q.maxSpend = amount(under[1], under[2]);
    s = s.replace(under[0], " ");
    q.understood.push(t("Spend under {amount}", { amount: format(q.maxSpend) }));
  }
  if (SINGLE.test(s)) {
    q.singleSource = true;
    s = s.replace(SINGLE, " ");
    q.understood.push(t("Bought from one supplier only"));
  }
  // A word that is (part of) a supplier's name, and not the name of a kind of product, means that supplier.
  const bySupplierWord = new Map<string, { id: string; name: string }[]>();
  for (const sup of suppliers) {
    for (const word of companyKey(sup.name).split(" ")) {
      if (word.length < 3 || categorize(word)) continue;
      bySupplierWord.set(word, [...(bySupplierWord.get(word) ?? []), sup]);
    }
  }
  for (const word of s.trim().split(/\s+/).filter(Boolean)) {
    if (FILLERS.has(word)) continue;
    const named = bySupplierWord.get(word);
    if (named && named.length <= 3) {
      q.supplierIds.push(...named.map((x) => x.id));
      q.understood.push(t("Supplier: {name}", { name: named.map((x) => x.name).join(", ") }));
    } else q.words.push(...word.split(".").filter(Boolean).map(stem));
  }
  return q;
}

/** True when every word of the question starts a word of the text ("stoppin" finds "Stoppino legno"). */
export function matchesWords(words: string[], ...texts: (string | null | undefined)[]): boolean {
  if (!words.length) return true;
  const hay = ` ${texts.map((x) => normalizeKey(x)).join(" ")} `;
  return words.every((w) => hay.includes(` ${w}`));
}
