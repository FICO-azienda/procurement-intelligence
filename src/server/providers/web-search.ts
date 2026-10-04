/**
 * Web search engines with an API. Each is switched on by its own key in the
 * environment; the first one that has a key is used. What a search costs is
 * not written here: prices change — set WEB_SEARCH_COST_PER_QUERY_EUR to have
 * the cost estimated, otherwise it is said to be unknown.
 */
import type { WebSearchProvider, WebSearchResult } from "@/lib/sourcing/providers";
import { httpGet } from "./http";

type Env = Record<string, string | undefined>;

const clean = (results: { title?: unknown; url?: unknown; snippet?: unknown }[]): WebSearchResult[] =>
  results
    .filter((r): r is { title: string; url: string; snippet?: unknown } => typeof r.url === "string" && /^https?:\/\//.test(r.url))
    .map((r) => ({ title: typeof r.title === "string" ? r.title : r.url, url: r.url, snippet: typeof r.snippet === "string" && r.snippet.trim() ? r.snippet.replace(/<[^>]+>/g, "").trim() : null }));

function cost(env: Env): number | null {
  const n = Number(env.WEB_SEARCH_COST_PER_QUERY_EUR);
  return env.WEB_SEARCH_COST_PER_QUERY_EUR && Number.isFinite(n) && n >= 0 ? n : null;
}

function brave(key: string, env: Env): WebSearchProvider {
  return {
    key: "brave",
    name: "Brave Search API",
    costPerQuery: cost(env),
    async search(query, { count, country }) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 20)}${country ? `&country=${country.toLowerCase()}` : ""}`;
      const { text } = await httpGet("Brave Search", url, { headers: { "X-Subscription-Token": key, accept: "application/json" } });
      const json = JSON.parse(text) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      return clean((json.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description })));
    },
  };
}

function tavily(key: string, env: Env): WebSearchProvider {
  return {
    key: "tavily",
    name: "Tavily",
    costPerQuery: cost(env),
    async search(query, { count }) {
      const { text } = await httpGet("Tavily", "https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: Math.min(count, 20), search_depth: "basic" }),
      });
      const json = JSON.parse(text) as { results?: { title?: string; url?: string; content?: string }[] };
      return clean((json.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })));
    },
  };
}

function serpapi(key: string, env: Env): WebSearchProvider {
  return {
    key: "serpapi",
    name: "SerpAPI",
    costPerQuery: cost(env),
    async search(query, { count, country }) {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${Math.min(count, 20)}${country ? `&gl=${country.toLowerCase()}` : ""}&api_key=${encodeURIComponent(key)}`;
      const { text } = await httpGet("SerpAPI", url);
      const json = JSON.parse(text) as { organic_results?: { title?: string; link?: string; snippet?: string }[] };
      return clean((json.organic_results ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })));
    },
  };
}

/** The search engines that have a key in the environment, in order of preference. */
export function webSearchProviders(env: Env = process.env): WebSearchProvider[] {
  return [
    env.BRAVE_SEARCH_API_KEY ? brave(env.BRAVE_SEARCH_API_KEY, env) : null,
    env.TAVILY_API_KEY ? tavily(env.TAVILY_API_KEY, env) : null,
    env.SERPAPI_API_KEY ? serpapi(env.SERPAPI_API_KEY, env) : null,
  ].filter((p): p is WebSearchProvider => !!p);
}
