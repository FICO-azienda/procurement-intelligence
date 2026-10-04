/**
 * External sources, behind interfaces: who can search the web, read a
 * supplier's page, find suppliers, publish a benchmark, give trade statistics,
 * commodity prices, exchange rates, duties and freight rates. The business
 * logic (market.ts, discovery.ts, research/) never names a provider: it
 * receives what providers return, already carrying its source.
 *
 * The interfaces and the list of known sources live here (pure). The adapters
 * that go on the network live in src/server/providers/, and which of them is
 * switched on is decided there from the environment — no key is ever in code.
 * A source that is not connected is said to be so on screen; nothing is shown
 * in its place.
 */
import type { Msg } from "../i18n";
import type { Comparability, Confidence, PriceType, SourceLevel, TechnicalFit } from "./types";

/** What a provider is told about the product. The price paid and the current supplier's terms are never sent out. */
export interface DiscoveryRequest {
  productName: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  family: string | null;
  /** Read from the name: size, diameter, material… */
  specifications: Record<string, string>;
  supplierCodes: string[];
  unit: string;
  annualQuantity: number | null;
  typicalOrderQuantity: number | null;
  /** Where the goods are needed. */
  deliveryCountry: string | null;
  /** Names to leave out: who the company buys from already. */
  knownSuppliers: string[];
  queries: string[];
}

/** One supplier as a provider reports it. Anything the provider can't back with a source is left out, not filled in. */
export interface DiscoveredSupplier {
  name: string;
  country?: string | null;
  website?: string | null;
  /** Required: where the supplier and its product were seen. */
  sourceUrl: string;
  sourceTitle?: string | null;
  sourceDate?: string | null;
  sourceLevel: SourceLevel;
  companyType?: "manufacturer" | "distributor" | "wholesaler" | null;
  productMatched?: string | null;
  matchReason?: string | null;
  technicalCompatibility?: TechnicalFit | null;
  specifications?: Record<string, string> | null;
  price?: { low: number; high: number; currency: string; unit: string; type: Extract<PriceType, "indicative" | "estimate">; sourceUrl: string; incoterm?: string | null } | null;
  moq?: number | null;
  leadTimeDays?: number | null;
  paymentTerms?: string | null;
  certifications?: string | null;
  shippingOrigin?: string | null;
  confidence?: Confidence | null;
  notes?: string | null;
  /** The query that found it, to learn which queries work. */
  query?: string | null;
}

export interface SupplierDiscoveryProvider {
  key: string;
  name: string;
  search(request: DiscoveryRequest): Promise<DiscoveredSupplier[]>;
}

/** One result of a web search: a page, not yet a supplier. */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string | null;
}

/** A search engine with an API (Brave, Tavily, SerpAPI…). */
export interface WebSearchProvider {
  key: string;
  name: string;
  /** EUR for one search. Null: not known — the cost is then said to be unknown, never guessed. */
  costPerQuery: number | null;
  search(query: string, options: { count: number; country: string | null }): Promise<WebSearchResult[]>;
}

/** The readable text of a public page. */
export interface PageContent {
  url: string;
  title: string | null;
  /** The site's own name, when the page declares one. */
  siteName: string | null;
  text: string;
}

/** Opens one public page — a supplier's own site — to read what it states. It does not follow links. */
export interface PageReader {
  key: string;
  name: string;
  read(url: string): Promise<PageContent>;
}

export interface BenchmarkRequest {
  productName: string;
  category: string | null;
  subcategory: string | null;
  specifications: Record<string, string>;
  unit: string;
  deliveryCountry: string | null;
}

export interface BenchmarkResult {
  label: string;
  low: number;
  high: number;
  currency: string;
  unit: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceDate: string;
  sourceLevel: SourceLevel;
  comparability: Comparability;
  notes?: string | null;
}

/** A published reference for the product itself (price reports, exchanges, sector indexes). */
export interface MarketBenchmarkProvider {
  key: string;
  name: string;
  benchmarks(request: BenchmarkRequest): Promise<BenchmarkResult[]>;
}

/** One month of imports under a customs code: what entered a country, and how much of it. */
export interface TradeMonth {
  /** "2026-06" */
  period: string;
  valueEUR: number;
  quantityKg: number;
}

export interface TradeSeries {
  code: string;
  /** What the code covers, as the source describes it. */
  description: string | null;
  /** ISO code of the importing country. */
  reporter: string;
  months: TradeMonth[];
  sourceName: string;
  sourceUrl: string;
  /** When the source last updated the data. */
  updated: string | null;
}

/** Import statistics by customs code: unit values of everything under a code, not of one product. */
export interface TradeDataProvider {
  key: string;
  name: string;
  imports(request: { code: string; reporter: string; months: string[] }): Promise<TradeSeries | null>;
}

/** Raw materials and energy: a series over time, to read movements — not the product's price. */
export interface CommodityProvider {
  key: string;
  name: string;
  series(code: string, from: string, to: string): Promise<{ date: string; value: number; unit: string; currency: string }[]>;
}

export interface FXProvider {
  key: string;
  name: string;
  /** Units of `currency` for one EUR, on the date or the last day before it with a rate. */
  rate(currency: string, date: string): Promise<{ rate: number; date: string; sourceName: string; sourceUrl: string } | null>;
  /** The average of a month ("2026-09"): the rate for a reference that is itself the average of that month. */
  average?(currency: string, month: string): Promise<{ rate: number; date: string; days: number; sourceName: string; sourceUrl: string } | null>;
}

export interface TariffProvider {
  key: string;
  name: string;
  duty(customsCode: string, origin: string, destination: string): Promise<{ ratePct: number; sourceName: string; sourceDate: string } | null>;
}

export interface FreightProvider {
  key: string;
  name: string;
  estimate(origin: string, destination: string, quantity: number, unit: string): Promise<{ low: number; high: number; currency: string; sourceName: string; sourceDate: string } | null>;
}

export interface Providers {
  webSearch: WebSearchProvider[];
  pages: PageReader[];
  discovery: SupplierDiscoveryProvider[];
  benchmark: MarketBenchmarkProvider[];
  trade: TradeDataProvider[];
  commodity: CommodityProvider[];
  fx: FXProvider[];
  tariff: TariffProvider[];
  freight: FreightProvider[];
}

export const NO_PROVIDERS: Providers = { webSearch: [], pages: [], discovery: [], benchmark: [], trade: [], commodity: [], fx: [], tariff: [], freight: [] };

export const PROVIDER_KINDS: { key: keyof Providers; label: Msg; gives: Msg }[] = [
  { key: "webSearch", label: "Web search", gives: "Pages that may belong to possible suppliers: each is then opened and checked." },
  { key: "pages", label: "Official websites", gives: "What a supplier's own site states about its products." },
  { key: "discovery", label: "Supplier discovery", gives: "Possible suppliers, each with the page where it was found." },
  { key: "benchmark", label: "Market benchmarks", gives: "Published price references for a product." },
  { key: "trade", label: "Trade statistics", gives: "Import and export unit values, by customs code." },
  { key: "commodity", label: "Commodities and energy", gives: "How raw materials and energy are moving." },
  { key: "fx", label: "Exchange rates", gives: "Official rates, to compare prices in other currencies." },
  { key: "tariff", label: "Duties", gives: "Customs duties by product and origin." },
  { key: "freight", label: "Freight", gives: "Transport cost estimates by route." },
];

/**
 * Every source the app knows how to talk to, or has a place for. `env` is the
 * variable that switches it on (free sources are on unless switched off);
 * `ready: false` is a place kept for an adapter that is not written yet.
 */
export interface KnownSource {
  key: string;
  kind: keyof Providers;
  name: string;
  /** free: public data, no key. key: needs an API key. premium: a paid data subscription, optional. */
  access: "free" | "key" | "premium";
  env: string | null;
  ready: boolean;
}

export const KNOWN_SOURCES: KnownSource[] = [
  { key: "brave", kind: "webSearch", name: "Brave Search API", access: "key", env: "BRAVE_SEARCH_API_KEY", ready: true },
  { key: "tavily", kind: "webSearch", name: "Tavily", access: "key", env: "TAVILY_API_KEY", ready: true },
  { key: "serpapi", kind: "webSearch", name: "SerpAPI", access: "key", env: "SERPAPI_API_KEY", ready: true },
  { key: "web_page", kind: "pages", name: "Supplier websites", access: "free", env: null, ready: true },
  { key: "ecb", kind: "fx", name: "European Central Bank reference rates", access: "free", env: null, ready: true },
  { key: "eurostat_comext", kind: "trade", name: "Eurostat Comext", access: "free", env: null, ready: true },
  { key: "taric", kind: "tariff", name: "EU TARIC / Access2Markets", access: "free", env: null, ready: false },
  { key: "pricepedia", kind: "benchmark", name: "PricePedia", access: "premium", env: "PRICEPEDIA_API_KEY", ready: false },
  { key: "volza", kind: "trade", name: "Volza", access: "premium", env: "VOLZA_API_KEY", ready: false },
  { key: "trademo", kind: "trade", name: "Trademo", access: "premium", env: "TRADEMO_API_KEY", ready: false },
  { key: "freightos", kind: "freight", name: "Freightos", access: "premium", env: "FREIGHTOS_API_KEY", ready: false },
];

export const connected = (providers: Providers) => PROVIDER_KINDS.filter((k) => providers[k.key].length > 0).map((k) => k.key);
