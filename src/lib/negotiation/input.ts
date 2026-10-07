/**
 * From what the app already knows about a product to what the negotiation
 * engine reads. Nothing is collected again: the price paid and its history
 * come from the intelligence engine, the outside evidence and the candidates
 * from the market view, the offers and their true cost from the true-cost
 * module, volumes, terms and specification from the product dataset — each
 * with the status (confirmed, estimated, missing), source and method it
 * already carries there.
 *
 * Pure. The price paid and the current supplier's terms stay inside: this
 * module only reads them.
 */
import { minusMonths } from "../analytics";
import { countryName } from "../countries";
import { FIELDS, type FieldKey } from "../dataset/fields";
import type { ProductProfile } from "../dataset/profile";
import * as f from "../format";
import { en, type Msg, type T } from "../i18n";
import { UNITS, normalizeUnit } from "../import/normalize/units";
import type { ProductIntel } from "../intel/engine";
import { CLASS_LABEL, type ProductClass } from "../research/strategy";
import type { MarketView } from "../sourcing/market";
import type { Comparability, MarketBenchmark } from "../sourcing/types";
import { NEGOTIATION_CONFIG, type NegotiationConfig } from "./config";
import { dataClassOf } from "./data-class";
import { JUDGEMENT_LABEL, LEVEL_LABEL, negotiate, precisionOf, type Anchor, type InputStatus, type JudgementKey, type Negotiation, type NegotiationInput } from "./engine";
import { RELATIONSHIP_PART_LABEL, type RelationshipFacts } from "./relationship";

/** An offer on file with its true cost, as the true-cost module works it out. */
export interface QuoteEvidence {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  date: string | null;
  /** The quoted price in EUR per product unit. Null: a currency with no rate on file. */
  priceEUR: number | null;
  expired: boolean;
  comparability: Comparability;
  technicalConfirmed: boolean;
  cost: { perUnit: number | null; missing: string[] };
}

export interface NegotiationContext {
  intel: Pick<ProductIntel, "product" | "price" | "metrics">;
  view: MarketView;
  profile: ProductProfile;
  quotes: QuoteEvidence[];
  /** The product's references on file: cost drivers are read from here. */
  benchmarks: MarketBenchmark[];
  productClass: ProductClass;
  /** Why the product is read as that class, and whether the user chose it. */
  classReason: Msg;
  classChosen: boolean;
  /** Everything bought from the product's current supplier, as the invoices show it (relationship.ts). */
  relationship: RelationshipFacts | null;
  customsCodeConfirmed: boolean;
  judgements: NegotiationInput["judgements"];
  asOf: string;
}

/** One input the estimate rests on: what it is, how sure, where it comes from. */
export type FactorGroup = "buyer" | "relationship" | "product" | "competition" | "price" | "terms" | "market";
export const FACTOR_GROUPS: FactorGroup[] = ["buyer", "relationship", "product", "competition", "price", "terms", "market"];
export const FACTOR_GROUP_LABEL: Record<FactorGroup, Msg> = {
  buyer: "Buyer power",
  relationship: "Relationship with the supplier",
  product: "Product|negotiation",
  competition: "Market competition",
  price: "Price intelligence",
  terms: "Commercial terms",
  market: "Market conditions",
};

export interface FactorInput {
  key: string;
  group: FactorGroup;
  label: string;
  value: string | null;
  status: InputStatus;
  source: string | null;
  sourceDate: string | null;
  method: string | null;
}

export type ProductNegotiation = Negotiation & { productId: string; name: string; inputs: FactorInput[] };

const number = (raw: string | null | undefined) => {
  if (raw == null || !raw.trim()) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function negotiationInput(ctx: NegotiationContext, t: T = en, cfg: NegotiationConfig = NEGOTIATION_CONFIG): NegotiationInput {
  const { view, profile, intel } = ctx;
  const unit = view.unit;
  const current = view.history.latest && view.currentPrice != null ? { price: view.currentPrice, date: view.history.latest.date, supplier: view.currentSupplier?.name ?? view.history.latest.supplierName } : null;
  const anchors: Anchor[] = [];

  // Real offers, on true cost when it is complete; on the quoted price, said to be so, when it is not.
  for (const q of ctx.quotes) {
    const whole = q.cost.perUnit != null;
    const value = whole ? q.cost.perUnit : q.priceEUR;
    if (value == null) continue;
    anchors.push({
      key: `quote:${q.quoteId}`,
      kind: "quote",
      dataClass: "real_quote",
      label: q.supplierName,
      low: value,
      high: value,
      date: q.date,
      source: whole ? t("Quote received, on true cost") : t("Quote received, quoted price only"),
      sourceUrl: null,
      comparability: q.comparability,
      recent: view.observations.find((o) => o.key === `offer:${q.supplierId}`)?.recent ?? !q.expired,
      basis: whole ? "true_cost" : "nominal",
      technicalConfirmed: q.technicalConfirmed,
      warning: whole ? null : t("{supplier}: the true cost is incomplete ({missing}), so the quoted price is not yet comparable with what you pay.", { supplier: q.supplierName, missing: q.cost.missing.join(", ").toLowerCase() }),
    });
  }
  // Everything else the market view already holds, each kept for what it is.
  for (const o of view.observations) {
    if (o.key === "current" || o.low == null || o.high == null) continue;
    const kind = o.key.startsWith("offer:") ? (o.type === "actual" ? ("other_supplier" as const) : null) : o.type === "direct_benchmark" ? ("benchmark" as const) : o.type === "trade_benchmark" ? ("trade" as const) : o.type === "indicative" ? ("published_price" as const) : o.type === "estimate" ? ("estimate" as const) : null;
    if (!kind) continue;
    anchors.push({
      key: o.key,
      kind,
      dataClass: dataClassOf(o.type),
      label: o.label,
      low: o.low,
      high: o.high,
      date: o.date,
      source: o.sourceName,
      sourceUrl: o.sourceUrl,
      comparability: o.comparability,
      recent: o.recent,
      basis: kind === "other_supplier" ? "invoice" : kind === "trade" ? "border" : "published",
      technicalConfirmed: false,
      warning: null,
    });
  }
  // The buyer's own invoices: the lowest price paid to the same supplier in the last year, when below today's, and the highest.
  const since = minusMonths(ctx.asOf, cfg.historyWindowMonths);
  const levels = intel.price.timeline;
  const inWindow = levels.filter((e, i) => e.date > since || (levels[i + 1] ? levels[i + 1].date > since : true));
  let recentHigh: { price: number; date: string } | null = null;
  if (current) {
    const half = precisionOf(current.price) / 2;
    const currentSupplierId = intel.price.current?.supplierId ?? null;
    const lower = inWindow.filter((e) => e.supplierId === currentSupplierId && e.price < current.price - half).sort((a, b) => a.price - b.price)[0];
    if (lower) {
      anchors.push({
        key: `history:${lower.purchaseId}`,
        kind: "own_history",
        dataClass: "private_purchase_price",
        label: t("Your own price of {month}", { month: f.month(lower.date, t) }),
        low: lower.price,
        high: lower.price,
        date: lower.date,
        source: t("Your invoices"),
        sourceUrl: null,
        comparability: "comparable",
        recent: true,
        basis: "invoice",
        technicalConfirmed: true,
        warning: null,
      });
    }
    const top = inWindow.filter((e) => e.price > current.price + half).sort((a, b) => b.price - a.price)[0];
    if (top) recentHigh = { price: top.price, date: top.date };
  }

  const field = (key: FieldKey) => profile.fields[key];
  const known = (key: FieldKey) => (field(key).status === "missing" ? null : field(key).raw);
  const freight = known("freight_included");
  const typicalOrder = profile.quantities.typicalOrder;
  const mass = UNITS.find((u) => u.code === (normalizeUnit(unit) ?? unit));
  const strong = view.screening.all.filter((s) => s.stage === "strong");
  return {
    unit,
    productClass: ctx.productClass,
    kind: intel.product.kind ?? null,
    asOf: ctx.asOf,
    current,
    volume: {
      annual: profile.quantities.annual,
      annualStatus: profile.quantities.annualStatus,
      typicalOrder,
      typicalOrderKg: typicalOrder != null && mass?.dimension === "mass" && mass.factor ? typicalOrder * mass.factor : null,
    },
    spendOnFile: view.history.annualSpend,
    relationship: ctx.relationship,
    history: { purchases: intel.metrics.purchaseCount, suppliersUsed: view.history.suppliers.length, trend: intel.price.trend, recentHigh },
    competition: {
      found: view.screening.counts.found,
      plausible: view.screening.counts.plausible,
      strong: strong.length,
      manufacturers: strong.filter((s) => s.candidate.companyType === "manufacturer").length,
      countries: new Set(strong.map((s) => s.candidate.country).filter(Boolean)).size,
    },
    spec: { readiness: profile.rfq.readiness, technical: field("technical_spec").status !== "missing", datasheet: field("datasheet").status !== "missing" },
    terms: {
      paymentDays: number(known("payment_terms")),
      deliveryBasis: known("delivery_basis"),
      freightIncluded: freight == null ? null : /^(y|yes|si|sì|true|1)$/i.test(freight.trim()),
      moq: number(known("moq")),
      leadTimeDays: number(known("lead_time")),
    },
    anchors,
    costDrivers: ctx.benchmarks.filter((b) => b.type === "cost_driver" && b.changePct != null).map((b) => ({ label: b.label, changePct: b.changePct! })),
    customsCodeConfirmed: ctx.customsCodeConfirmed,
    judgements: ctx.judgements,
  };
}

/** Every input the estimate uses, with its status, source, date and method: what is confirmed, what is estimated, what is missing. */
export function factorInputs(ctx: NegotiationContext, result: Negotiation, t: T = en): FactorInput[] {
  const { view, profile, intel } = ctx;
  const out: FactorInput[] = [];
  const fromProfile = (group: FactorGroup, key: FieldKey) => {
    const x = profile.fields[key];
    out.push({ key, group, label: t(FIELDS[key].label), value: x.display, status: x.status, source: x.source?.label ?? null, sourceDate: x.source?.date ?? null, method: x.method ?? x.note });
  };
  const put = (group: FactorGroup, key: string, label: string, value: string | null, status: InputStatus, source: string | null = null, sourceDate: string | null = null, method: string | null = null) => out.push({ key, group, label, value, status, source, sourceDate, method });
  /** A factor a person can correct: the person's word, else the software's estimate, else nothing. */
  const judged = (group: FactorGroup, key: JudgementKey) => {
    const j = result.judgements[key];
    if (j.user) put(group, key, t(JUDGEMENT_LABEL[key].label), t(LEVEL_LABEL[j.user.level]), "confirmed", t("Entered by you"), j.user.date, [j.user.reason, j.system && j.system !== j.user.level ? t("The software had estimated: {level}.", { level: t(LEVEL_LABEL[j.system]).toLowerCase() }) : null].filter(Boolean).join(" ") || null);
    else if (j.system) put(group, key, t(JUDGEMENT_LABEL[key].label), t(LEVEL_LABEL[j.system]), "estimated", t("Rules of the software"), null, j.systemWhy);
    else put(group, key, t(JUDGEMENT_LABEL[key].label), null, "missing", null, null, t("Nothing on file can tell: only you know."));
  };
  const invoices = t("Your invoices");
  const research = t("Supplier research");
  const lastPurchase = view.history.latest?.date ?? null;

  // ---- Buyer power
  fromProfile("buyer", "annual_volume");
  fromProfile("buyer", "typical_order");
  fromProfile("buyer", "purchase_frequency");
  put("buyer", "spend_on_file", t("Spend on file, last 12 months"), view.history.annualSpend > 0 ? f.money(Math.round(view.history.annualSpend)) : null, view.history.annualSpend > 0 ? "confirmed" : "missing", invoices, lastPurchase, t("Sum of the purchases of the last 12 months on file."));
  put("buyer", "suppliers_used", t("Suppliers you buy it from"), view.history.suppliers.length ? view.history.suppliers.map((s) => s.name).join(", ") : null, view.history.suppliers.length ? "confirmed" : "missing", invoices, lastPurchase);

  // ---- Relationship with the supplier: the whole of what is bought from it
  const rel = result.relationship;
  if (rel) {
    const x = rel.facts;
    const yearly = (n: number) => (rel.yearly?.estimated ? ` · ${t("about {amount} a year, estimated from {months} months on file", { amount: f.moneyApprox(n * (x.annualFactor ?? 1)), months: f.number(x.historyMonths, 1) })}` : "");
    const sums = t("Purchases of the last 12 months on file, catalogue products only.");
    put("relationship", "product_spend", t("Spend on this product"), f.money(Math.round(rel.onFile.product)) + yearly(rel.onFile.product), "confirmed", invoices, lastPurchase, sums);
    put("relationship", "supplier_spend", t(RELATIONSHIP_PART_LABEL.total_spend), f.money(Math.round(rel.onFile.total)) + yearly(rel.onFile.total), "confirmed", invoices, lastPurchase, sums);
    put("relationship", "cross_spend", t(RELATIONSHIP_PART_LABEL.cross_spend), f.money(Math.round(rel.onFile.cross)) + yearly(rel.onFile.cross), "confirmed", invoices, lastPurchase, t("Total spend with the supplier minus the spend on this product: nothing is counted twice."));
    put("relationship", "supplier_products", t("Products bought from the supplier"), String(x.products), "confirmed", invoices, lastPurchase, t("Catalogue products with a purchase from the supplier in the last 12 months."));
    put("relationship", "groups", t("Categories bought"), `${x.groups.length} (${x.groups.map((g) => (g.label ? t(g.label) : g.name)).join(", ")})`, x.groupsAreCategories ? "confirmed" : "estimated", x.groupsAreCategories ? t("Your catalogue") : t("Classification rules"), null, x.groupsAreCategories ? null : t("Products without a category yet are counted by kind of purchase."));
    put("relationship", "supplier_frequency", t("Purchase frequency with the supplier"), x.everyDays != null ? t("{n} purchase dates on file, about every {days}", { n: x.purchaseDates, days: f.days(x.everyDays, t) }) : t.n(x.purchaseDates, "{n} purchase date on file", "{n} purchase dates on file"), x.purchaseDates ? "confirmed" : "missing", invoices, lastPurchase, x.everyDays != null ? t("Median interval between distinct purchase dates.") : null);
    put("relationship", "duration", t("Relationship duration"), x.firstPurchase ? t("At least {months} months: first invoice on file {date}", { months: f.number(x.monthsWithSupplier, 1), date: f.date(x.firstPurchase) }) : null, x.firstPurchase ? "estimated" : "missing", invoices, x.firstPurchase, t("From the first invoice on file: the relationship may be older."));
    put("relationship", "supplier_share", t("Share of your product spend that goes to this supplier"), x.supplierShare != null ? `${f.number(x.supplierShare * 100, 0)}%` : null, x.supplierShare != null ? "confirmed" : "missing", invoices, lastPurchase, sums);
    put("relationship", "breadth", t(RELATIONSHIP_PART_LABEL.breadth), t(LEVEL_LABEL[rel.breadth]), "estimated", t("Rules of the software"), null, t("From the products and categories bought, the spend beyond this product, and how recurring and long-standing the orders are."));
    put("relationship", "bundle", t(RELATIONSHIP_PART_LABEL.bundle), t(LEVEL_LABEL[rel.bundle]), "estimated", t("Rules of the software"), null, t("From how many other products you buy from the supplier and what they are worth. A lever to use, not a discount."));
  } else put("relationship", "supplier_spend", t(RELATIONSHIP_PART_LABEL.total_spend), null, "missing", null, null, t("No current supplier on file for this product."));
  judged("relationship", "buyer_importance");
  put("relationship", "supplier_size", t("The supplier's size and margins"), null, "missing", null, null, t("Not on file: nothing here knows the supplier's side."));
  put("relationship", "more_from_supplier", t("What else this supplier could sell you"), null, "missing", null, null, t("Not on file: its range is not known."));

  // ---- Product
  put("product", "class", t("Kind of product"), t(CLASS_LABEL[ctx.productClass]), ctx.classChosen ? "confirmed" : "estimated", ctx.classChosen ? t("Entered by you") : t("Classification rules"), null, t(ctx.classReason));
  fromProfile("product", "technical_spec");
  fromProfile("product", "datasheet");
  for (const key of ["switching_difficulty", "standardization", "criticality"] as const) judged("product", key);

  // ---- Market competition
  const counts = view.screening.counts;
  const found = view.screening.all.map((s) => s.candidate.discoveredAt ?? s.candidate.sourceDate).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const strong = view.screening.all.filter((s) => s.stage === "strong");
  put("competition", "alternatives", t("Alternative suppliers"), counts.found ? t("{found} found, {strong} a strong match", { found: counts.found, strong: strong.length }) : null, counts.found ? "confirmed" : "missing", research, found, counts.found ? t("Candidates on file, screened by what their own pages state.") : t("No research on file for this product."));
  const countries = [...new Set(strong.map((s) => countryName(s.candidate.country, t.locale)).filter((c): c is string => !!c))];
  put("competition", "geography", t("Where the strong alternatives are"), countries.length ? countries.join(", ") : null, countries.length ? "confirmed" : "missing", research, found);
  const makers = strong.filter((s) => s.candidate.companyType === "manufacturer").length;
  put("competition", "manufacturers", t("Manufacturers among them"), strong.length ? String(makers) : null, strong.length ? "confirmed" : "missing", research, found, t("As each company describes itself on its own site."));
  const real = result.anchors.filter((a) => (a.kind === "quote" || a.kind === "other_supplier") && a.role !== "not_used");
  put("competition", "quotes", t("Real offers from other suppliers"), real.length ? real.map((a) => a.label).join(", ") : null, real.length ? "confirmed" : "missing", real.length ? t("Quotes and invoices on file") : null, real.map((a) => a.date).filter((d): d is string => !!d).sort().at(-1) ?? null);

  // ---- Price intelligence
  fromProfile("price", "current_price");
  fromProfile("price", "weighted_average");
  fromProfile("price", "historical_min");
  fromProfile("price", "historical_max");
  const trend = intel.price.trend;
  put("price", "trend", t("Recent price evolution"), trend ? t(trend === "increasing" ? "Rising" : trend === "decreasing" ? "Falling" : "Stable|trend") : null, trend ? "confirmed" : "missing", invoices, lastPurchase, trend ? t("The current price against the average of the purchases before it.") : t("Too few purchases to tell a trend."));
  const byKind = (kind: Anchor["kind"]) => result.anchors.filter((a) => a.kind === kind);
  for (const [kind, key, label] of [
    ["benchmark", "benchmarks", t("External benchmarks")],
    ["trade", "trade", t("Trade statistics")],
    ["published_price", "published", t("Prices published by suppliers")],
  ] as const) {
    const xs = byKind(kind);
    put("price", key, label, xs.length ? xs.map((a) => a.label).join(" · ") : null, xs.length ? "confirmed" : "missing", xs[0]?.source ?? null, xs[0]?.date ?? null);
  }

  // ---- Commercial terms of the current supply
  for (const key of ["delivery_basis", "freight_included", "payment_terms", "moq", "lead_time"] as const) fromProfile("terms", key);
  put("terms", "contract", t("Contract duration"), null, "missing", null, null, t("Not on file: the app holds no contracts yet."));

  // ---- Market conditions: only what a source on file says
  const drivers = ctx.benchmarks.filter((b) => b.type === "cost_driver" && b.changePct != null);
  put("market", "cost_drivers", t("Raw materials and energy"), drivers.length ? drivers.map((b) => `${b.label} ${b.changePct! > 0 ? "+" : ""}${f.number(b.changePct, 1)}%${b.period ? ` (${b.period})` : ""}`).join(" · ") : null, drivers.length ? "confirmed" : "missing", drivers[0]?.sourceName ?? null, drivers[0]?.sourceDate ?? null, drivers.length ? null : t("No cost driver on file for this product."));
  const foreign = ctx.benchmarks.find((b) => b.currency.toUpperCase() !== "EUR" && b.fxRate);
  if (foreign) put("market", "fx", t("Exchange rate"), `${f.number(foreign.fxRate, 4)} ${foreign.currency}/EUR`, "confirmed", t("European Central Bank"), foreign.fxDate, foreign.fxMethod === "month_average" ? t("Average of the month the reference is about.") : t("Reference rate of the day."));
  put("market", "freight_trend", t("Freight rates"), null, "missing", null, null, t("No source connected."));
  put("market", "scarcity", t("Supply scarcity"), null, "missing", null, null, t("No source connected."));
  return out;
}

/** The whole estimate for one product: the engine's answer, with the inputs it rests on. */
export function negotiationFor(ctx: NegotiationContext, t: T = en, cfg: NegotiationConfig = NEGOTIATION_CONFIG): ProductNegotiation {
  const result = negotiate(negotiationInput(ctx, t, cfg), t, cfg);
  return { ...result, productId: ctx.view.productId, name: ctx.view.name, inputs: factorInputs(ctx, result, t) };
}
