/**
 * What the user asked of the sourcing strategy page — the objective, the
 * weights and the limits — as it travels in the page's address. Nothing of it
 * is stored: a link is the whole request, and can be sent to a colleague.
 */
import { CRITERIA, PORTFOLIO_CONFIG, defaultWeights, isObjective, type Criterion, type Objective, type PortfolioConfig, type Weights } from "./config";
import { NO_CONSTRAINTS, normalizeWeights, type Constraints } from "./engine";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface StrategyParams {
  /** How many of the largest products are looked at. */
  top: number;
  /** The objective asked for. Null: the page chooses which to open. */
  goal: Objective | null;
  constraints: Constraints;
  /** The user's own weights, summing to 1. Null: none given. */
  custom: Weights | null;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (v == null ? [] : (Array.isArray(v) ? v : v.split(",")).map((x) => x.trim()).filter(Boolean));
const positive = (v: string | string[] | undefined) => {
  const n = Number(String(one(v) ?? "").replace(",", "."));
  return one(v) != null && one(v) !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

export function readStrategyParams(sp: SearchParams, cfg: PortfolioConfig = PORTFOLIO_CONFIG): StrategyParams {
  const top = Number(one(sp.top));
  const goal = one(sp.goal);
  const share = positive(sp.max_share);
  // The form always sends the weights: they count as the user's own only when asked for, or when they differ from the balanced ones.
  const balanced = defaultWeights("balanced", cfg);
  const sent = CRITERIA.some((k) => one(sp[`w_${k}`]) != null && one(sp[`w_${k}`]) !== "");
  const own = sent ? normalizeWeights(Object.fromEntries(CRITERIA.map((k) => [k, Number(one(sp[`w_${k}`])) || 0])) as Record<Criterion, number>, cfg) : null;
  const given = own != null && (goal === "custom" || CRITERIA.some((k) => Math.abs(own[k] - balanced[k]) > 0.005));
  const region = one(sp.region);
  const suppliers = positive(sp.max_suppliers);
  return {
    top: cfg.rounds.includes(top) ? top : cfg.rounds[0],
    goal: isObjective(goal) ? goal : null,
    constraints: {
      ...NO_CONSTRAINTS,
      maxShare: share != null && share < 100 ? share / 100 : null,
      maxSuppliers: suppliers != null ? Math.floor(suppliers) : null,
      maxLeadDays: positive(sp.max_lead),
      region: region === "eu" || region === "home" ? region : null,
      exclude: many(sp.exclude),
      keep: many(sp.keep),
      confirmedOnly: one(sp.confirmed) === "1",
      criticalSources: one(sp.critical) === "1" ? 2 : null,
      adminCost: positive(sp.admin),
    },
    custom: given ? own : goal === "custom" ? balanced : null,
  };
}

/** How many limits are set: what the page says next to "Limits". */
export function limitsSet(c: Constraints): number {
  return [c.maxShare, c.maxSuppliers, c.maxLeadDays, c.region, c.criticalSources, c.adminCost].filter((x) => x != null).length + c.exclude.length + c.keep.length + (c.confirmedOnly ? 1 : 0);
}

/** The address of the page for these choices, with what changes. */
export function strategyHref(p: StrategyParams, over: { top?: number; goal?: Objective | null } = {}, cfg: PortfolioConfig = PORTFOLIO_CONFIG): string {
  const q = new URLSearchParams();
  const top = over.top ?? p.top;
  const goal = over.goal === undefined ? p.goal : over.goal;
  if (top !== cfg.rounds[0]) q.set("top", String(top));
  if (goal) q.set("goal", goal);
  const c = p.constraints;
  if (c.maxShare != null) q.set("max_share", String(Math.round(c.maxShare * 100)));
  if (c.maxSuppliers != null) q.set("max_suppliers", String(c.maxSuppliers));
  if (c.maxLeadDays != null) q.set("max_lead", String(c.maxLeadDays));
  if (c.region) q.set("region", c.region);
  if (c.confirmedOnly) q.set("confirmed", "1");
  if (c.criticalSources) q.set("critical", "1");
  if (c.adminCost != null) q.set("admin", String(c.adminCost));
  // Products and suppliers belong to a scope: a wider or narrower one starts without them.
  if (over.top === undefined || over.top === p.top) {
    for (const x of c.exclude) q.append("exclude", x);
    for (const x of c.keep) q.append("keep", x);
  }
  if (p.custom) for (const k of CRITERIA) q.set(`w_${k}`, String(Math.round(p.custom[k] * 100)));
  const s = q.toString();
  return s ? `/strategy?${s}` : "/strategy";
}
