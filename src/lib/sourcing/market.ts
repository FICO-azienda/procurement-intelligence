/**
 * Market intelligence for one product: what the company pays and has paid,
 * every piece of outside evidence on file with its kind and source, the range
 * that evidence supports, where the current price sits against it, and what
 * to do next.
 *
 * What this module never does:
 *  - show a "market price": a range exists only when comparable evidence
 *    does, and it carries its sources, date and confidence;
 *  - call a gap a saving: it is a theoretical opportunity until a comparable
 *    quote confirms it — and with thin evidence no amount is given at all;
 *  - compare what is not comparable: a price in another unit or currency,
 *    or of a product whose specification nobody checked, is shown, not used.
 */
import { daysBetween } from "../analytics";
import * as f from "../format";
import { en, type T } from "../i18n";
import type { ProductDecision } from "../intel/decision";
import type { ProductIntel } from "../intel/engine";
import { CONFIDENCE_WORD } from "../intel/summary";
import { conversionFactor, normalizeUnit } from "../import/normalize/units";
import { priceOnOurBasis, rankCandidates, topCandidates, type RankedCandidate } from "./discovery";
import { REGIONS, type Region } from "./regions";
import { screenCandidates, type Materiality, type Screening } from "./screening";
import {
  PRICE_TYPE_LABEL,
  SOURCING_CONFIG,
  type Comparability,
  type Confidence,
  type MarketBenchmark,
  type MarketPosition,
  type PriceType,
  type SourceLevel,
  type SourcingConfig,
  type SourcingStatus,
  type SupplierCandidate,
} from "./types";

export interface PriceObservation {
  key: string;
  type: PriceType;
  /** EUR per product unit. Null for a cost driver (a movement, not a level) or a price that can't be put on our basis. */
  low: number | null;
  high: number | null;
  /** As written at the source, when it could not be converted ("USD 1,450–1,520/t"). */
  asWritten: string | null;
  /** Who or what it is from. */
  label: string;
  detail: string | null;
  date: string | null;
  sourceLevel: SourceLevel;
  sourceName: string | null;
  sourceUrl: string | null;
  comparability: Comparability | null;
  recent: boolean;
  /** Counted in the range. */
  used: boolean;
}

export interface InternalHistory {
  latest: { price: number; date: string; supplierName: string | null } | null;
  weightedAverage: number | null;
  low: { price: number; date: string } | null;
  high: { price: number; date: string } | null;
  observations: number;
  movement: { pct: number | null; since: string | null; partial: boolean };
  suppliers: { id: string; name: string; share: number }[];
  annualSpend: number;
  annualQuantity: number;
}

export interface MarketRange {
  /** EUR per product unit. */
  low: number;
  high: number;
  confidence: Confidence;
  observations: number;
  /** Of which highly comparable. */
  comparable: number;
  sources: { type: PriceType; count: number }[];
  latestDate: string | null;
  /** Enough comparable evidence to call it a market range and place the current price against it. Otherwise it is one benchmark, or an indication. */
  reliable: boolean;
  /** Built only from indirect evidence (published indications, trade data): never enough for an amount. */
  indirect: boolean;
}

export type NextKind = "find_suppliers" | "request_quotes" | "record_quotes" | "firm_up" | "keep_updated" | "validate" | "decide" | "add_purchases";

export interface MarketView {
  productId: string;
  name: string;
  unit: string;
  currentPrice: number | null;
  currentSupplier: { id: string; name: string; country: string | null } | null;
  history: InternalHistory;
  observations: PriceObservation[];
  range: MarketRange | null;
  position: MarketPosition;
  /** The current price against the top and the bottom of the range, in %. */
  gapPct: { low: number; high: number } | null;
  /** EUR a year at current volume, price only. Null when the evidence does not support an amount. */
  opportunity: { low: number; high: number } | null;
  opportunityNote: string | null;
  candidates: RankedCandidate[];
  /** The funnel: every candidate placed, and the few recommended for a request for quotation. */
  screening: Screening;
  materiality: Materiality;
  top: RankedCandidate[];
  byRegion: { region: Region; candidates: RankedCandidate[] }[];
  counts: { active: number; strong: number; comparable: number; withPrice: number; rejected: number };
  status: SourcingStatus;
  next: { kind: NextKind; label: string };
  missing: string[];
  summary: string[];
}

export interface MarketInput {
  intel: ProductIntel;
  decision: ProductDecision;
  candidates: SupplierCandidate[];
  benchmarks: MarketBenchmark[];
  homeCountry: string | null;
  asOf: string;
  /** How much the product weighs on the spend. Defaults to a priority product outside the first round. */
  materiality?: Materiality;
}

export const perUnit = (n: number, unit: string) => `${f.priceShort(n)}/${unit}`;
/** A range as it is shown: "€1,34–€1,42/kg" — or one price, when both ends are the same once rounded. */
export const rangeText = (low: number, high: number, unit: string) => (f.priceShort(low) === f.priceShort(high) ? perUnit(low, unit) : `${f.priceShort(low)}–${f.priceShort(high)}/${unit}`);
/** A benchmark's price per unit of the product, in EUR — null when its currency has no rate on file or its unit can't be converted. */
export function benchmarkOnOurBasis(b: Pick<MarketBenchmark, "low" | "high" | "currency" | "unit" | "fxRate">, productUnit: string): { low: number; high: number } | null {
  if (b.low == null || b.high == null) return null;
  const rate = (b.currency ?? "EUR").toUpperCase() === "EUR" ? 1 : b.fxRate;
  if (!rate) return null;
  const from = b.unit ? (normalizeUnit(b.unit) ?? b.unit) : productUnit;
  const factor = from === productUnit ? 1 : conversionFactor(from, productUnit);
  return factor ? { low: b.low / rate / factor, high: b.high / rate / factor } : null;
}

/** A percentage without decimals nobody can vouch for. */
const roughPct = (n: number) => `${Math.round(n)}%`;

export function marketView(input: MarketInput, t: T = en, cfg: SourcingConfig = SOURCING_CONFIG): MarketView {
  const { intel: p, decision: d, asOf } = input;
  const unit = p.product.unit;
  const current = d.currentPrice;
  const supplierName = (id: string) => p.comparison.find((r) => r.supplier.id === id)?.supplier.name ?? null;
  const recentEnough = (date: string | null) => !!date && daysBetween(date, asOf) <= cfg.maxAgeDays;

  // ---- 1. What the company already knows: its own purchases.
  const history: InternalHistory = {
    latest: p.price.current ? { price: p.price.current.price, date: p.price.current.date, supplierName: supplierName(p.price.current.supplierId) ?? d.currentSupplier?.name ?? null } : null,
    weightedAverage: p.price.weightedAveragePrice,
    low: p.price.low ? { price: p.price.low.price, date: p.price.low.date } : null,
    high: p.price.high ? { price: p.price.high.price, date: p.price.high.date } : null,
    observations: p.price.observations,
    movement: { pct: p.price.changes.m12.pct, since: p.price.changes.m12.referenceDate, partial: p.price.changes.m12.partial },
    suppliers: p.concentration.shares.map((s) => ({ id: s.supplierId, name: supplierName(s.supplierId) ?? "", share: s.share })),
    annualSpend: d.annualSpend,
    annualQuantity: d.annualQuantity,
  };

  // ---- 2. Every piece of evidence, each with its kind and source.
  const observations: PriceObservation[] = [];
  if (history.latest) {
    observations.push({
      key: "current",
      type: "actual",
      low: history.latest.price,
      high: history.latest.price,
      asWritten: null,
      label: history.latest.supplierName ?? t("Current supplier"),
      detail: t("What you pay today"),
      date: history.latest.date,
      sourceLevel: "invoice",
      sourceName: null,
      sourceUrl: null,
      comparability: null,
      recent: true,
      used: false,
    });
  }
  // Prices from other suppliers on file: quotes received, or prices paid to someone else.
  for (const r of p.comparison.filter((x) => !x.isCurrent && x.priceEUR != null)) {
    const recent = !r.expired && r.age !== "old";
    observations.push({
      key: `offer:${r.supplier.id}`,
      type: r.kind === "quote" ? "quote" : "actual",
      low: r.priceEUR,
      high: r.priceEUR,
      asWritten: null,
      label: r.supplier.name,
      detail: r.comparability === "comparable" ? null : (r.comparabilityReasons[0] ?? null),
      date: r.date,
      sourceLevel: r.kind === "quote" ? "quote" : "invoice",
      sourceName: r.sourceDoc?.filename ?? null,
      sourceUrl: null,
      comparability: r.comparability,
      recent,
      used: recent && r.comparability !== "not",
    });
  }
  for (const b of input.benchmarks) {
    const ours = b.type === "cost_driver" ? null : benchmarkOnOurBasis(b, unit);
    const level = ours != null;
    const foreign = (b.currency ?? "EUR").toUpperCase() !== "EUR";
    const written = b.low != null ? `${b.currency} ${f.number(b.low)}${b.high != null && b.high !== b.low ? `–${f.number(b.high)}` : ""}/${b.unit ?? unit}` : null;
    const recent = recentEnough(b.sourceDate);
    observations.push({
      key: `benchmark:${b.id}`,
      type: b.type,
      low: ours?.low ?? null,
      high: ours?.high ?? null,
      asWritten: b.type === "cost_driver" && b.changePct != null ? `${b.changePct > 0 ? "+" : ""}${f.number(b.changePct, 1)}%${b.period ? ` · ${b.period}` : ""}` : !level ? written : null,
      label: b.label,
      detail:
        [
          foreign && level && b.fxDate ? t("{written} at the source, converted at the reference rate of {date} ({rate} {currency} for one euro).", { written: written!, date: f.date(b.fxDate), rate: f.number(b.fxRate!, 4), currency: b.currency }) : null,
          foreign && !level && b.type !== "cost_driver" ? t("In {currency}: no exchange rate on file yet, so it is not compared.", { currency: b.currency }) : null,
          b.type === "trade_benchmark" ? t("The average value of everything imported under this customs code, at the border{period}: not the price of one product, and transport to you is not in it.", { period: b.period ? `, ${b.period}` : "" }) : null,
          b.notes,
        ]
          .filter(Boolean)
          .join(" ") || null,
      date: b.sourceDate,
      sourceLevel: b.sourceLevel,
      sourceName: b.sourceName,
      sourceUrl: b.sourceUrl,
      comparability: b.type === "cost_driver" ? null : b.comparability,
      recent,
      // A published reference for this product counts; trade data only when there is nothing better; an estimate or a cost driver never does.
      used: level && recent && b.comparability !== "not" && (b.type === "direct_benchmark" || b.type === "trade_benchmark"),
    });
  }
  const ranked = rankCandidates(input.candidates, { unit, typicalOrderQuantity: p.typicalOrderQuantity, annualQuantity: d.annualQuantity || null, homeCountry: input.homeCountry }, t);
  for (const r of ranked.filter((x) => x.candidate.priceLow != null && x.candidate.status !== "rejected")) {
    const c = r.candidate;
    const basis = priceOnOurBasis(c, unit);
    const recent = recentEnough(c.sourceDate);
    observations.push({
      key: `candidate:${c.id}`,
      type: c.priceType ?? "indicative",
      low: basis?.low ?? null,
      high: basis?.high ?? null,
      asWritten: basis ? null : `${c.currency ?? "EUR"} ${f.number(c.priceLow!)}${c.priceHigh !== c.priceLow ? `–${f.number(c.priceHigh!)}` : ""}/${c.unit ?? "?"}`,
      label: c.name,
      detail: r.reasons[0] ?? null,
      date: c.sourceDate,
      sourceLevel: c.sourceLevel,
      sourceName: null,
      sourceUrl: c.priceSourceUrl ?? c.sourceUrl,
      comparability: r.comparability,
      recent,
      used: !!basis && recent && r.comparability === "comparable",
    });
  }

  // ---- 3. The range the evidence supports. Offers and direct benchmarks first; indirect evidence only when there is nothing else.
  const direct = observations.filter((o) => o.used && (o.type === "quote" || o.type === "actual" || o.type === "direct_benchmark"));
  const indirect = observations.filter((o) => o.used && !direct.includes(o));
  // Real offers, and references known to be for the same product, make the range. A reference that is only partly comparable stands in while there is nothing better — and steps aside as soon as there is.
  const solid = direct.filter((o) => o.type === "quote" || o.type === "actual" || o.comparability === "comparable");
  const basis = solid.length ? solid : direct.length ? direct : indirect;
  for (const o of observations) if (o.used && !basis.includes(o)) o.used = false;
  let range: MarketRange | null = null;
  if (basis.length) {
    const comparable = basis.filter((o) => o.comparability === "comparable").length;
    const types = new Map<PriceType, number>();
    for (const o of basis) types.set(o.type, (types.get(o.type) ?? 0) + 1);
    range = {
      low: Math.min(...basis.map((o) => o.low!)),
      high: Math.max(...basis.map((o) => o.high!)),
      // Several recent, comparable observations: high. Two that hold together: medium. One, or indirect evidence only: low.
      confidence: !direct.length ? "low" : comparable >= cfg.highConfidenceObservations ? "high" : basis.length >= 2 ? "medium" : "low",
      observations: basis.length,
      comparable,
      // A range needs several observations — or one real, comparable offer. One published reference is a benchmark, not a market.
      reliable: solid.length >= cfg.rangeObservations || solid.some((o) => (o.type === "quote" || o.type === "actual") && o.comparability === "comparable"),
      sources: [...types.entries()].map(([type, count]) => ({ type, count })),
      latestDate: basis.reduce<string | null>((latest, o) => (o.date && (!latest || o.date > latest) ? o.date : latest), null),
      indirect: !direct.length,
    };
  }

  // ---- 4. Where the current price sits, and what the distance is worth.
  // Compare what the user sees: prices rounded as displayed.
  const shown = (n: number) => Number(n.toFixed(4));
  let position: MarketPosition = "insufficient";
  let gapPct: MarketView["gapPct"] = null;
  if (range && current != null) {
    const [c, lo, hi] = [shown(current), shown(range.low), shown(range.high)];
    const aboveTop = ((c - hi) / hi) * 100;
    // A position is a statement about the market: only a reliable range supports one.
    if (range.reliable) position = c < lo ? "below" : c <= hi ? "in_line" : aboveTop <= cfg.slightlyAbovePct ? "slightly_above" : "materially_above";
    gapPct = { low: aboveTop, high: ((c - lo) / lo) * 100 };
  }
  const above = position === "slightly_above" || position === "materially_above";
  let opportunity: MarketView["opportunity"] = null;
  let opportunityNote: string | null = null;
  if (!range || current == null) opportunityNote = t("No comparable evidence to measure a gap against.");
  else if (!range.reliable) opportunityNote = range.indirect ? t("The evidence is indirect: too thin to put an amount on the gap.") : t("One external reference, not confirmed for your specification and delivery terms, is not enough to put an amount on the gap: ask for comparable quotes.");
  else if (!above && !(position === "in_line" && current > range.low)) opportunityNote = t("Your price is not above the comparable evidence.");
  else if (range.confidence === "low") opportunityNote = range.indirect ? t("The evidence is indirect: too thin to put an amount on the gap.") : t("One observation is too thin to put an amount on the gap: get a second comparable quote.");
  else if (d.annualQuantity <= 0) opportunityNote = t("No purchases in the last 12 months to size the gap with.");
  else opportunity = { low: Math.max(0, current - range.high) * d.annualQuantity, high: Math.max(0, current - range.low) * d.annualQuantity };

  // ---- 5. Alternative suppliers: placed on the funnel, a few recommended.
  const active = ranked.filter((r) => r.candidate.status !== "rejected");
  const materiality = input.materiality ?? "priority";
  const screening = screenCandidates(
    input.candidates,
    { unit, annualQuantity: d.annualQuantity || null, typicalOrderQuantity: p.typicalOrderQuantity, homeCountry: input.homeCountry, materiality, priceAboveEvidence: !!gapPct && gapPct.high > 0.5, asOf },
    t,
    cfg,
  );
  const counts = {
    active: active.length,
    strong: screening.counts.strong,
    comparable: active.filter((r) => r.comparability === "comparable").length,
    withPrice: active.filter((r) => r.candidate.priceLow != null).length,
    rejected: ranked.length - active.length,
  };
  const byRegion = REGIONS.map((region) => ({ region, candidates: active.filter((r) => r.region === region) })).filter((g) => g.candidates.length > 0);

  // ---- 6. Status and next step.
  const asked = active.some((r) => ["contacted", "quote_requested", "quote_received"].includes(r.candidate.status));
  const status: SourcingStatus =
    // Validating a candidate says it is worth asking; only a checked opportunity validates the product.
    d.opportunityStatus === "validated"
      ? "validated"
      : (above && range!.confidence !== "low") || d.savingMaterial
        ? "opportunity"
        : range
          ? "benchmark_available"
          : asked
            ? "quotes_needed"
            : active.length
              ? "suppliers_found"
              : "no_market_data";
  // A targeted request to the few recommended — or, when none on file is worth it, better candidates first.
  const requestStep: MarketView["next"] = screening.toContact.length
    ? { kind: "request_quotes", label: t.n(screening.toContact.length, "Review the {n} recommended supplier and prepare the request for quotation", "Review the {n} recommended suppliers and prepare the request for quotation") }
    : screening.shortlist.length
      ? { kind: "record_quotes", label: t("Record the quotes as they arrive") }
      : { kind: "find_suppliers", label: t("None of the candidates on file is worth a request yet: look for better ones") };
  const next: MarketView["next"] =
    current == null
      ? { kind: "add_purchases", label: t("Add or import purchases for this product") }
      : status === "validated"
        ? { kind: "decide", label: t("Decide with the validated quote in hand") }
        : status === "opportunity"
          ? { kind: "validate", label: t("Ask for comparable quotes and check the specifications, to confirm the gap") }
          : status === "benchmark_available"
            ? !range!.reliable
              ? // A reference, not a range: only quotes settle it.
                asked
                ? { kind: "record_quotes", label: t("Record the quotes as they arrive") }
                : active.length
                  ? requestStep
                  : { kind: "find_suppliers", label: t("Find alternative suppliers and ask them for a quote") }
              : range!.confidence === "low"
                ? { kind: "firm_up", label: t("Get a second comparable quote, to make the range reliable") }
                : { kind: "keep_updated", label: t("No gap to chase: keep the quotes up to date") }
            : status === "quotes_needed"
              ? { kind: "record_quotes", label: t("Record the quotes as they arrive") }
              : status === "suppliers_found"
                ? requestStep
                : { kind: "find_suppliers", label: t("Find alternative suppliers and ask them for a quote") };

  const missing = [
    ...(current == null ? [t("A purchase price")] : []),
    ...(!active.length ? [t("Alternative suppliers")] : []),
    ...(!direct.length ? [t("A comparable quote from another supplier")] : range && range.confidence !== "high" ? [t("More comparable quotes, to make the range reliable")] : []),
    ...(!input.benchmarks.some((b) => b.type === "direct_benchmark" || b.type === "trade_benchmark") ? [t("An external benchmark")] : []),
    t("Transport, duties and payment terms of the alternatives (true cost)"),
  ];

  // ---- 7. In plain words. Every sentence states what is on file; none adds to it.
  const summary: string[] = [];
  if (current != null && d.currentSupplier) summary.push(t("You buy {product} from {supplier} at {price}: {spend} in the last 12 months.", { product: p.product.name, supplier: d.currentSupplier.name, price: perUnit(current, unit), spend: f.moneyApprox(d.annualSpend) }));
  else if (current == null) summary.push(t("There is no purchase price on record for {product} yet.", { product: p.product.name }));
  if (history.observations >= 2 && history.low && history.high && history.weightedAverage != null) {
    summary.push(t("Over {n} purchases you paid between {low} and {high}, {average} on average.", { n: history.observations, low: f.priceShort(history.low.price), high: perUnit(history.high.price, unit), average: f.priceShort(history.weightedAverage) }));
  }
  if (range && current != null && !range.reliable) {
    const pct = roughPct(Math.abs(gapPct!.high));
    const first = observations.find((o) => o.used)!;
    summary.push(
      `${
        range.indirect
          ? t("Trade statistics on file indicate {range}: an average of many products at the border, not a price for yours.", { range: rangeText(range.low, range.high, unit) })
          : t("One external reference on file ({source}) indicates {range}.", { source: first.sourceName ?? first.label, range: rangeText(range.low, range.high, unit) })
      } ${gapPct!.high > 0.5 ? t("Your price is about {pct} above it, but it is not comparable enough to speak of a market range or of a saving.", { pct }) : gapPct!.high < -0.5 ? t("Your price is about {pct} below it.", { pct }) : t("Your price is in line with it.")}`,
    );
  } else if (range && current != null) {
    const sources = range.sources.map((s) => `${s.count} × ${t(PRICE_TYPE_LABEL[s.type]).toLowerCase()}`).join(", ");
    const where =
      position === "below"
        ? t("Your price is below it.")
        : position === "in_line"
          ? t("Your price is in line with it.")
          : Math.round(gapPct!.low) === Math.round(gapPct!.high)
            ? t("Your price is about {pct} above it.", { pct: roughPct(gapPct!.low) })
            : t("Your price is between {low} and {high} above it.", { low: roughPct(gapPct!.low), high: roughPct(gapPct!.high) });
    summary.push(`${t("The comparable evidence on file ({sources}) is at {range}, with {confidence} confidence.", { sources, range: rangeText(range.low, range.high, unit), confidence: t(CONFIDENCE_WORD[range.confidence]) })} ${where}`);
  } else summary.push(t("There is no comparable price evidence on file, so no market range is shown: nothing is estimated in its place."));
  if (active.length) {
    summary.push(
      `${t.n(active.length, "{n} possible alternative supplier has been identified", "{n} possible alternative suppliers have been identified")}${counts.strong ? `, ${t.n(counts.strong, "{n} a strong match", "{n} of them a strong match")}` : ""}${
        direct.length ? "." : `; ${t("none has given a quote yet")}.`
      }`,
    );
  } else summary.push(t("No alternative supplier has been identified yet."));
  if (opportunity && opportunity.high > 0) {
    summary.push(
      t("At your annual volume the theoretical gap is {amount} a year. It becomes a saving only when a comparable quote confirms it and the true cost is checked.", {
        amount: opportunity.low > 0 && f.moneyApprox(opportunity.low) !== f.moneyApprox(opportunity.high) ? `${f.moneyApprox(opportunity.low)}–${f.moneyApprox(opportunity.high)}` : t("up to {amount}", { amount: f.moneyApprox(opportunity.high) }),
      }),
    );
  }
  summary.push(t("Next step: {action}.", { action: next.label.charAt(0).toLowerCase() + next.label.slice(1) }));

  return {
    productId: p.product.id,
    name: p.product.name,
    unit,
    currentPrice: current,
    currentSupplier: d.currentSupplier ? { id: d.currentSupplier.id, name: d.currentSupplier.name, country: d.currentSupplier.country } : null,
    history,
    observations,
    range,
    position,
    gapPct,
    opportunity,
    opportunityNote,
    candidates: ranked,
    screening,
    materiality,
    top: topCandidates(ranked, cfg),
    byRegion,
    counts,
    status,
    next,
    missing,
    summary,
  };
}

/** The review's order: the largest theoretical gap first, then the largest spend. */
export function byOpportunity(a: MarketView, b: MarketView) {
  return (b.opportunity?.high ?? 0) - (a.opportunity?.high ?? 0) || b.history.annualSpend - a.history.annualSpend || a.name.localeCompare(b.name);
}

export interface SourcingReview {
  products: MarketView[];
  spend: number;
  /** Share of the catalogue's spend these products make up. */
  share: number;
  byStatus: Record<SourcingStatus, number>;
  candidates: number;
  /** Sum of the theoretical gaps that could be estimated. */
  opportunity: { low: number; high: number; products: number };
}

export function sourcingReview(views: MarketView[], catalogueSpend: number): SourcingReview {
  const products = [...views].sort(byOpportunity);
  const byStatus: Record<SourcingStatus, number> = { no_market_data: 0, suppliers_found: 0, quotes_needed: 0, benchmark_available: 0, opportunity: 0, validated: 0 };
  for (const v of products) byStatus[v.status]++;
  const spend = products.reduce((s, v) => s + v.history.annualSpend, 0);
  const withGap = products.filter((v) => v.opportunity && v.opportunity.high > 0);
  return {
    products,
    spend,
    share: catalogueSpend > 0 ? spend / catalogueSpend : 0,
    byStatus,
    candidates: products.reduce((s, v) => s + v.counts.active, 0),
    opportunity: { low: withGap.reduce((s, v) => s + v.opportunity!.low, 0), high: withGap.reduce((s, v) => s + v.opportunity!.high, 0), products: withGap.length },
  };
}
