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
  // Countries a market research names, so that its coverage reads in the reader's language.
  { iso: "RS", en: "Serbia", it: "Serbia", flag: "🇷🇸" },
  { iso: "JP", en: "Japan", it: "Giappone", flag: "🇯🇵" },
  { iso: "KR", en: "South Korea", it: "Corea del Sud", flag: "🇰🇷" },
  { iso: "TW", en: "Taiwan", it: "Taiwan", flag: "🇹🇼" },
  { iso: "TH", en: "Thailand", it: "Thailandia", flag: "🇹🇭" },
  { iso: "PK", en: "Pakistan", it: "Pakistan", flag: "🇵🇰" },
  { iso: "BD", en: "Bangladesh", it: "Bangladesh", flag: "🇧🇩" },
  { iso: "AE", en: "United Arab Emirates", it: "Emirati Arabi Uniti", flag: "🇦🇪", also: ["uae"] },
  { iso: "SA", en: "Saudi Arabia", it: "Arabia Saudita", flag: "🇸🇦" },
  { iso: "CA", en: "Canada", it: "Canada", flag: "🇨🇦" },
  { iso: "MX", en: "Mexico", it: "Messico", flag: "🇲🇽" },
  { iso: "BR", en: "Brazil", it: "Brasile", flag: "🇧🇷" },
  { iso: "AR", en: "Argentina", it: "Argentina", flag: "🇦🇷" },
  { iso: "CO", en: "Colombia", it: "Colombia", flag: "🇨🇴" },
  { iso: "ZA", en: "South Africa", it: "Sudafrica", flag: "🇿🇦" },
  { iso: "EG", en: "Egypt", it: "Egitto", flag: "🇪🇬" },
  { iso: "MA", en: "Morocco", it: "Marocco", flag: "🇲🇦" },
  { iso: "TN", en: "Tunisia", it: "Tunisia", flag: "🇹🇳" },
  { iso: "AU", en: "Australia", it: "Australia", flag: "🇦🇺" },
  { iso: "NZ", en: "New Zealand", it: "Nuova Zelanda", flag: "🇳🇿" },
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

/** The countries listed, named in the reader's language and in its order: what a form offers to choose from (anything else can be typed). */
export function countryChoices(locale: Locale): string[] {
  return COUNTRIES.map((c) => c[locale]).sort((a, b) => a.localeCompare(b, locale));
}

/**
 * The country a VAT number names by its own prefix ("TR8390012345" → Turkey,
 * "EL…" → Greece), only when the prefix is a country we list. A number with no
 * letters in front says nothing, and nothing is guessed from it.
 */
export function countryOfVat(vat: string | null | undefined): string | null {
  const m = /^\s*([A-Za-z]{2})\s*\d/.exec(vat ?? "");
  if (!m) return null;
  const iso = m[1].toUpperCase() === "EL" ? "GR" : m[1].toUpperCase();
  return BY_ISO.get(iso)?.en ?? null;
}

/** The first, most common countries, to suggest while typing. */
export const countrySuggestions = (locale: Locale) => COUNTRIES.slice(0, 13).map((c) => c[locale]);
