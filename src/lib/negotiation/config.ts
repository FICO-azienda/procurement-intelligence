/**
 * Every assumption of the negotiation engine, in one place. These are
 * starting assumptions, to be calibrated on real negotiations: nothing in the
 * engine or the UI repeats these numbers, and the engine takes a config so a
 * category model (or, later, a learned one) can pass its own.
 */
import type { ProductClass } from "../research/strategy";

export type DimensionKey = "buyer" | "competition" | "substitutability" | "evidence" | "switching" | "commercial";
export const DIMENSION_KEYS: DimensionKey[] = ["buyer", "competition", "substitutability", "evidence", "switching", "commercial"];

/** Which set of weights a product is read with. Decided from what the catalogue knows of it, never from a company's own categories. */
export type NegotiationProfile = "commodity" | "standard" | "custom" | "packaging" | "other";

export function profileOf(productClass: ProductClass, kind: string | null | undefined): NegotiationProfile {
  if (productClass === "commodity") return "commodity";
  if (productClass === "custom" || productClass === "private_label") return "custom";
  if (kind === "packaging") return "packaging";
  if (productClass === "standard") return "standard";
  return "other";
}

export type AnchorKind = "quote" | "other_supplier" | "published_price" | "benchmark" | "trade" | "estimate" | "own_history";

export const NEGOTIATION_CONFIG = {
  /**
   * How much each score weighs in the buyer's negotiation power, by kind of
   * product. A commodity is negotiated on market evidence and volume; a
   * custom part on how hard it is to move and how well it is specified;
   * packaging on volume and on the terms around the price (minimum order,
   * transport). Each row sums to 1.
   */
  weights: {
    commodity: { buyer: 0.25, competition: 0.2, substitutability: 0.1, evidence: 0.3, switching: 0.1, commercial: 0.05 },
    standard: { buyer: 0.2, competition: 0.25, substitutability: 0.15, evidence: 0.2, switching: 0.1, commercial: 0.1 },
    custom: { buyer: 0.15, competition: 0.15, substitutability: 0.2, evidence: 0.1, switching: 0.3, commercial: 0.1 },
    packaging: { buyer: 0.25, competition: 0.2, substitutability: 0.1, evidence: 0.15, switching: 0.1, commercial: 0.2 },
    other: { buyer: 0.2, competition: 0.2, substitutability: 0.15, evidence: 0.2, switching: 0.15, commercial: 0.1 },
  } satisfies Record<NegotiationProfile, Record<DimensionKey, number>>,

  /** The power in words: below `medium` is low, from `veryHigh` up is very high (scores are 0–10). */
  strength: { medium: 4, high: 6, veryHigh: 8 },

  /** What a year of the product is worth (EUR) → the score of the volume. Below the last step: `smallSpendScore`. */
  spendSteps: [
    [250_000, 10],
    [100_000, 8],
    [25_000, 6],
    [5_000, 4],
  ] as [number, number][],
  smallSpendScore: 2,
  /** From this yearly value up the volume is named among the positive factors; below `smallSpend` among the limits. */
  largeSpend: 100_000,
  smallSpend: 5_000,
  /** A full truck, for products bought by weight: an order near it is a full load. */
  fullLoadKg: 24_000,
  fullLoadShare: 0.8,
  /** Purchases on file below which the history is called short. */
  minPurchases: 3,

  /**
   * What the buyer's own leverage is made of, and how much each part weighs:
   * what a year of the product is worth, how large the usual order is, whether
   * orders could be grouped or committed, and what the whole relationship
   * with the supplier adds. A part nothing on file can tell drops out.
   */
  buyerParts: { volume: 0.4, orderSize: 0.15, consolidation: 0.1, relationship: 0.35 },

  /**
   * Supplier relationship leverage: the whole of what is bought from the
   * supplier, read as five scores. They are leverage, never a discount.
   */
  relationship: {
    weights: { total_spend: 0.25, cross_spend: 0.2, breadth: 0.2, regularity: 0.2, bundle: 0.15 },
    /** What a year with the supplier is worth (EUR) → score. Below the last step: 2. */
    totalSteps: [
      [2_000_000, 10],
      [500_000, 9],
      [250_000, 8],
      [100_000, 7],
      [25_000, 5],
      [5_000, 3],
    ] as [number, number][],
    /** What a year of the supplier's other products is worth (EUR) → score. Below the last step: 2; nothing at all: 1. */
    crossSteps: [
      [500_000, 9],
      [250_000, 8],
      [100_000, 6],
      [25_000, 5],
      [5_000, 3],
    ] as [number, number][],
    /** Cross-category spend (EUR a year) that counts in the breadth of a relationship, once and twice. */
    crossMaterial: 25_000,
    crossLarge: 100_000,
    /** Purchase dates in the period from which orders are recurring, and frequent. */
    regularDates: 6,
    manyDates: 12,
    /** An interval up to this many days between purchases is "at least monthly". */
    monthlyDays: 31,
    /** Months of purchases from which a relationship is called stable, and below which too short to judge. */
    stableMonths: 12,
    shortHistoryMonths: 6,
    /** Other products, and their share of the account, from which several can be negotiated together with weight. */
    bundleProducts: 3,
    bundleShare: 0.1,
    /** Nobody has said how much the buyer matters to the supplier: the score stops here, and its confidence is not high. */
    unknownImportanceCap: 8,
    /** The score in words: below `medium` low, from `high` up high. */
    level: { medium: 4, high: 7 },
  },
  /** Without a real offer or a second source, competition is only on paper: its score stops here. */
  untestedCompetitionCap: 7,
  /** Without a real offer, the price evidence score stops here. */
  indirectEvidenceCap: 6,
  /** Payment terms from which paying sooner is something to offer. */
  longPaymentDays: 60,

  /**
   * How much of its distance from the current price a piece of evidence is
   * counted for. A real offer on true cost, with the specification confirmed,
   * counts in full: it is a price on the table. A published reference counts
   * for a part: nobody has confirmed it for this buyer's specification,
   * quantity and delivery terms.
   */
  anchorWeight: {
    quoteConfirmed: 1,
    quoteTrueCost: 0.85,
    quoteNominal: 0.5,
    otherSupplier: 0.9,
    publishedComparable: 0.5,
    publishedPartial: 0.3,
    benchmarkComparable: 0.6,
    benchmarkPartial: 0.4,
    tradeConfirmedCode: 0.3,
    tradeSuggestedCode: 0.2,
    estimate: 0.2,
    historyRecent: 0.5,
    historyOlder: 0.3,
  },
  /** A partly comparable offer or purchase counts for this much of its weight. */
  partialFactor: 0.8,
  /** One real offer, until a second confirms it, moves the cautious end of the range by this share. */
  singleQuoteShare: 0.5,
  /**
   * How far a published reference carries a buyer: a weak buyer gets this
   * share of the reference's counted distance, the strongest one all of it.
   */
  leverageFloor: 0.5,

  /** The buyer's own prices: how far back they count, and what is "recent". */
  historyWindowMonths: 12,
  recentHistoryMonths: 6,
  /** How much of the rise seen in the buyer's own history is kept as the risk above today's price, by trend. */
  upward: { increasing: 0.75, stable: 0.5, decreasing: 0.25 },
  /** A cost driver moving by at least this % shifts that share one step. */
  driverMovePct: 3,
  driverShift: 0.25,

  /**
   * Where the target sits between the cautious end and the lowest end: from
   * `base` (no strength) to `base + span` (full strength), then held back
   * when the confidence is not high. Never the lowest end.
   */
  target: { base: 0.3, span: 0.4, mediumConfidence: 0.9, lowConfidence: 0.75 },

  /** A current price older than this (days) caps the confidence at medium. */
  staleCurrentPriceDays: 180,
};

export type NegotiationConfig = typeof NEGOTIATION_CONFIG;
