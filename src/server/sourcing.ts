/**
 * Sourcing on the database: possible suppliers and market references of a
 * product. Every row carries where it comes from. Discovery runs through the
 * connected providers (none today): what they return is kept only if it has
 * a source, and always as "discovered" — for the user to review.
 */
import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";
import type { z } from "zod";
import { getDb, type DB } from "@/db";
import { marketBenchmarks, productFamilies, products, purchases, quotes, rfqRequests, supplierCandidates, suppliers } from "@/db/schema";
import { todayISO, windowStart } from "@/lib/analytics";
import { ATTRIBUTE_LABEL, attributesOf } from "@/lib/catalog/attributes";
import { catalogueOf } from "@/lib/catalog/spend";
import { getIntel, getOverview, getSettings, getT, readDataset, readLearning, readOpportunityStates, readSettings } from "@/lib/data";
import { purchasingOverview, type PurchasingOverview } from "@/lib/intel/decision";
import { analyze, type Intel } from "@/lib/intel/engine";
import { en, type T } from "@/lib/i18n";
import { acceptDiscovered, neutralName, refineQueries, searchQueries, type QueryInput, type Rejection } from "@/lib/sourcing/discovery";
import { companyKey } from "@/lib/import/normalize/text";
import { marketView, sourcingReview, type MarketView, type SourcingReview } from "@/lib/sourcing/market";
import { supplierOpportunities, type Materiality, type RfqRequest, type SupplierOpportunity } from "@/lib/sourcing/screening";
import type { DiscoveryRequest, Providers } from "@/lib/sourcing/providers";
import { SOURCING_CONFIG, isCandidateStatus, isCompanyType, isPriceType, isSourceLevel, isTechnicalFit, type CandidateStatus, type Comparability, type Confidence, type MarketBenchmark, type SupplierCandidate, type TechnicalFit } from "@/lib/sourcing/types";
import type { benchmarkInput, candidateInput } from "@/lib/validation";
import { connectedProviders } from "./providers";

const numOrNull = (v: string | null) => (v == null ? null : Number(v));
const text = (n: number | null | undefined) => (n == null ? null : String(n));

export function toCandidate(r: typeof supplierCandidates.$inferSelect): SupplierCandidate {
  return {
    id: r.id,
    productId: r.productId,
    name: r.name,
    country: r.country,
    website: r.website,
    source: r.source,
    sourceLevel: isSourceLevel(r.sourceLevel) ? r.sourceLevel : "external",
    sourceUrl: r.sourceUrl,
    sourceDate: r.sourceDate,
    productMatched: r.productMatched,
    matchReason: r.matchReason,
    technicalCompatibility: isTechnicalFit(r.technicalCompatibility) ? r.technicalCompatibility : null,
    specifications: r.specifications ?? null,
    priceLow: numOrNull(r.priceLow),
    priceHigh: numOrNull(r.priceHigh),
    priceType: isPriceType(r.priceType) ? r.priceType : null,
    priceSourceUrl: r.priceSourceUrl,
    currency: r.currency,
    unit: r.unit,
    incoterm: r.incoterm,
    moq: numOrNull(r.moq),
    leadTimeDays: r.leadTimeDays,
    paymentTerms: r.paymentTerms,
    certifications: r.certifications,
    shippingOrigin: r.shippingOrigin,
    confidence: (["high", "medium", "low"] as const).find((c) => c === r.confidence) ?? null,
    notes: r.notes,
    status: isCandidateStatus(r.status) ? r.status : "discovered",
    supplierId: r.supplierId,
    companyType: isCompanyType(r.companyType) ? r.companyType : null,
    sourceTitle: r.sourceTitle,
    discoveredAt: r.discoveredAt,
    specCheck: r.specCheck ?? null,
  };
}

export function toBenchmark(r: typeof marketBenchmarks.$inferSelect): MarketBenchmark {
  return {
    id: r.id,
    productId: r.productId,
    type: (["direct_benchmark", "trade_benchmark", "cost_driver", "estimate"] as const).find((x) => x === r.type) ?? "estimate",
    label: r.label,
    low: numOrNull(r.low),
    high: numOrNull(r.high),
    unit: r.unit,
    currency: r.currency,
    changePct: r.changePct,
    period: r.period,
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    sourceDate: r.sourceDate,
    fxRate: numOrNull(r.fxRate),
    fxDate: r.fxDate,
    sourceLevel: isSourceLevel(r.sourceLevel) ? r.sourceLevel : "external",
    comparability: (["comparable", "partial", "not"] as const).find((x) => x === r.comparability) ?? "partial",
    notes: r.notes,
    provider: r.provider,
  };
}

export async function readSourcing(db: DB): Promise<{ candidates: SupplierCandidate[]; benchmarks: MarketBenchmark[]; requests: RfqRequest[] }> {
  const [c, b, r] = await Promise.all([db.select().from(supplierCandidates).orderBy(supplierCandidates.createdAt), db.select().from(marketBenchmarks).orderBy(marketBenchmarks.createdAt), db.select().from(rfqRequests).orderBy(rfqRequests.sentAt)]);
  return {
    candidates: c.map(toCandidate),
    benchmarks: b.map(toBenchmark),
    requests: r.map((x) => ({ id: x.id, supplierKey: x.supplierKey, supplierName: x.supplierName, candidateIds: x.candidateIds, productIds: x.productIds, kind: x.kind === "update" || x.kind === "follow_up" ? x.kind : "request", sentAt: x.sentAt })),
  };
}

/**
 * The user says the requests were sent: each supplier is remembered once,
 * with the products asked about, and its candidates move to "RFQ sent" —
 * unless they are already further along. Nothing is sent from here.
 */
export async function markRequestsSent(db: DB, items: { supplierName: string; candidateIds: string[]; productIds: string[] }[], kind: RfqRequest["kind"], sentAt: string = todayISO()): Promise<void> {
  const further = new Set<CandidateStatus>(["quote_received", "converted"]);
  for (const item of items) {
    if (!item.candidateIds.length) continue;
    await db.insert(rfqRequests).values({ supplierKey: companyKey(item.supplierName), supplierName: item.supplierName, candidateIds: item.candidateIds, productIds: item.productIds, kind, sentAt });
    for (const id of item.candidateIds) {
      const [c] = await db.select({ status: supplierCandidates.status }).from(supplierCandidates).where(eq(supplierCandidates.id, id));
      if (c && !further.has(c.status as CandidateStatus)) await updateCandidate(db, id, { status: "quote_requested" });
    }
  }
}

export interface QuoteFromCandidate {
  date: string;
  unitPrice: number;
  currency: string;
  /** EUR for one unit of `currency`, when it is not EUR and a rate is known. */
  fxRate: number | null;
  moq: number | null;
  leadTimeDays: number | null;
  paymentTermsDays: number | null;
  incoterm: string | null;
  validUntil: string | null;
  notes: string | null;
  /** The answer as it was written, kept with the quote. */
  original: string | null;
}

/**
 * A candidate's answer becomes a quote on file. A quote belongs to a
 * supplier, so the candidate is added to the suppliers — this is the user
 * recording an offer, not the research deciding anything.
 */
export async function recordCandidateQuote(db: DB, candidateId: string, v: QuoteFromCandidate): Promise<{ quoteId: string; supplierId: string }> {
  const [c] = await db.select().from(supplierCandidates).where(eq(supplierCandidates.id, candidateId));
  if (!c) throw new Error("Candidate not found");
  const key = companyKey(c.name);
  const same = (await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)).find((x) => companyKey(x.name) === key);
  const supplierId = same?.id ?? (await db.insert(suppliers).values({ name: c.name, country: c.country, website: c.website }).returning({ id: suppliers.id }))[0].id;
  const [quote] = await db
    .insert(quotes)
    .values({
      productId: c.productId,
      supplierId,
      date: v.date,
      unitPrice: String(v.unitPrice),
      currency: v.currency,
      fxRate: v.currency === "EUR" ? "1" : text(v.fxRate),
      moq: text(v.moq),
      leadTimeDays: v.leadTimeDays,
      paymentTermsDays: v.paymentTermsDays,
      incoterm: v.incoterm,
      validUntil: v.validUntil,
      notes: v.notes,
      originalDescription: v.original?.slice(0, 4000) ?? null,
      source: "email",
    })
    .returning({ id: quotes.id });
  for (const other of (await db.select().from(supplierCandidates)).filter((x) => companyKey(x.name) === key)) {
    await db.update(supplierCandidates).set({ supplierId, ...(other.id === candidateId ? { status: "quote_received" } : {}), updatedAt: new Date() }).where(eq(supplierCandidates.id, other.id));
  }
  return { quoteId: quote.id, supplierId };
}

export function candidateValues(c: Omit<SupplierCandidate, "id">) {
  return {
    productId: c.productId,
    name: c.name,
    country: c.country,
    website: c.website,
    source: c.source,
    sourceLevel: c.sourceLevel,
    sourceUrl: c.sourceUrl,
    sourceDate: c.sourceDate,
    productMatched: c.productMatched,
    matchReason: c.matchReason,
    technicalCompatibility: c.technicalCompatibility,
    specifications: c.specifications,
    priceLow: text(c.priceLow),
    priceHigh: text(c.priceHigh),
    priceType: c.priceType,
    priceSourceUrl: c.priceSourceUrl,
    currency: c.currency,
    unit: c.unit,
    incoterm: c.incoterm,
    moq: text(c.moq),
    leadTimeDays: c.leadTimeDays,
    paymentTerms: c.paymentTerms,
    certifications: c.certifications,
    shippingOrigin: c.shippingOrigin,
    confidence: c.confidence,
    notes: c.notes,
    status: c.status,
    supplierId: c.supplierId,
    companyType: c.companyType,
    sourceTitle: c.sourceTitle,
    discoveredAt: c.discoveredAt,
    specCheck: c.specCheck,
  };
}

/** A supplier the user found: recorded with its source, to review like any other. */
export async function addCandidate(db: DB, productId: string, v: z.infer<typeof candidateInput>): Promise<{ id: string }> {
  const priced = v.priceLow != null || v.priceHigh != null;
  const [row] = await db
    .insert(supplierCandidates)
    .values(
      candidateValues({
        productId,
        name: v.name,
        country: v.country,
        website: v.website,
        source: "manual",
        sourceLevel: v.sourceLevel ?? "external",
        sourceUrl: v.sourceUrl,
        sourceDate: v.sourceDate ?? todayISO(),
        productMatched: v.productMatched,
        matchReason: v.matchReason,
        technicalCompatibility: v.technicalCompatibility,
        specifications: null,
        priceLow: priced ? (v.priceLow ?? v.priceHigh) : null,
        priceHigh: priced ? (v.priceHigh ?? v.priceLow) : null,
        priceType: priced ? "indicative" : null,
        priceSourceUrl: priced ? (v.priceSourceUrl ?? v.sourceUrl) : null,
        currency: priced ? v.currency : null,
        unit: priced ? v.unit : null,
        incoterm: v.incoterm,
        moq: v.moq,
        leadTimeDays: v.leadTimeDays,
        paymentTerms: v.paymentTerms,
        certifications: v.certifications,
        shippingOrigin: v.shippingOrigin,
        confidence: null,
        notes: v.notes,
        status: "to_review",
        supplierId: null,
        companyType: null,
        sourceTitle: null,
        discoveredAt: todayISO(),
        specCheck: null,
      }),
    )
    .returning({ id: supplierCandidates.id });
  return row;
}

export interface CandidatePatch {
  status?: CandidateStatus;
  technicalCompatibility?: TechnicalFit | null;
  confidence?: Confidence | null;
  notes?: string | null;
  supplierId?: string | null;
  companyType?: SupplierCandidate["companyType"];
  specCheck?: SupplierCandidate["specCheck"];
  productMatched?: string | null;
  matchReason?: string | null;
}

export async function updateCandidate(db: DB, id: string, patch: CandidatePatch): Promise<void> {
  await db.update(supplierCandidates).set({ ...patch, updatedAt: new Date() }).where(eq(supplierCandidates.id, id));
}

/** Several candidates at once: "quote requested" for everyone in the basket. */
export async function setCandidatesStatus(db: DB, ids: string[], status: CandidateStatus): Promise<void> {
  for (const id of ids) await updateCandidate(db, id, { status });
}

export async function deleteCandidate(db: DB, id: string): Promise<void> {
  await db.delete(supplierCandidates).where(eq(supplierCandidates.id, id));
}

export async function addBenchmark(db: DB, productId: string, v: z.infer<typeof benchmarkInput>, unit: string): Promise<{ id: string }> {
  const level = v.type !== "cost_driver";
  const [row] = await db
    .insert(marketBenchmarks)
    .values({
      productId,
      type: v.type ?? "direct_benchmark",
      label: v.label,
      low: level ? text(v.low ?? v.high) : null,
      high: level ? text(v.high ?? v.low) : null,
      unit: level ? unit : null,
      changePct: level ? null : v.changePct,
      period: v.period,
      sourceName: v.sourceName,
      sourceUrl: v.sourceUrl,
      sourceDate: v.sourceDate,
      sourceLevel: v.sourceLevel ?? "external",
      comparability: (v.comparability ?? "partial") as Comparability,
      notes: v.notes,
      provider: "manual",
    })
    .returning({ id: marketBenchmarks.id });
  return row;
}

export async function deleteBenchmark(db: DB, id: string): Promise<void> {
  await db.delete(marketBenchmarks).where(eq(marketBenchmarks.id, id));
}

// ---------------- Discovery ----------------

/** What a provider is told about a product: what it is and how much is needed — never what is paid for it. */
export async function discoveryRequest(db: DB, productId: string, t: T = en): Promise<{ request: DiscoveryRequest; query: QueryInput } | null> {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return null;
  const [learning, settings, bought, family] = await Promise.all([
    readLearning(db),
    readSettings(db),
    db.select().from(purchases).where(eq(purchases.productId, productId)),
    product.familyId ? db.select().from(productFamilies).where(eq(productFamilies.id, product.familyId)) : Promise.resolve([]),
  ]);
  const aliases = learning.productAliases.filter((a) => a.productId === productId);
  const specifications = { ...Object.fromEntries(attributesOf([product.name, ...aliases.map((a) => a.alias)].join(" · ")).map((a) => [a.key, a.value])), ...(product.specs ?? {}) };
  const start = windowStart(todayISO());
  const recent = bought.filter((x) => x.date > start && x.unit === product.unit);
  const quantities = bought.filter((x) => x.unit === product.unit).map((x) => Number(x.quantity)).sort((a, b) => a - b);
  const supplierIds = new Set(bought.map((x) => x.supplierId));
  const known = (await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)).filter((s) => supplierIds.has(s.id)).map((s) => s.name);
  const query: QueryInput = { name: product.name, category: product.category, subcategory: product.subcategory, family: family[0]?.name ?? null, specifications, deliveryCountry: settings.country, knownSuppliers: known };
  return {
    query,
    request: {
      productName: product.name,
      description: product.description ?? product.technicalSpecifications,
      category: product.category,
      subcategory: product.subcategory,
      family: query.family,
      specifications,
      supplierCodes: [...new Set(aliases.map((a) => a.supplierSku).filter((x): x is string => !!x))],
      unit: product.unit,
      annualQuantity: recent.length ? recent.reduce((s, x) => s + Number(x.quantity), 0) : null,
      typicalOrderQuantity: quantities.length ? quantities[Math.floor(quantities.length / 2)] : null,
      deliveryCountry: settings.country,
      knownSuppliers: known,
      queries: searchQueries(query, t),
    },
  };
}

export interface DiscoveryRun {
  /** False when no discovery provider is connected: nothing was searched, nothing is made up. */
  configured: boolean;
  queries: string[];
  added: number;
  skipped: { name: string; reason: Rejection }[];
  /** How each query went, and the ones worth trying next. */
  tried: { query: string; results: number }[];
  nextQueries: string[];
}

export async function runDiscovery(db: DB, productId: string, providers: Pick<Providers, "discovery"> = connectedProviders(), t: T = en): Promise<DiscoveryRun> {
  const built = await discoveryRequest(db, productId, t);
  if (!built) throw new Error("Product not found");
  const { request, query } = built;
  const run: DiscoveryRun = { configured: providers.discovery.length > 0, queries: request.queries, added: 0, skipped: [], tried: [], nextQueries: [] };
  if (!run.configured) return run;
  const existing = (await db.select().from(supplierCandidates).where(eq(supplierCandidates.productId, productId))).map(toCandidate);
  const perQuery = new Map(request.queries.map((q) => [q, 0]));
  for (const provider of providers.discovery) {
    for (const found of await provider.search(request)) {
      if (found.query && perQuery.has(found.query)) perQuery.set(found.query, perQuery.get(found.query)! + 1);
      const result = acceptDiscovered(found, { productId, provider: provider.key, knownSuppliers: request.knownSuppliers, existing, discoveredAt: todayISO() });
      if (!result.ok) {
        run.skipped.push({ name: found.name ?? "", reason: result.reason });
        continue;
      }
      const [row] = await db.insert(supplierCandidates).values(candidateValues(result.candidate)).returning();
      existing.push(toCandidate(row));
      run.added++;
    }
  }
  run.tried = [...perQuery.entries()].map(([q, results]) => ({ query: q, results }));
  run.nextQueries = refineQueries(query, run.tried, t);
  return run;
}

/** What a request for quotation says about a product: its name without the current supplier, its specification, the quantities. Never the price. */
export interface RfqLineData {
  productId: string;
  productName: string;
  /** Labels are English texts of the dictionary, or the company's own words. */
  specifications: { label: string; value: string }[];
  description: string | null;
  unit: string;
  annualQuantity: number | null;
  typicalOrderQuantity: number | null;
}

export async function readRfqLines(db: DB, productIds: string[]): Promise<Map<string, RfqLineData>> {
  const [rows, bought, names] = await Promise.all([db.select().from(products), db.select().from(purchases), db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)]);
  const start = windowStart(todayISO());
  const out = new Map<string, RfqLineData>();
  for (const id of productIds) {
    const product = rows.find((p) => p.id === id);
    if (!product) continue;
    const mine = bought.filter((x) => x.productId === id);
    const known = names.filter((n) => mine.some((x) => x.supplierId === n.id)).map((n) => n.name);
    const sameUnit = mine.filter((x) => x.unit === product.unit);
    const recent = sameUnit.filter((x) => x.date > start);
    const quantities = sameUnit.map((x) => Number(x.quantity)).sort((a, b) => a - b);
    out.set(id, {
      productId: id,
      productName: neutralName({ name: product.name, knownSuppliers: known }),
      specifications: [...attributesOf(product.name).map((a) => ({ label: ATTRIBUTE_LABEL[a.key] as string, value: a.value })), ...Object.entries(product.specs ?? {}).map(([label, value]) => ({ label, value }))],
      description: product.technicalSpecifications ?? product.description,
      unit: product.unit,
      annualQuantity: recent.length ? recent.reduce((sum, x) => sum + Number(x.quantity), 0) : null,
      typicalOrderQuantity: quantities.length ? quantities[Math.floor(quantities.length / 2)] : null,
    });
  }
  return out;
}

// ---------------- For the pages ----------------

export const getSourcingData = cache(async () => {
  await connection();
  return readSourcing(await getDb());
});

export interface MarketViews {
  views: Map<string, MarketView>;
  review: SourcingReview;
  /** The suppliers that could cover the priority products, one entry per company. */
  opportunities: SupplierOpportunity[];
  requests: RfqRequest[];
}

function buildViews(intel: Intel, overview: PurchasingOverview, sourcing: Awaited<ReturnType<typeof readSourcing>>, homeCountry: string | null, t: T): MarketViews {
  const decisions = new Map(overview.products.map((d) => [d.productId, d]));
  // The first round of requests is for the few products that weigh most.
  const bySpend = intel.products.filter((p) => p.highSpend).sort((a, b) => b.metrics.annualSpend - a.metrics.annualSpend);
  const materiality = new Map<string, Materiality>(bySpend.map((p, i) => [p.product.id, i < SOURCING_CONFIG.focusProducts ? "focus" : "priority"]));
  const views = new Map<string, MarketView>();
  for (const p of intel.products) {
    const decision = decisions.get(p.product.id);
    if (!decision) continue;
    views.set(
      p.product.id,
      marketView(
        {
          intel: p,
          decision,
          candidates: sourcing.candidates.filter((c) => c.productId === p.product.id),
          benchmarks: sourcing.benchmarks.filter((b) => b.productId === p.product.id),
          homeCountry,
          asOf: intel.asOf,
          materiality: materiality.get(p.product.id) ?? "minor",
        },
        t,
      ),
    );
  }
  const priority = bySpend.map((p) => views.get(p.product.id)!).filter(Boolean);
  return {
    views,
    review: sourcingReview(priority, intel.products.reduce((s, p) => s + p.metrics.annualSpend, 0)),
    opportunities: supplierOpportunities(priority.map((v) => ({ productId: v.productId, name: v.name, annualSpend: v.history.annualSpend, materiality: v.materiality, screening: v.screening })), t),
    requests: sourcing.requests,
  };
}

/** The market view of every catalogue product, and the review of the ones that make up most of the spend. */
export const getMarketViews = cache(async (): Promise<MarketViews> => {
  const [intel, overview, sourcing, settings, t] = await Promise.all([getIntel(), getOverview(), getSourcingData(), getSettings(), getT()]);
  return buildViews(intel, overview, sourcing, settings.country, t);
});

/** The same, read straight from the database: for a research that has just written to it. */
export async function readMarketViews(db: DB, t: T = en) {
  const [data, learning, states, sourcing, settings] = await Promise.all([readDataset(db), readLearning(db), readOpportunityStates(db), readSourcing(db), readSettings(db)]);
  const intel = analyze(catalogueOf(data), learning.supplierProducts, states, todayISO(), undefined, t);
  return buildViews(intel, purchasingOverview(intel, t), sourcing, settings.country, t);
}
