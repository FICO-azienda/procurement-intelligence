/**
 * The procurement product dataset on a real in-memory Postgres. The company,
 * supplier and product are made up for the test, and from no particular
 * industry: the rules must hold for any manufacturer.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { dataReadiness } from "@/lib/dataset/profile";
import { confirmDataField, confirmedQuantities, linkProductDocument, parseFieldValue, readProfiles, saveDataField } from "./product-data";
import { readRfqLines } from "./sourcing";

let db: DB;
let productId: string;
let supplierId: string;
let documentId: string;

// Four months of history: 1 June – 28 September.
const BUYS: [date: string, qty: number, price: number][] = [
  ["2026-06-01", 2_000, 2.1],
  ["2026-06-29", 2_400, 2.1],
  ["2026-07-27", 1_600, 2.2],
  ["2026-08-24", 2_000, 2.25],
  ["2026-09-28", 2_000, 2.3],
];

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await db.insert(schema.settings).values({ id: 1, companyName: "Example Manufacturing Srl", country: "Italy" });
  const [s] = await db.insert(schema.suppliers).values({ name: "Acme Metals S.p.A.", country: "Italy" }).returning();
  supplierId = s.id;
  const [p] = await db.insert(schema.products).values({ name: "Lamiera acciaio 2 mm", sku: "LAM-2", unit: "kg", kind: "direct_material", category: "Metals", mappedAt: new Date(), currentSupplierId: s.id }).returning();
  productId = p.id;
  await db.insert(schema.productAliases).values({ productId, alias: "LAMIERA ACC. 2MM ACME", normalized: "lamiera acc 2mm acme", supplierId, supplierSku: "AC-7781" });
  const [doc] = await db.insert(schema.documents).values({ filename: "acme-quote.pdf", sizeBytes: 10, sha256: "abc", storagePath: "x" }).returning();
  documentId = doc.id;
  for (const [i, [date, qty, price]] of BUYS.entries()) {
    await db.insert(schema.purchases).values({ productId, supplierId, date, quantity: String(qty), unit: "kg", unitPrice: String(price), totalAmount: String(qty * price), invoiceReference: `F-${i + 1}`, paymentTermsDays: i === BUYS.length - 1 ? 60 : null, source: "invoice" });
  }
}, 30_000);

const profile = async () => (await readProfiles(db, [productId])).get(productId)!;

describe("what is already known", () => {
  it("fills in every figure the invoices prove, with its source", async () => {
    const p = await profile();
    expect(p.fields.current_price).toMatchObject({ status: "confirmed", source: { kind: "invoice", label: "Invoice F-5", date: "2026-09-28" } });
    expect(p.fields.current_supplier).toMatchObject({ status: "confirmed", display: "Acme Metals S.p.A." });
    expect(p.fields.supplier_code).toMatchObject({ status: "confirmed", display: "AC-7781" });
    expect(p.fields.historical_min.display).toContain("2,10");
    expect(p.fields.historical_max.display).toContain("2,30");
    expect(p.fields.historical_volume).toMatchObject({ status: "confirmed", display: "10.000 kg" });
    expect(p.fields.payment_terms).toMatchObject({ status: "confirmed", raw: "60", source: { label: "Invoice F-5" } });
    expect(p.fields.weighted_average.method).toContain("5 purchases");
  });

  it("annualizes a short history only as an estimate, and says from how many months", async () => {
    const p = await profile();
    expect(p.fields.annual_volume.status).toBe("estimated");
    expect(p.fields.annual_volume.method).toMatch(/Annualized: 10\.000 kg bought in 3,9 months/);
    expect(p.fields.annual_volume.method).toContain("Not a real yearly figure");
    // 10.000 kg in 120 days → about 30.400 kg a year.
    expect(Number(p.fields.annual_volume.raw)).toBe(30_417);
    expect(p.fields.typical_order).toMatchObject({ status: "estimated", raw: "2000", confirmable: true });
    expect(p.fields.purchase_frequency).toMatchObject({ status: "estimated" });
    expect(p.fields.purchase_frequency.display).toContain("28 days");
  });

  it("never fills a gap: what nothing proves is missing, with whom to ask", async () => {
    const p = await profile();
    for (const k of ["delivery_basis", "freight_included", "moq", "lead_time", "datasheet", "application", "technical_spec"] as const) expect(p.fields[k].status).toBe("missing");
    expect(p.missing).toEqual(expect.arrayContaining(["delivery_basis", "freight_included", "moq", "lead_time", "datasheet"]));
    // A name a new supplier can't read comes first: without it no request is useful.
    expect(p.readiness.sourcing).toMatchObject({ level: "not_ready", missing: expect.arrayContaining(["neutral_name"]) });
    expect(p.next).toMatchObject({ kind: "describe" });
  });

  it("judges sourcing apart from the true cost", async () => {
    await saveDataField(db, productId, "technical_spec", "Hot-rolled, EN 10025, 2 mm ± 0,1");
    const p = await profile();
    // With a specification, the invoice name without the supplier's code is a usable description — to confirm.
    expect(p.fields.neutral_name).toMatchObject({ status: "estimated", confirmable: true });
    expect(p.readiness.sourcing.level).toBe("ready");
    expect(p.readiness.true_cost).toMatchObject({ level: "partial", missing: ["delivery_basis", "freight_included"] });
    expect(dataReadiness(p)).toBe("partial");
  });
});

describe("completing the data", () => {
  it("confirming an estimate makes it confirmed and keeps what was estimated, and how", async () => {
    await confirmDataField(db, productId, "typical_order");
    const p = await profile();
    expect(p.fields.typical_order).toMatchObject({ status: "confirmed", raw: "2000", source: { kind: "you" }, original: { value: "2.000 kg" } });
    expect(p.fields.typical_order.original!.method).toContain("Median of 5 purchases");
  });

  it("a corrected volume is what requests and the true cost use", async () => {
    await saveDataField(db, productId, "annual_volume", "24000");
    expect((await confirmedQuantities(db)).get(productId)).toEqual({ annual: 24_000, typicalOrder: 2_000 });
    const line = (await readRfqLines(db, [productId])).get(productId)!;
    expect(line).toMatchObject({ annualQuantity: 24_000, typicalOrderQuantity: 2_000 });
    const p = await profile();
    expect(p.fields.annual_volume).toMatchObject({ status: "confirmed", original: { method: expect.stringContaining("Annualized") } });
  });

  it("writes each value where the app reads it", async () => {
    await saveDataField(db, productId, "payment_terms", "90");
    await saveDataField(db, productId, "moq", "1500");
    await saveDataField(db, productId, "grade", "S235JR");
    await saveDataField(db, productId, "neutral_name", "Hot-rolled steel sheet, 2 mm");
    const [s] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, supplierId));
    expect(s.paymentTermsDays).toBe(90);
    const [link] = await db.select().from(schema.supplierProducts).where(eq(schema.supplierProducts.productId, productId));
    expect(Number(link.moq)).toBe(1500);
    const [prod] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(prod.specs).toEqual({ Grade: "S235JR" });
    expect(prod.rfqName).toBe("Hot-rolled steel sheet, 2 mm");
    const p = await profile();
    expect(p.fields.payment_terms).toMatchObject({ status: "confirmed", raw: "90", source: { kind: "you" } });
    expect(p.fields.moq).toMatchObject({ status: "confirmed", source: { kind: "you" } });
    expect(p.readiness.sourcing.level).toBe("ready");
    expect(p.next).toMatchObject({ kind: "ask_supplier" });
    expect(p.next.label).toContain("Acme Metals S.p.A.");
  });

  it("delivery terms complete the true cost readiness; freight follows the Incoterm only as an estimate", async () => {
    await saveDataField(db, productId, "delivery_basis", "dap");
    let p = await profile();
    expect(p.fields.delivery_basis.display).toBe("DAP");
    expect(p.fields.freight_included).toMatchObject({ status: "estimated", raw: "yes", confirmable: true });
    await confirmDataField(db, productId, "freight_included");
    p = await profile();
    expect(p.readiness.true_cost.level).toBe("ready");
  });

  it("refuses what can't be read, and clears on empty", async () => {
    expect(parseFieldValue("moq", "lots")).toEqual({ error: "number" });
    expect(parseFieldValue("lead_time", "2.5")).toEqual({ error: "days" });
    expect(parseFieldValue("freight_included", "maybe")).toEqual({ error: "yesno" });
    expect(parseFieldValue("current_price", "1")).toEqual({ error: "not_editable" });
    expect(parseFieldValue("moq", "1.500")).toEqual({ value: "1500" });
    expect(parseFieldValue("moq", "1,5")).toEqual({ value: "1.5" });
    expect(parseFieldValue("delivery_basis", "fca")).toEqual({ value: "FCA" });
    await saveDataField(db, productId, "grade", null);
    const [prod] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(prod.specs).toBeNull();
  });

  it("links a document already on file instead of copying it", async () => {
    await linkProductDocument(db, productId, documentId, "supplier_quote");
    await linkProductDocument(db, productId, documentId, "technical_datasheet");
    const links = await db.select().from(schema.productDocuments).where(eq(schema.productDocuments.productId, productId));
    expect(links).toHaveLength(1);
    expect(links[0].type).toBe("technical_datasheet");
    expect((await profile()).fields.datasheet).toMatchObject({ status: "confirmed", display: "acme-quote.pdf" });
  });
});
