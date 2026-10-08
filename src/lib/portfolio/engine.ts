/**
 * Sourcing mix: which combination of suppliers serves a group of products
 * best, for what the buyer wants to obtain. There is no supplier that is
 * right for everything — there are mixes, each good at something and paying
 * for it somewhere else.
 *
 * The rules everything here follows:
 * - a product is given only to a supplier with a price for this buyer: the
 *   price paid, or a real offer. A candidate nobody asked can be counted (it
 *   could cover three products), never allocated;
 * - every mix is read as its advantage over today's, criterion by criterion.
 *   What is not known gives no advantage: a supplier is never preferred on a
 *   lead time, a payment term or a quality nobody wrote down;
 * - covering many products is a bonus next to the cost, never a winner by
 *   itself — and covering one is no handicap;
 * - an advantage is what the prices on file say, called by what stands behind
 *   it (theoretical, to validate, validated). It is never a saving: a saving
 *   is proved by an invoice.
 *
 * Nothing here chooses a supplier: it lays the mixes side by side.
 */
import * as f from "../format";
import { en, list, type T } from "../i18n";
import type { Confidence } from "../intel/opportunities";
import { NEGOTIATION_CONFIG } from "../negotiation/config";
import type { InputStatus, Level, NegotiationStatus } from "../negotiation/engine";
import type { Region } from "../sourcing/regions";
import type { OpportunityLevel } from "../sourcing/true-cost";
import { CRITERIA, CRITERION_LABEL, OBJECTIVES, PORTFOLIO_CONFIG, defaultWeights, type Criterion, type Objective, type PortfolioConfig, type Weights } from "./config";

// ---------------- What goes in ----------------

/** What the price of an option is: paid, a real offer on true cost, a quoted price whose true cost is incomplete — or nothing. */
export type OptionEvidence = "actual" | "true_cost" | "quoted_price" | "none";
/** How far the supplier's fit for the product is established: bought from already, match confirmed, possible, nobody checked. */
export type Qualification = "proven" | "confirmed" | "possible" | "unknown";

export interface SourceOption {
  /** One company, the same key on every product it could supply. */
  key: string;
  name: string;
  country: string | null;
  region: Region;
  /** The supplier the product is bought from today. */
  current: boolean;
  /** A supplier the company already buys from, this product or another. */
  known: boolean;
  evidence: OptionEvidence;
  /** EUR per product unit. Null: no price for this buyer. */
  unitCost: number | null;
  /** What an advantage on this price can be called. */
  level: OpportunityLevel | null;
  qualification: Qualification;
  /** Quality as recorded for this supplier. Null: nothing on file. */
  quality: Level | null;
  certifications: string | null;
  leadTimeDays: number | null;
  paymentDays: number | null;
  moq: number | null;
  /** A candidate from research, and where it stands. Null for a supplier with a price. */
  stage: "strong" | "plausible" | null;
  asked: boolean;
  /** What the true cost of the offer still lacks. */
  missing: string[];
}

export interface PortfolioProduct {
  id: string;
  name: string;
  unit: string;
  /** Category, or the kind of purchase when no category is set. */
  group: string | null;
  annualQuantity: number;
  quantityStatus: InputStatus;
  typicalOrder: number | null;
  currentPrice: number;
  /** Today's supplier first, then the others. */
  options: SourceOption[];
  /** What negotiation intelligence says for the current supplier. */
  negotiation: { status: NegotiationStatus; low: number | null; high: number | null; target: number | null; upsideAnnual: number | null; confidence: Confidence | null } | null;
  criticality: Level | null;
  switching: Level | null;
}

export interface PortfolioInput {
  products: PortfolioProduct[];
  /** What is bought from each supplier outside these products, EUR a year: the rest of the relationship. */
  outside: Record<string, { spend: number; products: number }>;
  /** These products as a share of the catalogue's spend. */
  scopeShare: number | null;
}

export interface Constraints {
  /** No supplier above this share of the spend (0–1). */
  maxShare: number | null;
  maxSuppliers: number | null;
  maxLeadDays: number | null;
  region: "eu" | "home" | null;
  /** Supplier keys left out. */
  exclude: string[];
  /** Products that stay where they are. */
  keep: string[];
  /** Only suppliers whose fit is proven or confirmed. */
  confirmedOnly: boolean;
  /** Critical products need this many suppliers. */
  criticalSources: number | null;
  /** What one more supplier costs to manage, EUR a year. Null: not valued. */
  adminCost: number | null;
}

export const NO_CONSTRAINTS: Constraints = { maxShare: null, maxSuppliers: null, maxLeadDays: null, region: null, exclude: [], keep: [], confirmedOnly: false, criticalSources: null, adminCost: null };

// ---------------- What comes out ----------------

export interface MixSupplier {
  key: string;
  name: string;
  country: string | null;
  /** EUR a year in this mix, and its share. */
  cost: number;
  share: number;
  products: string[];
  current: boolean;
  known: boolean;
}

export interface Measures {
  /** EUR a year at the prices on file. */
  cost: number;
  suppliers: MixSupplier[];
  topShare: number;
  /** Σ share²: 1 is everything with one supplier. */
  consolidation: number;
  concentration: Level;
  /** Spend-weighted, over the products whose figure is on file. */
  lead: { days: number | null; known: number };
  payment: { days: number | null; known: number };
  /** How established the suppliers' fit is, 0–1 by spend. */
  qualification: number;
  /** Share of the spend with a recorded quality. */
  qualityKnown: number;
  risk: { score: number; level: Level; singleSource: number; unproven: number; far: number; shared: number };
  leverage: { score: number; level: Level };
}

export interface AllocationPart {
  key: string;
  name: string;
  share: number;
  unitCost: number;
  evidence: OptionEvidence;
  level: OpportunityLevel | null;
  current: boolean;
  known: boolean;
}

export type Decision = "keep" | "switch" | "negotiate" | "dual_source" | "need_data";

export interface Allocation {
  productId: string;
  name: string;
  unit: string;
  currentSupplier: string;
  currentPrice: number;
  /** EUR a year in this mix. */
  annualCost: number;
  /** Share of today's spend on these products. */
  weight: number;
  parts: AllocationPart[];
  decision: Decision;
  reason: string;
  /** EUR a year against today's supplier at today's price. Negative: it costs more. Null: nothing changes. */
  difference: number | null;
  level: OpportunityLevel | null;
  /** The negotiation target with the current supplier, when the evidence supports one. */
  target: number | null;
}

export type MissingKind = "request_quotes" | "find_suppliers" | "complete_true_cost" | "lead_time" | "payment_terms" | "quality_data" | "confirm_volume" | "confirm_match";
export interface Missing {
  kind: MissingKind;
  label: string;
  productIds: string[];
}

export type ScenarioStatus = "changed" | "unchanged" | "not_enough_data";

export interface Scenario {
  objective: Objective;
  status: ScenarioStatus;
  /** One sentence: what this mix is, or why there is none. */
  headline: string;
  weights: Weights;
  allocation: Allocation[];
  measures: Measures;
  /**
   * EUR a year below today's cost at the prices on file, split by what stands
   * behind it. Never a saving.
   */
  benefit: { total: number; theoretical: number; toValidate: number; validated: number; level: OpportunityLevel | null };
  /** What reaching the negotiation targets with the suppliers that stay would be worth. Always theoretical. */
  negotiationUpside: number | null;
  /** Money kept in (or taken out of) the company by payment terms and stock, EUR. Null: terms not on file. */
  cash: number | null;
  /** What managing more or fewer suppliers is worth, when the user said what one costs. */
  administration: { relationships: number; amount: number | null };
  quality: { status: "insufficient" } | { status: "known"; level: Level };
  confidence: Confidence;
  confidenceWhy: string;
  gains: string[];
  tradeoffs: string[];
  missing: Missing[];
  /** Limits the user set that nothing on file allows to respect. */
  unmet: string[];
  /** Each criterion's advantage over today's mix (−1…1). Null: nothing on file to judge it. */
  advantages: Record<Criterion, number | null>;
}

export interface BundleLine {
  productId: string;
  name: string;
  /** Today's spend on the product, EUR a year. */
  spend: number;
  current: boolean;
  priced: boolean;
  /** EUR a year against today. Null: no price. */
  difference: number | null;
  qualification: Qualification;
}

/** One company and everything it could supply of these products. */
export interface Bundle {
  key: string;
  name: string;
  country: string | null;
  current: boolean;
  known: boolean;
  lines: BundleLine[];
  products: number;
  groups: number;
  spend: number;
  /** Spend covered ÷ spend of all these products. */
  spendShare: number;
  /** Share of the covered spend whose technical fit is proven or confirmed. */
  technicalShare: number;
  /** How much several products together weigh in a negotiation. */
  potential: Level;
  potentialWhy: string;
  /** What the bundle is worth where it has prices. Null: no offer on any new product. */
  value: { amount: number; level: OpportunityLevel | null; priced: number; of: number } | null;
  asked: boolean;
}

export type SpecialistVerdict = "keep" | "ahead" | "ask" | "behind";
export interface Specialist {
  key: string;
  name: string;
  country: string | null;
  productId: string;
  product: string;
  current: boolean;
  specialization: Level;
  why: string;
  /** EUR a year against today. Null: no price, or the current supplier. */
  difference: number | null;
  level: OpportunityLevel | null;
  verdict: SpecialistVerdict;
}

/** A supplier bought from today, and who could take its place on several products. */
export interface CurrentSupplierView {
  key: string;
  name: string;
  products: { id: string; name: string; spend: number }[];
  spend: number;
  share: number;
  outside: { spend: number; products: number };
  /** Companies able to cover two or more of its products. */
  alternatives: { key: string; name: string; products: number; spend: number; share: number; priced: boolean }[];
  /** What this means at the table, in a sentence. */
  note: string;
}

export interface Portfolio {
  today: Scenario;
  scenarios: Scenario[];
  /** The mix worth looking at first, and why. Null: nothing on file supports a mix different from today's. */
  suggested: { objective: Objective; why: string } | null;
  /** What to do when no different mix can be supported. */
  next: string[];
  bundles: Bundle[];
  specialists: Specialist[];
  bySupplier: CurrentSupplierView[];
}

// ---------------- Measuring a mix ----------------

interface Part {
  option: SourceOption;
  share: number;
}
type Choice = Part[];

const clamp = (n: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, n));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const priced = (o: SourceOption) => o.unitCost != null && o.evidence !== "none";
const spendOf = (p: PortfolioProduct) => p.currentPrice * p.annualQuantity;
const currentOf = (p: PortfolioProduct) => p.options.find((o) => o.current)!;
const sameChoice = (a: Choice, b: Choice) => a.length === b.length && a.every((x, i) => x.option.key === b[i].option.key && x.share === b[i].share);
const levelOf = (score: number, steps: { medium: number; high: number }): Level => (score >= steps.high ? "high" : score >= steps.medium ? "medium" : "low");
const stepScore = (value: number, steps: [number, number][], floor: number) => steps.find(([from]) => value >= from)?.[1] ?? floor;
const LEVEL_RANK: Record<OpportunityLevel, number> = { theoretical: 0, to_validate: 1, validated: 2 };

function measure(input: PortfolioInput, mix: Choice[], cfg: PortfolioConfig): Measures {
  const total = sum(input.products.map(spendOf)) || 1;
  const bySupplier = new Map<string, MixSupplier>();
  let cost = 0;
  let lead = 0;
  let leadWeight = 0;
  let leadKnown = 0;
  let pay = 0;
  let payWeight = 0;
  let payKnown = 0;
  let qualification = 0;
  let qualityKnown = 0;
  let single = 0;
  let unproven = 0;
  let far = 0;
  let shared = 0;
  input.products.forEach((p, i) => {
    const w = spendOf(p) / total;
    const parts = mix[i];
    for (const { option: o, share } of parts) {
      const c = p.annualQuantity * share * o.unitCost!;
      cost += c;
      const s = bySupplier.get(o.key) ?? { key: o.key, name: o.name, country: o.country, cost: 0, share: 0, products: [], current: false, known: o.known };
      s.cost += c;
      if (!s.products.includes(p.id)) s.products.push(p.id);
      s.current ||= o.current;
      bySupplier.set(o.key, s);
      qualification += w * share * cfg.qualification[o.qualification];
      if (o.quality) qualityKnown += w * share;
      if (!o.known) unproven += w * share * cfg.risk.switchingFactor[p.switching ?? "medium"];
      far += w * share * (o.region === "asia" || o.region === "other" ? 1 : o.region === "nearby" || o.region === "unknown" ? 0.5 : 0);
    }
    if (parts.every((x) => x.option.leadTimeDays != null)) {
      lead += w * sum(parts.map((x) => x.share * x.option.leadTimeDays!));
      leadWeight += w;
      leadKnown++;
    }
    if (parts.every((x) => x.option.paymentDays != null)) {
      pay += w * sum(parts.map((x) => x.share * x.option.paymentDays!));
      payWeight += w;
      payKnown++;
    }
    // One source only weighs in full; a second priced source left unused, half; a shared product, nothing.
    if (parts.length > 1) shared += w;
    else single += w * (p.options.filter(priced).length > 1 ? cfg.risk.untestedSecondSource : 1);
  });
  const suppliers = [...bySupplier.values()].map((s) => ({ ...s, share: cost > 0 ? s.cost / cost : 0 })).sort((a, b) => b.cost - a.cost);
  const topShare = suppliers[0]?.share ?? 0;
  const concentration: Level = topShare >= cfg.risk.concentration.high ? "high" : topShare >= cfg.risk.concentration.medium ? "medium" : "low";
  const riskScore = Math.min(10, (concentration === "high" ? cfg.risk.concentrationPoints.high : concentration === "medium" ? cfg.risk.concentrationPoints.medium : 0) + cfg.risk.singleSourcePoints * single + cfg.risk.unprovenPoints * unproven + cfg.risk.distancePoints * far);
  // Leverage: what each supplier would be worth to it in a year, with the rest of the relationship, as the negotiation engine reads a supplier's total spend.
  const rel = NEGOTIATION_CONFIG.relationship;
  const leverage = sum(suppliers.map((s) => s.share * stepScore(s.cost + (input.outside[s.key]?.spend ?? 0), rel.totalSteps, 2)));
  return {
    cost,
    suppliers,
    topShare,
    consolidation: sum(suppliers.map((s) => s.share ** 2)),
    concentration,
    lead: { days: leadWeight > 0 ? lead / leadWeight : null, known: leadKnown },
    payment: { days: payWeight > 0 ? pay / payWeight : null, known: payKnown },
    qualification,
    qualityKnown,
    risk: { score: riskScore, level: levelOf(riskScore, cfg.risk.level), singleSource: single, unproven, far, shared },
    leverage: { score: leverage, level: levelOf(leverage, rel.level) },
  };
}

/** Stock held because a minimum order is above the usual one: half the extra, at the price. */
const extraStock = (p: PortfolioProduct, parts: Choice) => sum(parts.map(({ option: o }) => (o.moq != null && p.typicalOrder != null && o.moq > p.typicalOrder ? ((o.moq - p.typicalOrder) / 2) * o.unitCost! : 0)));

/** Money kept in the company (positive) or taken out by a mix's payment terms and stock, against today's. Null: no terms to compare. */
function cashEffect(input: PortfolioInput, mix: Choice[]): number | null {
  let known = false;
  let cash = 0;
  input.products.forEach((p, i) => {
    const cur = currentOf(p);
    const parts = mix[i];
    cash -= extraStock(p, parts) - extraStock(p, [{ option: cur, share: 1 }]);
    if (cur.paymentDays == null || parts.some((x) => x.option.paymentDays == null)) return;
    known = true;
    for (const { option: o, share } of parts) cash += (p.annualQuantity * share * o.unitCost! * (o.paymentDays! - cur.paymentDays)) / 365;
  });
  return known ? cash : null;
}

function advantages(input: PortfolioInput, today: Measures, mix: Choice[], m: Measures, cfg: PortfolioConfig): Record<Criterion, number | null> {
  const total = sum(input.products.map(spendOf)) || 1;
  // Delivery: only where both today's lead time and the mix's are on file.
  let leadBase = 0;
  let leadGain = 0;
  let payBase = 0;
  input.products.forEach((p, i) => {
    const cur = currentOf(p);
    const w = spendOf(p) / total;
    if (cur.leadTimeDays != null && cur.leadTimeDays > 0) {
      leadBase += w * cur.leadTimeDays;
      if (mix[i].every((x) => x.option.leadTimeDays != null)) leadGain += w * (cur.leadTimeDays - sum(mix[i].map((x) => x.share * x.option.leadTimeDays!)));
    }
    if (cur.paymentDays != null) payBase += spendOf(p);
  });
  const cash = cashEffect(input, mix);
  return {
    cost: today.cost > 0 ? clamp((today.cost - m.cost) / today.cost / (cfg.costScalePct / 100)) : null,
    quality: m.qualification - today.qualification,
    delivery: leadBase > 0 ? clamp(leadGain / leadBase) : null,
    risk: (today.risk.score - m.risk.score) / 10,
    coverage: m.consolidation - today.consolidation,
    payment: payBase > 0 && cash != null ? clamp(cash / ((payBase * cfg.cashScaleDays) / 365)) : null,
    leverage: (m.leverage.score - today.leverage.score) / 10,
  };
}

// ---------------- Choosing a mix ----------------

interface Eligibility {
  choices: Choice[];
  unmet: string[];
}

function eligibility(p: PortfolioProduct, c: Constraints, opts: { completeOnly: boolean; splits: boolean }, cfg: PortfolioConfig, t: T): Eligibility {
  const cur = currentOf(p);
  const unmet: string[] = [];
  const inRegion = (o: SourceOption) => !c.region || (c.region === "home" ? o.region === "home" : o.region === "home" || o.region === "eu");
  const withinLead = (o: SourceOption) => c.maxLeadDays == null || (o.leadTimeDays != null && o.leadTimeDays <= c.maxLeadDays);
  const others = c.keep.includes(p.id)
    ? []
    : p.options.filter((o) => !o.current && priced(o) && !(opts.completeOnly && o.evidence === "quoted_price") && !c.exclude.includes(o.key) && inRegion(o) && withinLead(o) && (!c.confirmedOnly || o.qualification === "proven" || o.qualification === "confirmed"));
  // Today's supplier stays an option unless a limit rules it out and someone else can take the product.
  const why = c.exclude.includes(cur.key)
    ? t("{supplier} is excluded, but no other supplier has a price for {product}.", { supplier: cur.name, product: p.name })
    : !inRegion(cur)
      ? t("{supplier} is outside the area you chose, but no supplier inside it has a price for {product}.", { supplier: cur.name, product: p.name })
      : c.maxLeadDays != null && cur.leadTimeDays != null && cur.leadTimeDays > c.maxLeadDays
        ? t("{supplier} delivers {product} in {days}, above your limit, and no faster supplier has a price.", { supplier: cur.name, product: p.name, days: f.days(cur.leadTimeDays, t) })
        : null;
  if (c.maxLeadDays != null && cur.leadTimeDays == null && !c.exclude.includes(cur.key) && inRegion(cur) && !c.keep.includes(p.id)) unmet.push(t("Lead time of {supplier} for {product} is not on file: the limit cannot be checked.", { supplier: cur.name, product: p.name }));
  const kept = c.keep.includes(p.id);
  const pool = why && others.length ? others : [cur, ...others];
  if (why && !others.length && !kept) unmet.push(why);
  const choices: Choice[] = pool.map((o) => [{ option: o, share: 1 }]);
  if (opts.splits) for (const a of pool) for (const b of pool) if (a !== b) choices.push([{ option: a, share: cfg.dualSplit }, { option: b, share: Number((1 - cfg.dualSplit).toFixed(2)) }]);
  return { choices, unmet };
}

/** Mix-level limits a mix breaks, in words. */
function violations(input: PortfolioInput, mix: Choice[], m: Measures, c: Constraints, t: T): string[] {
  const out: string[] = [];
  if (c.maxShare != null && m.topShare > c.maxShare + 1e-9) out.push(t("{supplier} would hold {pct}% of this spend, above your limit of {max}%.", { supplier: m.suppliers[0].name, pct: Math.round(m.topShare * 100), max: Math.round(c.maxShare * 100) }));
  if (c.maxSuppliers != null && m.suppliers.length > c.maxSuppliers) out.push(t("{n} suppliers, above your limit of {max}.", { n: m.suppliers.length, max: c.maxSuppliers }));
  if (c.criticalSources != null && c.criticalSources > 1) {
    input.products.forEach((p, i) => {
      if (p.criticality === "high" && mix[i].length < c.criticalSources!) out.push(t("{product} is critical and has one supplier only.", { product: p.name }));
    });
  }
  return out;
}

interface Chosen {
  mix: Choice[];
  measures: Measures;
  adv: Record<Criterion, number | null>;
  score: number;
  unmet: string[];
}

function choose(input: PortfolioInput, objective: Objective, weights: Weights, c: Constraints, today: Choice[], todayM: Measures, cfg: PortfolioConfig, t: T): Chosen {
  const opts = { completeOnly: objective === "total_value", splits: weights.risk > 0 || c.maxShare != null || (c.criticalSources ?? 0) > 1 };
  const elig = input.products.map((p) => eligibility(p, c, opts, cfg, t));
  const fixedUnmet = elig.flatMap((e) => e.unmet);
  const evaluate = (mix: Choice[]) => {
    const measures = measure(input, mix, cfg);
    const adv = advantages(input, todayM, mix, measures, cfg);
    let score = sum(CRITERIA.map((k) => weights[k] * (adv[k] ?? 0)));
    // "Fewer suppliers" keeps the cost within a limit: beyond it, consolidation is not worth it.
    if (objective === "fewer_suppliers" && measures.cost > todayM.cost * (1 + cfg.maxExtraCostPct / 100)) score = -Infinity;
    return { mix, measures, adv, score, broken: violations(input, mix, measures, c, t) };
  };
  type Eval = ReturnType<typeof evaluate>;
  // Fewer broken limits first, then the higher score; today's mix wins a tie.
  const better = (a: Eval, b: Eval) => a.broken.length < b.broken.length || (a.broken.length === b.broken.length && a.score > b.score + cfg.minAdvantage);

  // Where the search starts: today's mix when the limits allow each product's supplier, otherwise the first option allowed.
  const start = input.products.map((_, i) => elig[i].choices.find((ch) => sameChoice(ch, today[i])) ?? elig[i].choices[0]);
  let best = evaluate(start);
  const combinations = elig.reduce((n, e) => n * e.choices.length, 1);
  if (combinations <= cfg.maxCombinations) {
    const walk = (i: number, acc: Choice[]) => {
      if (i === elig.length) {
        const e = evaluate(acc.slice());
        if (better(e, best)) best = e;
        return;
      }
      for (const ch of elig[i].choices) {
        acc[i] = ch;
        walk(i + 1, acc);
      }
    };
    walk(0, []);
  } else {
    // Too many combinations to try them all: improve one product at a time until nothing improves.
    const keys = [...new Set(elig.flatMap((e) => e.choices.filter((ch) => ch.length === 1).map((ch) => ch[0].option.key)))];
    for (let improved = true; improved; ) {
      improved = false;
      // Several products to one supplier at once: a bundle only shows its worth when it moves together.
      for (const key of keys) {
        const e = evaluate(best.mix.map((x, j) => elig[j].choices.find((ch) => ch.length === 1 && ch[0].option.key === key) ?? x));
        if (better(e, best)) {
          best = e;
          improved = true;
        }
      }
      for (let i = 0; i < elig.length; i++) {
        for (const ch of elig[i].choices) {
          if (sameChoice(ch, best.mix[i])) continue;
          const e = evaluate(best.mix.map((x, j) => (j === i ? ch : x)));
          if (better(e, best)) {
            best = e;
            improved = true;
          }
        }
      }
    }
  }
  return { mix: best.mix, measures: best.measures, adv: best.adv, score: best.score, unmet: [...fixedUnmet, ...best.broken] };
}

// ---------------- Wording a scenario ----------------

const pctOf = (share: number) => Math.round(share * 100);

function describe(input: PortfolioInput, objective: Objective, weights: Weights, c: Constraints, chosen: Chosen, today: Choice[], todayM: Measures, reference: { lowestCost: number | null }, cfg: PortfolioConfig, t: T): Scenario {
  const total = sum(input.products.map(spendOf)) || 1;
  const { mix, measures: m } = chosen;
  const changed = mix.some((ch, i) => !sameChoice(ch, today[i]));
  const benefit = { total: todayM.cost - m.cost, theoretical: 0, toValidate: 0, validated: 0, level: null as OpportunityLevel | null };

  /** If this product alone went to its cheapest other supplier: which criterion would lose most. */
  const heldBy = (i: number, alt: SourceOption): Criterion | null => {
    const moved = mix.map((x, j) => (j === i ? [{ option: alt, share: 1 }] : x));
    const adv = advantages(input, todayM, moved, measure(input, moved, cfg), cfg);
    const losses = CRITERIA.filter((k) => k !== "cost")
      .map((k) => ({ k, loss: weights[k] * ((chosen.adv[k] ?? 0) - (adv[k] ?? 0)) }))
      .filter((x) => x.loss > 0)
      .sort((a, b) => b.loss - a.loss);
    return losses[0]?.k ?? null;
  };

  const allocation = input.products.map((p, i): Allocation => {
    const cur = currentOf(p);
    const parts = mix[i];
    const stays = parts.length === 1 && parts[0].option.current;
    const cost = sum(parts.map((x) => p.annualQuantity * x.share * x.option.unitCost!));
    const difference = stays ? null : spendOf(p) - cost;
    const moved = parts.filter((x) => !x.option.current);
    const level = moved.length ? moved.map((x) => x.option.level ?? "theoretical").sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b])[0] : null;
    for (const x of moved) {
      const gain = p.annualQuantity * x.share * (p.currentPrice - x.option.unitCost!);
      if (gain <= 0) continue;
      const l = x.option.level ?? "theoretical";
      if (l === "validated") benefit.validated += gain;
      else if (l === "to_validate") benefit.toValidate += gain;
      else benefit.theoretical += gain;
    }
    const neg = p.negotiation;
    const target = stays && neg?.status === "range" && neg.target != null && neg.target < p.currentPrice ? neg.target : null;
    const alternatives = p.options.filter((o) => !o.current && priced(o)).sort((a, b) => a.unitCost! - b.unitCost!);
    const cheaper = alternatives.find((o) => o.unitCost! < p.currentPrice) ?? null;
    const candidates = p.options.filter((o) => !priced(o) && o.stage);
    const below = (o: SourceOption) => Math.round(((p.currentPrice - o.unitCost!) / p.currentPrice) * 1000) / 10;
    const basis = (o: SourceOption) => (o.evidence === "true_cost" ? t("on true cost") : o.evidence === "quoted_price" ? t("on the quoted price, true cost incomplete") : t("on a price you paid"));
    let decision: Decision;
    let reason: string;
    if (parts.length > 1) {
      decision = "dual_source";
      reason = t("Shared between {a} ({x}%) and {b} ({y}%): a second source for a product that is {pct}% of this spend.", { a: parts[0].option.name, x: pctOf(parts[0].share), b: parts[1].option.name, y: pctOf(parts[1].share), pct: pctOf(spendOf(p) / total) });
    } else if (!stays) {
      const o = parts[0].option;
      decision = "switch";
      reason =
        o.unitCost! < p.currentPrice
          ? t("{supplier} is {pct}% below today's price, {basis}. To validate before any decision.", { supplier: o.name, pct: f.number(below(o), 1), basis: basis(o) })
          : t("{supplier} is preferred here for what this mix optimizes, at {pct}% above today's price.", { supplier: o.name, pct: f.number(-below(o), 1) });
    } else if (cheaper) {
      decision = "negotiate";
      const held = c.keep.includes(p.id) ? null : heldBy(i, cheaper);
      reason = c.keep.includes(p.id)
        ? t("{alternative} is {pct}% lower, {basis}; you chose to keep {supplier} on this product. A credible alternative to bring to the table.", { alternative: cheaper.name, pct: f.number(below(cheaper), 1), basis: basis(cheaper), supplier: cur.name })
        : held
          ? t("{alternative} is {pct}% lower, {basis}, but this mix keeps {supplier} for {criterion}. A credible alternative to bring to the table.", { alternative: cheaper.name, pct: f.number(below(cheaper), 1), basis: basis(cheaper), supplier: cur.name, criterion: t(CRITERION_LABEL[held]).toLowerCase() })
          : t("{alternative} is {pct}% lower, {basis}: with {supplier}, a credible alternative to bring to the table.", { alternative: cheaper.name, pct: f.number(below(cheaper), 1), basis: basis(cheaper), supplier: cur.name });
    } else if (target != null) {
      decision = "negotiate";
      reason = alternatives.length ? t("The offers on file are not below what {supplier} charges; the price evidence still supports a lower target.", { supplier: cur.name }) : t("No offer from another supplier yet; with {supplier}, the price evidence on file supports a lower target.", { supplier: cur.name });
    } else if (alternatives.length) {
      decision = "keep";
      reason = t("The offers on file are not below what {supplier} charges today.", { supplier: cur.name });
    } else {
      decision = "need_data";
      reason = candidates.length
        ? t.n(candidates.length, "No offer from another supplier: {n} possible supplier on file, not asked yet.", "No offer from another supplier: {n} possible suppliers on file, none with a price.")
        : t("No other supplier, offer or price evidence on file: nothing to compare {supplier} with.", { supplier: cur.name });
    }
    return {
      productId: p.id,
      name: p.name,
      unit: p.unit,
      currentSupplier: cur.name,
      currentPrice: p.currentPrice,
      annualCost: cost,
      weight: spendOf(p) / total,
      parts: parts.map((x) => ({ key: x.option.key, name: x.option.name, share: x.share, unitCost: x.option.unitCost!, evidence: x.option.evidence, level: x.option.current ? null : (x.option.level ?? "theoretical"), current: x.option.current, known: x.option.known })),
      decision,
      reason,
      difference,
      level,
      target,
    };
  });
  benefit.level = benefit.validated + benefit.toValidate + benefit.theoretical <= 0 ? null : benefit.theoretical > 0 ? "theoretical" : benefit.toValidate > 0 ? "to_validate" : "validated";

  const upside = sum(input.products.map((p, i) => (allocation[i].target != null ? (p.negotiation?.upsideAnnual ?? 0) : 0)));
  const cash = cashEffect(input, mix);
  const begun = m.suppliers.filter((s) => !s.known).length;
  // A relationship ends only when nothing at all is bought from the supplier any more — not just none of these products.
  const ended = todayM.suppliers.filter((s) => !m.suppliers.some((x) => x.key === s.key) && !(input.outside[s.key]?.products ?? 0)).length;
  const relationships = begun - ended;

  // ---- What is missing, for what this objective looks at ----
  const missing: Missing[] = [];
  const names = (ps: PortfolioProduct[]) => (ps.length > 3 ? t("{names} and {n} more", { names: ps.slice(0, 3).map((p) => p.name).join(", "), n: ps.length - 3 }) : list(t, ps.map((p) => p.name)));
  const add = (kind: MissingKind, ps: PortfolioProduct[], label: (n: string) => string) => {
    if (ps.length) missing.push({ kind, label: label(names(ps)), productIds: ps.map((p) => p.id) });
  };
  const unpriced = input.products.filter((p) => !p.options.some((o) => !o.current && priced(o)));
  add("request_quotes", unpriced.filter((p) => p.options.some((o) => !priced(o) && o.stage)), (n) => t("A real offer for {products}: possible suppliers are on file, none has a price.", { products: n }));
  add("find_suppliers", unpriced.filter((p) => !p.options.some((o) => !priced(o) && o.stage)), (n) => t("A credible alternative supplier for {products}: none on file.", { products: n }));
  add("complete_true_cost", input.products.filter((p) => p.options.some((o) => o.evidence === "quoted_price")), (n) => t("The true cost of the offers for {products}: transport, duties or terms are missing.", { products: n }));
  if (weights.delivery > 0) add("lead_time", input.products.filter((p) => p.options.some((o) => priced(o) && o.leadTimeDays == null)), (n) => t("Lead times for {products}.", { products: n }));
  if (weights.payment > 0 || objective === "total_value") add("payment_terms", input.products.filter((p) => p.options.some((o) => priced(o) && o.paymentDays == null)), (n) => t("Payment terms for {products}.", { products: n }));
  if (weights.quality > 0) {
    add("quality_data", input.products.filter((p) => !p.options.some((o) => o.quality)), (n) => t("Supplier quality for {products}: no quality history, certification or defect observation on file.", { products: n }));
    add("confirm_match", input.products.filter((p) => p.options.some((o) => !o.current && priced(o) && o.qualification !== "proven" && o.qualification !== "confirmed")), (n) => t("Confirmation that what is offered for {products} is the same specification.", { products: n }));
  }
  add("confirm_volume", input.products.filter((p) => p.quantityStatus !== "confirmed"), (n) => t("Yearly volumes for {products} are estimated from the invoices: confirm them.", { products: n }));

  // ---- Does the objective have anything to stand on? ----
  const anyAlternative = input.products.some((p) => p.options.some((o) => !o.current && priced(o)));
  const anyComplete = input.products.some((p) => p.options.some((o) => !o.current && priced(o) && o.evidence !== "quoted_price"));
  const multi = bundleKeys(input).size > 0;
  const lone = input.products.some((p) => p.options.some((o) => !o.current && priced(o) && input.products.filter((q) => q.options.some((x) => x.key === o.key)).length === 1));
  const noData: string | null =
    objective === "quality" && !input.products.some((p) => p.options.some((o) => o.quality))
      ? t("Insufficient quality data: no supplier quality history, certification or defect observation is on file. What is known is only who you already buy from.")
      : objective === "delivery" && chosen.adv.delivery == null
        ? t("Not enough data: no lead time of your current suppliers is on file, so nothing can be called faster.")
        : objective === "delivery" && !input.products.some((p) => currentOf(p).leadTimeDays != null && p.options.some((o) => !o.current && priced(o) && o.leadTimeDays != null))
          ? t("Not enough data: no other supplier has both a price and a lead time on file.")
          : objective === "cash_flow" && !input.products.some((p) => currentOf(p).paymentDays != null && p.options.some((o) => !o.current && priced(o) && o.paymentDays != null))
            ? t("Not enough data: payment terms are on file for no offer to compare with what you have today.")
            : objective === "total_value" && !anyComplete
              ? anyAlternative
                ? t("Not enough data: the offers on file have no complete true cost yet.")
                : t("Not enough data: no real offer from another supplier is on file, so there is no true cost to compare.")
              : objective === "bundle" && !multi
                ? t("Not enough data: no supplier has prices on two or more of these products beyond what you already buy from it.")
                : objective === "specialists" && !lone
                  ? t("Not enough data: no single-product supplier has made an offer.")
                  : !anyAlternative && objective !== "risk"
                    ? t("Not enough data: no real offer from another supplier is on file for any of these products.")
                    : null;
  const status: ScenarioStatus = noData ? "not_enough_data" : changed ? "changed" : "unchanged";

  // ---- What you gain, what you give up ----
  const gains: string[] = [];
  const tradeoffs: string[] = [];
  const n = m.suppliers.length;
  const before = todayM.suppliers.length;
  if (changed) {
    if (benefit.total > 0) gains.push(t("{amount} a year below today's cost at the prices on file: an estimated advantage, not a saving.", { amount: f.moneyApprox(benefit.total) }));
    else if (benefit.total < 0) tradeoffs.push(t("{amount} a year above today's cost at the prices on file.", { amount: f.moneyApprox(-benefit.total) }));
    if (reference.lowestCost != null && reference.lowestCost - benefit.total > 0.5 && objective !== "lowest_cost") tradeoffs.push(t("{amount} a year less than the lowest-cost mix.", { amount: f.moneyApprox(reference.lowestCost - benefit.total) }));
    if (n < before) gains.push(t("{n} suppliers instead of {m} for these products.", { n, m: before }));
    else if (n > before) tradeoffs.push(t("{n} suppliers instead of {m} for these products: more orders, deliveries and accounts to manage.", { n, m: before }));
    if (m.topShare < todayM.topShare - 0.005) gains.push(t("The largest supplier goes from {a}% to {b}% of this spend.", { a: pctOf(todayM.topShare), b: pctOf(m.topShare) }));
    else if (m.topShare > todayM.topShare + 0.005) tradeoffs.push(t("The largest supplier goes from {a}% to {b}% of this spend: more dependence.", { a: pctOf(todayM.topShare), b: pctOf(m.topShare) }));
    const dual = mix.filter((ch) => ch.length > 1).length;
    if (dual) gains.push(t.n(dual, "A second source for {n} product.", "A second source for {n} products."));
    if (m.lead.days != null && todayM.lead.days != null && Math.abs(m.lead.days - todayM.lead.days) >= 0.5) (m.lead.days < todayM.lead.days ? gains : tradeoffs).push(t("Average lead time {a} instead of {b}, where it is on file.", { a: f.days(m.lead.days, t), b: f.days(todayM.lead.days, t) }));
    if (cash != null && Math.abs(cash) >= 1) (cash > 0 ? gains : tradeoffs).push(cash > 0 ? t("About {amount} more kept in the company, from payment terms and stock.", { amount: f.moneyApprox(cash) }) : t("About {amount} more tied up, from payment terms and stock.", { amount: f.moneyApprox(-cash) }));
    if (m.leverage.level !== todayM.leverage.level) (m.leverage.score > todayM.leverage.score ? gains : tradeoffs).push(m.leverage.score > todayM.leverage.score ? t("More spend with each supplier: more weight at the table.") : t("The spend is spread thinner: less weight with each supplier."));
    const fresh = allocation.filter((a) => a.parts.some((x) => !x.known)).length;
    if (fresh) tradeoffs.push(t.n(fresh, "{n} product goes to a supplier you have never bought from: samples, approval and a first delivery come before any advantage.", "{n} products go to suppliers you have never bought from: samples, approval and a first delivery come before any advantage."));
    const soft = benefit.theoretical + benefit.toValidate + benefit.validated;
    if (benefit.theoretical > 0 && soft > 0) tradeoffs.push(t("{pct}% of the advantage rests on quoted prices whose true cost is incomplete: theoretical until it is completed.", { pct: pctOf(benefit.theoretical / soft) }));
    if (relationships > 0 && c.adminCost == null) tradeoffs.push(t.n(relationships, "{n} more supplier relationship to manage.", "{n} more supplier relationships to manage."));
  }

  // ---- How far the data carries ----
  const tested = sum(input.products.filter((p) => p.options.some((o) => !o.current && priced(o))).map(spendOf)) / total;
  const nominalUsed = mix.some((ch) => ch.some((x) => x.option.evidence === "quoted_price"));
  const estimatedVolumes = input.products.some((p) => p.quantityStatus !== "confirmed");
  const confidence: Confidence = noData || tested < cfg.confidence.medium || nominalUsed ? "low" : tested >= cfg.confidence.high && !estimatedVolumes && allocation.every((a) => a.level == null || a.level === "validated") ? "high" : "medium";
  const confidenceWhy = noData
    ? t("The data this objective needs is not on file.")
    : tested < cfg.confidence.medium
      ? t("Only {pct}% of this spend has a real price from another supplier to compare with.", { pct: pctOf(tested) })
      : nominalUsed
        ? t("Part of the mix rests on quoted prices whose true cost is incomplete.")
        : confidence === "high"
          ? t("Real offers on true cost, specifications confirmed, volumes confirmed.")
          : estimatedVolumes
            ? t("Real offers are on file, but the yearly volumes are estimated from the invoices.")
            : t("Real offers are on file; some are still to validate.");

  const headline = noData
    ? noData
    : !changed
      ? objective === "risk"
        ? t("Nothing on file lowers the risk of today's mix: a second source needs a real offer first.")
        : t("Same as today: nothing on file does better on this objective.")
      : t.n(n, "{n} supplier for {k} products.", "{n} suppliers for {k} products.", { k: input.products.length });

  return {
    objective,
    status,
    headline,
    weights,
    allocation,
    measures: m,
    benefit,
    negotiationUpside: upside > 0 ? upside : null,
    cash,
    administration: { relationships, amount: c.adminCost != null && relationships !== 0 ? -relationships * c.adminCost : null },
    quality: m.qualityKnown > 0 ? { status: "known", level: m.qualityKnown >= cfg.confidence.high ? "high" : m.qualityKnown >= cfg.confidence.medium ? "medium" : "low" } : { status: "insufficient" },
    confidence,
    confidenceWhy,
    gains,
    tradeoffs,
    missing,
    unmet: chosen.unmet,
    advantages: chosen.adv,
  };
}

// ---------------- Coverage: bundles and specialists ----------------

/** Suppliers with a price on two or more products, at least one of which they do not supply today. */
function bundleKeys(input: PortfolioInput): Set<string> {
  const byKey = new Map<string, { priced: number; fresh: number }>();
  for (const p of input.products)
    for (const o of p.options) {
      if (!priced(o)) continue;
      const x = byKey.get(o.key) ?? { priced: 0, fresh: 0 };
      x.priced++;
      if (!o.current) x.fresh++;
      byKey.set(o.key, x);
    }
  return new Set([...byKey].filter(([, x]) => x.priced >= 2 && x.fresh >= 1).map(([k]) => k));
}

function bundles(input: PortfolioInput, t: T): Bundle[] {
  const total = sum(input.products.map(spendOf)) || 1;
  const rel = NEGOTIATION_CONFIG.relationship;
  const byKey = new Map<string, { first: SourceOption; lines: BundleLine[]; groups: Set<string>; asked: boolean }>();
  for (const p of input.products)
    for (const o of p.options) {
      if (!priced(o) && !o.stage) continue;
      const b = byKey.get(o.key) ?? { first: o, lines: [], groups: new Set<string>(), asked: false };
      b.lines.push({ productId: p.id, name: p.name, spend: spendOf(p), current: o.current, priced: priced(o), difference: o.current || !priced(o) ? null : p.annualQuantity * (p.currentPrice - o.unitCost!), qualification: o.qualification });
      if (p.group) b.groups.add(p.group);
      b.asked ||= o.asked;
      byKey.set(o.key, b);
    }
  return [...byKey.entries()]
    .filter(([, b]) => b.lines.length >= 2)
    .map(([key, b]): Bundle => {
      const lines = b.lines.sort((x, y) => y.spend - x.spend);
      const spend = sum(lines.map((l) => l.spend));
      const fresh = lines.filter((l) => !l.current);
      const pricedFresh = fresh.filter((l) => l.priced);
      const technical = sum(lines.filter((l) => l.qualification === "proven" || l.qualification === "confirmed").map((l) => l.spend));
      // The same thresholds the negotiation engine reads a relationship with: what several products together are worth in a year.
      const potential: Level = spend >= rel.crossLarge ? "high" : spend >= rel.crossMaterial ? "medium" : "low";
      const levels = input.products.flatMap((p) => p.options.filter((o) => o.key === key && !o.current && priced(o) && o.unitCost! < p.currentPrice).map((o) => o.level ?? "theoretical"));
      return {
        key,
        name: b.first.name,
        country: b.first.country,
        current: lines.some((l) => l.current),
        known: b.first.known,
        lines,
        products: lines.length,
        groups: b.groups.size,
        spend,
        spendShare: spend / total,
        technicalShare: spend > 0 ? technical / spend : 0,
        potential,
        potentialWhy:
          potential === "high"
            ? t("{n} products worth {amount} a year together: a request that weighs.", { n: lines.length, amount: f.moneyApprox(spend) })
            : potential === "medium"
              ? t("{n} products worth {amount} a year together: enough to be asked for one price list.", { n: lines.length, amount: f.moneyApprox(spend) })
              : t("{n} products, but only {amount} a year together: little weight.", { n: lines.length, amount: f.moneyApprox(spend) }),
        value: pricedFresh.length ? { amount: sum(pricedFresh.map((l) => l.difference!)), level: levels.length ? levels.sort((x, y) => LEVEL_RANK[x] - LEVEL_RANK[y])[0] : null, priced: pricedFresh.length, of: fresh.length } : null,
        asked: b.asked,
      };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}

function specialists(input: PortfolioInput, t: T): Specialist[] {
  const count = new Map<string, number>();
  for (const p of input.products) for (const o of p.options) if (priced(o) || o.stage) count.set(o.key, (count.get(o.key) ?? 0) + 1);
  const out: Specialist[] = [];
  for (const p of input.products)
    for (const o of p.options) {
      if (count.get(o.key) !== 1 || (!priced(o) && o.stage !== "strong") || (input.outside[o.key]?.products ?? 0) > 0) continue;
      // A single-product supplier counts as a specialist only when something says it fits: bought from, confirmed, or a strong match.
      const specialization: Level = o.qualification === "proven" || o.qualification === "confirmed" ? "high" : o.stage === "strong" || o.qualification === "possible" ? "medium" : "low";
      if (specialization === "low") continue;
      const difference = o.current || !priced(o) ? null : p.annualQuantity * (p.currentPrice - o.unitCost!);
      const cheaperElsewhere = o.current && p.options.some((x) => !x.current && priced(x) && x.unitCost! < p.currentPrice);
      const verdict: SpecialistVerdict = o.current ? "keep" : !priced(o) ? "ask" : difference! > 0 ? "ahead" : "behind";
      out.push({
        key: o.key,
        name: o.name,
        country: o.country,
        productId: p.id,
        product: p.name,
        current: o.current,
        specialization,
        why: o.current
          ? cheaperElsewhere
            ? t("Your supplier for this product only. A lower offer is on file: something to negotiate with, not a reason to drop a supplier that works.")
            : t("Your supplier for this product only, proven by your purchases: covering one product is no reason to replace it.")
          : !priced(o)
            ? t("A strong match for this product only, not asked yet.")
            : o.qualification === "confirmed"
              ? t("Covers this product only, with the technical match confirmed.")
              : t("Covers this product only; the technical match is still to confirm."),
        difference,
        level: difference != null && difference > 0 ? (o.level ?? "theoretical") : null,
        verdict,
      });
    }
  const order: Record<SpecialistVerdict, number> = { ahead: 0, keep: 1, ask: 2, behind: 3 };
  return out.sort((a, b) => order[a.verdict] - order[b.verdict] || (b.difference ?? 0) - (a.difference ?? 0) || a.name.localeCompare(b.name));
}

function bySupplier(input: PortfolioInput, all: Bundle[], todayM: Measures, t: T): CurrentSupplierView[] {
  return todayM.suppliers.map((s): CurrentSupplierView => {
    const mine = input.products.filter((p) => currentOf(p).key === s.key);
    const alternatives = all
      .filter((b) => b.key !== s.key)
      .map((b) => {
        const covered = b.lines.filter((l) => !l.current && mine.some((p) => p.id === l.productId));
        return { key: b.key, name: b.name, products: covered.length, spend: sum(covered.map((l) => l.spend)), share: s.cost > 0 ? sum(covered.map((l) => l.spend)) / s.cost : 0, priced: covered.length > 0 && covered.every((l) => l.priced) };
      })
      .filter((a) => a.products >= 2)
      .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
    const top = alternatives[0];
    const note = !top
      ? mine.length >= 2
        ? t("Of the products you buy from {supplier}, no two could be taken over by one company on file.", { supplier: s.name })
        : t("One product from {supplier} among these: nothing to group.", { supplier: s.name })
      : alternatives.some((a) => a.priced)
        ? t.n(alternatives.length, "{n} company could take over {k} of the products you buy from {supplier} ({pct}% of what you spend with it here), with real prices: a credible alternative bundle to bring to the table.", "{n} companies could each take over {k} of the products you buy from {supplier} ({pct}% of what you spend with it here), some with real prices: a credible alternative bundle to bring to the table.", { k: top.products, supplier: s.name, pct: pctOf(top.share) })
        : t.n(alternatives.length, "{n} company could take over {k} of the products you buy from {supplier} ({pct}% of what you spend with it here). None has a price yet: on paper until one answers a request.", "{n} companies could each take over {k} of the products you buy from {supplier} ({pct}% of what you spend with it here). None has a price yet: on paper until one answers a request.", { k: top.products, supplier: s.name, pct: pctOf(top.share) });
    return { key: s.key, name: s.name, products: mine.map((p) => ({ id: p.id, name: p.name, spend: spendOf(p) })), spend: s.cost, share: s.share, outside: input.outside[s.key] ?? { spend: 0, products: 0 }, alternatives, note };
  });
}

// ---------------- The whole picture ----------------

export interface PortfolioOptions {
  constraints?: Constraints;
  /** The user's own weights: with them the "custom" scenario is worked out. */
  custom?: Weights | null;
}

/** Weights as given, brought back to a sum of 1. All zero: the balanced ones. */
export function normalizeWeights(w: Partial<Weights>, cfg: PortfolioConfig = PORTFOLIO_CONFIG): Weights {
  const clean = Object.fromEntries(CRITERIA.map((k) => [k, Math.max(0, Number(w[k]) || 0)])) as Weights;
  const total = sum(Object.values(clean));
  if (total <= 0) return defaultWeights("balanced", cfg);
  return Object.fromEntries(CRITERIA.map((k) => [k, clean[k] / total])) as Weights;
}

export function sourcingMix(input: PortfolioInput, options: PortfolioOptions = {}, t: T = en, cfg: PortfolioConfig = PORTFOLIO_CONFIG): Portfolio {
  const c = options.constraints ?? NO_CONSTRAINTS;
  const todayMix: Choice[] = input.products.map((p) => [{ option: currentOf(p), share: 1 }]);
  const todayM = measure(input, todayMix, cfg);
  const still: Record<Criterion, number | null> = { cost: 0, quality: 0, delivery: null, risk: 0, coverage: 0, payment: null, leverage: 0 };
  const asIs = (objective: Objective, weights: Weights) => describe(input, objective, weights, NO_CONSTRAINTS, { mix: todayMix, measures: todayM, adv: still, score: 0, unmet: [] }, todayMix, todayM, { lowestCost: null }, cfg, t);
  const today = asIs("balanced", defaultWeights("balanced", cfg));

  const run = (objective: Objective, weights: Weights, lowestCost: number | null) => describe(input, objective, weights, c, choose(input, objective, weights, c, todayMix, todayM, cfg, t), todayMix, todayM, { lowestCost }, cfg, t);
  const lowest = run("lowest_cost", defaultWeights("lowest_cost", cfg), null);
  const reference = lowest.status === "changed" ? lowest.benefit.total : null;
  const scenarios = OBJECTIVES.filter((o) => o !== "custom" || options.custom).map((o) => (o === "lowest_cost" ? lowest : run(o, o === "custom" ? options.custom! : defaultWeights(o, cfg), reference)));

  // The mix to look at first: the balanced one when it differs from today's, then total economic value.
  const pick = (["balanced", "total_value"] as Objective[]).map((o) => scenarios.find((s) => s.objective === o)!).find((s) => s.status === "changed") ?? null;
  let suggested: Portfolio["suggested"] = null;
  if (pick) {
    const n = pick.measures.suppliers.length;
    const captured = reference && reference > 0 ? Math.round((pick.benefit.total / reference) * 100) : null;
    const dual = pick.allocation.filter((a) => a.decision === "dual_source").length;
    suggested = {
      objective: pick.objective,
      why: [
        captured != null && pick.benefit.total > 0 ? t("It captures {pct}% of the largest advantage the prices on file allow ({amount} a year).", { pct: captured, amount: f.moneyApprox(reference!) }) : t("It does better than today's mix on what it weighs."),
        n !== todayM.suppliers.length ? t.n(n, "It uses {n} supplier instead of {m}.", "It uses {n} suppliers instead of {m}.", { m: todayM.suppliers.length }) : t.n(n, "It uses {n} supplier, as today.", "It uses {n} suppliers, as today."),
        t("The largest holds {pct}% of this spend.", { pct: pctOf(pick.measures.topShare) }),
        ...(dual ? [t.n(dual, "{n} product gets a second source.", "{n} products get a second source.")] : []),
      ].join(" "),
    };
  }
  const allBundles = bundles(input, t);
  const next: string[] = [];
  if (!pick) {
    const negotiable = today.allocation.filter((a) => a.target != null);
    if (negotiable.length) next.push(t.n(negotiable.length, "Negotiate with the current supplier on {n} product: the price evidence on file supports a lower target (about {amount} a year, theoretical).", "Negotiate with the current suppliers on {n} products: the price evidence on file supports lower targets (about {amount} a year, theoretical).", { amount: f.moneyApprox(today.negotiationUpside) }));
    const toAsk = allBundles.filter((b) => !b.current && !b.value);
    if (toAsk.length) next.push(t.n(toAsk.length, "Ask {names} for one quotation covering several products: {n} company could cover {pct}% of this spend.", "Ask for quotations covering several products at once: {names} could each cover up to {pct}% of this spend.", { names: list(t, toAsk.slice(0, 3).map((b) => b.name)), pct: pctOf(toAsk[0].spendShare) }));
    for (const m of today.missing.filter((x) => x.kind === "find_suppliers" || x.kind === "complete_true_cost")) next.push(m.label);
  }
  return { today, scenarios, suggested, next, bundles: allBundles, specialists: specialists(input, t), bySupplier: bySupplier(input, allBundles, todayM, t) };
}
