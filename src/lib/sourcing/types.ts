/**
 * Sourcing: alternative suppliers and market evidence for a product.
 *
 * The one rule everything here follows: a price is never shown without saying
 * what kind of price it is and where it comes from. There is no "market
 * price" — there are prices paid, quotes received, benchmarks with a source,
 * and estimates, each with its own label.
 */
import type { Msg } from "../i18n";
import type { Comparability } from "../intel/comparison";
import type { Confidence } from "../intel/opportunities";

export type { Comparability, Confidence };

/** What kind of price a number is. Shown next to every price, the same way everywhere. */
export const PRICE_TYPES = ["actual", "quote", "internal_range", "direct_benchmark", "trade_benchmark", "cost_driver", "indicative", "estimate"] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const PRICE_TYPE_LABEL: Record<PriceType, Msg> = {
  actual: "Actual",
  quote: "Quote|price",
  internal_range: "Your quotes",
  direct_benchmark: "Benchmark",
  trade_benchmark: "Trade data",
  cost_driver: "Cost driver",
  indicative: "Public price",
  estimate: "Estimated range",
};

export const PRICE_TYPE_MEANING: Record<PriceType, Msg> = {
  actual: "A price really paid, from an invoice.",
  quote: "A real offer received from a supplier.",
  internal_range: "The range of the comparable quotes you have on file.",
  direct_benchmark: "A published reference for this very product.",
  trade_benchmark: "Derived from import and export statistics: an average of many products, not this one.",
  cost_driver: "The movement of a raw material, energy or exchange rate behind the price — not a price level.",
  indicative: "A price published by the supplier or a marketplace: not an offer made to you.",
  estimate: "Worked out by the system from other evidence: the least certain of all.",
};

/** Where a piece of information comes from, the most trusted first. */
export const SOURCE_LEVELS = ["invoice", "quote", "supplier_official", "official_data", "licensed_data", "external", "estimate"] as const;
export type SourceLevel = (typeof SOURCE_LEVELS)[number];

export const SOURCE_LEVEL_LABEL: Record<SourceLevel, Msg> = {
  invoice: "Your invoices",
  quote: "A quote you received",
  supplier_official: "The supplier's own information",
  official_data: "Official, customs or trade data",
  licensed_data: "Licensed market data",
  external: "Other external source",
  estimate: "System estimate",
};

/** 1 = most trusted. */
export const sourceRank = (level: SourceLevel) => SOURCE_LEVELS.indexOf(level) + 1;
export const isSourceLevel = (v: unknown): v is SourceLevel => typeof v === "string" && (SOURCE_LEVELS as readonly string[]).includes(v);
export const isPriceType = (v: unknown): v is PriceType => typeof v === "string" && (PRICE_TYPES as readonly string[]).includes(v);

/** Where the user is with a possible supplier. No workflow: any status can follow any other. */
export const CANDIDATE_STATUSES = ["discovered", "to_review", "validated", "contacted", "quote_requested", "quote_received", "rejected", "converted"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, Msg> = {
  discovered: "Discovered",
  to_review: "To review",
  validated: "Validated|candidate",
  contacted: "Contacted",
  quote_requested: "RFQ sent",
  quote_received: "Quote received",
  rejected: "Rejected|candidate",
  converted: "Converted to supplier",
};
export const isCandidateStatus = (v: unknown): v is CandidateStatus => typeof v === "string" && (CANDIDATE_STATUSES as readonly string[]).includes(v);

/** How well the candidate's product matches ours technically, as far as the evidence says. Null: nobody checked yet. */
export type TechnicalFit = "high" | "partial" | "not";
export const isTechnicalFit = (v: unknown): v is TechnicalFit => v === "high" || v === "partial" || v === "not";
/** In words, the same everywhere. Unknown is an answer too: it is never read as a yes. */
export const TECHNICAL_LABEL: Record<TechnicalFit | "unknown", Msg> = { high: "Highly comparable", partial: "Possibly comparable", not: "Low comparability", unknown: "Unknown|compatibility" };

/** What kind of company a candidate is, as its own pages word it. */
export const COMPANY_TYPES = ["manufacturer", "distributor", "wholesaler"] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];
export const COMPANY_TYPE_LABEL: Record<CompanyType | "unknown", Msg> = { manufacturer: "Manufacturer", distributor: "Distributor", wholesaler: "Wholesaler", unknown: "Type not stated" };
export const isCompanyType = (v: unknown): v is CompanyType => typeof v === "string" && (COMPANY_TYPES as readonly string[]).includes(v);

/** What a candidate's own page confirms of the product's specification, and what it leaves open. */
export interface SpecCheck {
  url: string;
  checkedAt: string;
  /** A contact address written on the page, if any. */
  email?: string | null;
  /** The product words found on the page ("paraffin"). */
  product: string[];
  /** Specification values found on the page ("52/54"). */
  confirmed: string[];
  /** Specification values the page does not state: to confirm with the supplier. */
  missing: string[];
}

/** A company that may sell a comparable product: found by a provider or added by the user, always with its source. */
export interface SupplierCandidate {
  id: string;
  productId: string;
  name: string;
  country: string | null;
  website: string | null;
  /** Who or what found it: a provider's key, or "manual". */
  source: string;
  sourceLevel: SourceLevel;
  /** Where the supplier and its product were seen. */
  sourceUrl: string | null;
  /** When the source said so (not when we recorded it). */
  sourceDate: string | null;
  productMatched: string | null;
  matchReason: string | null;
  technicalCompatibility: TechnicalFit | null;
  specifications: Record<string, string> | null;
  /** A published or indicated price, per `unit` in `currency`. Never an offer: offers are quotes. */
  priceLow: number | null;
  priceHigh: number | null;
  priceType: PriceType | null;
  priceSourceUrl: string | null;
  currency: string | null;
  unit: string | null;
  incoterm: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  certifications: string | null;
  shippingOrigin: string | null;
  confidence: Confidence | null;
  notes: string | null;
  status: CandidateStatus;
  /** The supplier on file this candidate became, once the user converted it or recorded its quote. */
  supplierId: string | null;
  companyType: CompanyType | null;
  sourceTitle: string | null;
  /** When the research found it. */
  discoveredAt: string | null;
  specCheck: SpecCheck | null;
}

/** An external reference for a product's price: a published benchmark, trade statistics, a cost driver. */
export interface MarketBenchmark {
  id: string;
  productId: string;
  type: Extract<PriceType, "direct_benchmark" | "trade_benchmark" | "cost_driver" | "estimate">;
  label: string;
  /** Per product unit, in `currency`; for a cost driver, the movement in % over `period`. */
  low: number | null;
  high: number | null;
  unit: string | null;
  currency: string;
  /** Units of `currency` for one EUR on `fxDate`. Null with a foreign currency: the price is shown as written, not compared. */
  fxRate: number | null;
  fxDate: string | null;
  /** For cost drivers: change in % and the period it refers to. */
  changePct: number | null;
  period: string | null;
  sourceName: string;
  sourceUrl: string | null;
  sourceDate: string | null;
  sourceLevel: SourceLevel;
  comparability: Comparability;
  notes: string | null;
  provider: string;
}

export type MatchStrength = "strong" | "possible" | "needs_validation";
export const MATCH_LABEL: Record<MatchStrength, Msg> = { strong: "Strong match", possible: "Possible match", needs_validation: "Needs validation" };

export const COMPARABILITY_LABEL: Record<Comparability, Msg> = { comparable: "Highly comparable", partial: "Partially comparable", not: "Not comparable" };

export type SourcingStatus = "no_market_data" | "suppliers_found" | "quotes_needed" | "benchmark_available" | "opportunity" | "validated";
export const SOURCING_STATUS: Record<SourcingStatus, { label: Msg; meaning: Msg }> = {
  no_market_data: { label: "No market data", meaning: "No alternative supplier, quote or benchmark on file yet." },
  suppliers_found: { label: "Suppliers found", meaning: "Possible suppliers identified: review them and ask for quotes." },
  quotes_needed: { label: "Quotes needed", meaning: "Suppliers contacted: the comparison waits for their quotes." },
  benchmark_available: { label: "Benchmark available", meaning: "There is comparable evidence to set your price against." },
  opportunity: { label: "Opportunity to validate", meaning: "Your price is above the comparable evidence: a gap to confirm with quotes, not a saving yet." },
  validated: { label: "Validated|sourcing", meaning: "A comparable quote has been received and checked." },
};

export type MarketPosition = "below" | "in_line" | "slightly_above" | "materially_above" | "insufficient";
export const POSITION_LABEL: Record<MarketPosition, Msg> = {
  below: "Below the available range",
  in_line: "In line",
  slightly_above: "Slightly above",
  materially_above: "Materially above",
  insufficient: "Insufficient data",
};

/** Every threshold of the sourcing engine. Starting assumptions, to be calibrated. */
export const SOURCING_CONFIG = {
  /** A benchmark or an indicated price older than this (days) is shown, but not used for the range. */
  maxAgeDays: 180,
  /** Above the range by up to this % is "slightly above"; more is "materially above". */
  slightlyAbovePct: 5,
  /** Recent, highly comparable observations needed for high confidence. */
  highConfidenceObservations: 3,
  /** Candidates shown first for a product. */
  topCandidates: 5,
  /** Comparable observations needed before a range is called a market range; fewer is "a benchmark", with no position and no amount. */
  rangeObservations: 2,
  /** Suppliers recommended for a request for quotation, per product. */
  shortlistSize: 3,
  /** …and how many when a product has many strong candidates. */
  shortlistMax: 5,
  manyStrongCandidates: 7,
  /** The first round of requests concentrates on this many products, the largest by spend. */
  focusProducts: 5,
  /** Days without an answer before a follow-up is proposed. */
  followUpAfterDays: 10,
  /** A supplier asked within this many days is not written to again from scratch: the earlier request is extended. */
  recentContactDays: 30,
};
export type SourcingConfig = typeof SOURCING_CONFIG;
