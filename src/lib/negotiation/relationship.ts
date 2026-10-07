/**
 * The relationship with a supplier as the invoices show it: everything the
 * company buys from it, not only the product being negotiated. A buyer that
 * spends a million on one product and another hundred thousand on five more
 * from the same supplier sits at the table differently from one that buys
 * the single product.
 *
 * Spend is never counted twice. What the relationship adds to a product's own
 * volume is the spend on the supplier's *other* products — total minus this
 * product — plus what cannot be put in euros: how many products and groups,
 * how regular the orders, how long it has lasted.
 *
 * Pure: it reads purchases and the catalogue. It knows nothing of the
 * supplier's side — its size, its margins — and says so.
 */
import { baseTotal, daysBetween, isPriced, windowStart, type ProductData, type PurchaseData } from "../analytics";
import { KIND_GROUP_LABEL, isProductKind } from "../catalog/kinds";
import * as f from "../format";
import { en, list, type Msg, type T } from "../i18n";
import { NEGOTIATION_CONFIG, type NegotiationConfig } from "./config";
import type { Level } from "./engine";

export interface RelationshipFacts {
  supplierId: string;
  /** EUR bought from the supplier in the last 12 months on file, over every catalogue product. */
  supplierSpend: number;
  /** Of which on this product. The rest is the cross-category spend. */
  productSpend: number;
  /** What turns the spend on file into a year: 1 with a full year on file, more with less, null with too little to tell. */
  annualFactor: number | null;
  /** Months of purchase history the company has on file. */
  historyMonths: number;
  /** Catalogue products bought from the supplier in the period, this one included. */
  products: number;
  /** The groups those products fall in: their category where the catalogue has one, the kind of purchase otherwise. */
  groups: { name: string; label: Msg | null }[];
  /** Every product bought has a category of its own: the groups are categories, not kinds. */
  groupsAreCategories: boolean;
  /** Distinct dates with a purchase from the supplier in the period, and the usual gap between them. */
  purchaseDates: number;
  everyDays: number | null;
  /** The first purchase from the supplier on file: the relationship may be older than that. */
  firstPurchase: string | null;
  monthsWithSupplier: number | null;
  /** The share of the company's catalogue spend that goes to this supplier (0–1). */
  supplierShare: number | null;
  /** This product alone: distinct purchase dates in the period and the usual gap between them. */
  productDates: number;
  productEveryDays: number | null;
}

/** Thresholds of the facts themselves; how they are scored lives in config.ts. */
const MIN_DAYS_TO_ANNUALIZE = 60;
const MIN_DATES_FOR_INTERVAL = 3;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const usualGap = (dates: string[]) => (dates.length >= MIN_DATES_FOR_INTERVAL ? Math.max(1, Math.round(median(dates.slice(1).map((d, i) => daysBetween(dates[i], d))))) : null);
const distinct = (xs: string[]) => [...new Set(xs)].sort();

/**
 * What the invoices say of the relationship behind one product. `purchases`
 * and `products` are the catalogue's: transport and services a supplier bills
 * are spend, not products to negotiate together. `coverage` is the first and
 * last purchase date of everything the company has on file.
 */
export function relationshipFacts(data: { purchases: PurchaseData[]; products: ProductData[] }, productId: string, supplierId: string | null, asOf: string, coverage?: { from: string; to: string } | null): RelationshipFacts | null {
  if (!supplierId) return null;
  const start = windowStart(asOf);
  const priced = data.purchases.filter(isPriced);
  // How much history there is: the company's whole purchase history when given (the same the product data annualizes on).
  const all = data.purchases.map((p) => p.date).sort();
  const span = coverage ?? (all.length ? { from: all[0], to: all.at(-1)! } : null);
  const days = span ? daysBetween(span.from, span.to) + 1 : 0;
  const inWindow = priced.filter((p) => p.date > start);
  const fromSupplier = inWindow.filter((p) => p.supplierId === supplierId);
  const spend = (xs: typeof priced) => xs.reduce((s, p) => s + baseTotal(p), 0);
  const supplierSpend = spend(fromSupplier);
  const total = spend(inWindow);
  const bought = new Set(fromSupplier.map((p) => p.productId));
  bought.add(productId);
  const items = data.products.filter((p) => bought.has(p.id));
  const groupsAreCategories = items.length > 0 && items.every((p) => !!p.category?.trim());
  const groups = new Map<string, { name: string; label: Msg | null }>();
  for (const p of items) {
    const category = p.category?.trim();
    // A product the catalogue has not placed yet is counted by what kind of purchase it is.
    if (category) groups.set(`c:${category.toLowerCase()}`, { name: category, label: null });
    else groups.set(`k:${p.kind ?? "needs_review"}`, { name: p.kind ?? "needs_review", label: isProductKind(p.kind) ? KIND_GROUP_LABEL[p.kind] : KIND_GROUP_LABEL.needs_review });
  }
  const everFromSupplier = data.purchases.filter((p) => p.supplierId === supplierId).map((p) => p.date).sort();
  const dates = distinct(fromSupplier.map((p) => p.date));
  const productDates = distinct(fromSupplier.filter((p) => p.productId === productId).map((p) => p.date));
  return {
    supplierId,
    supplierSpend,
    productSpend: spend(fromSupplier.filter((p) => p.productId === productId)),
    annualFactor: days >= 365 ? 1 : days >= MIN_DAYS_TO_ANNUALIZE ? 365 / days : null,
    historyMonths: days / 30.44,
    products: items.length,
    groups: [...groups.values()],
    groupsAreCategories,
    purchaseDates: dates.length,
    everyDays: usualGap(dates),
    firstPurchase: everFromSupplier[0] ?? null,
    monthsWithSupplier: everFromSupplier.length ? (daysBetween(everFromSupplier[0], asOf) + 1) / 30.44 : null,
    supplierShare: total > 0 ? supplierSpend / total : null,
    productDates: productDates.length,
    productEveryDays: usualGap(productDates),
  };
}

// ---------------- Leverage ----------------

export type RelationshipPartKey = "total_spend" | "cross_spend" | "breadth" | "regularity" | "bundle";
export const RELATIONSHIP_PART_LABEL: Record<RelationshipPartKey, Msg> = {
  total_spend: "Total spend with the supplier",
  cross_spend: "Cross-category spend",
  breadth: "Relationship breadth",
  regularity: "Purchase regularity",
  bundle: "Bundle negotiation potential",
};

export interface RelationshipLeverage {
  facts: RelationshipFacts;
  /** EUR in the last 12 months on file. Cross is the total minus this product: nothing is counted twice. */
  onFile: { total: number; product: number; cross: number };
  /** The same over a year: estimated when less than a year is on file, null with too little history to tell. */
  yearly: { total: number; product: number; cross: number; estimated: boolean } | null;
  /** 0–10. Leverage, never a discount. */
  score: number;
  level: Level;
  /** How much the reading can be trusted: never high while nobody has said how much the buyer matters to the supplier. */
  confidence: Level;
  confidenceWhy: string;
  breadth: Level;
  bundle: Level;
  parts: { key: RelationshipPartKey; score: number; weight: number; fact: string }[];
  positives: string[];
  limits: string[];
  /**
   * What the relationship adds to the buyer's leverage: the score without the
   * total spend, whose largest part — this product — is already counted as
   * the product's own volume.
   */
  added: number;
  /** The same for a buyer that bought only this product from the supplier: what the comparison is made with. */
  alone: number;
}

const clamp = (n: number, lo = 0, hi = 10) => Math.min(hi, Math.max(lo, n));
const stepped = (value: number, steps: [number, number][], below: number) => steps.find(([min]) => value >= min)?.[1] ?? below;

/** The five scores of a relationship, from its facts alone. */
function scores(x: RelationshipFacts, cfg: NegotiationConfig) {
  const r = cfg.relationship;
  const factor = x.annualFactor ?? 1;
  const total = x.supplierSpend * factor;
  const cross = Math.max(0, x.supplierSpend - x.productSpend) * factor;
  const others = Math.max(0, x.products - 1);
  const recurring = x.purchaseDates >= r.regularDates;
  const points = (x.products >= 6 ? 3 : x.products >= 4 ? 2 : x.products >= 2 ? 1 : 0) + (x.groups.length >= 3 ? 2 : x.groups.length === 2 ? 1 : 0) + (cross >= r.crossLarge ? 2 : cross >= r.crossMaterial ? 1 : 0) + (recurring ? 1 : 0) + ((x.monthsWithSupplier ?? 0) >= r.stableMonths ? 1 : 0);
  const breadth: Level = points >= 6 ? "high" : points >= 3 ? "medium" : "low";
  const bundle: Level = others >= r.bundleProducts && (cross >= r.crossMaterial || (total > 0 && cross / total >= r.bundleShare)) ? "high" : others >= 1 && cross > 0 ? "medium" : "low";
  return {
    total,
    cross,
    others,
    breadth,
    bundle,
    parts: {
      total_spend: stepped(total, r.totalSteps, 2),
      cross_spend: cross <= 0 ? 1 : stepped(cross, r.crossSteps, 2),
      breadth: clamp(1 + points),
      regularity: clamp((x.purchaseDates >= r.manyDates ? 9 : recurring ? 7 : x.purchaseDates >= 3 ? 5 : 3) + (x.everyDays != null && x.everyDays <= r.monthlyDays ? 1 : 0)),
      bundle: bundle === "high" ? 8 : bundle === "medium" ? 5 : 2,
    } satisfies Record<RelationshipPartKey, number>,
  };
}

const KEYS: RelationshipPartKey[] = ["total_spend", "cross_spend", "breadth", "regularity", "bundle"];
const weighted = (parts: Record<RelationshipPartKey, number>, keys: RelationshipPartKey[], cfg: NegotiationConfig) => keys.reduce((s, k) => s + parts[k] * cfg.relationship.weights[k], 0) / keys.reduce((s, k) => s + cfg.relationship.weights[k], 0);

/**
 * How much the whole relationship with the supplier weighs at the table.
 * `importance` is what a person says of how much the buyer matters to the
 * supplier: nothing on file can tell, so without it the score is capped and
 * its confidence held down.
 */
export function relationshipLeverage(x: RelationshipFacts, ctx: { supplier: string | null; importance: Level | null }, t: T = en, cfg: NegotiationConfig = NEGOTIATION_CONFIG): RelationshipLeverage {
  const r = cfg.relationship;
  const supplier = ctx.supplier ?? t("the supplier");
  const s = scores(x, cfg);
  // The same buyer, had it bought only this product: the relationship reduced to it.
  const alone = scores({ ...x, supplierSpend: x.productSpend, products: 1, groups: x.groups.slice(0, 1), purchaseDates: x.productDates, everyDays: x.productEveryDays }, cfg);
  const adjust = (n: number) => (ctx.importance === "high" ? clamp(n + 1) : ctx.importance === "low" ? clamp(n - 2) : ctx.importance === "medium" ? n : Math.min(n, r.unknownImportanceCap));
  const score = adjust(weighted(s.parts, KEYS, cfg));
  const beyond = KEYS.filter((k) => k !== "total_spend");

  const estimated = x.annualFactor != null && x.annualFactor !== 1;
  const onFile = { total: x.supplierSpend, product: x.productSpend, cross: Math.max(0, x.supplierSpend - x.productSpend) };
  const yearly = x.annualFactor == null ? null : { total: onFile.total * x.annualFactor, product: onFile.product * x.annualFactor, cross: onFile.cross * x.annualFactor, estimated };
  const months = f.number(x.historyMonths, 1);
  const amount = (n: number) => (yearly ? (estimated ? t("about {amount} a year, estimated from {months} months on file", { amount: f.moneyApprox(n), months }) : t("{amount} in the last 12 months", { amount: f.money(Math.round(n)) })) : t("{amount} on file: too little history to tell a year", { amount: f.money(Math.round(n)) }));
  const products = t.n(x.products, "{n} product", "{n} products");
  const groups = x.groupsAreCategories ? t.n(x.groups.length, "{n} category", "{n} categories") : t.n(x.groups.length, "{n} kind of purchase", "{n} kinds of purchase");
  const fact: Record<RelationshipPartKey, string> = {
    total_spend: amount(yearly?.total ?? onFile.total),
    cross_spend: onFile.cross > 0 ? amount(yearly?.cross ?? onFile.cross) : t("Nothing besides this product"),
    breadth: `${products}, ${groups}`,
    regularity: x.everyDays != null ? t("{n} purchase dates on file, about every {days}", { n: x.purchaseDates, days: f.days(x.everyDays, t) }) : t.n(x.purchaseDates, "{n} purchase date on file", "{n} purchase dates on file"),
    bundle: s.others > 0 ? t.n(s.others, "{n} other product bought from the same supplier", "{n} other products bought from the same supplier") : t("No other product bought from this supplier"),
  };

  const positives: string[] = [];
  const limits: string[] = [];
  const perYear = f.moneyApprox(s.total);
  if (s.total >= cfg.largeSpend) positives.push(yearly ? t("About {amount} a year with {supplier}, over everything you buy from it.", { amount: perYear, supplier }) : t("{amount} with {supplier} on file, over everything you buy from it.", { amount: perYear, supplier }));
  if (s.cross > 0 && s.others > 0) positives.push(t.n(s.others, "About {amount} a year on {n} other product from the same supplier, beyond this one.", "About {amount} a year on {n} other products from the same supplier, beyond this one.", { amount: f.moneyApprox(s.cross) }));
  if (s.bundle !== "low") positives.push(t("You buy {n} products from {supplier}: negotiating them together may increase your leverage.", { n: x.products, supplier }));
  if (s.breadth === "high") positives.push(t("A broad relationship: {products}, {groups}.", { products, groups }));
  if (s.parts.regularity >= 7) positives.push(x.everyDays != null ? t("Recurring orders with {supplier}: about every {days}.", { supplier, days: f.days(x.everyDays, t) }) : t("Recurring orders with {supplier}: {n} purchase dates on file.", { supplier, n: x.purchaseDates }));
  if (ctx.importance === "high") positives.push(t("You said you are an important customer for {supplier}.", { supplier }));

  if (ctx.importance == null) limits.push(t("How much you matter to {supplier} as a customer is not known: its size is not on file.", { supplier }));
  else if (ctx.importance === "low") limits.push(t("You said you are a small customer for {supplier}.", { supplier }));
  limits.push(t("The supplier's margins on each product are not known."));
  if (s.others === 0) limits.push(t("This is the only product you buy from {supplier}: the relationship adds little to its volume.", { supplier }));
  if (x.historyMonths < r.shortHistoryMonths) limits.push(t("Only {months} months of purchases on file: how stable the relationship is cannot be told yet.", { months }));

  const short = x.historyMonths < r.shortHistoryMonths;
  const confidence: Level = ctx.importance != null ? (x.historyMonths >= r.stableMonths ? "high" : "medium") : short ? "low" : "medium";
  const why = [...(ctx.importance == null ? [t("how much you matter to the supplier is not known")] : []), ...(x.historyMonths < r.stableMonths ? [t("{months} months of history on file", { months })] : [])];
  return {
    facts: x,
    onFile,
    yearly,
    score,
    level: score >= r.level.high ? "high" : score >= r.level.medium ? "medium" : "low",
    confidence,
    confidenceWhy: why.length ? t("Held down because: {reasons}.", { reasons: list(t, why) }) : t("A year or more of purchases on file, and your own word on how much you matter to the supplier."),
    breadth: s.breadth,
    bundle: s.bundle,
    parts: KEYS.map((key) => ({ key, score: s.parts[key], weight: r.weights[key], fact: fact[key] })),
    positives,
    limits,
    added: adjust(weighted(s.parts, beyond, cfg)),
    alone: adjust(weighted(alone.parts, beyond, cfg)),
  };
}
