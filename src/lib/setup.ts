/**
 * The first start of a workspace: who the company is, said before anything is
 * imported. No company is named in the code — each installation says its own.
 *
 *  - the name and the VAT number: on an invoice they are the customer (us),
 *    never taken for a supplier;
 *  - the country: which offers can be set against the prices paid (no customs
 *    border between the supplier and us);
 *  - the town of delivery: what requests for quotation name;
 *  - the language of the interface.
 *
 * Pure: what is asked and how an answer is checked. Nothing is filled in.
 */
import { countryKey, countryName, countryOfVat } from "./countries";
import { en, isLocale, type Locale, type T } from "./i18n";
import { vatKey } from "./import/normalize/text";

export interface CompanySetup {
  companyName: string;
  country: string;
  vatNumber: string | null;
  userName: string | null;
  deliveryCity: string | null;
  deliveryProvince: string | null;
  language: Locale;
}

export const SETUP_FIELDS = ["companyName", "country", "vatNumber", "userName", "deliveryCity", "deliveryProvince", "language"] as const;
export type SetupField = (typeof SETUP_FIELDS)[number];
export type SetupErrors = Partial<Record<SetupField, string>>;

const clean = (v: unknown, max = 160) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
};

/**
 * Reads an answer as given and says what is wrong with it, field by field.
 * The name and the country are needed; a VAT number, when given, must look
 * like one and must not name another country than the one written.
 */
export function readSetup(raw: Partial<Record<SetupField, unknown>>, t: T = en): { value: CompanySetup | null; errors: SetupErrors } {
  const errors: SetupErrors = {};
  const companyName = clean(raw.companyName, 120);
  const country = clean(raw.country, 60);
  const vatNumber = clean(raw.vatNumber, 30);
  const language = typeof raw.language === "string" && isLocale(raw.language) ? raw.language : null;
  if (!companyName) errors.companyName = t("Your company's name is needed");
  if (!country) errors.country = t("The country is needed: it decides which offers can be set against the prices you pay.");
  if (vatNumber) {
    const digits = vatKey(vatNumber);
    if (digits.length < 8 || digits.length > 14 || !/^[A-Z0-9]+$/.test(digits)) errors.vatNumber = t("This does not look like a VAT number.");
    else {
      const named = countryOfVat(vatNumber);
      if (named && country && countryKey(named) !== countryKey(country)) errors.vatNumber = t("This VAT number names {vatCountry} as its country, not {country}: check one of the two.", { vatCountry: countryName(named, t.locale), country });
    }
  }
  if (!language) errors.language = t("Choose a language.");
  if (Object.keys(errors).length) return { value: null, errors };
  return {
    value: { companyName: companyName!, country: country!, vatNumber, userName: clean(raw.userName, 80), deliveryCity: clean(raw.deliveryCity, 80), deliveryProvince: clean(raw.deliveryProvince, 10), language: language! },
    errors,
  };
}
