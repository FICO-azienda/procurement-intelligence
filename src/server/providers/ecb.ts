/**
 * Euro reference rates of the European Central Bank: public, free, one rate
 * per working day. A date with no rate (weekend, holiday) gets the last one
 * before it — and says which day that was.
 */
import type { FXProvider } from "@/lib/sourcing/providers";
import { httpGet } from "./http";

const RECENT = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
const ALL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";
const PAGE = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";

/** The rates in an ECB file: date → currency → units for one euro. */
export function parseEcb(xml: string): Map<string, Map<string, number>> {
  const days = new Map<string, Map<string, number>>();
  for (const day of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const rates = new Map<string, number>();
    for (const r of day[2].matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates.set(r[1], Number(r[2]));
    days.set(day[1], rates);
  }
  return days;
}

export function rateOn(days: Map<string, Map<string, number>>, currency: string, date: string): { rate: number; date: string } | null {
  const on = [...days.keys()].filter((d) => d <= date).sort().pop();
  const rate = on ? days.get(on)!.get(currency.toUpperCase()) : undefined;
  return on && rate ? { rate, date: on } : null;
}

export const ecbRates: FXProvider = {
  key: "ecb",
  name: "European Central Bank",
  async rate(currency, date) {
    if (currency.toUpperCase() === "EUR") return { rate: 1, date, sourceName: "European Central Bank", sourceUrl: PAGE };
    let found = rateOn(parseEcb((await httpGet("ECB", RECENT)).text), currency, date);
    // Older than the 90-day file: the full history.
    if (!found) found = rateOn(parseEcb((await httpGet("ECB", ALL, { timeoutMs: 30_000 })).text), currency, date);
    return found ? { ...found, sourceName: "European Central Bank, euro reference rates", sourceUrl: PAGE } : null;
  },
};
