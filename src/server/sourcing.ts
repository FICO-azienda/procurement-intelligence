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
import { createHash } from "node:crypto";
import { documents, marketBenchmarks, productAliases, productDocuments, productFamilies, products, purchases, quotes, rfqRequests, settings as settingsTable, supplierCandidates, suppliers, trueCostScenarios } from "@/db/schema";
import { getStorage, storageKey } from "@/lib/storage";
import { crossesCustoms } from "@/lib/sourcing/regions";
import { rfqSpec, type RfqSpec } from "@/lib/sourcing/rfq-spec";
import { quoteOpportunity, trueCost, type CostBasis, type QuoteOpportunity, type TrueCost } from "@/lib/sourcing/true-cost";
import { todayISO, windowStart } from "@/lib/analytics";
import { attributesOf } from "@/lib/catalog/attributes";
import { catalogueOf } from "@/lib/catalog/spend";
import { getIntel, getOverview, getSettings, getT, readDataset, readLearning, readOpportunityStates, readSettings } from "@/lib/data";
import { purchasingOverview, type PurchasingOverview } from "@/lib/intel/decision";
import { analyze, type Intel } from "@/lib/intel/engine";
import { en, type T } from "@/lib/i18n";
import { acceptDiscovered, refineQueries, searchQueries, type QueryInput, type Rejection } from "@/lib/sourcing/discovery";
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
    periodMonth: r.periodMonth,
    fxMethod: r.fxMethod,
    sourceLevel: isSourceLevel(r.sourceLevel) ? r.sourceLevel : "external",
    comparability: (["comparable", "partial", "not"] as const).find((x) => x === r.comparability) ?? "partial",
    notes: r.notes,
    provider: r.provider,
  };
}

export async function readSourcing(db: DB): Promise<{ candidates: SupplierCandidate[]; benchmarks: MarketBenchmark[]; requests: RfqRequest[]; pilot: string[] }> {
  const [c, b, r, pilot] = await Promise.all([
    db.select().from(supplierCandidates).orderBy(supplierCandidates.createdAt),
    db.select().from(marketBenchmarks).orderBy(marketBenchmarks.createdAt),
    db.select().from(rfqRequests).orderBy(rfqRequests.sentAt),
    db.select({ id: products.id }).from(products).where(eq(products.inPilot, true)),
  ]);
  return {
    pilot: pilot.map((x) => x.id),
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
  /** Transport per unit, when the answer states it: kept apart from the price, for the true cost. */
  freightPerUnit?: number | null;
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
  if (v.freightPerUnit != null) await db.insert(trueCostScenarios).values({ quoteId: quote.id, freightPerUnit: String(v.freightPerUnit * (v.currency === "EUR" ? 1 : (v.fxRate ?? 1))), freightBasis: "quote" });
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

/** What a request for quotation says about a product: its neutral description, its specification, the quantities. Never the price, never the current supplier's own codes. */
export interface RfqLineData {
  productId: string;
  /** The neutral description. Empty when there is none safe to send: the product is then not ready. */
  productName: string;
  /** Labels are English texts of the dictionary, or the company's own words. */
  specifications: { label: string; value: string }[];
  description: string | null;
  application: string | null;
  unit: string;
  annualQuantity: number | null;
  typicalOrderQuantity: number | null;
  spec: RfqSpec;
  documents: { id: string; documentId: string; filename: string }[];
}

export async function readRfqLines(db: DB, productIds: string[], t: T = en): Promise<Map<string, RfqLineData>> {
  const [rows, bought, names, aliases, docs, company] = await Promise.all([
    db.select().from(products),
    db.select().from(purchases),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers),
    db.select({ productId: productAliases.productId, sku: productAliases.supplierSku }).from(productAliases),
    db.select({ id: productDocuments.id, productId: productDocuments.productId, documentId: documents.id, filename: documents.filename }).from(productDocuments).innerJoin(documents, eq(productDocuments.documentId, documents.id)),
    readSettings(db),
  ]);
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
    const attached = docs.filter((d) => d.productId === id);
    const spec = rfqSpec(
      {
        name: product.name,
        rfqName: product.rfqName,
        technical: product.technicalSpecifications ?? product.description,
        application: product.application,
        specs: product.specs ?? null,
        supplierCodes: [...new Set(aliases.filter((a) => a.productId === id && a.sku).map((a) => a.sku!))],
        knownSuppliers: known,
        companyName: company.companyName,
        unit: product.unit,
        annualQuantity: recent.length ? recent.reduce((sum, x) => sum + Number(x.quantity), 0) : null,
        typicalOrderQuantity: quantities.length ? quantities[Math.floor(quantities.length / 2)] : null,
        deliveryCountry: company.country,
        documents: attached.length,
      },
      t,
    );
    out.set(id, {
      productId: id,
      productName: spec.neutralName ?? "",
      specifications: spec.attributes,
      description: spec.technical,
      application: spec.application,
      unit: product.unit,
      annualQuantity: spec.annualQuantity,
      typicalOrderQuantity: spec.typicalOrderQuantity,
      spec,
      documents: attached.map((d) => ({ id: d.id, documentId: d.documentId, filename: d.filename })),
    });
  }
  return out;
}

/** The description of a product for people outside: the company's own words, saved as written. */
export async function saveRfqSpec(db: DB, productId: string, v: { rfqName: string | null; technical: string | null; application: string | null }): Promise<void> {
  await db.update(products).set({ rfqName: v.rfqName?.trim() || null, technicalSpecifications: v.technical?.trim() || null, application: v.application?.trim() || null, updatedAt: new Date() }).where(eq(products.id, productId));
}

/** A technical document kept with a product, to attach to a request. The file is stored as it is: nothing is read from it. */
export async function addProductDocument(db: DB, productId: string, file: { name: string; bytes: Uint8Array; mimeType: string | null }, type = "technical_datasheet"): Promise<void> {
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  let [doc] = await db.select().from(documents).where(eq(documents.sha256, sha256));
  if (!doc) {
    const key = storageKey(file.name, sha256);
    await getStorage().put(key, file.bytes, file.mimeType ?? "application/octet-stream");
    [doc] = await db.insert(documents).values({ filename: file.name, mimeType: file.mimeType, sizeBytes: file.bytes.length, sha256, storagePath: key }).returning();
  }
  const linked = await db.select().from(productDocuments).where(eq(productDocuments.productId, productId));
  if (!linked.some((l) => l.documentId === doc.id)) await db.insert(productDocuments).values({ productId, documentId: doc.id, type });
}

export async function removeProductDocument(db: DB, id: string): Promise<void> {
  await db.delete(productDocuments).where(eq(productDocuments.id, id));
}

export async function setPilot(db: DB, productIds: string[], on: boolean): Promise<void> {
  for (const id of productIds) await db.update(products).set({ inPilot: on, updatedAt: new Date() }).where(eq(products.id, id));
}

/** The month a reference is about: its exchange rate is taken again, as that month's average, at the next research. */
export async function setBenchmarkMonth(db: DB, id: string, month: string | null): Promise<void> {
  const [b] = await db.select().from(marketBenchmarks).where(eq(marketBenchmarks.id, id));
  if (!b) return;
  const foreign = b.currency.toUpperCase() !== "EUR";
  await db.update(marketBenchmarks).set({ periodMonth: month, ...(foreign ? { fxRate: null, fxDate: null, fxMethod: null } : {}), updatedAt: new Date() }).where(eq(marketBenchmarks.id, id));
}

// ---------------- True cost ----------------

export interface TrueCostInputs {
  freightPerUnit: number | null;
  freightBasis: string | null;
  dutyRatePct: number | null;
  customsPerUnit: number | null;
  otherPerUnit: number | null;
  notes: string | null;
}

/** What the user knows or estimates about a quote's transport, duty and other costs. The true cost is worked out from it, never stored. */
export async function saveTrueCostInputs(db: DB, quoteId: string, v: TrueCostInputs): Promise<void> {
  const values = { freightPerUnit: text(v.freightPerUnit), freightBasis: v.freightPerUnit == null ? null : (v.freightBasis ?? "manual"), dutyRatePct: v.dutyRatePct, dutyBasis: v.dutyRatePct == null ? null : "manual", customsPerUnit: text(v.customsPerUnit), otherPerUnit: text(v.otherPerUnit), notes: v.notes, updatedAt: new Date() };
  await db.insert(trueCostScenarios).values({ quoteId, ...values }).onConflictDoUpdate({ target: trueCostScenarios.quoteId, set: values });
}

export interface QuoteCost {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  country: string | null;
  date: string | null;
  price: number;
  currency: string;
  priceEUR: number | null;
  incoterm: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  paymentTermsDays: number | null;
  expired: boolean;
  comparability: Comparability;
  /** The user confirmed the offered product is the same specification. */
  technicalConfirmed: boolean;
  inputs: TrueCostInputs;
  cost: TrueCost;
  opportunity: QuoteOpportunity | null;
}

export interface ProductCosts {
  /** What is paid today: the invoice price, with no breakdown of what it includes. */
  baseline: number | null;
  baselinePaymentDays: number | null;
  rates: { financing: number; holding: number; own: boolean };
  quotes: QuoteCost[];
  /** The quote with the lowest nominal price, and the one with the lowest complete true cost: they need not be the same. */
  lowestQuote: QuoteCost | null;
  lowestTrueCost: QuoteCost | null;
  /** The largest opportunity a quote supports, on true cost. */
  best: QuoteCost | null;
}

/** For every product with quotes on file: each quote's true cost, component by component, against what is paid today. */
export async function readProductCosts(db: DB, intel: Intel, views: Map<string, MarketView>, t: T = en): Promise<Map<string, ProductCosts>> {
  const [scenarios, sups, [company], candidates] = await Promise.all([db.select().from(trueCostScenarios), db.select().from(suppliers), db.select().from(settingsTable).limit(1), db.select().from(supplierCandidates)]);
  const rates = { financing: company?.financingRatePct ?? SOURCING_CONFIG.financingRatePct, holding: company?.holdingRatePct ?? SOURCING_CONFIG.holdingRatePct, own: company?.financingRatePct != null || company?.holdingRatePct != null };
  const home = company?.country ?? null;
  const out = new Map<string, ProductCosts>();
  for (const p of intel.products) {
    const rows = p.comparison.filter((r) => !r.isCurrent && r.kind === "quote" && r.price != null && r.recordId);
    if (!rows.length) continue;
    const view = views.get(p.product.id);
    const current = p.comparison.find((r) => r.isCurrent);
    const baseline = view?.currentPrice ?? null;
    const baselinePaymentDays = current ? (sups.find((x) => x.id === current.supplier.id)?.paymentTermsDays ?? current.paymentTermsDays) : null;
    const costs = rows.map((r): QuoteCost => {
      const sc = scenarios.find((x) => x.quoteId === r.recordId);
      const supplier = sups.find((x) => x.id === r.supplier.id);
      const country = supplier?.country ?? r.supplier.country ?? null;
      const crosses = crossesCustoms(country, home);
      const technicalConfirmed = candidates.some((c) => c.productId === p.product.id && c.supplierId === r.supplier.id && c.technicalCompatibility === "high");
      const inputs: TrueCostInputs = { freightPerUnit: numOrNull(sc?.freightPerUnit ?? null), freightBasis: sc?.freightBasis ?? null, dutyRatePct: sc?.dutyRatePct ?? null, customsPerUnit: numOrNull(sc?.customsPerUnit ?? null), otherPerUnit: numOrNull(sc?.otherPerUnit ?? null), notes: sc?.notes ?? null };
      const cost = trueCost(
        {
          price: r.price!,
          currency: r.currency ?? "EUR",
          fxRate: r.priceEUR != null && r.price ? r.priceEUR / r.price : null,
          fxNote: null,
          incoterm: r.incoterm,
          sameCustomsArea: crosses == null ? null : !crosses,
          freightPerUnit: inputs.freightPerUnit,
          freightBasis: (inputs.freightBasis as CostBasis | null) ?? null,
          dutyRatePct: inputs.dutyRatePct,
          customsPerUnit: inputs.customsPerUnit,
          otherPerUnit: inputs.otherPerUnit,
          moq: r.moq,
          typicalOrder: p.typicalOrderQuantity,
          annualVolume: view?.history.annualQuantity || null,
          paymentDays: r.termsFromDefaults ? null : r.paymentTermsDays,
          baselinePaymentDays,
          financingRatePct: rates.financing,
          holdingRatePct: rates.holding,
          technicalConfirmed,
        },
        t,
      );
      return {
        quoteId: r.recordId!,
        supplierId: r.supplier.id,
        supplierName: r.supplier.name,
        country,
        date: r.date,
        price: r.price!,
        currency: r.currency ?? "EUR",
        priceEUR: r.priceEUR,
        incoterm: r.incoterm,
        moq: r.moq,
        leadTimeDays: r.termsFromDefaults ? null : r.leadTimeDays,
        paymentTermsDays: r.termsFromDefaults ? null : r.paymentTermsDays,
        expired: r.expired,
        comparability: r.comparability,
        technicalConfirmed,
        inputs,
        cost,
        opportunity: r.expired ? null : quoteOpportunity(baseline, cost, { annualVolume: view?.history.annualQuantity || null, technicalConfirmed, moq: r.moq, comparable: r.comparability !== "not" }, t),
      };
    });
    const live = costs.filter((c) => !c.expired && c.comparability !== "not");
    const min = <K extends QuoteCost>(list: K[], value: (c: K) => number | null) => list.filter((c) => value(c) != null).sort((a, b) => value(a)! - value(b)!)[0] ?? null;
    out.set(p.product.id, {
      baseline,
      baselinePaymentDays,
      rates,
      quotes: costs,
      lowestQuote: live.length >= 2 ? min(live, (c) => c.priceEUR) : null,
      lowestTrueCost: live.filter((c) => c.cost.perUnit != null).length >= 2 ? min(live, (c) => c.cost.perUnit) : null,
      best: [...live].filter((c) => c.opportunity).sort((a, b) => b.opportunity!.perUnit - a.opportunity!.perUnit)[0] ?? null,
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
  /** The products the user put in the live pilot. Empty: the largest by spend stand in. */
  pilot: string[];
}

function buildViews(intel: Intel, overview: PurchasingOverview, sourcing: Awaited<ReturnType<typeof readSourcing>>, homeCountry: string | null, t: T): MarketViews {
  const decisions = new Map(overview.products.map((d) => [d.productId, d]));
  // The first round of requests is for the few products that weigh most.
  const bySpend = intel.products.filter((p) => p.highSpend).sort((a, b) => b.metrics.annualSpend - a.metrics.annualSpend);
  // …and once the user has chosen the products of the pilot, the first round is those.
  const pilot = new Set(sourcing.pilot);
  const materiality = new Map<string, Materiality>(bySpend.map((p, i) => [p.product.id, (pilot.size ? pilot.has(p.product.id) : i < SOURCING_CONFIG.focusProducts) ? "focus" : "priority"]));
  for (const id of pilot) materiality.set(id, "focus");
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
    pilot: sourcing.pilot,
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
