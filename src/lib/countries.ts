/**
 * The countries suppliers usually come from: one entry per country, whatever
 * language its name was typed in. Used to show a flag, to name the country in
 * the reader's language, and to know that "Italy" and "Italia" are one place.
 * A country that is not listed is shown and compared exactly as written.
 */
import type { Locale } from "./i18n";

interface Country {
  /** Two-letter code, as electronic invoices write the country. */
  iso: string;
  en: string;
  it: string;
  flag: string;
  /** Other spellings people use. */
  also?: string[];
}

const COUNTRIES: Country[] = [
  { iso: "IT", en: "Italy", it: "Italia", flag: "🇮🇹" },
  { iso: "DE", en: "Germany", it: "Germania", flag: "🇩🇪", also: ["deutschland"] },
  { iso: "FR", en: "France", it: "Francia", flag: "🇫🇷" },
  { iso: "ES", en: "Spain", it: "Spagna", flag: "🇪🇸" },
  { iso: "PL", en: "Poland", it: "Polonia", flag: "🇵🇱" },
  { iso: "NL", en: "Netherlands", it: "Paesi Bassi", flag: "🇳🇱", also: ["olanda", "holland"] },
  { iso: "BE", en: "Belgium", it: "Belgio", flag: "🇧🇪" },
  { iso: "AT", en: "Austria", it: "Austria", flag: "🇦🇹" },
  { iso: "TR", en: "Turkey", it: "Turchia", flag: "🇹🇷", also: ["türkiye"] },
  { iso: "CN", en: "China", it: "Cina", flag: "🇨🇳" },
  { iso: "IN", en: "India", it: "India", flag: "🇮🇳" },
  { iso: "GB", en: "United Kingdom", it: "Regno Unito", flag: "🇬🇧", also: ["uk"] },
  { iso: "US", en: "United States", it: "Stati Uniti", flag: "🇺🇸", also: ["usa"] },
  { iso: "CH", en: "Switzerland", it: "Svizzera", flag: "🇨🇭" },
  { iso: "PT", en: "Portugal", it: "Portogallo", flag: "🇵🇹" },
  { iso: "RO", en: "Romania", it: "Romania", flag: "🇷🇴" },
  { iso: "CZ", en: "Czech Republic", it: "Repubblica Ceca", flag: "🇨🇿", also: ["czechia", "cechia"] },
  { iso: "SI", en: "Slovenia", it: "Slovenia", flag: "🇸🇮" },
  { iso: "HR", en: "Croatia", it: "Croazia", flag: "🇭🇷" },
  { iso: "GR", en: "Greece", it: "Grecia", flag: "🇬🇷" },
  { iso: "VN", en: "Vietnam", it: "Vietnam", flag: "🇻🇳" },
  { iso: "ID", en: "Indonesia", it: "Indonesia", flag: "🇮🇩" },
  { iso: "MY", en: "Malaysia", it: "Malesia", flag: "🇲🇾" },
  // The rest of the European Union, so that a supplier there is known to be in the single market.
  { iso: "EE", en: "Estonia", it: "Estonia", flag: "🇪🇪" },
  { iso: "LV", en: "Latvia", it: "Lettonia", flag: "🇱🇻" },
  { iso: "LT", en: "Lithuania", it: "Lituania", flag: "🇱🇹" },
  { iso: "SK", en: "Slovakia", it: "Slovacchia", flag: "🇸🇰" },
  { iso: "HU", en: "Hungary", it: "Ungheria", flag: "🇭🇺" },
  { iso: "BG", en: "Bulgaria", it: "Bulgaria", flag: "🇧🇬" },
  { iso: "DK", en: "Denmark", it: "Danimarca", flag: "🇩🇰" },
  { iso: "SE", en: "Sweden", it: "Svezia", flag: "🇸🇪" },
  { iso: "FI", en: "Finland", it: "Finlandia", flag: "🇫🇮" },
  { iso: "IE", en: "Ireland", it: "Irlanda", flag: "🇮🇪" },
  { iso: "LU", en: "Luxembourg", it: "Lussemburgo", flag: "🇱🇺" },
  { iso: "CY", en: "Cyprus", it: "Cipro", flag: "🇨🇾" },
  { iso: "MT", en: "Malta", it: "Malta", flag: "🇲🇹" },
  { iso: "NO", en: "Norway", it: "Norvegia", flag: "🇳🇴" },
];

const clean = (s: string) => s.trim().toLowerCase();
const BY_SPELLING = new Map<string, Country>();
// The two-letter code is a spelling too: invoices write "IT", "DE".
for (const c of COUNTRIES) for (const s of [c.en, c.it, c.iso, ...(c.also ?? [])]) BY_SPELLING.set(clean(s), c);

const find = (country: string | null | undefined) => (country ? BY_SPELLING.get(clean(country)) : undefined);

/** A flag next to a supplier's country: easier to scan than the name alone. Unknown countries get none. */
export function flagOf(country: string | null | undefined): string | null {
  return find(country)?.flag ?? null;
}

/** The country's name in the reader's language; as written when we don't know it. */
export function countryName(country: string, locale: Locale): string;
export function countryName(country: string | null | undefined, locale: Locale): string | null;
export function countryName(country: string | null | undefined, locale: Locale): string | null {
  return country ? (find(country)?.[locale] ?? country) : null;
}

/** Same value for every spelling of a country ("Italy", "Italia"), so two suppliers there are not taken for an import. */
export function countryKey(country: string | null | undefined): string | null {
  return country ? (find(country)?.en ?? clean(country)) : null;
}

/** The two-letter code of a country, however it was written; a two-letter text we don't know is taken as a code. */
export function countryIso(country: string | null | undefined): string | null {
  const known = find(country)?.iso;
  if (known) return known;
  const text = country?.trim() ?? "";
  return /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : null;
}

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));

/** "IT" → "Italy". A code we don't have a name for comes back as written. */
export function countryFromIso(code: string | null | undefined): string | null {
  const iso = code?.trim().toUpperCase();
  return iso ? (BY_ISO.get(iso)?.en ?? iso) : null;
}

/** The first, most common countries, to suggest while typing. */
export const countrySuggestions = (locale: Locale) => COUNTRIES.slice(0, 13).map((c) => c[locale]);
