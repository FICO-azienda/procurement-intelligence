/**
 * End-to-end import scenarios (A–G + PDF quote) against a real, in-memory
 * Postgres (PGlite) with the demo data. Files come from test-data/
 * (regenerate with: npx tsx scripts/make-test-data.ts).
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { productMetrics } from "@/lib/analytics";
import { readDataset } from "@/lib/data";
import type { Issue, ItemData } from "@/lib/import/types";
import {
  acknowledge,
  applyMapping,
  approveSession,
  createUpload,
  decideDuplicate,
  getSession,
  getSessionItems,
  productGroupKey,
  resolveProduct,
  resolveSupplier,
  supplierGroupKey,
  type MappingInfo,
  type SpreadsheetExtraction,
} from "./imports";

let db: DB;
const file = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(path.join(process.cwd(), "test-data", name))) });
const AS_OF = new Date().toISOString().slice(0, 10);

async function uploadAndMap(name: string) {
  const { sessionId } = await createUpload(db, file(name), "spreadsheet");
  const s = await getSession(db, sessionId);
  expect(s?.status, s?.errorMessage ?? "").toBe("uploaded");
  const res = await applyMapping(db, sessionId, s!.mapping as MappingInfo);
  expect(res.error).toBeUndefined();
  return sessionId;
}
const issues = (i: { issues: unknown }) => i.issues as Issue[];
const codes = (i: { issues: unknown }) => issues(i).map((x) => x.code);

beforeAll(async () => {
  process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "pi-files-"));
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await seedDemo(db);
}, 30_000);

describe("import scenarios", () => {
  it("A — perfect CSV: everything recognised, 10 purchases imported", async () => {
    const id = await uploadAndMap("scenario-a-perfect.csv");
    const s = await getSession(db, id);
    expect(Object.values((s!.mapping as MappingInfo).columns).filter(Boolean)).toHaveLength(9);
    const items = await getSessionItems(db, id);
    expect(items).toHaveLength(10);
    expect(items.every((i) => i.status === "ready")).toBe(true);
    const res = await approveSession(db, id);
    expect(res.imported).toBe(10);
    expect((await getSession(db, id))!.status).toBe("completed");
    const imported = (await readDataset(db)).purchases.filter((p) => p.source === "csv");
    expect(imported).toHaveLength(10);
    expect(imported[0].sourceDoc?.filename).toBe("scenario-a-perfect.csv");
  });

  it("B — Italian CSV: columns mapped automatically, comma decimals and ; separator", async () => {
    const { sessionId } = await createUpload(db, file("scenario-b-italiano.csv"), "spreadsheet");
    const s = await getSession(db, sessionId);
    const m = (s!.mapping as MappingInfo).columns;
    expect(m).toEqual({ Data: "purchase_date", Fornitore: "supplier_name", Descrizione: "description", "Quantità": "quantity", Prezzo: "unit_price" });
    expect((s!.extraction as SpreadsheetExtraction).headers).toContain("Quantità"); // Windows-1252 decoded
    await applyMapping(db, sessionId, s!.mapping as MappingInfo);
    const items = await getSessionItems(db, sessionId);
    const box = items.find((i) => (i.data as ItemData).description === "Scatola Home Collection")!;
    expect((box.data as ItemData).quantity).toBe(5000);
    expect((box.data as ItemData).unitPrice).toBe(0.46);
    expect((box.data as ItemData).currency).toBe("EUR");
    expect(items.every((i) => i.productId && i.supplierId)).toBe(true);
    expect(items.every((i) => i.status === "ready")).toBe(true);
  });

  it("C — 'ABC S.r.l.' is suggested as ABC Srl (92%), confirmed, then learned", async () => {
    const id = await uploadAndMap("scenario-c-fornitore.csv");
    let [item] = await getSessionItems(db, id);
    expect(item.supplierId).toBeNull();
    expect(item.supplierMatch).toMatchObject({ status: "probable", confidence: 0.92 });
    expect(codes(item)).toContain("supplier_probable");
    const abc = (await db.select().from(schema.suppliers).where(eq(schema.suppliers.name, "ABC Srl")))[0];
    await resolveSupplier(db, id, supplierGroupKey(item.data as ItemData), { type: "use", supplierId: abc.id });
    [item] = await getSessionItems(db, id);
    expect(item.supplierId).toBe(abc.id);
    expect(item.supplierResolution).toBe("confirmed");
    expect(item.status).toBe("ready");
    // Learned: a new upload of the same supplier spelling matches exactly.
    const again = await uploadAndMap("scenario-c-fornitore.csv");
    const [second] = await getSessionItems(db, again);
    expect(second.supplierMatch).toMatchObject({ status: "exact" });
  });

  it("D — 'PARAFFIN WAX 58/60' is suggested as Paraffina 58/60, alias saved", async () => {
    const id = await uploadAndMap("scenario-d-alias.csv");
    const [item] = await getSessionItems(db, id);
    expect((item.data as ItemData).date).toBe("2026-09-21"); // US month-first date detected
    expect(item.productMatch).toMatchObject({ status: "probable" });
    const par = (await db.select().from(schema.products).where(eq(schema.products.sku, "PAR-5860")))[0];
    expect((item.productMatch as { id: string }).id).toBe(par.id);
    await resolveProduct(db, id, productGroupKey(item.data as ItemData), { type: "use", productId: par.id });
    const aliases = await db.select().from(schema.productAliases);
    expect(aliases.map((a) => a.alias)).toContain("PARAFFIN WAX 58/60");
    const again = await uploadAndMap("scenario-d-alias.csv");
    const [second] = await getSessionItems(db, again);
    expect(second.productMatch).toMatchObject({ status: "exact", id: par.id });
  });

  it("E — Excel with a new product: create it, then import", async () => {
    const id = await uploadAndMap("scenario-e-nuovo-prodotto.xlsx");
    const s = await getSession(db, id);
    expect((s!.extraction as SpreadsheetExtraction).headers[0]).toBe("Data"); // title rows skipped
    const items = await getSessionItems(db, id);
    const jar = items.find((i) => (i.data as ItemData).description === "Glass Jar Green 500 ml")!;
    expect((jar.data as ItemData).date).toBe("2026-09-18");
    expect((jar.data as ItemData).unit).toBe("pcs");
    expect(jar.productMatch).toMatchObject({ status: "none" });
    expect(codes(jar)).toContain("product_unmatched");
    const res = await resolveProduct(db, id, productGroupKey(jar.data as ItemData), {
      type: "create",
      name: "Glass Jar Green 500 ml",
      sku: "GLS-500-GRN",
      unit: "pcs",
      category: "Glass",
    });
    expect(res.error).toBeUndefined();
    const after = await getSessionItems(db, id);
    expect(after.every((i) => i.status === "ready")).toBe(true);
    const out = await approveSession(db, id);
    expect(out.summary?.newProducts).toBe(1);
  });

  it("F — PDF invoice: lines read, supplier found by VAT/name; second upload flagged duplicate", async () => {
    const { sessionId } = await createUpload(db, file("scenario-f-fattura-abc.pdf"), "invoice");
    const s = await getSession(db, sessionId);
    expect(s?.status, s?.errorMessage ?? "").toBe("needs_review");
    let items = await getSessionItems(db, sessionId);
    expect(items).toHaveLength(2);
    const first = items[0].data as ItemData;
    expect(first).toMatchObject({ quantity: 2000, unit: "kg", unitPrice: 1.64, invoiceReference: "2026/481", date: "2026-09-25", paymentTermsDays: 60 });
    expect(first.freight).toBeCloseTo((60 * 3280) / 4100, 2);
    // ABC S.r.l. was learned in scenario C → exact now.
    expect(items[0].supplierMatch).toMatchObject({ status: "exact" });
    // Products: "Paraffina raffinata 58-60 pastiglie" suggested as Paraffina 58/60
    const par = (await db.select().from(schema.products).where(eq(schema.products.sku, "PAR-5860")))[0];
    for (const it of items) {
      if (!it.productId) await resolveProduct(db, sessionId, productGroupKey(it.data as ItemData), { type: "use", productId: par.id });
    }
    items = await getSessionItems(db, sessionId);
    expect(items.every((i) => i.productId === par.id)).toBe(true);
    await acknowledge(db, { sessionId });
    const res = await approveSession(db, sessionId);
    expect(res.imported).toBe(2);

    // Same file again
    const dup = await createUpload(db, file("scenario-f-fattura-abc.pdf"), "invoice");
    const ds = await getSession(db, dup.sessionId);
    expect(ds?.duplicateOfSessionId).toBe(sessionId);
    const dupItems = await getSessionItems(db, dup.sessionId);
    expect(dupItems.every((i) => codes(i).includes("duplicate"))).toBe(true);
    await decideDuplicate(db, { sessionId: dup.sessionId }, "skip");
    expect((await getSessionItems(db, dup.sessionId)).every((i) => i.status === "skipped")).toBe(true);
  });

  it("G — price increases detected with annualized impact", async () => {
    const before = await readDataset(db);
    const glass = before.products.find((p) => p.sku === "GLS-300")!;
    const glassBefore = productMetrics(glass, before.purchases, AS_OF);

    const id = await uploadAndMap("scenario-g-aumento-prezzi.csv");
    const items = await getSessionItems(db, id);
    const glassItem = items.find((i) => (i.data as ItemData).sku === "GLS-300")!;
    const inc = issues(glassItem).find((x) => x.code === "price_increase")!;
    expect(inc.severity).toBe("review"); // +5,9% > 5%
    expect(inc.data!.previousPrice).toBeCloseTo(glassBefore.currentPrice!, 4);
    expect(inc.data!.newPrice).toBe(1.25);
    expect(inc.data!.annualImpact).toBeCloseTo(glassBefore.annualQuantity * (1.25 - glassBefore.currentPrice!), 2);
    expect(glassItem.status).toBe("attention");

    await acknowledge(db, { sessionId: id });
    const res = await approveSession(db, id);
    expect(res.imported).toBe(2);
    const g = res.summary!.priceChanges.find((c) => c.productId === glass.id)!;
    expect(g.newPrice).toBe(1.25);
    expect(g.pct).toBeCloseTo((1.25 / glassBefore.currentPrice! - 1) * 100, 4);
    expect(res.summary!.increaseImpact).toBeGreaterThan(0);

    const after = productMetrics(glass, (await readDataset(db)).purchases, AS_OF);
    expect(after.currentPrice).toBe(1.25);
    expect(after.previousPrice).toBeCloseTo(glassBefore.currentPrice!, 4);
  });

  it("PDF quote becomes a quote with MOQ, lead time, terms and validity", async () => {
    const { sessionId } = await createUpload(db, file("quote-turkish-wax.pdf"), "quote");
    const s = await getSession(db, sessionId);
    expect(s?.status, s?.errorMessage ?? "").toBe("needs_review");
    let [item] = await getSessionItems(db, sessionId);
    expect(item.data).toMatchObject({ unitPrice: 1.29, unit: "kg", moq: 5000, leadTimeDays: 28, paymentTermsDays: 0, incoterm: "FOB", validUntil: "2026-10-31", date: "2026-09-28" });
    expect(item.supplierMatch).toMatchObject({ status: "exact" });
    const par = (await db.select().from(schema.products).where(eq(schema.products.sku, "PAR-5860")))[0];
    // Learned in D: "Paraffin Wax 58/60" is close to the confirmed alias.
    expect((item.productMatch as { id: string }).id).toBe(par.id);
    if (!item.productId) await resolveProduct(db, sessionId, productGroupKey(item.data as ItemData), { type: "use", productId: par.id });
    [item] = await getSessionItems(db, sessionId);
    if (item.status === "attention") await acknowledge(db, { sessionId });
    const res = await approveSession(db, sessionId);
    expect(res.imported).toBe(1);
    const q = (await readDataset(db)).quotes.find((x) => x.source === "quote")!;
    expect(q).toMatchObject({ unitPrice: 1.29, moq: 5000, incoterm: "FOB", validUntil: "2026-10-31" });
    expect(q.sourceDoc?.filename).toBe("quote-turkish-wax.pdf");
  });

  it("explains that a scanned PDF has no text", async () => {
    const { PDFDocument, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]).drawRectangle({ x: 50, y: 50, width: 200, height: 100, color: rgb(0.5, 0.5, 0.5) });
    const scan = await createUpload(db, { name: "scansione.pdf", bytes: await pdf.save() }, "invoice");
    const s = await getSession(db, scan.sessionId);
    expect(s?.status).toBe("failed");
    expect(s?.errorMessage).toMatch(/scanned/i);
  });

  it("rejects unsupported and empty files without crashing", async () => {
    const bad = await createUpload(db, { name: "notes.docx", bytes: new Uint8Array([1, 2, 3]) }, "spreadsheet");
    expect((await getSession(db, bad.sessionId))!).toMatchObject({ status: "failed" });
    const empty = await createUpload(db, { name: "empty.csv", bytes: new Uint8Array() }, "spreadsheet");
    expect((await getSession(db, empty.sessionId))!.errorMessage).toMatch(/empty/i);
    const notPdf = await createUpload(db, { name: "fake.pdf", bytes: new TextEncoder().encode("%PDF-1.4 garbage") }, "invoice");
    expect((await getSession(db, notPdf.sessionId))!.status).toBe("failed");
  });
});
