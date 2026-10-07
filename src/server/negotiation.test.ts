/**
 * Negotiation intelligence on a real in-memory Postgres, from invoices to an
 * estimate and its history. The company, the suppliers ("Mock Wax GmbH",
 * "Mock Paraffin Sp. z o.o.") and every price here are MOCKS that exist only
 * in this file.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { translator } from "@/lib/i18n";
import { publicView } from "@/lib/negotiation/history";
import { benchmarkInput, candidateInput } from "@/lib/validation";
import { readEstimateHistory, readNegotiations, recordEstimates, saveJudgement } from "./negotiation";
import { readProfiles } from "./product-data";
import { addBenchmark, addCandidate, recordCandidateQuote } from "./sourcing";

let db: DB;
let productId: string;
let otherId: string;

const monthsAgo = (n: number) => {
  const d = new Date(`${todayISO()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};
const candidate = (name: string, country: string) => candidateInput.parse({ name, country, sourceUrl: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}.example.test/paraffin`, sourceLevel: "supplier_official", technicalCompatibility: "high" });
const one = async () => (await readNegotiations(db, undefined, [productId])).get(productId)!;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.settings).values({ id: 1, companyName: "Mock Candle Co.", country: "Italy" });
  const [current] = await db.insert(schema.suppliers).values({ name: "Mock Current Supplier S.p.A.", country: "Italy" }).returning();
  const [p] = await db.insert(schema.products).values({ name: "Paraffin wax 52/54", sku: "PAR", unit: "kg", kind: "direct_material", category: "Waxes and paraffin", subcategory: "Paraffin", technicalSpecifications: "Fully refined, oil content below 0.5%, slabs", mappedAt: new Date() }).returning();
  productId = p.id;
  // Full loads every month: 1.50, then 1.52, then 1.48 today.
  for (const [i, price] of [1.48, 1.48, 1.52, 1.5].entries()) {
    await db.insert(schema.purchases).values({ productId, supplierId: current.id, date: monthsAgo(i), quantity: "24000", unit: "kg", unitPrice: String(price), totalAmount: String(24_000 * price), source: "csv" });
  }
  // A second product with nothing but its own invoices.
  const [q] = await db.insert(schema.products).values({ name: "Article 5F container", sku: "ART5F", unit: "pcs", kind: "component", mappedAt: new Date() }).returning();
  otherId = q.id;
  await db.insert(schema.purchases).values({ productId: otherId, supplierId: current.id, date: monthsAgo(1), quantity: "20000", unit: "pcs", unitPrice: "0.0752", totalAmount: "1504", source: "csv" });
}, 30_000);

describe("from what is on file to an estimate", () => {
  it("with invoices only there is no range — and nothing is written to the history", async () => {
    const n = await one();
    expect(n).toMatchObject({ status: "not_enough_data", current: 1.48, range: null, target: null, productId, name: "Paraffin wax 52/54" });
    expect(n.improve.map((x) => x.kind)).toEqual(expect.arrayContaining(["find_suppliers", "first_quote"]));
    expect(await recordEstimates(db)).toBe(0);
    expect(await readEstimateHistory(db, productId)).toEqual([]);
  });

  it("reads every input with its status, source and method", async () => {
    const n = await one();
    const by = (key: string) => n.inputs.find((x) => x.key === key)!;
    expect(by("current_price")).toMatchObject({ status: "confirmed", group: "price" });
    expect(by("annual_volume")).toMatchObject({ status: "estimated" });
    expect(by("annual_volume").method).toMatch(/Annualized/);
    expect(by("payment_terms")).toMatchObject({ status: "missing", group: "terms" });
    expect(by("switching_difficulty")).toMatchObject({ status: "estimated", value: "Low" });
    expect(by("criticality")).toMatchObject({ status: "missing", value: null });
    expect(by("class")).toMatchObject({ value: "Raw material or commodity", status: "estimated" });
    expect(by("contract")).toMatchObject({ status: "missing" });
  });

  it("a published reference and alternatives give a wide range, a cautious target and low confidence", async () => {
    await addBenchmark(db, productId, benchmarkInput.parse({ type: "direct_benchmark", label: "Paraffin, Europe average", low: "1,36", sourceName: "Mock Index", sourceUrl: "index.example.test/paraffin", sourceDate: monthsAgo(0), comparability: "partial" }), "kg");
    for (const [name, country] of [
      ["Mock Wax GmbH", "Germany"],
      ["Mock Paraffin Sp. z o.o.", "Poland"],
    ]) await addCandidate(db, productId, candidate(name, country));
    const n = await one();
    expect(n).toMatchObject({ status: "range", confidence: "low", current: 1.48 });
    // Below today's price at the low end, above it at the cautious end: 1.52 was paid two months ago.
    expect(n.range!.low).toBeLessThan(1.48);
    expect(n.range!.low).toBeGreaterThan(1.36);
    expect(n.range!.high).toBeGreaterThan(1.48);
    expect(n.range!.high).toBeLessThan(1.52);
    expect(n.target!).toBeGreaterThan(n.range!.low);
    expect(n.target!).toBeLessThan(1.48);
    expect(n.upside).toMatchObject({ volumeStatus: "estimated" });
    expect(n.anchors).toMatchObject([{ kind: "benchmark", role: "low_end", dataClass: "anonymized_benchmark" }]);
    // The second product still has nothing: every product is read on its own evidence.
    expect((await readNegotiations(db)).get(otherId)).toMatchObject({ status: "not_enough_data", current: 0.0752 });
  });
});

describe("the history follows the evidence", () => {
  it("keeps the first estimate once, and nothing while the answer stays the same", async () => {
    expect(await recordEstimates(db)).toBe(1);
    expect(await recordEstimates(db)).toBe(0);
    const [row] = await readEstimateHistory(db, productId);
    expect(row).toMatchObject({ status: "range", confidence: "low", current: 1.48 });
    expect(row.snapshot.change.message).toBe("First estimate.");
    expect(await readEstimateHistory(db, otherId)).toEqual([]);
  });

  it("a quote on true cost moves the range onto the offer, raises the confidence and is kept as a new estimate", async () => {
    const before = await one();
    const [first] = (await db.select().from(schema.supplierCandidates)).filter((c) => c.name === "Mock Wax GmbH");
    // Delivered, from the same customs area: nothing to add to the price.
    await recordCandidateQuote(db, first.id, { date: todayISO(), unitPrice: 1.42, currency: "EUR", fxRate: 1, moq: 24_000, leadTimeDays: 21, paymentTermsDays: null, incoterm: "DAP", validUntil: null, notes: null, original: null });
    const n = await one();
    expect(n.anchors[0]).toMatchObject({ kind: "quote", label: "Mock Wax GmbH", basis: "true_cost", role: "both_ends", dataClass: "real_quote" });
    expect(n.confidence).toBe("medium");
    expect(n.range!.high).toBeLessThan(1.48);
    expect(n.range!.high - n.range!.low).toBeLessThan(before.range!.high - before.range!.low);
    expect(n.anchors.find((a) => a.kind === "benchmark")!.role).toBe("supports");
    expect(await recordEstimates(db, [productId])).toBe(1);
    const history = await readEstimateHistory(db, productId);
    expect(history).toHaveLength(2);
    expect(history[0].snapshot.change).toMatchObject({ msg: "After the quote of {supplier}.", params: { supplier: "Mock Wax GmbH" } });
    expect(translator("it").any(history[0].snapshot.change.msg!, history[0].snapshot.change.params)).toBe("Dopo il preventivo di Mock Wax GmbH.");
  });

  it("an offer in transit terms with no freight on file is not set against a delivered price", async () => {
    const [second] = (await db.select().from(schema.supplierCandidates)).filter((c) => c.name === "Mock Paraffin Sp. z o.o.");
    await recordCandidateQuote(db, second.id, { date: todayISO(), unitPrice: 1.3, currency: "EUR", fxRate: 1, moq: null, leadTimeDays: null, paymentTermsDays: null, incoterm: "FCA", validUntil: null, notes: null, original: null });
    const n = await one();
    const fca = n.anchors.find((a) => a.label === "Mock Paraffin Sp. z o.o.")!;
    expect(fca).toMatchObject({ basis: "nominal", role: "supports" });
    expect(n.warnings.join(" ")).toMatch(/Mock Paraffin Sp\. z o\.o\.: the true cost is incomplete/);
    // The cheaper-looking quote does not become the low end: the delivered offer still sets it.
    expect(n.range!.low).toBeGreaterThan(1.3);
    expect(n.improve.map((x) => x.kind)).toContain("complete_true_cost");
  });
});

describe("what a person knows better", () => {
  it("is kept with its reason next to the software's estimate, and changes the estimate", async () => {
    const before = await one();
    await saveJudgement(db, productId, "switching_difficulty", "high", "Needs a production test");
    const [row] = (await db.select().from(schema.productDataFields)).filter((r) => r.field === "switching_difficulty");
    expect(row).toMatchObject({ value: "high", note: "Needs a production test", source: "user", estimate: { value: "low" } });
    const n = await one();
    expect(n.judgements.switching_difficulty).toMatchObject({ system: "low", effective: "high" });
    expect(n.strengthScore).toBeLessThan(before.strengthScore);
    expect(n.inputs.find((x) => x.key === "switching_difficulty")).toMatchObject({ status: "confirmed", value: "High" });
    expect(await recordEstimates(db, [productId])).toBe(1);
    expect((await readEstimateHistory(db, productId))[0].snapshot.judgements).toEqual({ switching_difficulty: "high" });
    // The product's data sheet is untouched by it.
    expect((await readProfiles(db, [productId])).get(productId)!.counts.important).toBeGreaterThan(0);
  });

  it("can be taken back", async () => {
    await saveJudgement(db, productId, "switching_difficulty", null, null);
    expect((await db.select().from(schema.productDataFields)).filter((r) => r.field === "switching_difficulty")).toEqual([]);
    expect((await one()).judgements.switching_difficulty).toMatchObject({ user: null, effective: "low" });
  });
});

describe("what never happens", () => {
  it("no purchase, quote or supplier is changed by estimating", async () => {
    const purchases = await db.select().from(schema.purchases);
    expect(purchases).toHaveLength(5);
    expect(purchases.filter((p) => p.productId === productId).map((p) => Number(p.unitPrice)).sort()).toEqual([1.48, 1.48, 1.5, 1.52]);
    expect(await db.select().from(schema.quotes)).toHaveLength(2);
  });

  it("a stored estimate is private: nothing of it but public references could be shown outside", async () => {
    const rows = await db.select().from(schema.negotiationEstimates);
    expect(rows.every((r) => r.dataClass === "model_estimate")).toBe(true);
    const [latest] = await readEstimateHistory(db, productId);
    const shown = publicView(latest);
    expect(shown.anchors.every((a) => a.dataClass === "anonymized_benchmark")).toBe(true);
    expect(JSON.stringify(shown)).not.toMatch(/Mock Wax GmbH|Mock Paraffin|1\.42|1\.48/);
  });
});
