/** Display formatting. Numbers and dates in Italian style (1.234,56 · 15/09/2026) in both languages; words through the translator. */
import { en, type Msg, type T } from "./i18n";

const LOCALE = "it-IT";
// it-IT skips grouping below 10.000 by default ("6000"); we always want "6.000".
const GROUP = { useGrouping: "always" } as const;
const SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF ", TRY: "₺", PLN: "zł " };

function withSymbol(n: number, body: string, currency = "EUR") {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${n < 0 ? "−" : ""}${symbol}${body}`;
}

/** Amounts: €31.600 — decimals only when there are cents. */
export function money(n: number | null | undefined, currency = "EUR") {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const hasCents = Math.abs(Math.round(abs * 100) - Math.round(abs) * 100) > 0;
  const body = abs.toLocaleString(LOCALE, {
    ...GROUP,
    minimumFractionDigits: hasCents && abs < 10_000 ? 2 : 0,
    maximumFractionDigits: hasCents && abs < 10_000 ? 2 : 0,
  });
  return withSymbol(n, body, currency);
}

/** Unit prices: €1,58 · €0,074 · €31,00 */
export function price(n: number | null | undefined, currency = "EUR") {
  if (n == null || !Number.isFinite(n)) return "—";
  const body = Math.abs(n).toLocaleString(LOCALE, {
    ...GROUP,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return withSymbol(n, body, currency);
}

/** Unit prices for plain-language views: €1,44 · €0,074 — no false precision. */
export function priceShort(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const digits = Math.abs(n) < 1 ? 3 : 2;
  const body = Math.abs(n).toLocaleString(LOCALE, { ...GROUP, minimumFractionDigits: 2, maximumFractionDigits: digits });
  return withSymbol(n, body);
}

/** Estimates, rounded to two significant figures: 1.837 → €1.800 · 9.760 → €9.800. */
export function moneyApprox(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 100) return money(Math.round(n));
  const step = 10 ** (Math.floor(Math.log10(abs)) - 1);
  return money(Math.round(n / step) * step);
}

export function pct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Number(n.toFixed(digits));
  const body = Math.abs(rounded).toLocaleString(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (rounded === 0) return `${body}%`;
  return `${rounded > 0 ? "+" : "−"}${body}%`;
}

export function number(n: number | null | undefined, maxDigits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(LOCALE, { ...GROUP, maximumFractionDigits: maxDigits });
}

export function quantity(n: number | null | undefined, unit?: string) {
  if (n == null) return "—";
  return unit ? `${number(n)} ${unit}` : number(n);
}

/** 2026-09-15 → 15/09/2026 */
export function date(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const MONTHS: Msg[] = ["Jan", "Feb", "Mar", "Apr", "May|month", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-09-15 → Sep 2026 */
export function month(iso: string | null | undefined, t: T = en) {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  return `${t(MONTHS[Number(m) - 1])} ${y}`;
}

export function days(n: number | null | undefined, t: T = en) {
  if (n == null) return "—";
  return t.n(Math.round(n), "{n} day", "{n} days");
}

export function paymentTerms(n: number | null | undefined, t: T = en) {
  if (n == null) return "—";
  return n === 0 ? t("Advance") : t("{n} days", { n });
}
