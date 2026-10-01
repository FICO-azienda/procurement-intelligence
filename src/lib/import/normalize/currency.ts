/**
 * Currency normalization. Values are always stored with their original
 * currency; conversion to EUR needs an exchange rate and is never guessed.
 */

export const CURRENCIES: Record<string, string[]> = {
  EUR: ["eur", "€", "euro", "euros"],
  USD: ["usd", "$", "us$", "us dollar", "us dollars", "dollar", "dollars", "dollaro", "dollari"],
  GBP: ["gbp", "£", "pound", "pounds", "sterling", "sterlina", "sterline"],
  CHF: ["chf", "sfr", "fr.", "franco svizzero", "franchi svizzeri", "swiss franc", "swiss francs"],
  CNY: ["cny", "rmb", "yuan", "renminbi", "cn¥"],
  TRY: ["try", "₺", "tl", "lira turca", "turkish lira"],
  PLN: ["pln", "zł", "zloty", "złoty"],
  JPY: ["jpy", "yen"],
  INR: ["inr", "₹", "rupee", "rupees"],
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCIES);

const BY_SPELLING = new Map<string, string>();
for (const [code, spellings] of Object.entries(CURRENCIES)) {
  BY_SPELLING.set(code.toLowerCase(), code);
  for (const s of spellings) BY_SPELLING.set(s, code);
}

/** "€", "eur", "Euro" → "EUR". Unknown 3-letter codes are kept as-is. */
export function normalizeCurrency(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const known = BY_SPELLING.get(s);
  if (known) return known;
  return /^[a-z]{3}$/.test(s) ? s.toUpperCase() : null;
}

export function isKnownCurrency(code: string | null | undefined) {
  return !!code && code in CURRENCIES;
}

const SYMBOL_RE = /(€|£|\$|₺|₹|zł|\b(?:EUR|USD|GBP|CHF|CNY|RMB|TRY|PLN|JPY|INR)\b)/i;

/** Currency written inside an amount: "€ 1,58", "1.58 USD" → "EUR" / "USD". */
export function currencyInText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = SYMBOL_RE.exec(text);
  return m ? normalizeCurrency(m[1]) : null;
}

/** Removes currency symbols/codes so the number can be parsed. */
export function stripCurrency(text: string): string {
  return text.replace(new RegExp(SYMBOL_RE.source, "gi"), "").trim();
}
