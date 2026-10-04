/**
 * The external sources switched on in this installation. Free public sources
 * (supplier websites, ECB rates, Eurostat trade data) are on unless
 * RESEARCH_OFFLINE=1; a web search engine is on when its API key is in the
 * environment. Premium data providers have a place in KNOWN_SOURCES and no
 * adapter yet: setting their key changes nothing until one is written.
 */
import { KNOWN_SOURCES, NO_PROVIDERS, type KnownSource, type Providers } from "@/lib/sourcing/providers";
import { eurostatComext } from "./comext";
import { ecbRates } from "./ecb";
import { webPageReader } from "./web-page";
import { webSearchProviders } from "./web-search";

type Env = Record<string, string | undefined>;

export function connectedProviders(env: Env = process.env): Providers {
  if (env.RESEARCH_OFFLINE === "1") return NO_PROVIDERS;
  return { ...NO_PROVIDERS, webSearch: webSearchProviders(env), pages: [webPageReader], fx: [ecbRates], trade: [eurostatComext] };
}

export type SourceState = "connected" | "needs_key" | "not_available" | "off";

/** Every known source with its state, for the screen that says what is connected and what is not. */
export function sourceStates(env: Env = process.env): (KnownSource & { state: SourceState })[] {
  const providers = connectedProviders(env);
  const on = new Set(Object.values(providers).flatMap((list) => list.map((p: { key: string }) => p.key)));
  return KNOWN_SOURCES.map((s) => ({ ...s, state: on.has(s.key) ? "connected" : !s.ready ? "not_available" : s.access === "key" ? "needs_key" : "off" }));
}
