/**
 * Text normalization for matching names across documents.
 *   companyKey("ABC S.r.l.") === companyKey("ABC Srl") === "abc"
 *   companyKey("S.E.R. S.p.A.") === companyKey("SER SPA") === "ser"
 *   productKey("PARAFFINA RAFFINATA 58-60") → "paraffina raffinata 58 60"
 *   codeKey("PAR 5860") === codeKey("par-5860") === "PAR5860"
 */

/** Letters that Unicode does not decompose into base letter + accent. */
const SPECIAL_LETTERS: Record<string, string> = {
  ł: "l", Ł: "l", ø: "o", Ø: "o", ß: "ss", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe", đ: "d", Đ: "d", ı: "i", þ: "th",
};

export function normalizeKey(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[łŁøØßæÆœŒđĐıþ]/g, (c) => SPECIAL_LETTERS[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Legal forms dropped when comparing company names. */
const LEGAL_FORMS = new Set([
  "srl", "srls", "spa", "sapa", "sas", "snc", "scarl", "scrl", "sc", "coop", "soc", "societa", "cooperativa",
  "ltd", "limited", "llc", "llp", "inc", "incorporated", "corp", "corporation", "co", "company", "plc",
  "gmbh", "ag", "kg", "ohg", "ug", "sa", "sarl", "sas", "sl", "slu", "bv", "nv", "oy", "ab", "as", "aps",
  "sp", "zoo", "z", "o", "oo", "o o", "sro", "as", "kft", "doo", "pte", "pty", "sti", "as", "ltd sti", "anonim", "sirketi",
  "rl", "arl", "and", "e", "c", "the",
]);

/** Joins dotted abbreviations: "s r l" → "srl", "s p a" → "spa". */
function joinInitials(tokens: string[]): string[] {
  const out: string[] = [];
  let run = "";
  for (const t of tokens) {
    if (t.length === 1 && /[a-z]/.test(t)) {
      run += t;
      continue;
    }
    if (run) out.push(run);
    run = "";
    out.push(t);
  }
  if (run) out.push(run);
  return out;
}

/**
 * A dotted abbreviation is one word, whatever stands next to it: "S.p.A." →
 * "SpA", "S.E.R." → "SER". Without this "S.E.R. S.p.A." would read as one
 * six-letter word and never meet "SER SPA".
 */
const DOTTED = /^(?:\p{L}\.){1,}\p{L}?\.?[,;]?$/u;
function joinDotted(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => (DOTTED.test(word) && word.replace(/[^\p{L}]/gu, "").length >= 2 ? word.replace(/[.,;]/g, "") : word))
    .join(" ");
}

/**
 * What a company register adds after the name and says nothing of who the
 * company is: sole shareholder, benefit company, in liquidation, "subject to
 * the direction and coordination of…". Read on the normalized name.
 */
const LEGAL_NOTES = [/\b(?:societa )?(?:a |con |c )?(?:socio unico|unico socio)\b/g, /\b(?:societa )?unipersonale\b/g, /\bsocieta benefit\b/g, /\bin liquidazione\b/g, /\bsoggett[ao] ad? (?:attivita di )?direz.*$/g];

export function companyKey(name: string | null | undefined): string {
  let normalized = normalizeKey(joinDotted(name ?? ""));
  for (const note of LEGAL_NOTES) normalized = normalized.replace(note, " ");
  const tokens = joinInitials(normalized.split(" ").filter(Boolean));
  const kept = tokens.filter((t) => !LEGAL_FORMS.has(t));
  // Never reduce a name to nothing ("Co. Ltd" alone): fall back to all tokens.
  return (kept.length ? kept : tokens).join(" ");
}

const PRODUCT_STOPWORDS = new Set(["di", "da", "per", "con", "in", "the", "of", "with", "for", "and", "e", "a"]);

/** Tokens for product comparison: letters and digits split, stopwords dropped. */
export function productTokens(text: string | null | undefined): string[] {
  return normalizeKey(text)
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(" ")
    .filter((t) => t && !PRODUCT_STOPWORDS.has(t));
}

export function productKey(text: string | null | undefined): string {
  return productTokens(text).join(" ");
}

/** Codes compared without separators or case. */
export function codeKey(code: string | null | undefined): string {
  return (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** VAT numbers compared without spaces, dots or the country prefix. */
export function vatKey(vat: string | null | undefined): string {
  const s = (vat ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.replace(/^[A-Z]{2}(?=\d)/, "");
}

/** Pretty display name from a raw document value: trims and collapses spaces. */
export function tidy(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
