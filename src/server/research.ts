/**
 * Deep research on the database: for one product, understand what it is,
 * look for who else could supply it, open their own sites and read what they
 * state, collect what price evidence exists, and conclude — keeping every
 * source. A run writes candidates, evidence and references; it never touches
 * a purchase, a price paid or a supplier on file.
 *
 * What goes outside goes through the provider interfaces, is counted
 * (research_usage), limited (lib/research/budget.ts) and reused while fresh
 * (research_cache). A source that is not connected is a step "not
 * configured": the run goes on with what it has and says so.
 */
import { createHash } from "node:crypto";
import { desc, eq, gte } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";
import { getDb, type DB } from "@/db";
import { marketBenchmarks, products, researchCache, researchEvidence, researchRuns, researchUsage, supplierCandidates, suppliers } from "@/db/schema";
import { categorize } from "@/lib/catalog/taxonomy";
import { countryFromIso, countryIso } from "@/lib/countries";
import { TIME_ZONE } from "@/lib/config";
import { readSettings } from "@/lib/data";
import * as f from "@/lib/format";
import { en, say, type Said, type T } from "@/lib/i18n";
import { companyKey, normalizeKey } from "@/lib/import/normalize/text";
import { UNITS, conversionFactor, normalizeUnit } from "@/lib/import/normalize/units";
import { Budget, limitsFor, limitsFrom, researchPlan, type PlanLine, type ResearchLimits, type ResearchPlan } from "@/lib/research/budget";
import { researchSummary } from "@/lib/research/conclusions";
import type { ResearchFile } from "@/lib/research/file";
import { inspectPage, productTerms, type PageFinding } from "@/lib/research/inspect";
import { countryCodeOfHost, leadsFromResults } from "@/lib/research/leads";
import type { StepKey, StepStatus } from "@/lib/research/steps";
import { STRATEGY, classifyProduct, isProductClass, type ProductClass } from "@/lib/research/strategy";
import { acceptDiscovered, hostOf, searchQueries, type Rejection } from "@/lib/sourcing/discovery";
import type { PageContent, Providers, TradeSeries, WebSearchResult } from "@/lib/sourcing/providers";
import type { Confidence, SourceLevel, SupplierCandidate, TechnicalFit } from "@/lib/sourcing/types";
import { connectedProviders } from "./providers";
import { SourceError } from "./providers/http";
import { candidateValues, discoveryRequest, readMarketViews, toCandidate } from "./sourcing";

export interface ResearchDeps {
  providers: Providers;
  limits: ResearchLimits;
  now: () => Date;
}

export const researchDeps = (): ResearchDeps => ({ providers: connectedProviders(), limits: limitsFrom(process.env), now: () => new Date() });

/** The key candidates found by research carry as their source. */
export const WEB_RESEARCH = "web_research";

export interface Step {
  key: StepKey;
  status: StepStatus;
  count?: number;
  note?: Said;
}

/** The calendar day where the company works — the same day todayISO() gives, not the UTC one. */
const iso = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TIME_ZONE });

// ---------------- Calls outside: cached, counted, limited ----------------

type Kind = "search" | "page" | "fx" | "trade";

class Sources {
  private used = new Map<string, { provider: string; kind: Kind; calls: number; cached: number; cost: number | null }>();
  constructor(
    private db: DB,
    private deps: ResearchDeps,
  ) {}

  static key = (provider: string, kind: Kind, request: string) => createHash("sha256").update(`${provider}|${kind}|${request}`).digest("hex");

  private count(provider: string, kind: Kind, cached: boolean, cost: number | null) {
    const k = `${provider}|${kind}`;
    const u = this.used.get(k) ?? { provider, kind, calls: 0, cached: 0, cost: 0 };
    u.calls++;
    if (cached) u.cached++;
    else u.cost = cost == null || u.cost == null ? null : u.cost + cost;
    this.used.set(k, u);
  }

  /** Whether a fresh answer is on file: asking again would cost nothing. */
  async fresh(provider: string, kind: Kind, request: string): Promise<boolean> {
    const [row] = await this.db.select({ expiresAt: researchCache.expiresAt }).from(researchCache).where(eq(researchCache.key, Sources.key(provider, kind, request)));
    return !!row && row.expiresAt > this.deps.now();
  }

  /** The answer of a source: from the cache while fresh, otherwise asked — if `allow` says the budget has room. Null: not asked. */
  async get<V>(provider: string, kind: Kind, request: string, fetcher: () => Promise<V>, options: { cost?: number | null; allow?: () => boolean } = {}): Promise<{ value: V; cached: boolean } | null> {
    const key = Sources.key(provider, kind, request);
    const now = this.deps.now();
    const [row] = await this.db.select().from(researchCache).where(eq(researchCache.key, key));
    if (row && row.expiresAt > now) {
      this.count(provider, kind, true, null);
      return { value: row.response as V, cached: true };
    }
    if (options.allow && !options.allow()) return null;
    let failure: unknown;
    for (let attempt = 0; attempt <= this.deps.limits.maxRetries; attempt++) {
      this.count(provider, kind, false, options.cost ?? (kind === "search" ? null : 0));
      try {
        const value = await fetcher();
        const expiresAt = new Date(now.getTime() + this.deps.limits.cacheDays[kind] * 86_400_000);
        await this.db.insert(researchCache).values({ key, provider, kind, request, response: value as unknown, retrievedAt: now, expiresAt }).onConflictDoUpdate({ target: researchCache.key, set: { response: value as unknown, retrievedAt: now, expiresAt } });
        return { value, cached: false };
      } catch (err) {
        failure = err;
        // Refused is refused: asking again changes nothing.
        if (err instanceof SourceError && err.status != null && err.status >= 400 && err.status < 500 && err.status !== 429) break;
      }
    }
    throw failure;
  }

  async save(runId: string | null, productId: string | null) {
    const rows = [...this.used.values()];
    if (rows.length) await this.db.insert(researchUsage).values(rows.map((u) => ({ runId, productId, provider: u.provider, kind: u.kind, calls: u.calls, cached: u.cached, estimatedCost: u.cost == null ? null : String(u.cost) })));
    return rows;
  }
}

/** EUR estimated for today's research so far. */
export async function spentToday(db: DB, now: Date): Promise<number> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const rows = await db.select({ cost: researchUsage.estimatedCost }).from(researchUsage).where(gte(researchUsage.createdAt, start));
  return rows.reduce((s, r) => s + Number(r.cost ?? 0), 0);
}

// ---------------- One research ----------------

export interface ResearchOutcome {
  runId: string;
  status: "completed" | "partial" | "failed";
  /** New candidates found. */
  added: number;
  /** Pages opened. */
  checked: number;
  evidence: number;
  errors: { step: string; message: string }[];
}

const dimensionOf = (unit: string) => UNITS.find((u) => u.code === (normalizeUnit(unit) ?? unit))?.dimension ?? null;

/** What a page says about the product, as evidence. */
function findingOf(name: string, finding: PageFinding): { finding: Said; comparability: string | null; confidence: Confidence } {
  if (finding.fit === "high") return { finding: say("{name}'s own site states the product and the specification ({spec}).", { name, spec: finding.confirmed.join(", ") }), comparability: "comparable", confidence: "medium" };
  if (finding.fit === "partial" && finding.missing.length) return { finding: say("{name}'s own site states the product, not the exact specification ({spec}): to confirm with them.", { name, spec: finding.missing.join(", ") }), comparability: "partial", confidence: "low" };
  if (finding.fit === "partial") return { finding: say("{name}'s own site states the product; the specification has to be confirmed with them.", { name }), comparability: "partial", confidence: "low" };
  return { finding: say("The page read on {name}'s site does not state the product.", { name }), comparability: null, confidence: "low" };
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The months trade statistics are asked for: the last `n` before the current one (the newest are published weeks later). */
export function tradeMonths(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export async function runResearch(db: DB, productId: string, deps: ResearchDeps = researchDeps(), t: T = en): Promise<ResearchOutcome> {
  const built = await discoveryRequest(db, productId, t);
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!built || !product) throw new Error("Product not found");
  const { providers } = deps;
  // How deep to go follows how much the product weighs.
  const limits = limitsFor(deps.limits, (await readMarketViews(db, t)).views.get(productId)?.materiality ?? "minor");
  const settings = await readSettings(db);
  const today = iso(deps.now());
  const cls = classifyProduct({ name: product.name, kind: product.kind, unit: product.unit, specifications: built.request.specifications, companyName: settings.companyName, override: product.researchClass });
  const strategy = STRATEGY[cls.productClass];
  const [run] = await db.insert(researchRuns).values({ productId, productClass: cls.productClass, depth: "standard", startedAt: deps.now() }).returning();
  const sources = new Sources(db, deps);
  const budget = new Budget(limits, await spentToday(db, deps.now()));
  const steps: Step[] = [];
  const errors: { step: string; message: string }[] = [];
  const queries: { query: string; results: number; cached: boolean }[] = [];
  let added = 0;
  let evidenceCount = 0;
  let sourcesChecked = 0;
  const evidence = async (row: Omit<typeof researchEvidence.$inferInsert, "runId" | "productId">) => {
    await db.insert(researchEvidence).values({ ...row, runId: run.id, productId });
    evidenceCount++;
  };

  try {
    // 1. What it is, and so what is worth looking for.
    steps.push({ key: "understand", status: "done", note: say(strategy.plan) });

    // 2. The searches.
    const wanted = searchQueries({ ...built.query, productClass: cls.productClass }, t).slice(0, limits.maxSearchesPerProduct);
    steps.push({ key: "queries", status: "done", count: wanted.length });

    // 3. Possible suppliers: pages from a search engine, not yet suppliers.
    const engine = providers.webSearch[0];
    const searches: { query: string; results: WebSearchResult[] }[] = [];
    if (!engine) steps.push({ key: "discover", status: "not_configured", note: say("No web search provider is configured: no new supplier was looked for. The candidates on file were checked.") });
    else {
      let stopped = false;
      for (const query of wanted) {
        try {
          const got = await sources.get(engine.key, "search", `${query}|${limits.resultsPerSearch}`, () => engine.search(query, { count: limits.resultsPerSearch, country: countryIso(settings.country) }), { cost: engine.costPerQuery, allow: () => budget.canSearch(engine.costPerQuery) });
          if (!got) {
            stopped = true;
            break;
          }
          budget.search(engine.costPerQuery, got.cached);
          sourcesChecked++;
          searches.push({ query, results: got.value });
          queries.push({ query, results: got.value.length, cached: got.cached });
        } catch (err) {
          errors.push({ step: "discover", message: describe(err) });
        }
      }
      steps.push({ key: "discover", status: searches.length ? "done" : "failed", count: searches.reduce((s, x) => s + x.results.length, 0), note: stopped ? say("Stopped at the spending limit: not every search was run.") : undefined });
    }

    // 4. Their own sites: does the page state the product, and the specification?
    const existing = (await db.select().from(supplierCandidates).where(eq(supplierCandidates.productId, productId))).map(toCandidate);
    const reader = providers.pages[0];
    const terms = productTerms({ name: product.name, knownSuppliers: built.request.knownSuppliers, companyName: settings.companyName });
    const { leads } = leadsFromResults(searches, { knownHosts: existing.flatMap((c) => [hostOf(c.website), hostOf(c.sourceUrl)]).filter((h): h is string => !!h), knownSuppliers: built.request.knownSuppliers, max: limits.maxPagesPerProduct });
    if (!reader) steps.push({ key: "inspect", status: "not_configured", note: say("Reading suppliers' websites is switched off.") });
    else if (!terms.words.length) {
      // A name made of codes: there is nothing to look for on a page, and "not found" would be a false finding.
      for (const c of existing.filter((x) => x.specCheck)) await db.update(supplierCandidates).set({ specCheck: null, updatedAt: deps.now() }).where(eq(supplierCandidates.id, c.id));
      steps.push({ key: "inspect", status: "skipped", note: say("The product's name does not say what it is, so its candidates' sites can't be checked against it. Give the product a readable name to check them.") });
    } else {
      let opened = 0;
      const read = async (url: string): Promise<PageContent | null> => {
        if (!budget.canOpenPage()) return null;
        budget.page();
        const got = await sources.get(reader.key, "page", url, () => reader.read(url));
        opened++;
        sourcesChecked++;
        return got!.value;
      };
      // Candidates on file first: they are already someone's finding. Their own judgement is never overwritten.
      const stale = (c: SupplierCandidate) => !c.specCheck || c.specCheck.email === undefined || (deps.now().getTime() - new Date(c.specCheck.checkedAt).getTime()) / 86_400_000 > limits.cacheDays.page;
      for (const c of existing.filter((x) => x.status !== "rejected" && (x.sourceUrl ?? x.website) && stale(x))) {
        const url = (c.sourceUrl ?? c.website)!;
        try {
          const page = await read(url);
          if (!page) break;
          const found = inspectPage(page, terms);
          await db
            .update(supplierCandidates)
            .set({
              specCheck: { url, checkedAt: today, email: found.email, product: found.product, confirmed: found.confirmed, missing: found.missing },
              companyType: c.companyType ?? found.companyType,
              sourceTitle: c.sourceTitle ?? page.title,
              technicalCompatibility: c.technicalCompatibility ?? found.fit,
              updatedAt: deps.now(),
            })
            .where(eq(supplierCandidates.id, c.id));
          const own = hostOf(url) === hostOf(c.website ?? url);
          await evidence({ candidateId: c.id, type: "specification", sourceName: page.title ?? hostOf(url) ?? url, sourceUrl: url, retrievedAt: deps.now(), excerpt: found.excerpt, reliability: own ? "supplier_official" : c.sourceLevel, ...findingOf(c.name, found) });
        } catch (err) {
          errors.push({ step: "inspect", message: `${c.name}: ${describe(err)}` });
        }
      }
      // New sites: a candidate only if its own page states the product.
      const kept = [...existing];
      for (const lead of leads) {
        try {
          const page = await read(lead.url);
          if (!page) break;
          const found = inspectPage(page, terms);
          if (!found.fit) continue;
          const code = countryCodeOfHost(lead.host);
          const accepted = acceptDiscovered(
            { name: found.companyName, country: code ? countryFromIso(code) : null, website: new URL(page.url).origin, sourceUrl: page.url, sourceTitle: page.title, sourceLevel: "supplier_official", companyType: found.companyType, productMatched: found.excerpt, technicalCompatibility: found.fit, confidence: found.fit === "high" ? "medium" : "low", query: lead.queries[0] },
            { productId, provider: WEB_RESEARCH, knownSuppliers: built.request.knownSuppliers, existing: kept, discoveredAt: today },
          );
          if (!accepted.ok) continue;
          const [row] = await db
            .insert(supplierCandidates)
            .values({ ...candidateValues(accepted.candidate), specCheck: { url: page.url, checkedAt: today, email: found.email, product: found.product, confirmed: found.confirmed, missing: found.missing } })
            .returning();
          kept.push(toCandidate(row));
          added++;
          await evidence({ candidateId: row.id, type: "supplier", sourceName: page.title ?? lead.host, sourceUrl: page.url, retrievedAt: deps.now(), excerpt: found.excerpt, reliability: "supplier_official", ...findingOf(found.companyName, found) });
          if (code) await evidence({ candidateId: row.id, type: "supplier", sourceName: lead.host, sourceUrl: page.url, retrievedAt: deps.now(), finding: say("{name}: country read from the site's domain (.{tld}), to confirm.", { name: found.companyName, tld: lead.host.split(".").pop()! }), reliability: "external", confidence: "low" });
        } catch (err) {
          errors.push({ step: "inspect", message: `${lead.host}: ${describe(err)}` });
        }
      }
      steps.push({ key: "inspect", status: "done", count: opened, note: !budget.canOpenPage() && opened > 0 ? say("The limit of pages per product was reached: the rest was not opened.") : undefined });
    }

    // 5. Price evidence on file: references in another currency get the official rate of their date.
    const references = await db.select().from(marketBenchmarks).where(eq(marketBenchmarks.productId, productId));
    const rates = providers.fx[0];
    // A reference about a month takes that month's average rate, not the rate of one day — and never today's.
    const monthly = (x: (typeof references)[number]) => !!x.periodMonth && !!rates?.average;
    for (const b of references.filter((x) => x.currency.toUpperCase() !== "EUR" && x.low != null && (x.fxRate == null || (monthly(x) && x.fxMethod !== "month_average")))) {
      if (!rates) break;
      try {
        const date = b.sourceDate ?? today;
        const got = monthly(b) ? await sources.get(rates.key, "fx", `${b.currency}|avg|${b.periodMonth}`, () => rates.average!(b.currency, b.periodMonth!)) : await sources.get(rates.key, "fx", `${b.currency}|${date}`, () => rates.rate(b.currency, date));
        sourcesChecked++;
        if (!got?.value) continue;
        await db.update(marketBenchmarks).set({ fxRate: String(got.value.rate), fxDate: got.value.date, fxMethod: monthly(b) ? "month_average" : "day", updatedAt: deps.now() }).where(eq(marketBenchmarks.id, b.id));
        await evidence({
          type: "fx",
          sourceName: got.value.sourceName,
          sourceUrl: got.value.sourceUrl,
          retrievedAt: deps.now(),
          publishedAt: got.value.date,
          finding: monthly(b)
            ? say("{currency} converted at {rate} for one euro, the average of the reference rates of {month}.", { currency: b.currency, rate: f.number(got.value.rate, 4), month: b.periodMonth! })
            : say("{currency} converted at {rate} for one euro, the reference rate of {date}.", { currency: b.currency, rate: f.number(got.value.rate, 4), date: f.date(got.value.date) }),
          reliability: "official_data",
          confidence: "high",
        });
      } catch (err) {
        errors.push({ step: "pricing", message: describe(err) });
      }
    }
    steps.push({
      key: "pricing",
      status: "done",
      count: references.filter((b) => b.provider !== providers.trade[0]?.key).length,
      note: strategy.benchmarks && !providers.benchmark.length ? say("No benchmark provider is connected: only the references added by hand or loaded from research are on file.") : !strategy.benchmarks && !strategy.publicPrices ? say("No public price exists for a product made to a specification: only quotes can tell.") : undefined,
    });

    // 6. Trade statistics, where they mean something: a product bought by weight, with a customs code.
    const trade = providers.trade[0];
    if (!strategy.trade) steps.push({ key: "trade", status: "skipped", note: say("Not useful for this kind of product.") });
    else if (!trade) steps.push({ key: "trade", status: "not_configured" });
    else if (dimensionOf(product.unit) !== "mass") steps.push({ key: "trade", status: "skipped", note: say("Trade statistics are by weight; this product is bought per {unit}: not comparable.", { unit: product.unit }) });
    else {
      const code = product.customsCode ?? categorize(product.name)?.sub.customs ?? null;
      const reporter = countryIso(settings.country);
      if (!code) steps.push({ key: "trade", status: "skipped", note: say("No customs code for this product: add it to include trade statistics.") });
      else if (!reporter) steps.push({ key: "trade", status: "skipped", note: say("Your country is not set: trade statistics need to know where the goods enter.") });
      else {
        try {
          const months = tradeMonths(deps.now(), limits.tradeMonths);
          const got = await sources.get<TradeSeries | null>(trade.key, "trade", `${code}|${reporter}|${months.join(",")}`, () => trade.imports({ code, reporter, months }));
          sourcesChecked++;
          const series = got?.value;
          const last = series?.months.slice(-3) ?? [];
          const perKg = conversionFactor("kg", normalizeUnit(product.unit) ?? product.unit) ?? 1;
          if (!series || !last.length) steps.push({ key: "trade", status: "done", count: 0, note: say("No imports recorded under code {code} in the last months.", { code }) });
          else {
            const values = last.map((m) => m.valueEUR / m.quantityKg / perKg);
            const [low, high] = [Math.min(...values), Math.max(...values)];
            const period = `${last[0].period} – ${last[last.length - 1].period}`;
            // One trade reference per product: the latest replaces the one before.
            for (const old of references.filter((b) => b.provider === trade.key)) await db.delete(marketBenchmarks).where(eq(marketBenchmarks.id, old.id));
            await db.insert(marketBenchmarks).values({
              productId,
              type: "trade_benchmark",
              label: [code, series.description].filter(Boolean).join(" — "),
              low: String(low),
              high: String(high),
              unit: product.unit,
              currency: "EUR",
              period,
              sourceName: series.sourceName,
              sourceUrl: series.sourceUrl,
              sourceDate: series.updated ?? today,
              sourceLevel: "official_data",
              comparability: "partial",
              provider: trade.key,
            });
            await evidence({
              type: "trade",
              sourceName: series.sourceName,
              sourceUrl: series.sourceUrl,
              retrievedAt: deps.now(),
              publishedAt: series.updated,
              finding: say("Imports under customs code {code} (reporting country {country}): {low}–{high} per {unit} on average, {period}.", { country: reporter, code, low: f.priceShort(low), high: f.priceShort(high), unit: product.unit, period }),
              excerpt: series.description,
              reliability: "official_data",
              comparability: "partial",
              confidence: "low",
            });
            steps.push({ key: "trade", status: "done", count: last.length, note: product.customsCode && product.customsCodeConfirmed ? undefined : say("Customs code {code} is a suggestion from the product's category: confirm it.", { code }) });
          }
        } catch (err) {
          errors.push({ step: "trade", message: describe(err) });
          steps.push({ key: "trade", status: "failed" });
        }
      }
    }

    // 7. What it comes to.
    const view = (await readMarketViews(db, t)).views.get(productId);
    const summary = view ? researchSummary(view) : [];
    steps.push({ key: "conclude", status: "done" });
    const status = errors.length ? "partial" : "completed";
    await db
      .update(researchRuns)
      .set({ status, completedAt: deps.now(), sourcesChecked, resultsFound: added + evidenceCount, confidence: view?.range?.reliable ? view.range.confidence : "low", summary, steps, queries, errors })
      .where(eq(researchRuns.id, run.id));
    return { runId: run.id, status, added, checked: budget.pages, evidence: evidenceCount, errors };
  } catch (err) {
    errors.push({ step: "run", message: describe(err) });
    await db.update(researchRuns).set({ status: "failed", completedAt: deps.now(), sourcesChecked, resultsFound: added + evidenceCount, steps, queries, errors }).where(eq(researchRuns.id, run.id));
    return { runId: run.id, status: "failed", added, checked: budget.pages, evidence: evidenceCount, errors };
  } finally {
    await sources.save(run.id, productId);
  }
}

// ---------------- Before starting: what it will take ----------------

export interface PlanView extends ResearchPlan {
  searchProvider: string | null;
  /** EUR per search, when known. */
  costPerQuery: number | null;
  limits: Pick<ResearchLimits, "maxSearchesPerProduct" | "maxPagesPerProduct" | "dailyCostLimit">;
  spentToday: number;
}

export async function planResearch(db: DB, productIds: string[], deps: ResearchDeps = researchDeps(), t: T = en): Promise<PlanView> {
  const engine = deps.providers.webSearch[0] ?? null;
  const sources = new Sources(db, deps);
  const settings = await readSettings(db);
  const lines: PlanLine[] = [];
  const { views } = await readMarketViews(db, t);
  for (const productId of productIds) {
    const limits = limitsFor(deps.limits, views.get(productId)?.materiality ?? "minor");
    const built = await discoveryRequest(db, productId, t);
    const [product] = await db.select().from(products).where(eq(products.id, productId));
    if (!built || !product) continue;
    const cls = classifyProduct({ name: product.name, kind: product.kind, unit: product.unit, specifications: built.request.specifications, companyName: settings.companyName, override: product.researchClass });
    const wanted = searchQueries({ ...built.query, productClass: cls.productClass }, t).slice(0, limits.maxSearchesPerProduct);
    let cached = 0;
    if (engine) for (const q of wanted) if (await sources.fresh(engine.key, "search", `${q}|${limits.resultsPerSearch}`)) cached++;
    lines.push({ productId, name: product.name, queries: engine ? wanted.length : 0, cached, pages: limits.maxPagesPerProduct });
  }
  const spent = await spentToday(db, deps.now());
  return {
    ...researchPlan(lines, engine?.costPerQuery ?? null, !!engine, deps.limits, spent),
    searchProvider: engine?.name ?? null,
    costPerQuery: engine?.costPerQuery ?? null,
    limits: { maxSearchesPerProduct: deps.limits.maxSearchesPerProduct, maxPagesPerProduct: deps.limits.maxPagesPerProduct, dailyCostLimit: deps.limits.dailyCostLimit },
    spentToday: spent,
  };
}

// ---------------- Research done outside the app ----------------

export interface ImportOutcome {
  candidates: number;
  benchmarks: number;
  products: { id: string; name: string; candidates: number; benchmarks: number }[];
  /** Product references in the file that match nothing in the catalogue. */
  unknown: string[];
  skipped: { name: string; product: string; reason: Rejection | "already_on_file" }[];
}

/**
 * Loads a research file: its suppliers become candidates "discovered", its
 * price references market references, each with its source and the date of
 * the research. With `dryRun`, says what would be loaded and writes nothing.
 */
export async function importResearch(db: DB, file: ResearchFile, options: { dryRun: boolean }, deps: ResearchDeps = researchDeps(), t: T = en): Promise<ImportOutcome> {
  const all = await db.select().from(products);
  const find = (ref: string) => all.find((p) => p.id === ref) ?? all.find((p) => p.sku === ref) ?? all.find((p) => normalizeKey(p.name) === normalizeKey(ref));
  const settings = await readSettings(db);
  const out: ImportOutcome = { candidates: 0, benchmarks: 0, products: [], unknown: [], skipped: [] };
  const touched = new Map<string, { id: string; name: string; candidates: number; benchmarks: number; runId: string | null; evidence: number; urls: Set<string> }>();
  const unknown = new Set<string>();
  const state = async (p: (typeof all)[number]) => {
    let s = touched.get(p.id);
    if (!s) {
      let runId: string | null = null;
      if (!options.dryRun) {
        const built = await discoveryRequest(db, p.id, t);
        const cls = classifyProduct({ name: p.name, kind: p.kind, unit: p.unit, specifications: built?.request.specifications ?? {}, companyName: settings.companyName, override: p.researchClass });
        const [run] = await db.insert(researchRuns).values({ productId: p.id, productClass: cls.productClass, depth: "imported", startedAt: deps.now() }).returning();
        runId = run.id;
      }
      s = { id: p.id, name: p.name, candidates: 0, benchmarks: 0, runId, evidence: 0, urls: new Set() };
      touched.set(p.id, s);
    }
    return s;
  };
  const existing = (await db.select().from(supplierCandidates)).map(toCandidate);
  const known = new Map<string, string[]>();
  const retrievedAt = new Date(`${file.researchedAt}T12:00:00Z`);

  for (const c of file.candidates) {
    for (const ref of c.products) {
      const p = find(ref);
      if (!p) {
        unknown.add(ref);
        continue;
      }
      if (!known.has(p.id)) known.set(p.id, (await discoveryRequest(db, p.id, t))?.request.knownSuppliers ?? []);
      const accepted = acceptDiscovered(
        { name: c.name, country: c.country, website: c.website, sourceUrl: c.sourceUrl, sourceTitle: c.sourceTitle, sourceDate: file.researchedAt, sourceLevel: c.sourceLevel, companyType: c.companyType, productMatched: c.matchedProduct, matchReason: c.matchExplanation, technicalCompatibility: c.technicalCompatibility as TechnicalFit | null | undefined, confidence: c.confidence, notes: c.notes },
        { productId: p.id, provider: WEB_RESEARCH, knownSuppliers: known.get(p.id)!, existing: existing.filter((x) => x.productId === p.id), discoveredAt: file.researchedAt },
      );
      if (!accepted.ok) {
        out.skipped.push({ name: c.name, product: p.name, reason: accepted.reason });
        continue;
      }
      const s = await state(p);
      s.candidates++;
      s.urls.add(c.sourceUrl);
      out.candidates++;
      if (options.dryRun) {
        existing.push({ ...accepted.candidate, id: `new-${out.candidates}` });
        continue;
      }
      const [row] = await db.insert(supplierCandidates).values(candidateValues(accepted.candidate)).returning();
      existing.push(toCandidate(row));
      await db.insert(researchEvidence).values({
        runId: s.runId!,
        productId: p.id,
        candidateId: row.id,
        type: "supplier",
        sourceName: c.sourceTitle ?? hostOf(c.sourceUrl) ?? c.name,
        sourceUrl: c.sourceUrl,
        retrievedAt,
        finding: say("{name}: found by research outside the app and loaded with its source. Not validated.", { name: c.name }),
        excerpt: c.matchedProduct ?? null,
        reliability: c.sourceLevel satisfies SourceLevel,
        confidence: c.confidence ?? "low",
      });
      s.evidence++;
    }
  }

  const references = await db.select().from(marketBenchmarks);
  for (const b of file.benchmarks) {
    const p = find(b.product);
    if (!p) {
      unknown.add(b.product);
      continue;
    }
    if (references.some((x) => x.productId === p.id && x.sourceName === b.sourceName && x.sourceDate === b.sourceDate && x.label === b.label)) {
      out.skipped.push({ name: b.label, product: p.name, reason: "already_on_file" });
      continue;
    }
    const s = await state(p);
    s.benchmarks++;
    if (b.sourceUrl) s.urls.add(b.sourceUrl);
    out.benchmarks++;
    if (options.dryRun) continue;
    await db.insert(marketBenchmarks).values({ productId: p.id, type: b.type, label: b.label, low: String(b.low), high: String(b.high ?? b.low), unit: b.unit, currency: b.currency.toUpperCase(), sourceName: b.sourceName, sourceUrl: b.sourceUrl ?? null, sourceDate: b.sourceDate, sourceLevel: b.sourceLevel, comparability: b.comparability, notes: b.notes ?? null, provider: WEB_RESEARCH });
    await db.insert(researchEvidence).values({
      runId: s.runId!,
      productId: p.id,
      type: b.type === "trade_benchmark" ? "trade" : "benchmark",
      sourceName: b.sourceName,
      sourceUrl: b.sourceUrl ?? null,
      retrievedAt,
      publishedAt: b.sourceDate,
      finding: say("{label}: {currency} {low} per {unit}, as published by {source}.", { label: b.label, currency: b.currency.toUpperCase(), low: f.number(b.low), unit: b.unit, source: b.sourceName }),
      reliability: b.sourceLevel,
      comparability: b.comparability,
      confidence: "low",
    });
    s.evidence++;
  }

  if (!options.dryRun && touched.size) {
    const { views } = await readMarketViews(db, t);
    for (const s of touched.values()) {
      const view = views.get(s.id);
      await db
        .update(researchRuns)
        .set({
          status: "completed",
          completedAt: deps.now(),
          sourcesChecked: s.urls.size,
          resultsFound: s.candidates + s.benchmarks,
          confidence: view?.range?.reliable ? view.range.confidence : "low",
          summary: view ? researchSummary(view) : [],
          steps: [{ key: "imported", status: "done", count: s.candidates + s.benchmarks, note: say("{source}, {date}: loaded with its sources. Nothing was checked again by the app.", { source: file.source, date: f.date(file.researchedAt) }) }],
        })
        .where(eq(researchRuns.id, s.runId!));
    }
  }
  out.products = [...touched.values()].map(({ id, name, candidates, benchmarks }) => ({ id, name, candidates, benchmarks }));
  out.unknown = [...unknown];
  return out;
}

// ---------------- Decisions that are the user's ----------------

/** The candidate becomes a supplier on file — only when the user says so. An existing supplier of the same name is linked, not duplicated. */
export async function convertCandidate(db: DB, id: string): Promise<{ supplierId: string; created: boolean }> {
  const [c] = await db.select().from(supplierCandidates).where(eq(supplierCandidates.id, id));
  if (!c) throw new Error("Candidate not found");
  const key = companyKey(c.name);
  const same = (await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)).find((s) => companyKey(s.name) === key);
  const supplierId = same?.id ?? (await db.insert(suppliers).values({ name: c.name, country: c.country, website: c.website }).returning({ id: suppliers.id }))[0].id;
  // Every candidate of the same company, on whatever product, now points to the one supplier.
  for (const other of (await db.select().from(supplierCandidates)).filter((x) => companyKey(x.name) === key)) {
    await db.update(supplierCandidates).set({ supplierId, ...(other.id === id ? { status: "converted" } : {}), updatedAt: new Date() }).where(eq(supplierCandidates.id, other.id));
  }
  return { supplierId, created: !same };
}

export async function setCustomsCode(db: DB, productId: string, code: string | null, confirmed: boolean): Promise<void> {
  await db.update(products).set({ customsCode: code, customsCodeConfirmed: !!code && confirmed, updatedAt: new Date() }).where(eq(products.id, productId));
}

export async function setResearchClass(db: DB, productId: string, productClass: string | null): Promise<void> {
  await db.update(products).set({ researchClass: isProductClass(productClass) ? productClass : null, updatedAt: new Date() }).where(eq(products.id, productId));
}

// ---------------- For the pages ----------------

export interface RunView {
  id: string;
  productId: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  depth: string;
  productClass: ProductClass | null;
  sourcesChecked: number;
  resultsFound: number;
  confidence: Confidence | null;
  summary: Said[];
  steps: Step[];
  queries: { query: string; results: number; cached: boolean }[];
  errors: { step: string; message: string }[];
}

export interface EvidenceView {
  id: string;
  runId: string;
  productId: string;
  candidateId: string | null;
  type: string;
  sourceName: string;
  sourceUrl: string | null;
  retrievedAt: string;
  publishedAt: string | null;
  finding: Said;
  excerpt: string | null;
  reliability: SourceLevel;
  comparability: string | null;
  confidence: string | null;
}

export async function readResearch(db: DB): Promise<{ runs: RunView[]; evidence: EvidenceView[] }> {
  const [runs, evidence] = await Promise.all([db.select().from(researchRuns).orderBy(desc(researchRuns.startedAt)), db.select().from(researchEvidence).orderBy(desc(researchEvidence.retrievedAt))]);
  return {
    runs: runs.map((r) => ({
      id: r.id,
      productId: r.productId,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      status: r.status,
      depth: r.depth,
      productClass: isProductClass(r.productClass) ? r.productClass : null,
      sourcesChecked: r.sourcesChecked,
      resultsFound: r.resultsFound,
      confidence: (["high", "medium", "low"] as const).find((c) => c === r.confidence) ?? null,
      summary: r.summary ?? [],
      steps: (r.steps ?? []) as Step[],
      queries: r.queries ?? [],
      errors: r.errors ?? [],
    })),
    evidence: evidence.map((e) => ({
      id: e.id,
      runId: e.runId,
      productId: e.productId,
      candidateId: e.candidateId,
      type: e.type,
      sourceName: e.sourceName,
      sourceUrl: e.sourceUrl,
      retrievedAt: e.retrievedAt.toISOString(),
      publishedAt: e.publishedAt,
      finding: e.finding,
      excerpt: e.excerpt,
      reliability: e.reliability as SourceLevel,
      comparability: e.comparability,
      confidence: e.confidence,
    })),
  };
}

export const getResearch = cache(async () => {
  await connection();
  return readResearch(await getDb());
});

/** What research has used: calls made, answers reused, and what it is estimated to have cost. */
export async function readUsage(db: DB, now: Date = new Date()) {
  const rows = await db.select().from(researchUsage);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const sum = (list: typeof rows) => ({ calls: list.reduce((s, r) => s + r.calls, 0), cached: list.reduce((s, r) => s + r.cached, 0), cost: list.some((r) => r.estimatedCost == null && r.calls > r.cached) ? null : list.reduce((s, r) => s + Number(r.estimatedCost ?? 0), 0) });
  return { total: sum(rows), today: sum(rows.filter((r) => r.createdAt >= start)), byProvider: [...new Set(rows.map((r) => r.provider))].map((provider) => ({ provider, ...sum(rows.filter((r) => r.provider === provider)) })) };
}
