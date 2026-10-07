/**
 * Negotiation intelligence on the database. Reading gathers what the other
 * modules already work out for a product (price history, market view, true
 * cost of the offers, product data) and hands it to lib/negotiation: the
 * estimate is never stored as the truth, it is worked out fresh each time.
 *
 * Two things are written. The history: each time the answer changes, what
 * was said is appended to negotiation_estimates. And what a person knows
 * better than the rules — how hard switching is, how standard or critical the
 * product is — kept in the product's data ledger (product_data_fields) with
 * the reason and the software's own estimate. Neither ever touches a price, a
 * quote or a supplier.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { after, connection } from "next/server";
import { getDb, type DB } from "@/db";
import { negotiationEstimates, productDataFields, products } from "@/db/schema";
import { attributesOf } from "@/lib/catalog/attributes";
import { getIntel, getLearning, getSettings, getT, readLearning, readSettings } from "@/lib/data";
import type { LedgerRow, ProductProfile } from "@/lib/dataset/profile";
import { en, type T } from "@/lib/i18n";
import type { Intel } from "@/lib/intel/engine";
import { isJudgementKey, isLevel, type JudgementKey, type Level, type NegotiationInput, type NegotiationStatus, type Strength } from "@/lib/negotiation/engine";
import { estimateRecord, type EstimateRecord, type EstimateSnapshot } from "@/lib/negotiation/history";
import { negotiationFor, type ProductNegotiation } from "@/lib/negotiation/input";
import { classifyProduct } from "@/lib/research/strategy";
import type { MarketView } from "@/lib/sourcing/market";
import type { Confidence, MarketBenchmark } from "@/lib/sourcing/types";
import { getProfiles, readLedger, readProfiles } from "./product-data";
import { getMarketViews, getSourcingData, readMarketViews, readProductCosts, readSourcing, type ProductCosts } from "./sourcing";

interface Assembly {
  intel: Intel;
  views: Map<string, MarketView>;
  profiles: Map<string, ProductProfile>;
  costs: Map<string, ProductCosts>;
  benchmarks: MarketBenchmark[];
  aliases: { productId: string; alias: string }[];
  companyName: string | null;
  rows: { id: string; kind: string; researchClass: string | null; customsCode: string | null; customsCodeConfirmed: boolean }[];
  ledger: Map<string, LedgerRow[]>;
}

/** What a person said about the product, read back from the ledger. */
function judgementsOf(rows: LedgerRow[]): NegotiationInput["judgements"] {
  const out: NegotiationInput["judgements"] = {};
  for (const r of rows) if (isJudgementKey(r.field) && isLevel(r.value)) out[r.field] = { level: r.value, reason: r.note, date: r.updatedAt.slice(0, 10) };
  return out;
}

function assemble(a: Assembly, productIds: string[], t: T): Map<string, ProductNegotiation> {
  const supplierOf = (p: Intel["products"][number]) => p.product.currentSupplierId ?? p.metrics.lastSupplierId ?? null;
  const bySupplier = new Map<string, number>();
  for (const p of a.intel.products) {
    const s = supplierOf(p);
    if (s) bySupplier.set(s, (bySupplier.get(s) ?? 0) + 1);
  }
  const out = new Map<string, ProductNegotiation>();
  for (const id of productIds) {
    const intel = a.intel.products.find((p) => p.product.id === id);
    const view = a.views.get(id);
    const profile = a.profiles.get(id);
    if (!intel || !view || !profile) continue;
    const row = a.rows.find((r) => r.id === id);
    const names = [intel.product.name, ...a.aliases.filter((x) => x.productId === id).map((x) => x.alias)].join(" · ");
    const cls = classifyProduct({
      name: intel.product.name,
      kind: row?.kind ?? "needs_review",
      unit: intel.product.unit,
      specifications: { ...Object.fromEntries(attributesOf(names).map((x) => [x.key, x.value])), ...(intel.product.specs ?? {}) },
      companyName: a.companyName,
      override: row?.researchClass,
    });
    const supplier = supplierOf(intel);
    out.set(
      id,
      negotiationFor(
        {
          intel,
          view,
          profile,
          quotes: a.costs.get(id)?.quotes ?? [],
          benchmarks: a.benchmarks.filter((b) => b.productId === id),
          productClass: cls.productClass,
          classReason: cls.reason,
          classChosen: cls.chosen,
          supplierProducts: supplier ? (bySupplier.get(supplier) ?? 1) : 1,
          customsCodeConfirmed: !!row?.customsCode && row.customsCodeConfirmed,
          judgements: judgementsOf(a.ledger.get(id) ?? []),
          asOf: a.intel.asOf,
        },
        t,
      ),
    );
  }
  return out;
}

const productRows = (db: DB) => db.select({ id: products.id, kind: products.kind, researchClass: products.researchClass, customsCode: products.customsCode, customsCodeConfirmed: products.customsCodeConfirmed }).from(products);

/** Straight from the database: for the history, the tests, and a write that needs the estimate as it stands. */
export async function readNegotiations(db: DB, t: T = en, productIds?: string[]): Promise<Map<string, ProductNegotiation>> {
  const [{ views, intel }, sourcing, learning, settings, rows] = await Promise.all([readMarketViews(db, t), readSourcing(db), readLearning(db), readSettings(db), productRows(db)]);
  const ids = productIds ?? intel.products.map((p) => p.product.id);
  const [profiles, costs, ledger] = await Promise.all([readProfiles(db, ids, t), readProductCosts(db, intel, views, t), readLedger(db, ids)]);
  return assemble({ intel, views, profiles, costs, benchmarks: sourcing.benchmarks, aliases: learning.productAliases, companyName: settings.companyName, rows, ledger }, ids, t);
}

/** For the pages: the estimates of the given products, from this request's data. */
export async function getNegotiations(productIds: string[]): Promise<Map<string, ProductNegotiation>> {
  await connection();
  const [intel, { views }, sourcing, learning, settings, t, db] = await Promise.all([getIntel(), getMarketViews(), getSourcingData(), getLearning(), getSettings(), getT(), getDb()]);
  const ids = productIds.filter((id) => intel.products.some((p) => p.product.id === id));
  const [profiles, costs, ledger, rows] = await Promise.all([getProfiles(ids), readProductCosts(db, intel, views, t), readLedger(db, ids), productRows(db)]);
  return assemble({ intel, views, profiles, costs, benchmarks: sourcing.benchmarks, aliases: learning.productAliases, companyName: settings.companyName, rows, ledger }, ids, t);
}

/** Every catalogue product with a price paid: the list the opportunities page reads. */
export async function getAllNegotiations(): Promise<ProductNegotiation[]> {
  const intel = await getIntel();
  const all = await getNegotiations(intel.products.filter((p) => p.metrics.currentPrice != null).map((p) => p.product.id));
  return [...all.values()];
}

// ---------------- History ----------------

export interface EstimateRow extends EstimateRecord {
  id: string;
  productId: string;
  /** ISO timestamp. */
  createdAt: string;
}

const num = (v: string | null) => (v == null ? null : Number(v));
const text = (n: number | null) => (n == null ? null : String(n));
const toRow = (r: typeof negotiationEstimates.$inferSelect): EstimateRow => ({
  id: r.id,
  productId: r.productId,
  createdAt: r.createdAt.toISOString(),
  status: r.status as NegotiationStatus,
  current: num(r.currentPrice),
  low: num(r.low),
  high: num(r.high),
  target: num(r.target),
  confidence: r.confidence as Confidence | null,
  strength: r.strength as Strength,
  signature: r.signature,
  snapshot: r.snapshot as EstimateSnapshot,
});

/** The estimates kept for a product, the latest first. */
export async function readEstimateHistory(db: DB, productId: string): Promise<EstimateRow[]> {
  const rows = await db.select().from(negotiationEstimates).where(eq(negotiationEstimates.productId, productId)).orderBy(desc(negotiationEstimates.createdAt));
  return rows.map(toRow);
}

async function record(db: DB, productIds?: string[]): Promise<number> {
  // Stored in English with their values: the history is read back in the reader's language.
  const all = await readNegotiations(db, en, productIds);
  const ids = [...all.keys()];
  if (!ids.length) return 0;
  const kept = await db.select().from(negotiationEstimates).where(inArray(negotiationEstimates.productId, ids)).orderBy(desc(negotiationEstimates.createdAt));
  const latest = new Map<string, EstimateRow>();
  for (const r of kept) if (!latest.has(r.productId)) latest.set(r.productId, toRow(r));
  let written = 0;
  for (const [id, n] of all) {
    const previous = latest.get(id) ?? null;
    // "Not enough data" is not an estimate: it is kept only when it follows one, so the history shows the evidence went away.
    if (!previous && n.status === "not_enough_data") continue;
    const next = estimateRecord(n, previous);
    if (previous?.signature === next.signature) continue;
    await db.insert(negotiationEstimates).values({ productId: id, status: next.status, currentPrice: text(next.current), low: text(next.low), high: text(next.high), target: text(next.target), confidence: next.confidence, strength: next.strength, signature: next.signature, snapshot: next.snapshot });
    written++;
  }
  return written;
}

// One at a time: two writes landing together must not keep the same estimate twice.
let queue: Promise<unknown> = Promise.resolve();

/** Appends to the history the estimates whose answer changed. Returns how many were written. */
export function recordEstimates(db: DB, productIds?: string[]): Promise<number> {
  const run = queue.then(() => record(db, productIds));
  queue = run.catch(() => undefined);
  return run;
}

/**
 * After a write, or after a product's estimate has been shown: bring the
 * history up to date once the response is out. It never fails the request
 * it follows.
 */
export function keepEstimateHistory(productIds?: string[]): void {
  after(async () => {
    try {
      await recordEstimates(await getDb(), productIds);
    } catch (err) {
      console.error("[negotiation history]", err);
    }
  });
}

// ---------------- What a person knows better ----------------

/**
 * A person corrects a factor the rules can only estimate. The level and the
 * reason are kept with the date, next to what the software had estimated.
 * A null level takes the correction back.
 */
export async function saveJudgement(db: DB, productId: string, key: JudgementKey, level: Level | null, reason: string | null): Promise<void> {
  const where = and(eq(productDataFields.productId, productId), eq(productDataFields.field, key));
  if (level == null) {
    await db.delete(productDataFields).where(where);
    return;
  }
  const [existing] = await db.select().from(productDataFields).where(where);
  // The software's estimate is kept once: a later correction does not overwrite what it first said.
  let estimate = existing?.estimate ?? null;
  if (!existing) {
    const system = (await readNegotiations(db, en, [productId])).get(productId)?.judgements[key];
    estimate = system?.system ? { value: system.system, method: system.systemWhy, source: null } : null;
  }
  const values = { value: level, source: "user", documentId: null, note: reason?.trim() || null, estimate, updatedAt: new Date() };
  await db.insert(productDataFields).values({ productId, field: key, ...values }).onConflictDoUpdate({ target: [productDataFields.productId, productDataFields.field], set: values });
}
