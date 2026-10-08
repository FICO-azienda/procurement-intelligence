/**
 * Sourcing mix on the database. Nothing is stored and nothing is written:
 * the mixes are worked out fresh from what the other modules already hold —
 * the price paid and the yearly volume of each priority product, the offers
 * received with their true cost, the candidates research found, what
 * negotiation intelligence says for the current supplier — and handed to
 * lib/portfolio. What the user wants to optimize, the weights and the limits
 * travel in the page's address, not in a table.
 */
import { connection } from "next/server";
import { getDb, type DB } from "@/db";
import type { Dataset } from "@/lib/analytics";
import { getDataset, getIntel, getSettings, getT, readSettings } from "@/lib/data";
import type { ProductProfile } from "@/lib/dataset/profile";
import { readNumber } from "@/lib/dataset/profile";
import { en, type T } from "@/lib/i18n";
import { companyKey } from "@/lib/import/normalize/text";
import type { Intel } from "@/lib/intel/engine";
import type { ProductNegotiation } from "@/lib/negotiation/input";
import type { PortfolioInput, PortfolioProduct, Qualification, SourceOption } from "@/lib/portfolio/engine";
import type { MarketView } from "@/lib/sourcing/market";
import { regionOf } from "@/lib/sourcing/regions";
import { getNegotiations, readNegotiations } from "./negotiation";
import { getProfiles, priorityProducts, readProfiles } from "./product-data";
import { getMarketViews, readMarketViews, readProductCosts, type ProductCosts } from "./sourcing";

interface Sources {
  intel: Intel;
  views: Map<string, MarketView>;
  costs: Map<string, ProductCosts>;
  negotiations: Map<string, ProductNegotiation>;
  profiles: Map<string, ProductProfile>;
  data: Pick<Dataset, "purchases" | "suppliers">;
  homeCountry: string | null;
}

export interface PortfolioScope {
  input: PortfolioInput;
  /** How many products make up most of the spend: the widest scope there is. */
  priority: number;
  /** Priority products with no price paid or no quantity on file: they cannot be placed in a mix. */
  leftOut: { id: string; name: string }[];
}

const ASKED = ["contacted", "quote_requested", "quote_received"];

/** The largest `top` products by spend, each with every supplier that could take it and what is known of each. Pure: everything comes in. */
export function portfolioInput(src: Sources, top: number): PortfolioScope {
  const priority = priorityProducts(src.intel);
  const scope = priority.slice(0, top);
  const known = new Set(src.data.purchases.map((p) => p.supplierId));
  const onFile = new Map(src.data.suppliers.map((s) => [companyKey(s.name), s]));
  const products: PortfolioProduct[] = [];
  const leftOut: PortfolioScope["leftOut"] = [];

  for (const p of scope) {
    const id = p.product.id;
    const view = src.views.get(id);
    const profile = src.profiles.get(id);
    const supplier = view?.currentSupplier ?? null;
    const quantity = profile?.quantities.annual ?? (view?.history.annualQuantity || null);
    if (!view || view.currentPrice == null || !supplier || !quantity) {
      leftOut.push({ id, name: p.product.name });
      continue;
    }
    const field = (key: "payment_terms" | "moq" | "lead_time") => {
      const x = profile?.fields[key];
      return x && x.status !== "missing" ? readNumber(x.raw) : null;
    };
    const options: SourceOption[] = [
      {
        key: `s:${supplier.id}`,
        name: supplier.name,
        country: supplier.country,
        region: regionOf(supplier.country, src.homeCountry),
        current: true,
        known: true,
        evidence: "actual",
        unitCost: view.currentPrice,
        level: null,
        qualification: "proven",
        // No quality record exists in the database yet: nothing is assumed in its place.
        quality: null,
        certifications: null,
        leadTimeDays: field("lead_time"),
        paymentDays: field("payment_terms"),
        moq: field("moq"),
        stage: null,
        asked: true,
        missing: [],
      },
    ];
    const has = (key: string) => options.some((o) => o.key === key);

    // Other suppliers the product was really bought from, at the price paid: still recent enough to stand next to today's.
    for (const r of p.comparison) {
      if (r.isCurrent || r.kind !== "purchase" || r.priceEUR == null || r.age === "old" || r.comparability === "not" || has(`s:${r.supplier.id}`)) continue;
      options.push({
        key: `s:${r.supplier.id}`,
        name: r.supplier.name,
        country: r.supplier.country ?? null,
        region: regionOf(r.supplier.country, src.homeCountry),
        current: false,
        known: true,
        evidence: "actual",
        unitCost: r.priceEUR,
        level: "to_validate",
        qualification: "proven",
        quality: null,
        certifications: null,
        leadTimeDays: r.termsFromDefaults ? null : r.leadTimeDays,
        paymentDays: r.termsFromDefaults ? null : r.paymentTermsDays,
        moq: r.moq,
        stage: null,
        asked: true,
        missing: [],
      });
    }

    // Real offers: on true cost when it is complete, on the quoted price — said to be so — when it is not.
    for (const q of src.costs.get(id)?.quotes ?? []) {
      if (q.expired || q.comparability === "not" || has(`s:${q.supplierId}`)) continue;
      const whole = q.cost.perUnit != null;
      const unitCost = whole ? q.cost.perUnit : q.priceEUR;
      if (unitCost == null) continue;
      options.push({
        key: `s:${q.supplierId}`,
        name: q.supplierName,
        country: q.country,
        region: regionOf(q.country, src.homeCountry),
        current: false,
        known: known.has(q.supplierId),
        evidence: whole ? "true_cost" : "quoted_price",
        unitCost,
        level: whole ? (q.opportunity?.level ?? "to_validate") : "theoretical",
        qualification: known.has(q.supplierId) ? "proven" : q.technicalConfirmed ? "confirmed" : "possible",
        quality: null,
        certifications: null,
        leadTimeDays: q.leadTimeDays,
        paymentDays: q.paymentTermsDays,
        moq: q.moq,
        stage: null,
        asked: true,
        missing: q.cost.missing,
      });
    }

    // Candidates from research: they can be counted, never given a product — nobody has a price from them.
    for (const s of view.screening.all) {
      if (s.stage !== "strong" && s.stage !== "plausible") continue;
      const c = s.candidate;
      const match = c.supplierId ? null : onFile.get(companyKey(c.name));
      const key = c.supplierId ? `s:${c.supplierId}` : match ? `s:${match.id}` : `c:${companyKey(c.name) || c.name.toLowerCase()}`;
      if (has(key)) continue;
      const qualification: Qualification = c.technicalCompatibility === "high" ? "confirmed" : c.technicalCompatibility === "partial" || s.stage === "strong" ? "possible" : "unknown";
      options.push({
        key,
        name: match?.name ?? c.name,
        country: c.country,
        region: s.region,
        current: false,
        known: !!(c.supplierId && known.has(c.supplierId)) || !!(match && known.has(match.id)),
        evidence: "none",
        unitCost: null,
        level: null,
        qualification,
        quality: null,
        certifications: c.certifications,
        leadTimeDays: c.leadTimeDays,
        paymentDays: null,
        moq: c.moq,
        stage: s.stage,
        asked: ASKED.includes(c.status),
        missing: [],
      });
    }

    const n = src.negotiations.get(id);
    products.push({
      id,
      name: p.product.name,
      unit: p.product.unit,
      group: p.product.category ?? p.product.kind ?? null,
      annualQuantity: quantity,
      quantityStatus: profile?.quantities.annual != null ? profile.quantities.annualStatus : "missing",
      typicalOrder: profile?.quantities.typicalOrder ?? p.typicalOrderQuantity,
      currentPrice: view.currentPrice,
      options,
      negotiation: n ? { status: n.status, low: n.range?.low ?? null, high: n.range?.high ?? null, target: n.target, upsideAnnual: n.upside?.annual ?? null, confidence: n.confidence } : null,
      criticality: n?.judgements.criticality.effective ?? null,
      switching: n?.judgements.switching_difficulty.effective ?? null,
    });
  }

  // The rest of each relationship: what is bought from the supplier beyond these products, brought to a year the way the relationship engine does.
  const outside: PortfolioInput["outside"] = {};
  for (const p of products) {
    const key = p.options[0].key;
    if (outside[key]) continue;
    const mine = products.filter((x) => x.options[0].key === key);
    const facts = src.negotiations.get(p.id)?.relationship?.facts;
    if (!facts) continue;
    const inScope = mine.reduce((sum, x) => sum + (src.negotiations.get(x.id)?.relationship?.facts.productSpend ?? 0), 0);
    outside[key] = { spend: Math.max(0, facts.supplierSpend - inScope) * (facts.annualFactor ?? 1), products: Math.max(0, facts.products - mine.length) };
  }

  const total = src.intel.products.reduce((sum, p) => sum + p.metrics.annualSpend, 0);
  const covered = scope.filter((p) => products.some((x) => x.id === p.product.id)).reduce((sum, p) => sum + p.metrics.annualSpend, 0);
  return { input: { products, outside, scopeShare: total > 0 ? covered / total : null }, priority: priority.length, leftOut };
}

/** For the page: the scope from this request's data. */
export async function getPortfolioScope(top: number): Promise<PortfolioScope> {
  await connection();
  const [intel, { views }, data, settings, t, db] = await Promise.all([getIntel(), getMarketViews(), getDataset(), getSettings(), getT(), getDb()]);
  const ids = priorityProducts(intel)
    .slice(0, top)
    .map((p) => p.product.id);
  const [costs, negotiations, profiles] = await Promise.all([readProductCosts(db, intel, views, t), getNegotiations(ids), getProfiles(ids)]);
  return portfolioInput({ intel, views, costs, negotiations, profiles, data, homeCountry: settings.country }, top);
}

/** The same, straight from the database: for the tests and for reading a copy of the data. */
export async function readPortfolioScope(db: DB, top: number, t: T = en): Promise<PortfolioScope> {
  const [{ views, intel, data }, settings] = await Promise.all([readMarketViews(db, t), readSettings(db)]);
  const ids = priorityProducts(intel)
    .slice(0, top)
    .map((p) => p.product.id);
  const [costs, negotiations, profiles] = await Promise.all([readProductCosts(db, intel, views, t), readNegotiations(db, t, ids), readProfiles(db, ids, t)]);
  return portfolioInput({ intel, views, costs, negotiations, profiles, data, homeCountry: settings.country }, top);
}
