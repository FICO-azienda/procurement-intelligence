/**
 * Summary engine for the Overview page.
 *
 * Takes what the intelligence engine already computed (`Intel`) and reduces it
 * to what an owner needs to decide, product by product: what you pay, how it
 * moved, what it can be compared with, which alternatives exist, how much is
 * at stake, what is still unknown and what to check first.
 *
 * Nothing is recalculated here: no new price, saving or confidence formula.
 * This file only selects, orders and words. Pages render the result as is, so
 * no React component works out a status or a sentence on its own.
 *
 * Not available yet, and therefore never shown as a number:
 *   true (landed) cost · external market benchmarks · supplier quality data.
 * The structure has a place for each (`estimatedTrueCost`, `ReferenceType`),
 * to be filled by the phases that compute them.
 */
import { countryKey, countryName } from "../countries";
import * as f from "../format";
import { en, list, lowerFirst, upperFirst, type Msg, type T } from "../i18n";
import type { Comparability, ComparisonRow } from "./comparison";
import type { IntelConfig } from "./config";
import { topOpportunities, type Intel, type ProductIntel, type SupplierIntel } from "./engine";
import { DELIVERED_INCOTERMS, type Confidence } from "./opportunities";
import type { AlertLevel } from "./portfolio";
import type { Quality } from "./quality";
import { DECISION_STATUS, isDataGap, type DecisionStatus, type OpportunityStatus } from "./statuses";

// ---------------- Shapes ----------------

export { DATA_GAPS, DECISION_STATUS, isDataGap, type DecisionStatus } from "./statuses";

/**
 * What the current price is compared with. Only the last two are produced
 * today (from the company's own quotes); the others are reserved for external
 * sources, so that a real market price is never confused with an internal one.
 */
export type ReferenceType = "direct_market" | "market_range" | "trade" | "cost_driver" | "internal_quotes" | "not_available";

export const REFERENCE_LABEL: Record<ReferenceType, Msg> = {
  direct_market: "Direct market benchmark",
  market_range: "Market range",
  trade: "Trade benchmark",
  cost_driver: "Cost driver benchmark",
  internal_quotes: "Other suppliers on file",
  not_available: "Not available",
};

export interface MarketReference {
  type: ReferenceType;
  /** EUR per product unit. */
  low: number | null;
  high: number | null;
  /** Comparable offers from other suppliers the range is built from. */
  count: number;
  /** Of which still recent and valid. */
  recent: number;
  confidence: Confidence | null;
  /** Where the current price sits against the range. */
  position: "above" | "within" | "below" | null;
  latestDate: string | null;
}

export type FlagKey =
  | "expired"
  | "old"
  | "specs_differ"
  | "moq_annual"
  | "moq"
  | "currency"
  | "freight"
  | "import"
  | "lead_time"
  | "payment"
  | "specs_unknown"
  | "quality"
  | "set_aside"
  | "recent"
  | "same_currency"
  | "specs_match"
  | "moq_ok"
  | "delivered";

export interface AlternativeFlag {
  key: FlagKey;
  tone: "ok" | "warn";
  label: string;
}

export interface DecisionAlternative {
  supplierId: string;
  supplierName: string;
  country: string | null;
  kind: "quote" | "purchase";
  /** Price as written on the offer. */
  quotedPrice: number;
  currency: string;
  /** EUR per product unit; null when the exchange rate is unknown. */
  priceEUR: number | null;
  date: string | null;
  /** Alternative vs current price, in % (negative = lower). */
  differencePct: number | null;
  /** Landed cost per unit. Not computed yet: stays null until the landed-cost phase. */
  estimatedTrueCost: number | null;
  /** EUR/year, price only. Null when no saving can be claimed. */
  potentialSaving: number | null;
  confidence: Confidence | null;
  comparability: Comparability;
  /** Why it can't be compared, when it can't. */
  notComparableReason: string | null;
  leadTimeDays: number | null;
  moq: number | null;
  paymentTermsDays: number | null;
  incoterm: string | null;
  flags: AlternativeFlag[];
  /** The user rejected or closed this opportunity. */
  setAside: boolean;
  opportunityKey: string | null;
}

export type ActionKind =
  | "check_price"
  | "negotiate"
  | "update_quote"
  | "check_specs"
  | "check_moq"
  | "get_freight"
  | "check_import"
  | "check_payment"
  | "validate_quality"
  | "explain_increase"
  | "request_quote"
  | "record_fx"
  | "second_source"
  | "confirm_price"
  | "add_purchases";

export interface NextAction {
  kind: ActionKind;
  label: string;
  /** The facts behind the suggestion — every action can be explained. */
  why: { label: string; value: string }[];
}

export type SupplyRiskLevel = "high" | "moderate" | "low" | "unknown";

export interface ProductDecision {
  productId: string;
  name: string;
  sku: string;
  category: string | null;
  unit: string;

  // Cost
  status: DecisionStatus;
  statusReason: string;
  currentSupplier: {
    id: string;
    name: string;
    country: string | null;
    paymentTermsDays: number | null;
    leadTimeDays: number | null;
    /** First purchase from this supplier, any product. */
    since: string | null;
    orders12m: number;
  } | null;
  currentPrice: number | null;
  currentPriceDate: string | null;
  /** The current price may be a data error (not reviewed yet). */
  currentPriceFlagged: boolean;
  priceTrend: { pct: number | null; referencePrice: number | null; referenceDate: string | null; partial: boolean; alert: AlertLevel | null };
  /** EUR/year the 12-month increase costs at current volume; only for increases worth an alert. */
  priceIncreaseCost: number | null;
  annualQuantity: number;
  annualSpend: number;
  spendShare: number;
  highSpend: boolean;
  market: MarketReference;
  /** Best first; at most `overview.maxAlternatives`. */
  alternatives: DecisionAlternative[];
  alternativesTotal: number;
  /** The alternative the potential saving refers to. */
  best: DecisionAlternative | null;
  /** Set when the lowest quoted price is not the first alternative: who, and why. */
  cheapestNotFirst: { supplierName: string; price: number; explanation: string } | null;
  /** Same annual volume at today's price and at the alternative's quoted price. */
  money: { currentAnnualCost: number; alternativeAnnualCost: number; difference: number } | null;
  potentialSaving: number | null;
  savingConfidence: Confidence | null;
  /** False when a saving exists but is too small to matter. */
  savingMaterial: boolean;
  opportunityStatus: OpportunityStatus | null;
  opportunityKey: string | null;

  // Supply — kept apart from cost: a product can be well priced and still risky.
  supplyRisk: { level: SupplyRiskLevel; label: string; detail: string; suppliers: number; alternativesQuoted: number };

  dataConfidence: Quality;
  dataConfidenceReasons: string[];
  missingData: string[];
  nextActions: NextAction[];
  summary: string[];
  lastUpdated: { purchases: string | null; quotes: string | null };
  /** Internal ordering only — never shown as a score. */
  priority: { tier: 1 | 2 | 3 | 4 | 5; value: number };
}

// ---------------- Helpers ----------------

const pct1 = (n: number) => Math.abs(n).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const qty = (n: number) => n.toLocaleString("it-IT", { useGrouping: "always", maximumFractionDigits: 2 });
const per = (price: number | null, unit: string) => `${f.priceShort(price)}/${unit}`;
const COMPARABILITY_RANK: Record<Comparability, number> = { comparable: 2, partial: 1, not: 0 };
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
const INACTIVE: OpportunityStatus[] = ["rejected", "closed"];

function range(low: number | null, high: number | null, unit: string) {
  if (low == null || high == null) return "—";
  return f.priceShort(low) === f.priceShort(high) ? per(low, unit) : `${f.priceShort(low)}–${per(high, unit)}`;
}

// ---------------- Alternatives ----------------

interface AlternativeContext {
  current: ComparisonRow | null;
  annualQuantity: number;
  typicalOrderQuantity: number | null;
  unit: string;
  cfg: IntelConfig;
  t: T;
}

/** Short warnings and reassurances about one offer, most important first. */
function flagsFor(row: ComparisonRow, ctx: AlternativeContext, setAside: boolean): AlternativeFlag[] {
  const warn: AlternativeFlag[] = [];
  const ok: AlternativeFlag[] = [];
  const w = (key: FlagKey, label: string) => warn.push({ key, tone: "warn", label });
  const o = (key: FlagKey, label: string) => ok.push({ key, tone: "ok", label });
  const { current, unit, cfg, t } = ctx;

  if (setAside) w("set_aside", t("Set aside by you"));
  if (row.expired) w("expired", t("Quote expired"));
  else if (row.age === "old") w("old", t(row.kind === "quote" ? "Old quote ({days} days)" : "Old price ({days} days)", { days: row.ageDays }));
  else o("recent", t(row.kind === "quote" ? "Recent quote" : "Recent price paid"));

  if (row.specDifferences.length) w("specs_differ", t("Specifications differ"));
  else if (row.specsKnown) o("specs_match", t("Similar specifications"));

  if (row.moq != null) {
    if (ctx.annualQuantity > 0 && row.moq > ctx.annualQuantity) w("moq_annual", t("Minimum order above your yearly volume"));
    else if (ctx.typicalOrderQuantity != null && row.moq > ctx.typicalOrderQuantity * cfg.moqToleranceFactor) w("moq", t("Higher minimum order ({moq} {unit})", { moq: qty(row.moq), unit }));
    else o("moq_ok", t("Minimum order fits your orders"));
  }

  if (row.currency && current?.currency) {
    if (row.currency !== current.currency) w("currency", t("Different currency ({currency})", { currency: row.currency }));
    else o("same_currency", t("Same currency"));
  }

  if (row.freightCost == null) {
    if (row.incoterm && DELIVERED_INCOTERMS.has(row.incoterm)) o("delivered", t("Delivered price ({incoterm})", { incoterm: row.incoterm }));
    else w("freight", row.incoterm ? t("Freight not included ({incoterm})", { incoterm: row.incoterm }) : t("Freight unknown"));
  }
  // Same rule as the opportunity engine: a different (or unknown) country means import costs are open.
  if (!row.supplier.country || !current?.supplier.country || countryKey(row.supplier.country) !== countryKey(current.supplier.country)) {
    w("import", t("Import costs not assessed"));
  }
  if (row.leadTimeDays != null && current?.leadTimeDays != null && row.leadTimeDays > current.leadTimeDays + cfg.overview.leadTimeToleranceDays) {
    w("lead_time", t("Longer lead time ({offer} vs {current} days)", { offer: row.leadTimeDays, current: current.leadTimeDays }));
  }
  if (row.paymentTermsDays != null && current?.paymentTermsDays != null && row.paymentTermsDays < current.paymentTermsDays) {
    w("payment", row.paymentTermsDays === 0 ? t("Payment in advance") : t("Shorter payment terms ({offer} vs {current} days)", { offer: row.paymentTermsDays, current: current.paymentTermsDays }));
  }
  if (!row.specsKnown && !row.specDifferences.length) w("specs_unknown", t("Specifications not compared"));
  w("quality", t("Quality not validated"));
  return [...warn, ...ok];
}

function toAlternative(row: ComparisonRow, p: ProductIntel, ctx: AlternativeContext): DecisionAlternative | null {
  if (row.isCurrent || row.price == null || row.kind == null) return null;
  const opp = p.opportunities.find((o) => o.type === "lower_quote" && o.alternativeSupplierId === row.supplier.id) ?? null;
  const setAside = !!opp && INACTIVE.includes(opp.status);
  return {
    supplierId: row.supplier.id,
    supplierName: row.supplier.name,
    country: row.supplier.country,
    kind: row.kind,
    quotedPrice: row.price,
    currency: row.currency ?? "EUR",
    priceEUR: row.priceEUR,
    date: row.date,
    differencePct: row.differencePct,
    estimatedTrueCost: null,
    potentialSaving: opp?.potentialSaving ?? null,
    confidence: opp?.confidence ?? null,
    comparability: row.comparability,
    notComparableReason: row.comparability === "not" ? (row.comparabilityReasons[0] ?? ctx.t("Can't be compared yet")) : null,
    leadTimeDays: row.leadTimeDays,
    moq: row.moq,
    paymentTermsDays: row.paymentTermsDays,
    incoterm: row.incoterm,
    flags: row.comparability === "not" ? [] : flagsFor(row, ctx, setAside),
    setAside,
    opportunityKey: opp?.key ?? null,
  };
}

/**
 * Order of the alternatives: the one the engine picked as the product's saving
 * first, then by comparability, then by confidence, then by price. Never by
 * quoted price alone. When a landed cost exists it replaces the quoted price here.
 */
function rankAlternatives(alts: DecisionAlternative[], bestSupplierId: string | null) {
  const cost = (a: DecisionAlternative) => a.estimatedTrueCost ?? a.priceEUR ?? Number.POSITIVE_INFINITY;
  return [...alts].sort(
    (a, b) =>
      Number(b.supplierId === bestSupplierId) - Number(a.supplierId === bestSupplierId) ||
      Number(a.setAside) - Number(b.setAside) ||
      COMPARABILITY_RANK[b.comparability] - COMPARABILITY_RANK[a.comparability] ||
      (b.confidence ? CONFIDENCE_RANK[b.confidence] : 0) - (a.confidence ? CONFIDENCE_RANK[a.confidence] : 0) ||
      cost(a) - cost(b) ||
      a.supplierName.localeCompare(b.supplierName),
  );
}

// ---------------- Market reference ----------------

function marketReference(p: ProductIntel): MarketReference {
  const offers = p.comparison.filter((r) => !r.isCurrent && r.priceEUR != null && r.comparability !== "not");
  if (!offers.length) return { type: "not_available", low: null, high: null, count: 0, recent: 0, confidence: null, position: null, latestDate: null };
  const prices = offers.map((r) => r.priceEUR!);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const recent = offers.filter((r) => !r.expired && r.age !== "old").length;
  const current = p.price.current?.price ?? null;
  // Compare what the user sees: prices rounded as displayed.
  const shown = (n: number) => Number(n.toFixed(4));
  return {
    type: "internal_quotes",
    low,
    high,
    count: offers.length,
    recent,
    // A handful of quotes is a useful comparison, never a market price.
    confidence: recent >= 2 ? "medium" : "low",
    position: current == null ? null : shown(current) > shown(high) ? "above" : shown(current) < shown(low) ? "below" : "within",
    latestDate: offers.reduce<string | null>((d, r) => (r.date && (!d || r.date > d) ? r.date : d), null),
  };
}

// ---------------- Next actions ----------------

const FOLLOW_UP: Partial<Record<FlagKey, { kind: ActionKind; label: (t: T, name: string, a: DecisionAlternative) => string; caveat: Msg }>> = {
  expired: { kind: "update_quote", label: (t, name) => t("Ask {name} for an updated quote", { name }), caveat: "ask for an updated quote" },
  old: { kind: "update_quote", label: (t, name) => t("Ask {name} for an updated quote", { name }), caveat: "ask for an updated quote" },
  specs_differ: { kind: "check_specs", label: (t, name) => t("Check the specification differences with {name}", { name }), caveat: "check the specification differences" },
  moq_annual: { kind: "check_moq", label: (t, name) => t("Check the minimum order with {name}", { name }), caveat: "check the minimum order quantity" },
  moq: { kind: "check_moq", label: (t, name) => t("Check whether {name}'s minimum order works for you", { name }), caveat: "check the minimum order quantity" },
  freight: { kind: "get_freight", label: (t, name) => t("Get a transport cost for {name}", { name }), caveat: "add the cost of transport" },
  import: {
    kind: "check_import",
    label: (t, _name, a) => (a.country ? t("Check duties and import costs from {country}", { country: countryName(a.country, t.locale) }) : t("Check duties and import costs")),
    caveat: "check import costs",
  },
  payment: { kind: "check_payment", label: (t, name) => t("Weigh {name}'s payment terms against yours today", { name }), caveat: "consider the shorter payment terms" },
  specs_unknown: { kind: "check_specs", label: (t, name) => t("Confirm {name}'s product matches your specifications", { name }), caveat: "confirm the specifications match" },
  quality: { kind: "validate_quality", label: (t, name) => t("Ask {name} for a sample to validate quality", { name }), caveat: "validate quality" },
};

/** Where a suggested check is carried out in the app, and what the button says. */
export interface ActionStep {
  label: Msg;
  target: "compare" | "quote" | "product" | "purchase";
}

export function actionStep(kind: ActionKind): ActionStep {
  switch (kind) {
    case "request_quote":
    case "second_source":
    case "update_quote":
      return { label: "Add quote", target: "quote" };
    case "check_price":
    case "confirm_price":
      return { label: "Check price", target: "product" };
    case "add_purchases":
      return { label: "Add purchase", target: "purchase" };
    case "record_fx":
      return { label: "Complete data", target: "compare" };
    default:
      return { label: "Compare suppliers", target: "compare" };
  }
}

/** What decides whether an offer is real comes before what merely changes its terms. */
const FOLLOW_UP_ORDER: FlagKey[] = ["expired", "old", "specs_differ", "moq_annual", "moq", "freight", "import", "specs_unknown", "quality", "payment"];

/** Flags worth a follow-up, most decisive first. A longer lead time or a currency is a fact to weigh, not a task. */
function followUps(a: DecisionAlternative) {
  return FOLLOW_UP_ORDER.flatMap((key) => {
    const flag = a.flags.find((x) => x.key === key && x.tone === "warn");
    const step = FOLLOW_UP[key];
    return flag && step ? [{ flag, step }] : [];
  });
}

// ---------------- One product ----------------

export interface DecisionContext {
  suppliers: Map<string, SupplierIntel>;
  cfg: IntelConfig;
  /** The language of the sentences; English when left out. */
  t?: T;
}

// ---------------- Side-by-side comparison ----------------

/** One supplier in the Compare view: the few things a buyer weighs, on the same basis. */
export interface CompareColumn extends Omit<DecisionAlternative, "differencePct"> {
  isCurrent: boolean;
  /** vs the price paid today, in %. Null for the current supplier. */
  differencePct: number | null;
  /**
   * What this offer is the best at, stated as a fact ("Shortest lead time").
   * Never a verdict: which supplier to buy from is the buyer's judgement.
   */
  highlights: string[];
}

/** The current supplier first, then the alternatives in the order of the product summary. */
export function compareColumns(p: ProductIntel, cfg: IntelConfig, t: T = en): CompareColumn[] {
  const current = p.comparison.find((r) => r.isCurrent) ?? null;
  const ctx: AlternativeContext = { current, annualQuantity: p.metrics.annualQuantity, typicalOrderQuantity: p.typicalOrderQuantity, unit: p.product.unit, cfg, t };
  const columns: CompareColumn[] = [];
  if (current && current.price != null && current.kind) {
    columns.push({
      supplierId: current.supplier.id,
      supplierName: current.supplier.name,
      country: current.supplier.country,
      kind: current.kind,
      quotedPrice: current.price,
      currency: current.currency ?? "EUR",
      priceEUR: p.price.current?.price ?? current.priceEUR,
      date: p.price.current?.date ?? current.date,
      differencePct: null,
      estimatedTrueCost: null,
      potentialSaving: null,
      confidence: null,
      comparability: "comparable",
      notComparableReason: null,
      leadTimeDays: current.leadTimeDays,
      moq: current.moq,
      paymentTermsDays: current.paymentTermsDays,
      incoterm: current.incoterm,
      flags: [],
      setAside: false,
      opportunityKey: null,
      isCurrent: true,
      highlights: [],
    });
  }
  const alternatives = rankAlternatives(
    p.comparison.flatMap((r) => toAlternative(r, p, ctx) ?? []),
    p.bestSaving?.alternativeSupplierId ?? null,
  );
  for (const a of alternatives) columns.push({ ...a, isCurrent: false, highlights: [] });

  // A highlight needs something to be compared with, and a single holder.
  const award = (label: Msg, value: (c: CompareColumn) => number | null, pick: "min" | "max", among = columns) => {
    const known = among.filter((c) => value(c) != null && c.comparability !== "not");
    if (known.length < 2) return;
    const best = known.reduce((m, c) => ((pick === "min" ? value(c)! < value(m)! : value(c)! > value(m)!) ? c : m));
    if (known.filter((c) => value(c) === value(best)).length === 1) best.highlights.push(t(label));
  };
  award("Lowest quoted price", (c) => c.estimatedTrueCost ?? c.priceEUR, "min");
  award("Shortest lead time", (c) => c.leadTimeDays, "min");
  award("Lowest minimum order", (c) => c.moq, "min");
  award("Most recent quote", (c) => (c.kind === "quote" && c.date ? Date.parse(c.date) : null), "max", columns.filter((c) => !c.isCurrent));
  return columns;
}

export function productDecision(p: ProductIntel, ctx: DecisionContext): ProductDecision {
  const { cfg } = ctx;
  const t = ctx.t ?? en;
  const { product, metrics, price } = p;
  const unit = product.unit;
  const o = cfg.overview;

  const currentRow = p.comparison.find((r) => r.isCurrent) ?? null;
  const currentPrice = price.current?.price ?? null;
  const supplierIntel = currentRow ? ctx.suppliers.get(currentRow.supplier.id) : undefined;
  const currentSupplier = currentRow
    ? {
        id: currentRow.supplier.id,
        name: currentRow.supplier.name,
        country: currentRow.supplier.country,
        paymentTermsDays: currentRow.paymentTermsDays,
        leadTimeDays: currentRow.leadTimeDays,
        since: supplierIntel?.metrics.firstPurchaseDate ?? null,
        orders12m: supplierIntel?.orders.ordersLast12m ?? 0,
      }
    : null;

  // ---- Alternatives
  const altCtx: AlternativeContext = { current: currentRow, annualQuantity: metrics.annualQuantity, typicalOrderQuantity: p.typicalOrderQuantity, unit, cfg, t };
  const allAlternatives = rankAlternatives(
    p.comparison.flatMap((r) => toAlternative(r, p, altCtx) ?? []),
    p.bestSaving?.alternativeSupplierId ?? null,
  );
  const alternatives = allAlternatives.slice(0, o.maxAlternatives);
  const best = p.bestSaving ? (allAlternatives.find((a) => a.supplierId === p.bestSaving!.alternativeSupplierId) ?? null) : null;
  const potentialSaving = p.bestSaving?.potentialSaving ?? null;
  const savingMaterial = potentialSaving != null && potentialSaving >= o.minMaterialSaving;
  const market = marketReference(p);

  const priced = allAlternatives.filter((a) => a.priceEUR != null && !a.setAside);
  const cheapest = priced.length ? priced.reduce((m, a) => (a.priceEUR! < m.priceEUR! ? a : m)) : null;
  const first = allAlternatives[0] ?? null;
  let cheapestNotFirst: ProductDecision["cheapestNotFirst"] = null;
  if (cheapest && first && cheapest !== first && first.priceEUR != null && cheapest.priceEUR! < first.priceEUR) {
    const reasons = cheapest.flags.filter((x) => x.tone === "warn" && x.key !== "quality").slice(0, 3).map((x) => x.label.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase()));
    cheapestNotFirst = {
      supplierName: cheapest.supplierName,
      price: cheapest.priceEUR!,
      explanation: t("{name} has the lowest quoted price ({price}), but it is not listed first: {reasons}. Its true cost has not been estimated yet.", {
        name: cheapest.supplierName,
        price: per(cheapest.priceEUR, unit),
        reasons: reasons.length ? list(t, reasons) : t("the comparison is less reliable"),
      }),
    };
  }

  // ---- Supply risk
  const sourcing = p.concentration.sourcing;
  const suppliersUsed = p.concentration.shares.length;
  const alternativesQuoted = allAlternatives.length;
  const share = `${pct1(p.spendShare * 100)}%`;
  const supplyRisk: ProductDecision["supplyRisk"] =
    sourcing === "none"
      ? { level: "unknown", label: t("No purchases"), detail: t("No purchases on record."), suppliers: 0, alternativesQuoted }
      : sourcing === "single"
        ? {
            level: p.highSpend ? "high" : "moderate",
            label: t("Single source"),
            detail: `${p.highSpend ? t("{share} of your spend is bought from one supplier", { share }) : t("Bought from one supplier")} · ${
              alternativesQuoted ? t.n(alternativesQuoted, "{n} other supplier on file", "{n} other suppliers on file") : t("no other supplier on file")
            }.`,
            suppliers: 1,
            alternativesQuoted,
          }
        : {
            level: "low",
            label: t("{n} suppliers", { n: suppliersUsed }),
            detail: t("Bought from {n} suppliers; the largest has {pct}% of the spend.", { n: suppliersUsed, pct: pct1(p.concentration.shares[0].share * 100) }),
            suppliers: suppliersUsed,
            alternativesQuoted,
          };

  // ---- Status (cost side only)
  const trendPct = price.changes.m12.pct;
  const stale = metrics.status === "review" && currentPrice != null;
  let status: DecisionStatus;
  let statusReason: string;
  if (currentPrice == null) {
    status = "needs_cost";
    statusReason = t("No purchase price on record yet.");
  } else if (p.currentPriceFlagged) {
    status = "review";
    statusReason = t("The last price looks unusual — check the data first.");
  } else if (savingMaterial && p.bestSaving!.confidence === "high") {
    status = "action";
    statusReason = t("A comparable, recent offer is below what you pay.");
  } else if (savingMaterial) {
    status = "review";
    statusReason = t("A lower quote exists, but the comparison is not fully reliable yet.");
  } else if (p.alert) {
    status = "review";
    statusReason = t(price.changes.m12.partial ? "Price up {pct}% since your first purchase on record." : "Price up {pct}% in 12 months.", { pct: pct1(trendPct!) });
  } else if (product.mapped === false || product.kind === "needs_review") {
    status = "needs_classification";
    statusReason = t("Its name and category still come from the invoice: confirm what it is.");
  } else if (stale) {
    status = "needs_history";
    statusReason = t("No purchase in the last 6 months — the price may be outdated.");
  } else if (market.type === "not_available" && (alternativesQuoted || p.highSpend)) {
    status = "needs_alternative";
    statusReason = alternativesQuoted ? t("The offers on file can't be compared yet.") : t("It is among the products that make up most of your spend, and there is no quote from another supplier to compare with.");
  } else if (market.type === "not_available") {
    // Nothing is wrong with a product whose price and supplier are known: a comparison is something more, not something missing.
    status = "ready";
    statusReason = t("Price and supplier known. No other offer to compare with yet.");
  } else if (market.recent === 0) {
    status = "needs_alternative";
    statusReason = t("The quotes on file are too old to judge today's price.");
  } else {
    status = "good";
    statusReason = t("No significant issue identified.");
  }

  // ---- Money view: the saving formula, shown as two annual costs
  const money =
    best && best.priceEUR != null && currentPrice != null && potentialSaving != null && metrics.annualQuantity > 0
      ? { currentAnnualCost: currentPrice * metrics.annualQuantity, alternativeAnnualCost: best.priceEUR * metrics.annualQuantity, difference: potentialSaving }
      : null;

  // ---- Next actions
  const actions: NextAction[] = [];
  const supplierLabel = currentSupplier?.name ?? t("your supplier");
  if (currentPrice == null) {
    actions.push({ kind: "add_purchases", label: t("Add or import purchases for this product"), why: [{ label: t("Purchases on record"), value: t("none with a usable price") }] });
  }
  if (p.currentPriceFlagged && currentPrice != null) {
    const out = price.outliers.find((x) => x.purchaseId === price.current!.purchaseId);
    actions.push({
      kind: "check_price",
      label: t("Check the last invoice: the price looks unusual"),
      why: [
        { label: t("Last price"), value: per(currentPrice, unit) },
        ...(out ? [{ label: t("Your usual level"), value: per(out.median, unit) }] : []),
      ],
    });
  }
  if (best && savingMaterial && currentPrice != null && !p.currentPriceFlagged) {
    actions.push({
      kind: "negotiate",
      label: t("Ask {supplier} to review their price", { supplier: supplierLabel }),
      why: [
        { label: t("You pay"), value: `${per(currentPrice, unit)} (${supplierLabel})` },
        {
          label: t(best.comparability === "partial" ? (best.kind === "quote" ? "Partly comparable quote" : "Partly comparable price") : best.kind === "quote" ? "Comparable quote" : "Comparable price"),
          value: `${per(best.priceEUR, unit)} (${best.supplierName})`,
        },
        { label: t("Gap"), value: `${per(currentPrice - best.priceEUR!, unit)} · ${pct1(best.differencePct ?? 0)}%` },
        { label: t("Annual volume"), value: `${qty(metrics.annualQuantity)} ${unit}` },
      ],
    });
    for (const { flag, step } of followUps(best).slice(0, 2)) {
      actions.push({ kind: step.kind, label: step.label(t, best.supplierName, best), why: [{ label: best.supplierName, value: flag.label }] });
    }
  } else if (p.alert && currentPrice != null && !p.currentPriceFlagged) {
    actions.push({
      kind: "explain_increase",
      label: t("Ask {supplier} to explain the increase", { supplier: supplierLabel }),
      why: [
        { label: f.month(price.changes.m12.referenceDate, t), value: per(price.changes.m12.referencePrice, unit) },
        { label: t("Today"), value: per(currentPrice, unit) },
        ...(metrics.changeImpact != null && metrics.changeImpact > 0 ? [{ label: t("Extra cost at your volume"), value: t("{amount}/year", { amount: f.moneyApprox(metrics.changeImpact) }) }] : []),
      ],
    });
  }
  for (const a of allAlternatives.filter((x) => x.comparability === "not" && x.priceEUR == null && x.currency !== "EUR").slice(0, 1)) {
    actions.push({
      kind: "record_fx",
      label: t("Record the exchange rate for {supplier}'s offer", { supplier: a.supplierName }),
      why: [
        { label: t("Offer"), value: `${f.price(a.quotedPrice, a.currency)}/${unit}` },
        { label: t("Exchange rate"), value: t("not on record — the offer can't be compared") },
      ],
    });
  }
  if (currentPrice != null && !savingMaterial && (market.type === "not_available" || market.recent === 0)) {
    actions.push({
      kind: "request_quote",
      label: market.count ? t("Ask for an up-to-date quote from another supplier") : t("Get a quote from another supplier"),
      why: [{ label: t("Comparable quotes on file"), value: market.count ? t("{n}, none recent", { n: market.count }) : t("none") }],
    });
  }
  if (stale) {
    actions.push({ kind: "confirm_price", label: t("Confirm today's price with {supplier}", { supplier: supplierLabel }), why: [{ label: t("Last purchase"), value: f.date(metrics.currentDate) }] });
  }
  if (supplyRisk.level === "high") {
    actions.push({
      kind: "second_source",
      label: alternativesQuoted ? t("Keep a second supplier qualified") : t("Find and qualify a second supplier"),
      why: [
        { label: t("Bought from"), value: t("one supplier ({supplier})", { supplier: supplierLabel }) },
        { label: t("Annual spend"), value: t("{amount} · {share} of the total", { amount: f.money(Math.round(metrics.annualSpend)), share }) },
        { label: t("Other suppliers on file"), value: String(alternativesQuoted) },
      ],
    });
  }
  const nextActions = actions.slice(0, o.maxActions);

  // ---- What is still unknown
  const missingData = p.bestSaving
    ? p.bestSaving.missing
    : [
        ...(currentPrice == null ? [t("A purchase with a usable price")] : []),
        ...(market.type === "not_available" ? [t("A comparable quote from another supplier")] : market.recent === 0 ? [t("A recent quote from another supplier")] : []),
        ...(product.specs && Object.keys(product.specs).length ? [] : [t("Structured specifications for this product")]),
        t("External market benchmark"),
      ];

  // ---- Priority (internal)
  const priceIncreaseCost = p.alert && !p.currentPriceFlagged && (metrics.changeImpact ?? 0) > 0 ? metrics.changeImpact : null;
  const increaseImpact = priceIncreaseCost ?? 0;
  const priority: ProductDecision["priority"] =
    status === "action"
      ? { tier: 1, value: potentialSaving ?? 0 }
      : supplyRisk.level === "high"
        ? { tier: 2, value: metrics.annualSpend }
        : status === "review"
          ? { tier: 3, value: Math.max(savingMaterial ? (potentialSaving ?? 0) : 0, increaseImpact) }
          : isDataGap(status)
            ? { tier: 4, value: metrics.annualSpend }
            : { tier: 5, value: metrics.annualSpend };

  const quoteDates = p.comparison.filter((r) => r.kind === "quote" && r.date).map((r) => r.date!);
  const d: ProductDecision = {
    productId: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    unit,
    status,
    statusReason,
    currentSupplier,
    currentPrice,
    currentPriceDate: price.current?.date ?? null,
    currentPriceFlagged: p.currentPriceFlagged,
    priceTrend: {
      pct: trendPct,
      referencePrice: price.changes.m12.referencePrice,
      referenceDate: price.changes.m12.referenceDate,
      partial: price.changes.m12.partial,
      alert: p.alert,
    },
    priceIncreaseCost,
    annualQuantity: metrics.annualQuantity,
    annualSpend: metrics.annualSpend,
    spendShare: p.spendShare,
    highSpend: p.highSpend,
    market,
    alternatives,
    alternativesTotal: allAlternatives.length,
    best,
    cheapestNotFirst,
    money,
    potentialSaving,
    savingConfidence: p.bestSaving?.confidence ?? null,
    savingMaterial,
    opportunityStatus: p.bestSaving?.status ?? null,
    opportunityKey: p.bestSaving?.key ?? null,
    supplyRisk,
    dataConfidence: p.quality.level,
    dataConfidenceReasons: p.quality.factors.filter((x) => x.state !== "ok").map((x) => x.detail),
    missingData,
    nextActions,
    summary: [],
    lastUpdated: { purchases: metrics.currentDate, quotes: quoteDates.length ? quoteDates.reduce((a, b) => (b > a ? b : a)) : null },
    priority,
  };
  d.summary = easySummary(d, t);
  return d;
}

// ---------------- Plain-language summary ----------------

/**
 * At most five short sentences, in the order an owner asks: what do I pay and to
 * whom, how did it move, how does it compare, what else is there, how much is
 * at stake, what is the catch. Rules and templates — no language model — so
 * the same data always gives the same words.
 */
export function easySummary(d: ProductDecision, t: T = en): string[] {
  const s: string[] = [];
  const unit = d.unit;
  if (d.currentPrice == null) {
    s.push(t("There are no purchases with a usable price for this product yet, so there is nothing to assess."));
    if (d.alternativesTotal) {
      s.push(t.n(d.alternativesTotal, "{n} offer is on file and will be compared as soon as a purchase is recorded.", "{n} offers are on file and will be compared as soon as a purchase is recorded."));
    }
    return s;
  }

  // What you pay, to whom, and how it moved
  const to = d.currentSupplier ? t(" to {supplier}", { supplier: d.currentSupplier.name }) : "";
  const trend = d.priceTrend;
  const since = f.month(trend.referenceDate, t);
  let moved: string;
  if (trend.pct == null) moved = t(". There is only one purchase on record, so no price history yet");
  else if (Math.abs(trend.pct) < 0.05) moved = t(", unchanged since {month}", { month: since });
  else if (trend.partial) moved = t(trend.pct > 0 ? ", {pct}% more than at your first purchase on record ({month})" : ", {pct}% less than at your first purchase on record ({month})", { pct: pct1(trend.pct), month: since });
  else moved = t(trend.pct > 0 ? ", {pct}% more than 12 months ago" : ", {pct}% less than 12 months ago", { pct: pct1(trend.pct) });
  s.push(t("You pay {price}{to}{moved}.", { price: per(d.currentPrice, unit), to, moved }));
  if (d.currentPriceFlagged) s.push(t("This last price is far from your usual level and may be a data error: check it before relying on the figures here."));

  // How it compares
  const m = d.market;
  if (m.type === "internal_quotes" && m.position) {
    // "Prices", not "quotes": another supplier's price may be one you actually paid.
    const one: Record<"within" | "above" | "below", Msg> = {
      within: "That is in line with the one other supplier's price on file ({range}).",
      above: "That is above the one other supplier's price on file ({range}).",
      below: "That is below the one other supplier's price on file ({range}).",
    };
    const many: Record<"within" | "above" | "below", Msg> = {
      within: "That is within the range of the {n} other suppliers' prices on file ({range}).",
      above: "That is above all {n} other suppliers' prices on file ({range}).",
      below: "That is below all {n} other suppliers' prices on file ({range}).",
    };
    s.push(t((m.count === 1 ? one : many)[m.position], { n: m.count, range: range(m.low, m.high, unit) }));
  }

  // The alternative and what it is worth
  const best = d.best;
  if (best && d.savingMaterial && d.potentialSaving != null) {
    s.push(
      t(
        best.comparability === "partial"
          ? "The most relevant alternative on file is {who} at {price} — about {pct}% less, or roughly {amount} a year at your current volume."
          : "The best comparable alternative on file is {who} at {price} — about {pct}% less, or roughly {amount} a year at your current volume.",
        {
          who: best.country ? `${best.supplierName} (${countryName(best.country, t.locale)})` : best.supplierName,
          price: per(best.priceEUR, unit),
          pct: pct1(best.differencePct ?? 0),
          amount: f.moneyApprox(d.potentialSaving),
        },
      ),
    );
  } else if (best && d.potentialSaving != null) {
    s.push(t("The lowest comparable price is only about {amount} a year below what you pay: not a meaningful opportunity at current volumes.", { amount: f.moneyApprox(d.potentialSaving) }));
  } else if (m.type === "internal_quotes" && m.recent > 0) {
    s.push(t("Your price appears broadly in line with the comparisons available. No meaningful price opportunity has been identified at current volumes."));
  } else if (m.type === "internal_quotes") {
    s.push(t("The other prices on file are too old to say whether today's price is competitive."));
  } else if (d.alternativesTotal) {
    const why = d.alternatives.find((a) => a.notComparableReason)?.notComparableReason;
    s.push(
      why
        ? t.n(d.alternativesTotal, "{n} offer from another supplier is on file but can't be compared yet ({why}).", "{n} offers from other suppliers are on file but can't be compared yet ({why}).", { why: lowerFirst(why) })
        : t.n(d.alternativesTotal, "{n} offer from another supplier is on file but can't be compared yet.", "{n} offers from other suppliers are on file but can't be compared yet."),
    );
  } else {
    s.push(t("We know what you pay and how the price has moved, but there is no comparable price from another supplier yet, so we cannot say whether a saving is possible."));
  }

  if (d.cheapestNotFirst) {
    s.push(
      t("{name} quotes even less ({price}), but that offer is harder to compare and its true cost is not estimated yet.", {
        name: d.cheapestNotFirst.supplierName,
        price: per(d.cheapestNotFirst.price, unit),
      }),
    );
  }

  // The catch
  if (best && d.savingMaterial) {
    const caveats = [...new Set(followUps(best).map((x) => x.step.caveat))].slice(0, 2);
    s.push(t("This is a price comparison only: before treating it as a saving, {caveats}.", { caveats: list(t, caveats.map((c) => t(c))) }));
  }
  // Kept short: the supply block on the card says it anyway.
  if (d.supplyRisk.level === "high" && s.length < 5) {
    s.push(t("Everything is bought from one supplier, and this product is {pct}% of your purchasing spend.", { pct: pct1(d.spendShare * 100) }));
  }
  return s;
}

// ---------------- The whole page ----------------

export interface OverviewOpportunity {
  key: string;
  productId: string;
  productName: string;
  /** EUR/year. */
  amount: number;
  /** True: a potential saving. False: the yearly cost of a price increase or gap. */
  isSaving: boolean;
  confidence: Confidence | null;
  reason: string;
}

export interface RecentChange {
  date: string;
  daysAgo: number;
  productId: string;
  productName: string;
  kind: "price" | "quote";
  text: string;
  /** Price changes only, in %. */
  pct: number | null;
}

export interface PurchasingOverview {
  asOf: string;
  /** Highest priority first. */
  products: ProductDecision[];
  totals: {
    annualSpend: number;
    productsTotal: number;
    /** Products with a price to analyse. */
    productsAnalyzed: number;
    /** One alternative per product, high or medium confidence, still open. */
    potentialSavings: number;
    highConfidenceSavings: number;
    /** Opportunities the user marked as validated. */
    validatedSavings: number;
    productsToReview: number;
    byStatus: Record<DecisionStatus, number>;
    /** Products with enough data to judge the price (every status but "data needed"). */
    productsJudged: number;
  };
  topOpportunities: OverviewOpportunity[];
  recentChanges: RecentChange[];
  supplyRisks: { productId: string; name: string; annualSpend: number; spendShare: number; supplierName: string | null; alternativesQuoted: number }[];
  concentration: {
    topN: number;
    topProductsShare: number;
    /** Products with spend in the last 12 months. */
    productsWithSpend: number;
    topSupplier: { name: string; share: number } | null;
    singleSourceSpend: number;
    singleSourceProducts: number;
  };
  /** The first check of the highest-priority products, with what is at stake. */
  checkFirst: {
    productId: string;
    productName: string;
    status: DecisionStatus;
    action: NextAction;
    /** Why this product is on the list. */
    reason: string;
    /** EUR/year: a potential saving, or what a price increase costs. */
    impact: number | null;
    impactKind: "saving" | "increase" | null;
    /** The percentage behind it: the alternative vs what you pay, or the 12-month price change. */
    pct: number | null;
    /** Where the action is carried out. */
    step: ActionStep;
  }[];
  executiveSummary: string[];
  lastUpdated: { purchases: string | null; quotes: string | null };
}

/** Default order of the page: where to look first. */
export function byPriority(a: ProductDecision, b: ProductDecision) {
  return a.priority.tier - b.priority.tier || b.priority.value - a.priority.value || b.annualSpend - a.annualSpend || a.name.localeCompare(b.name);
}

export function purchasingOverview(intel: Intel, t: T = en): PurchasingOverview {
  const cfg = intel.config;
  const o = cfg.overview;
  const suppliers = new Map(intel.suppliers.map((s) => [s.supplier.id, s]));
  const ctx: DecisionContext = { suppliers, cfg, t };
  const byId = new Map(intel.products.map((p) => [p.product.id, p]));
  const products = intel.products.map((p) => productDecision(p, ctx)).sort(byPriority);
  const name = (id: string) => byId.get(id)?.product.name ?? t("Unknown product");

  // ---- Totals
  const byStatus: Record<DecisionStatus, number> = { action: 0, review: 0, needs_classification: 0, needs_cost: 0, needs_history: 0, needs_alternative: 0, ready: 0, good: 0 };
  let highConfidenceSavings = 0;
  let validatedSavings = 0;
  for (const d of products) {
    byStatus[d.status]++;
    if (d.potentialSaving == null) continue;
    if (d.savingConfidence === "high") highConfidenceSavings += d.potentialSaving;
    if (d.opportunityStatus === "validated") validatedSavings += d.potentialSaving;
  }

  // ---- Top opportunities, in plain words
  const top: OverviewOpportunity[] = topOpportunities(intel, 5).map((op) => {
    const who = op.alternativeSupplierId ? (suppliers.get(op.alternativeSupplierId)?.supplier.name ?? t("another supplier")) : null;
    const reason =
      op.type === "lower_quote"
        ? t(op.comparability === "partial" ? "A partly comparable quote from {who} is below what you pay." : "A comparable quote from {who} is below what you pay.", { who })
        : op.type === "price_increase"
          ? t("The price went up {pct}% in 12 months.", { pct: pct1(op.priceDifferencePct ?? 0) })
          : op.type === "above_average"
            ? t("You pay {pct}% more than your own average.", { pct: pct1(op.priceDifferencePct ?? 0) })
            : op.reason;
    return { key: op.key, productId: op.productId, productName: name(op.productId), amount: op.impact!, isSaving: op.potentialSaving != null, confidence: op.confidence, reason };
  });

  // ---- What changed recently
  const changes: RecentChange[] = [];
  const daysAgo = (date: string) => Math.round((Date.parse(intel.asOf) - Date.parse(date)) / 86_400_000);
  for (const p of intel.products) {
    for (const e of p.price.timeline) {
      const ago = daysAgo(e.date);
      if (e.pct == null || ago < 0 || ago > o.recentDays) continue;
      const who = suppliers.get(e.supplierId)?.supplier.name ?? t("supplier");
      changes.push({ date: e.date, daysAgo: ago, productId: p.product.id, productName: p.product.name, kind: "price", text: t(e.pct > 0 ? "{who} price up" : "{who} price down", { who }), pct: e.pct });
    }
    for (const r of p.comparison) {
      if (r.isCurrent || r.kind !== "quote" || r.ageDays == null || r.ageDays > o.recentDays) continue;
      changes.push({ date: r.date!, daysAgo: r.ageDays, productId: p.product.id, productName: p.product.name, kind: "quote", text: t("Quote received from {supplier}", { supplier: r.supplier.name }), pct: null });
    }
  }
  changes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.productName.localeCompare(b.productName)));

  // ---- Supply
  const risky = products.filter((d) => d.supplyRisk.level === "high").sort((a, b) => b.annualSpend - a.annualSpend);
  const single = intel.products.filter((p) => p.concentration.sourcing === "single");
  const topN = Math.min(o.concentrationTopN, intel.pareto.items.length);
  const topSupplier = intel.spendBySupplier[0];

  // ---- What to check first: one step per product, in page order
  const checkFirst = products
    .flatMap((d) =>
      d.nextActions[0] && d.status !== "good"
        ? [
            {
              productId: d.productId,
              productName: d.name,
              status: d.status,
              action: d.nextActions[0],
              reason: d.statusReason,
              impact: d.savingMaterial ? d.potentialSaving : d.priceIncreaseCost,
              impactKind: d.savingMaterial ? ("saving" as const) : d.priceIncreaseCost != null ? ("increase" as const) : null,
              pct: d.savingMaterial ? (d.best?.differencePct ?? null) : d.priceTrend.alert ? d.priceTrend.pct : null,
              // "Compare suppliers" needs someone to compare with.
              step: d.alternativesTotal === 0 && actionStep(d.nextActions[0].kind).target === "compare" ? actionStep("request_quote") : actionStep(d.nextActions[0].kind),
            },
          ]
        : [],
    )
    .slice(0, 3);

  const totals = {
    annualSpend: intel.totals.annualSpend,
    productsTotal: products.length,
    productsAnalyzed: products.filter((d) => d.currentPrice != null).length,
    potentialSavings: intel.totals.potentialSavings,
    highConfidenceSavings,
    validatedSavings,
    productsToReview: byStatus.action + byStatus.review,
    byStatus,
    productsJudged: byStatus.action + byStatus.review + byStatus.good,
  };

  const purchaseDates = products.flatMap((d) => (d.lastUpdated.purchases ? [d.lastUpdated.purchases] : []));
  const quoteDates = products.flatMap((d) => (d.lastUpdated.quotes ? [d.lastUpdated.quotes] : []));
  const latest = (dates: string[]) => (dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null);

  const overview: PurchasingOverview = {
    asOf: intel.asOf,
    products,
    totals,
    topOpportunities: top,
    recentChanges: changes.slice(0, 6),
    supplyRisks: risky.map((d) => ({
      productId: d.productId,
      name: d.name,
      annualSpend: d.annualSpend,
      spendShare: d.spendShare,
      supplierName: d.currentSupplier?.name ?? null,
      alternativesQuoted: d.supplyRisk.alternativesQuoted,
    })),
    concentration: {
      topN,
      topProductsShare: topN ? intel.pareto.items[topN - 1].cumulativeShare : 0,
      productsWithSpend: intel.pareto.items.length,
      topSupplier: topSupplier ? { name: topSupplier.label, share: topSupplier.share } : null,
      singleSourceSpend: single.reduce((s, p) => s + p.metrics.annualSpend, 0),
      singleSourceProducts: single.length,
    },
    checkFirst,
    executiveSummary: [],
    lastUpdated: { purchases: latest(purchaseDates), quotes: latest(quoteDates) },
  };
  overview.executiveSummary = executiveSummary(overview, intel, t);
  return overview;
}

/** The decision summary of one product (what the Overview card shows). */
export function decisionFor(intel: Intel, productId: string, t: T = en): ProductDecision | null {
  const p = intel.products.find((x) => x.product.id === productId);
  return p ? productDecision(p, { suppliers: new Map(intel.suppliers.map((s) => [s.supplier.id, s])), cfg: intel.config, t }) : null;
}

/** Five to seven sentences that stand on their own, without opening a single card. */
export function executiveSummary(ov: PurchasingOverview, intel: Intel, t: T = en): string[] {
  const s: string[] = [];
  const tot = ov.totals;
  if (tot.productsTotal === 0) return [t("No products yet. Import invoices or spreadsheets to see where your purchasing money goes.")];
  const activeSuppliers = intel.spendBySupplier.length;
  s.push(
    tot.annualSpend > 0
      ? t("You spent {amount} on purchases in the last 12 months, across {products} and {suppliers}.", {
          amount: f.money(Math.round(tot.annualSpend)),
          products: t.n(tot.productsAnalyzed, "{n} product", "{n} products"),
          suppliers: t.n(activeSuppliers, "{n} supplier", "{n} suppliers"),
        })
      : t.n(tot.productsTotal, "{n} product on file, with no purchases in the last 12 months.", "{n} products on file, with no purchases in the last 12 months."),
  );

  const parts: string[] = [];
  if (tot.productsToReview) parts.push(t.n(tot.productsToReview, "{n} product shows a price opportunity or a price increase worth a look", "{n} products show a price opportunity or a price increase worth a look"));
  const uncompared = tot.productsTotal - tot.productsJudged;
  if (uncompared) parts.push(t.n(uncompared, "{n} product has nothing to be compared with yet", "{n} products have nothing to be compared with yet"));
  if (tot.byStatus.good) parts.push(t.n(tot.byStatus.good, "{n} product looks fairly priced", "{n} products look fairly priced"));
  if (parts.length) s.push(`${upperFirst(parts.join("; "))}.`);

  if (tot.potentialSavings > 0) {
    const amount = f.moneyApprox(tot.potentialSavings);
    s.push(
      tot.highConfidenceSavings <= 0
        ? t("About {amount} a year of potential savings has been identified, none of it yet supported by high-confidence comparable quotes. These compare prices only: transport, duties and quality checks are not included.", { amount })
        : Math.round(tot.highConfidenceSavings) >= Math.round(tot.potentialSavings)
          ? t("About {amount} a year of potential savings has been identified, all of it supported by high-confidence comparable quotes. These compare prices only: transport, duties and quality checks are not included.", { amount })
          : t("About {amount} a year of potential savings has been identified, of which {high} is supported by high-confidence comparable quotes. These compare prices only: transport, duties and quality checks are not included.", {
              amount,
              high: f.moneyApprox(tot.highConfidenceSavings),
            }),
    );
    const categories = [
      ...new Set(
        ov.products
          .filter((d) => d.savingMaterial && d.savingConfidence !== "low" && d.opportunityStatus !== "rejected" && d.opportunityStatus !== "closed")
          .sort((a, b) => (b.potentialSaving ?? 0) - (a.potentialSaving ?? 0))
          .map((d) => d.category?.trim() || d.name),
      ),
    ].slice(0, 3);
    if (categories.length) {
      s.push(t(categories.length === 1 ? "The largest opportunity is in {where}." : "The largest opportunities are in {where}.", { where: list(t, categories.map((c) => c.toLowerCase())) }));
    }
  } else {
    s.push(t("No potential saving has been identified yet: that needs comparable quotes from other suppliers."));
  }

  if (ov.supplyRisks.length) {
    s.push(t.n(ov.supplyRisks.length, "{n} high-spend product is bought from a single supplier.", "{n} high-spend products are bought from a single supplier."));
  }
  const first = ov.checkFirst[0];
  if (first) s.push(t("First thing to look at: {product} — {action}.", { product: first.productName, action: lowerFirst(first.action.label) }));
  return s;
}

// ---------------- Filters and sorting ----------------

export type OverviewSort = "priority" | "spend" | "saving";

export const OVERVIEW_SORTS: { key: OverviewSort; label: Msg }[] = [
  { key: "priority", label: "Priority" },
  { key: "spend", label: "Annual spend" },
  { key: "saving", label: "Potential saving" },
];

export interface OverviewQuery {
  status?: string | null;
  supplierId?: string | null;
  category?: string | null;
  search?: string | null;
  sort?: string | null;
}

export function filterDecisions(products: ProductDecision[], q: OverviewQuery): ProductDecision[] {
  const search = q.search?.trim().toLowerCase();
  const out = products.filter((d) => {
    if (q.status && q.status in DECISION_STATUS && d.status !== q.status) return false;
    if (q.supplierId && d.currentSupplier?.id !== q.supplierId && !d.alternatives.some((a) => a.supplierId === q.supplierId)) return false;
    if (q.category && (d.category ?? "").toLowerCase() !== q.category.toLowerCase()) return false;
    if (search && !`${d.name} ${d.sku} ${d.category ?? ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const material = (d: ProductDecision) => (d.savingMaterial ? (d.potentialSaving ?? 0) : 0);
  if (q.sort === "spend") return out.sort((a, b) => b.annualSpend - a.annualSpend || a.name.localeCompare(b.name));
  if (q.sort === "saving") return out.sort((a, b) => material(b) - material(a) || byPriority(a, b));
  return out.sort(byPriority);
}
