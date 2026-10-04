/**
 * From search results to sites worth opening. A search result is a page, not
 * a supplier: marketplaces, directories, social networks, encyclopedias and
 * sellers of market reports are left out, results of the same site are one
 * lead, and a site already on file is not opened again as new. What is left
 * is only a lead — it becomes a candidate when its own page states the product.
 */
import { companyKey } from "../import/normalize/text";
import { hostOf } from "../sourcing/discovery";
import type { WebSearchResult } from "../sourcing/providers";

/** Sites that list or resell other companies' products, or are not companies at all. Data, to extend. */
export const NOT_A_SUPPLIER_SITE = [
  "alibaba.com", "aliexpress.com", "made-in-china.com", "globalsources.com", "indiamart.com", "tradeindia.com", "ec21.com", "dhgate.com", "freshdi.com", "go4worldbusiness.com", "exportersindia.com",
  "amazon.", "ebay.", "etsy.com", "walmart.com",
  "europages.", "kompass.com", "thomasnet.com", "wlw.de", "wlw.at", "yellowpages.", "paginegialle.it", "atoka.io", "dnb.com", "ensun.io", "wonnda.com", "volza.com", "panjiva.com", "importgenius.com",
  "facebook.com", "linkedin.com", "instagram.com", "youtube.com", "pinterest.", "x.com", "twitter.com", "tiktok.com", "reddit.com",
  "wikipedia.org", "patents.google.com", "justia.com", "scribd.com", "researchgate.net",
  "imarcgroup.com", "chemanalyst.com", "expertmarketresearch.com", "mordorintelligence.com", "grandviewresearch.com", "marketsandmarkets.com", "statista.com", "price-watch.ai",
];

export interface SiteLead {
  host: string;
  /** The page to open: the most specific result of the site. */
  url: string;
  title: string;
  snippet: string | null;
  /** The searches that found it. */
  queries: string[];
}

export type LeadDrop = "not_a_supplier_site" | "already_known" | "over_limit";

const listed = (host: string) => NOT_A_SUPPLIER_SITE.some((site) => (site.endsWith(".") ? host.startsWith(site) || host.includes(`.${site}`) : host === site || host.endsWith(`.${site}`)));

export function leadsFromResults(
  searches: { query: string; results: WebSearchResult[] }[],
  ctx: { knownHosts: string[]; knownSuppliers: string[]; max: number },
): { leads: SiteLead[]; dropped: { host: string; reason: LeadDrop }[] } {
  const known = new Set(ctx.knownHosts);
  const names = ctx.knownSuppliers.map((s) => companyKey(s).replace(/ /g, "")).filter((s) => s.length >= 3);
  const byHost = new Map<string, SiteLead>();
  const dropped = new Map<string, LeadDrop>();
  for (const { query, results } of searches) {
    for (const r of results) {
      const host = hostOf(r.url);
      if (!host) continue;
      if (listed(host)) dropped.set(host, "not_a_supplier_site");
      // On file already, or the company's own supplier: its domain usually carries its name.
      else if (known.has(host) || names.some((n) => host.replace(/[^a-z0-9]/g, "").includes(n))) dropped.set(host, "already_known");
      else {
        const lead = byHost.get(host);
        if (!lead) byHost.set(host, { host, url: r.url, title: r.title, snippet: r.snippet, queries: [query] });
        else {
          if (!lead.queries.includes(query)) lead.queries.push(query);
          // A product page says more than a home page.
          if (new URL(r.url).pathname.length > new URL(lead.url).pathname.length) Object.assign(lead, { url: r.url, title: r.title, snippet: r.snippet ?? lead.snippet });
        }
      }
    }
  }
  const ranked = [...byHost.values()].sort((a, b) => b.queries.length - a.queries.length);
  for (const lead of ranked.slice(ctx.max)) dropped.set(lead.host, "over_limit");
  return { leads: ranked.slice(0, ctx.max), dropped: [...dropped.entries()].map(([host, reason]) => ({ host, reason })) };
}

/** Country codes used as generic domains: they say nothing about where a company is. */
const GENERIC = new Set(["co", "io", "ai", "me", "tv", "eu", "cc", "fm", "to", "biz", "app", "dev"]);

/** The country a site's domain suggests (".pl" → PL): a hint to confirm, null for .com and the like. */
export function countryCodeOfHost(host: string): string | null {
  const tld = host.split(".").pop() ?? "";
  if (tld.length !== 2 || GENERIC.has(tld)) return null;
  return tld === "uk" ? "GB" : tld.toUpperCase();
}
