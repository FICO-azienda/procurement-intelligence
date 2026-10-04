/**
 * Product normalisation end to end, on a real in-memory Postgres: a file of
 * invoice lines as an e-invoice export writes them (typed codes, discounts,
 * a credit note, lump sums, repeated lines) goes from "nothing is known" to
 * imported purchases — and the same descriptions are recognised by themselves
 * the next time.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import * as schema from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { isStrategic } from "@/lib/catalog/kinds";
import { catalogueOf, companySpend } from "@/lib/catalog/spend";
import { readDataset, readLearning } from "@/lib/data";
import { proposeMapping } from "@/lib/import/fields";
import type { CurrentData, Issue } from "@/lib/import/types";
import { analyzeSession, answerKind, answerSame, confirmDrafts } from "./catalog";
import { applyMapping, approveSession, createAllNew, createUpload, getSession, getSessionItems, type SpreadsheetExtraction } from "./imports";

let db: DB;
const HEADER = "supplier_name,supplier_vat,supplier_country,document_type,invoice_number,invoice_date,currency,line_number,product_code,description,quantity,unit_of_measure,unit_price_original,discount_surcharge,line_total";
const row = (supplier: string, vat: string, type: string, invoice: string, date: string, line: number, code: string, description: string, qty: string, unit: string, price: string, discount: string, total: string) =>
  [supplier, vat, "IT", type, invoice, date, "EUR", line, code, `"${description}"`, qty, unit, price, discount, total].join(",");
const SER = ["SER S.p.A.", "00000000011"] as const;
const MONTE = ["Monterosa Srl", "00000000022"] as const;
const BIANCHI = ["Cereria Bianchi", "00000000033"] as const;
const CALONI = ["CALONI GROUPAGE S.R.L.", "00000000044"] as const;
const SCREEN = ["Special Screen Srl", "00000000055"] as const;
const AXI = ["Axitea Spa", "00000000066"] as const;

const MAY = [
  row(...SER, "TD01", "100", "2026-05-10", 1, "ART:PRP026", "PARAFFINA SER 52/54 (XXF)", "20000", "KG", "1.50", "", "30000.00"),
  row(...SER, "TD01", "100", "2026-05-10", 2, "", "ADDEBITO TRASPORTO", "", "", "250.00", "", "250.00"),
  row(...MONTE, "TD24", "M-1", "2026-05-12", 1, "AswArtFor:PFTRTG1204", "* TRECCIOLINO TG 1204", "4", "kg", "34.48", "", "137.92"),
  row(...MONTE, "TD24", "M-1", "2026-05-12", 2, "AswArtFor:PFTRTG1206", "* TRECCIOLINO TG 1206", "16", "kg", "36.00", "SC 7.00%", "535.68"),
  row(...BIANCHI, "TD01", "B-7", "2026-05-15", 1, "AswArtFor:CLA", "Candela Liturgica Altare Ø 22x400 mm", "400", "KG", "4.25", "", "1700.00"),
  row(...BIANCHI, "TD01", "B-7", "2026-05-15", 2, "AswArtFor:CLA", "Candela Liturgica Altare Ø 25x160 mm", "64", "KG", "4.25", "", "272.00"),
  row(...CALONI, "TD01", "C-9", "2026-05-20", 1, "", "Rif.cl 959 del 12/05/2026 linea MB- -OT-1 co 1 KG 145,0 Nolo", "1", "NR", "72.00", "", "72.00"),
  row(...CALONI, "TD01", "C-9", "2026-05-20", 2, "", "Rif.cl 997 del 14/05/2026 linea MB- -RE-1 co 4 KG 1490,0 Nolo", "1", "NR", "200.60", "", "200.60"),
  // Two equal lines on one invoice: two purchases, told apart by their line number.
  row(...CALONI, "TD01", "C-9", "2026-05-20", 3, "", "Diritto fisso", "1", "NR", "2.50", "", "2.50"),
  row(...CALONI, "TD01", "C-9", "2026-05-20", 4, "", "Diritto fisso", "1", "NR", "2.50", "", "2.50"),
  row(...SCREEN, "TD01", "S-3", "2026-05-22", 1, "AswArtFor:290610", "50x70 - BEST CHOICE - ARTICOLO 60T", "50000", "Nr", "0.01", "", "500.00"),
  row(...AXI, "TD01", "A-1", "2026-05-25", 1, "COD.:40002497", "MONITORAGGIO ALLARMI E INTERVENTO FA", "1", "NM", "436.50", "", "436.50"),
  // A credit on a service bill lowers that spend.
  row(...AXI, "TD01", "A-1", "2026-05-25", 2, "", "Sconto fedeltà", "1", "", "-36.50", "", "-36.50"),
  // A credit note and a line with no amount are not purchases.
  row(...AXI, "TD04", "A-2", "2026-05-28", 1, "COD.:40002497", "MONITORAGGIO ALLARMI E INTERVENTO FA", "1", "NM", "100.00", "", "100.00"),
  row(...SER, "TD01", "100", "2026-05-10", 3, "", "Costi di spedizione", "1", "", "5.00", "SC 5.00", "0.00"),
];
const JUNE = [
  row(...SER, "TD01", "140", "2026-06-10", 1, "ART:PRP026", "PARAFFINA SER 52-54 (XXF)", "20000", "KG", "1.52", "", "30400.00"),
  row(...MONTE, "TD24", "M-2", "2026-06-12", 1, "AswArtFor:PFTRTG1206", "* TRECCIOLINO TG 1206", "8", "kg", "33.48", "", "267.84"),
  row(...CALONI, "TD01", "C-15", "2026-06-20", 1, "", "Rif.cl 1203 del 16/06/2026 linea MB- -TO-2 co 2 KG 300,0 Nolo", "1", "NR", "95.00", "", "95.00"),
  row(...AXI, "TD01", "A-5", "2026-06-25", 1, "COD.:40002497", "MONITORAGGIO ALLARMI E INTERVENTO FA", "1", "NM", "436.50", "", "436.50"),
  row(...MONTE, "TD24", "M-2", "2026-06-12", 2, "AswArtFor:PFTUCR043", "TUBOLARE CR 43", "9", "kg", "38.57", "", "347.13"),
];

async function upload(name: string, rows: string[]) {
  const bytes = new TextEncoder().encode([HEADER, ...rows].join("\n"));
  const { sessionId } = await createUpload(db, { name, bytes }, "auto");
  const s = (await getSession(db, sessionId))!;
  const columns = proposeMapping((s.extraction as SpreadsheetExtraction).headers);
  expect((await applyMapping(db, sessionId, { columns, recordType: "purchase", defaultCurrency: "EUR" })).error).toBeUndefined();
  await createAllNew(db, sessionId, "supplier");
  return sessionId;
}
const statuses = async (sessionId: string) => {
  const counts: Record<string, number> = {};
  for (const i of await getSessionItems(db, sessionId)) counts[i.status] = (counts[i.status] ?? 0) + 1;
  return counts;
};

beforeAll(async () => {
  process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "pi-catalog-"));
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}, 30_000);

describe("a first import of real invoice lines", () => {
  let may: string;

  it("reads the columns of an e-invoice export: net prices, typed codes, lump sums, what is not a purchase", async () => {
    const columns = proposeMapping(HEADER.split(","));
    expect(columns).toMatchObject({ discount_surcharge: "discount", document_type: "document_type", line_number: "invoice_line", product_code: "sku", unit_price_original: "unit_price", line_total: "total" });
    may = await upload("maggio.csv", MAY);
    const items = await getSessionItems(db, may);
    const data = (line: number) => items[line - 1].data as CurrentData;
    // "AswArtFor:…" is the supplier's code, not ours.
    expect(data(3)).toMatchObject({ supplierSku: "PFTRTG1204", sku: null, invoiceLine: 1, documentType: "TD24" });
    // A discount: the price is what was paid per unit.
    expect(data(4).unitPrice).toBe(33.48);
    // No quantity: one item at the line total.
    expect(data(2)).toMatchObject({ quantity: 1, unitPrice: 250 });
    // Set aside by themselves, with the reason.
    expect(await statuses(may)).toEqual({ attention: 13, skipped: 2 });
    const reasons = items.filter((i) => i.status === "skipped").map((i) => (i.issues as Issue[]).find((x) => x.excludes)?.message);
    expect(reasons).toEqual(["Credit note: it corrects an earlier invoice and is not a purchase", "Line with no amount: nothing was bought"]);
    // Nothing was created by looking.
    expect((await readDataset(db)).products).toEqual([]);
  });

  it("proposes products and spend, and asks only where it can't know", async () => {
    const a = await analyzeSession(db, may);
    expect(a).toMatchObject({ descriptions: 12, lines: 13, products: 3, otherSpend: 3, grouped: 5 });
    expect(a.confident.map((d) => [d.name, d.kind, d.lines])).toEqual([
      ["Paraffina SER 52/54 (XXF)", "direct_material", 1],
      ["Trecciolino TG 1206", "component", 1],
      ["Servizi — Axitea Spa", "service", 2],
      ["Trasporti e logistica — CALONI GROUPAGE S.R.L.", "logistics", 4],
      ["Addebito Trasporto — SER S.p.A.", "logistics", 1],
      ["Trecciolino TG 1204", "component", 1],
    ].map(([name, kind, lines]) => [String(name).replace("Servizi", "Services").replace("Trasporti e logistica", "Transport and logistics"), kind, lines]));
    expect(a.questions.map((q) => [q.type, q.suggestion, q.drafts.length])).toEqual([
      ["same", "merge", 2],
      ["kind", null, 1],
    ]);
  });

  it("confirms everything it is sure of in one go; the lines become ready, the doubts stay open", async () => {
    expect(await confirmDrafts(db, may)).toEqual({ created: 6, lines: 10 });
    expect(await statuses(may)).toEqual({ ready: 10, attention: 3, skipped: 2 });
    const data = await readDataset(db);
    expect(data.products.map((p) => [p.name, p.kind, p.unit]).sort()).toEqual([
      ["Addebito Trasporto — SER S.p.A.", "logistics", "pcs"],
      ["Paraffina SER 52/54 (XXF)", "direct_material", "kg"],
      ["Services — Axitea Spa", "service", "pcs"],
      ["Transport and logistics — CALONI GROUPAGE S.R.L.", "logistics", "pcs"],
      ["Trecciolino TG 1204", "component", "kg"],
      ["Trecciolino TG 1206", "component", "kg"],
    ]);
    // Every description is an alias of its product, as written, with the supplier's code and where it came from.
    const { productAliases } = await readLearning(db);
    expect(productAliases).toHaveLength(9);
    const tg = data.products.find((p) => p.name === "Trecciolino TG 1206")!;
    expect(productAliases.find((x) => x.productId === tg.id)).toMatchObject({ alias: "* TRECCIOLINO TG 1206", supplierSku: "PFTRTG1206", confidence: "high", confirmedByUser: true, sourceSessionId: may });
    const caloni = data.products.find((p) => p.name.includes("CALONI"))!;
    expect(productAliases.filter((x) => x.productId === caloni.id).map((x) => x.alias)).toContain("Diritto fisso");
  });

  it("the ready lines can be imported while the doubts wait", async () => {
    const res = await approveSession(db, may);
    expect(res.imported).toBe(10);
    expect(await statuses(may)).toEqual({ imported: 10, attention: 3, skipped: 2 });
    const data = await readDataset(db);
    expect(data.purchases).toHaveLength(10);
    // The original text and the invoice line stay on each purchase.
    const diritto = data.purchases.filter((p) => p.originalDescription === "Diritto fisso");
    expect(diritto.map((p) => p.invoiceLine).sort()).toEqual([3, 4]);
    // A credit on a bill is negative spend, kept as written.
    expect(data.purchases.find((p) => p.originalDescription === "Sconto fedeltà")).toMatchObject({ quantity: 1, unitPrice: -36.5, totalAmount: -36.5 });
  });

  it("each doubt is one decision: merge sizes under one product, say what an unknown line is", async () => {
    const [same, kind] = (await analyzeSession(db, may)).questions;
    expect((await answerSame(db, may, same.key, "merge")).created).toBe(1);
    expect((await answerKind(db, may, kind.key, "packaging")).created).toBe(1);
    expect((await answerKind(db, may, kind.key, "packaging")).error).toBe("This question is no longer open.");
    expect(await statuses(may)).toEqual({ imported: 10, ready: 3, skipped: 2 });
    expect((await approveSession(db, may)).imported).toBe(3);
    const data = await readDataset(db);
    const candle = data.products.find((p) => p.name === "Candela Liturgica Altare")!;
    expect(candle).toMatchObject({ kind: "direct_material", unit: "kg" });
    expect(data.purchases.filter((p) => p.productId === candle.id).map((p) => p.originalDescription).sort()).toEqual(["Candela Liturgica Altare Ø 22x400 mm", "Candela Liturgica Altare Ø 25x160 mm"]);
    expect(data.products.find((p) => p.name === "50x70 - Best Choice - Articolo 60T")).toMatchObject({ kind: "packaging" });
    expect((await readLearning(db)).productAliases.filter((a) => a.productId === candle.id).every((a) => a.confidence === "medium")).toBe(true);
  });

  it("every euro of the file is in the spend, split between the catalogue and the rest", async () => {
    const data = await readDataset(db);
    const spend = companySpend(data, todayISO());
    const expected = { catalogue: 30000 + 137.92 + 535.68 + 1700 + 272 + 500, other: 250 + 72 + 200.6 + 2.5 + 2.5 + 436.5 - 36.5 };
    expect(spend.catalogue).toBeCloseTo(expected.catalogue, 2);
    expect(spend.other).toBeCloseTo(expected.other, 2);
    expect(spend.items.map((i) => [i.kind, Math.round(i.annualSpend), i.lines])).toEqual([
      ["service", 400, 2],
      ["logistics", 278, 4],
      ["logistics", 250, 1],
    ]);
    // Procurement Intelligence works on the catalogue only; suppliers are all still there.
    const catalogue = catalogueOf(data);
    expect(catalogue.products.every((p) => isStrategic(p.kind))).toBe(true);
    expect(catalogue.products).toHaveLength(5);
    expect(catalogue.suppliers).toHaveLength(data.suppliers.length);
  });
});

describe("the next import", () => {
  it("recognises what it learned: aliases, supplier codes, and the kind of spend of each supplier", async () => {
    const june = await upload("giugno.csv", JUNE);
    const items = await getSessionItems(db, june);
    const data = await readDataset(db);
    const name = (i: (typeof items)[number]) => data.products.find((p) => p.id === i.productId)?.name ?? null;
    expect(items.map((i) => [name(i), i.productResolution])).toEqual([
      // Written with a dash instead of a slash: the same words.
      ["Paraffina SER 52/54 (XXF)", "auto"],
      ["Trecciolino TG 1206", "auto"],
      // A shipment never seen before: still this carrier's transport.
      ["Transport and logistics — CALONI GROUPAGE S.R.L.", "auto"],
      ["Services — Axitea Spa", "auto"],
      // Really new: the only thing left to decide.
      [null, null],
    ]);
    expect(await statuses(june)).toEqual({ ready: 4, attention: 1 });
    const a = await analyzeSession(db, june);
    expect(a.confident.map((d) => [d.name, d.kind])).toEqual([["Tubolare CR 43", "component"]]);
    expect(a.questions).toEqual([]);
    expect(await confirmDrafts(db, june)).toEqual({ created: 1, lines: 1 });
    expect((await approveSession(db, june)).imported).toBe(5);
    expect((await readDataset(db)).products).toHaveLength(9);
  });


  it("remembers what a supplier sells: once its labels are packaging, a new label is not asked about", async () => {
    // "50x70 - BEST CHOICE…" from Special Screen was said to be packaging; nothing in this text says what it is.
    const labels = await upload("etichette.csv", [row(...SCREEN, "TD01", "S-5", "2026-06-28", 1, "AswArtFor:290675", "55x55 - MADONNA DEL FRASSINO", "50000", "Nr", "0.0135", "", "675.00")]);
    const a = await analyzeSession(db, labels);
    expect(a.questions).toEqual([]);
    expect(a.confident.map((d) => [d.name, d.kind])).toEqual([["55x55 - Madonna del Frassino", "packaging"]]);
    expect(await confirmDrafts(db, labels)).toEqual({ created: 1, lines: 1 });
    expect((await approveSession(db, labels)).imported).toBe(1);
  });

  it("the same lines again are duplicates, not new purchases", async () => {
    const again = await upload("maggio-di-nuovo.csv", MAY);
    const items = await getSessionItems(db, again);
    expect(await statuses(again)).toEqual({ attention: 13, skipped: 2 });
    expect(items.filter((i) => i.status === "attention").every((i) => (i.issues as Issue[]).some((x) => x.code === "duplicate"))).toBe(true);
    expect((await approveSession(db, again)).error).toBe("No lines are ready to import yet.");
    expect((await readDataset(db)).purchases).toHaveLength(19);
    expect((await analyzeSession(db, again)).descriptions).toBe(0);
  });

  it("more spend of a kind a supplier already has joins the same item", async () => {
    const extra = await upload("luglio.csv", [row(...SCREEN, "TD01", "S-9", "2026-07-02", 1, "", "Spese incasso", "1", "", "2.50", "", "2.50"), row(...SCREEN, "TD01", "S-10", "2026-07-20", 1, "", "Rivalsa bolli", "1", "", "2.00", "", "2.00")]);
    expect((await confirmDrafts(db, extra)).created).toBe(1);
    const before = (await readDataset(db)).products.length;
    const later = await upload("agosto.csv", [row(...SCREEN, "TD01", "S-12", "2026-08-02", 1, "", "Bollo su fattura", "1", "", "2.00", "", "2.00")]);
    const [item] = await getSessionItems(db, later);
    expect(item.status).toBe("ready");
    expect((await readDataset(db)).products).toHaveLength(before);
  });
});

describe("the real export's columns", () => {
  it("are all understood (header of Cereria_Cicogna_Acquisti_Puliti.csv)", () => {
    const header = "original_file,file_sha256,transmission_progressive,fatturapa_format,destination_code,supplier_name,supplier_vat_country,supplier_vat,supplier_tax_code,supplier_country,customer_name,customer_vat,body_index,document_type,invoice_number,invoice_date,currency,invoice_total,causal,payment_condition,payment_method,payment_days,payment_due_date,payment_amounts,supplier_iban,line_number,product_code,description,quantity,unit_of_measure,unit_price_original,discount_surcharge,line_total,net_unit_price_calc,vat_rate,vat_nature,period_start,period_end,line_classification_guess,include_in_spend_analysis".split(",");
    const mapped = Object.fromEntries(Object.entries(proposeMapping(header)).filter(([, f]) => f));
    expect(mapped).toEqual({
      supplier_name: "supplier_name",
      supplier_vat: "supplier_vat",
      supplier_country: "supplier_country",
      document_type: "document_type",
      invoice_number: "invoice_reference",
      invoice_date: "purchase_date",
      currency: "currency",
      payment_days: "payment_terms",
      line_number: "invoice_line",
      product_code: "sku",
      description: "description",
      quantity: "quantity",
      unit_of_measure: "unit",
      // The price actually paid, when the file has both the list price and the net one.
      net_unit_price_calc: "unit_price",
      discount_surcharge: "discount",
      line_total: "total",
    });
  });
});
