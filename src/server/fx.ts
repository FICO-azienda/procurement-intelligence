/**
 * Exchange rates, in one place. A rate comes from a provider of official
 * reference rates switched on in the environment (the European Central Bank,
 * by default) or from a person, who says where it comes from and its date.
 *
 * Rules that must hold:
 *  - no rate is made up: when no provider has one, there is none, and whatever
 *    needed it stays unconverted and incomplete;
 *  - a rate is only ever used to read a price in another currency next to
 *    prices in euro: the price as it was quoted is never replaced;
 *  - a reference rate is not the rate a bank will apply on the day: it is
 *    offered as an estimate, and the person keeps or changes it;
 *  - the rate used is kept where it was used, with its date and its source
 *    (an offer's landed cost, a purchase): markets moving later change nothing
 *    of what was worked out then.
 */
import type { FXProvider } from "@/lib/sourcing/providers";
import { connectedProviders } from "./providers";

export interface ReferenceRate {
  currency: string;
  /** EUR for one unit of the currency: what a price is multiplied by. */
  eurPerUnit: number;
  /** Units of the currency for one euro: as the source publishes it. */
  unitsPerEur: number;
  /** The day the rate is of — the last working day before the one asked, when that day has none. */
  date: string;
  source: string;
  sourceUrl: string | null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The official reference rate of a currency on a day, from the first provider that has one. Null: nobody has it. */
export async function referenceRate(currency: string, date: string, providers: FXProvider[] = connectedProviders().fx): Promise<ReferenceRate | null> {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (code === "EUR") return { currency: code, eurPerUnit: 1, unitsPerEur: 1, date, source: "—", sourceUrl: null };
  for (const provider of providers) {
    try {
      const found = await provider.rate(code, date);
      if (found && found.rate > 0) return { currency: code, eurPerUnit: round6(1 / found.rate), unitsPerEur: found.rate, date: found.date, source: found.sourceName, sourceUrl: found.sourceUrl };
    } catch (err) {
      // A source that does not answer is a source without a rate today: the next one is asked, and nothing is guessed.
      console.error("[fx]", provider.key, err);
    }
  }
  return null;
}
