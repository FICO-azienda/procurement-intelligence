/**
 * Two languages, one source of truth: the English text written in the code is
 * the key, and `it/` holds its Italian. `t("Add purchase")` gives the text in
 * the language in use; a text missing from the Italian dictionary does not
 * compile, so nothing is left half translated.
 *
 *   {name}    a value                       t("{n} lines ready", { n: 12 })
 *   {~name}   a value that is a message itself, translated on the way in
 *   "…|ctx"   one English word, two meanings ("Open|status" / "Open|verb")
 *
 * Pure: no React, no database. Server code gets a translator from
 * `getT()` (lib/data.ts), client components from `useT()` (i18n/client.tsx),
 * and the pure engines take one as an argument (English by default, which is
 * what the tests read).
 */
import { it } from "./it";

export const LOCALES = ["en", "it"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Each language named in itself: that is how people look for it. */
export const LOCALE_NAME: Record<Locale, string> = { en: "English", it: "Italiano" };
export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Every text of the app. */
export type Msg = keyof typeof it;
export type Params = Record<string, string | number | null | undefined>;

export interface T {
  (msg: Msg, params?: Params): string;
  /** Counted things: the singular or the plural message; `{n}` is the count, formatted. */
  n(count: number, one: Msg, many: Msg, params?: Params): string;
  /** Text that may or may not be a known message: stored earlier, or typed by someone. */
  any(text: string, params?: Params): string;
  locale: Locale;
}

const CONTEXT = /\|[a-z-]+$/;
const count = (n: number) => n.toLocaleString("it-IT", { useGrouping: "always" });

/**
 * Italian articles before a number follow how the number is said: "l'8%",
 * "l'11,3%", "dell'80%", "lo 0,5%" — but "il 12%". Templates are written with
 * the plain form ("il {pct}%"); this fixes it once the number is known.
 * Dates (15/09/2026) are left alone. Only the article standing right before a
 * placeholder is touched: a value is never rewritten ("Fattura del 8.pdf"
 * stays as the file is called).
 */
const PLACEHOLDER = /(?:\b(il|del|al|dal|nel|sul) )?\{(~?)(\w+)\}/gi;
const LEADING_NUMBER = /^(\d[\d.]*)(?![\d.]*\/)/;
const ELIDED: Record<string, [vowel: string, zero: string]> = {
  il: ["l'", "lo "],
  del: ["dell'", "dello "],
  al: ["all'", "allo "],
  dal: ["dall'", "dallo "],
  nel: ["nell'", "nello "],
  sul: ["sull'", "sullo "],
};
function withArticle(article: string, value: string): string {
  const n = LEADING_NUMBER.exec(value)?.[1].replace(/\./g, "");
  // otto, ottanta, ottocento, ottomila… · uno · undici, undicimila…
  const form = !n ? null : /^0+$/.test(n) ? 1 : n === "1" || n === "11" || /^8/.test(n) || /^11\d{3}$/.test(n) ? 0 : null;
  if (form == null) return `${article} ${value}`;
  const fixed = ELIDED[article.toLowerCase()][form];
  return (article[0] === article[0].toUpperCase() ? fixed[0].toUpperCase() + fixed.slice(1) : fixed) + value;
}

function make(locale: Locale): T {
  const dict: Record<string, string> = locale === "it" ? it : {};
  const lookup = (key: string) => dict[key] ?? key.replace(CONTEXT, "");
  // A placeholder without a value stays as written, so `rich()` can fill it with an element.
  const fill = (text: string, params?: Params) => {
    if (!params) return text;
    return text.replace(PLACEHOLDER, (whole, article: string | undefined, nested: string, name: string) => {
      const v = params[name];
      if (v == null) return whole;
      const value = nested ? lookup(String(v)) : String(v);
      if (!article) return value;
      return locale === "it" ? withArticle(article, value) : `${article} ${value}`;
    });
  };
  const t = ((msg: Msg, params?: Params) => fill(lookup(msg), params)) as T;
  t.n = (n, one, many, params) => t(n === 1 ? one : many, { n: count(n), ...params });
  t.any = (text, params) => fill(lookup(text), params);
  t.locale = locale;
  return t;
}

const TRANSLATORS: Record<Locale, T> = { en: make("en"), it: make("it") };

export const translator = (locale: Locale): T => TRANSLATORS[locale];
/** English, as written in the code: the default of every pure function. */
export const en = TRANSLATORS.en;

// ---------------- Messages that are stored ----------------

/**
 * A message kept in the database (a problem found while reading a file) is
 * stored with its template and values, so it can be shown later in whatever
 * language the reader uses. `message` stays the plain English text.
 */
export interface Said {
  message: string;
  msg?: string;
  params?: Params;
}

export const say = (msg: Msg, params?: Params): { message: string; msg: Msg; params?: Params } => (params ? { message: en(msg, params), msg, params } : { message: en(msg), msg });

/** The text of a stored message, in the reader's language. */
export const said = (t: T, x: { message: string; msg?: string | null; params?: Params | null }) => (x.msg ? t.any(x.msg, x.params ?? undefined) : t.any(x.message));

/** "a, b and c" */
export function list(t: T, items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : t("{items} and {last}", { items: items.slice(0, -1).join(", "), last: items[items.length - 1] });
}

export const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
