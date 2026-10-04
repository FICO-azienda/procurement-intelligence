/**
 * Where a possible supplier is, seen from the company: the same country, the
 * EU, the countries around it, Asia, the rest. It prepares the landed-cost
 * question (transport, duties, lead time) — it never answers it: a lower
 * price from far away is not a lower cost.
 */
import { countryIso } from "../countries";
import type { Msg } from "../i18n";

export const REGIONS = ["home", "eu", "nearby", "asia", "other", "unknown"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABEL: Record<Region, Msg> = {
  home: "Your country",
  eu: "European Union",
  nearby: "Nearby Europe and Mediterranean",
  asia: "Asia",
  other: "Other countries",
  unknown: "Country not known",
};

const EU = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" "));
const NEARBY = new Set("GB CH NO IS LI TR RS AL BA MK ME XK UA MD MA TN DZ EG IL LB JO AD MC SM".split(" "));
const ASIA = new Set("CN IN JP KR VN TH MY ID TW PK BD LK PH SG HK KH MM AE SA QA KW OM BH KZ UZ".split(" "));

export function regionOf(country: string | null | undefined, homeCountry: string | null | undefined): Region {
  const iso = countryIso(country);
  if (!iso) return "unknown";
  const home = countryIso(homeCountry);
  if (home && iso === home) return "home";
  // Seen from an EU company the single market is one area; from outside it, the EU is simply where those suppliers are.
  if (EU.has(iso)) return "eu";
  if (NEARBY.has(iso)) return "nearby";
  if (ASIA.has(iso)) return "asia";
  return "other";
}

/** True when buying there means customs: outside the company's customs area. */
export function crossesCustoms(country: string | null | undefined, homeCountry: string | null | undefined): boolean | null {
  const [iso, home] = [countryIso(country), countryIso(homeCountry)];
  if (!iso || !home) return null;
  if (iso === home) return false;
  return !(EU.has(iso) && EU.has(home));
}
