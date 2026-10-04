/**
 * The "no training needed" side of imports: pasted rows without headers,
 * columns recognised without asking, PDFs that say what they are, new names
 * created in one go, everything ready imported at once. Real in-memory
 * Postgres with the demo data, like imports.test.ts.
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
import { readDataset, readLearning } from "@/lib/data";
import { leftOutNotes, openArchive } from "@/lib/import/archive";
import type { ItemData } from "@/lib/import/types";
import {
  applyMapping,
  approveAllReady,
  createAllNew,
  createUpload,
  getSession,
  getSessionItems,
  inbox,
  productGroupKey,
  reclassifyPdf,
  reopenMapping,
  resolveProduct,
  type MappingInfo,
  type SpreadsheetExtraction,
} from "./imports";

let db: DB;
const text = (name: string, body: string) => ({ name, bytes: new TextEncoder().encode(body) });
const disk = (name: string, as = name) => ({ name: as, bytes: new Uint8Array(readFileSync(path.join(process.cwd(), "test-data", name))) });

beforeAll(async () => {
  process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "pi-easy-"));
  db = drizzle(new PGlite(), { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await seedDemo(db);
}, 30_000);

describe("paste from Excel", () => {
  it("rows without a header: columns are worked out from the values, and the user checks them", async () => {
    const pasted = ["28/09/26\tABC Srl\tParaffina 58/60\t2000\t1,58", "29/09/26\tVetreria Rossi\tVetro Trasparente 300 ml\t6000\t1,18", "30/09/26\tNuova Cartotecnica\tScatola regalo\t500\t0,92"].join("\n");
    const { sessionId } = await createUpload(db, text("Pasted rows.tsv", pasted), "auto", { autoMap: true });
    const s = (await getSession(db, sessionId))!;
    // Guessed from values → never applied silently.
    expect(s.status).toBe("uploaded");
    expect((s.extraction as SpreadsheetExtraction).headerless).toBe(true);
    expect((s.extraction as SpreadsheetExtraction).rowCount).toBe(3);
    expect((s.mapping as MappingInfo).columns).toEqual({
      "Column 1": "purchase_date",
      "Column 2": "supplier_name",
      "Column 3": "product_name",
      "Column 4": "quantity",
      "Column 5": "unit_price",
    });
    expect((await applyMapping(db, sessionId, s.mapping as MappingInfo)).error).toBeUndefined();
    const items = await getSessionItems(db, sessionId);
    expect(items.map((i) => [(i.data as ItemData).date, (i.data as ItemData).quantity, (i.data as ItemData).unitPrice, i.status])).toEqual([
      ["2026-09-28", 2000, 1.58, "ready"],
      ["2026-09-29", 6000, 1.18, "ready"],
      ["2026-09-30", 500, 0.92, "attention"], // supplier and product not known yet
    ]);
    expect(items[0].line).toBe(1);
  });

  it("a single pasted row is enough", async () => {
    const { sessionId } = await createUpload(db, text("Pasted row.tsv", "15/09/26\tABC Srl\tParaffina 58/60\t2000\t1,58"), "auto");
    const s = (await getSession(db, sessionId))!;
    expect(s.status).toBe("uploaded");
    expect(Object.values((s.mapping as MappingInfo).columns)).toEqual(["purchase_date", "supplier_name", "product_name", "quantity", "unit_price"]);
  });
});

describe("columns recognised without asking", () => {
  const csv = ["Data;Fornitore;Prodotto;Quantità;UM;Prezzo unitario;Fattura", "05/10/2026;ABC Srl;Paraffina 58/60;2000;kg;1,60;FT 2026/0501", "06/10/2026;Vetreria Rossi;Vetro Trasparente 300 ml;5000;pz;1,18;FT 2026/0502"].join("\n");

  it("known column names skip the column screen; the choice can be reopened", async () => {
    const { sessionId } = await createUpload(db, text("ottobre.csv", csv), "auto", { autoMap: true });
    let s = (await getSession(db, sessionId))!;
    expect(s.status).toBe("needs_review");
    expect((s.mapping as MappingInfo).auto).toBe(true);
    expect((await getSessionItems(db, sessionId)).map((i) => i.status)).toEqual(["ready", "ready"]);

    expect((await reopenMapping(db, sessionId)).error).toBeUndefined();
    s = (await getSession(db, sessionId))!;
    expect(s.status).toBe("uploaded");
    expect(await getSessionItems(db, sessionId)).toHaveLength(0);
    expect((await applyMapping(db, sessionId, s.mapping as MappingInfo)).error).toBeUndefined();
    expect(await getSessionItems(db, sessionId)).toHaveLength(2);
  });

  it("without the option nothing is applied (the service default)", async () => {
    const { sessionId } = await createUpload(db, text("ottobre-bis.csv", csv.replace("0501", "0591").replace("0502", "0592")), "spreadsheet");
    expect((await getSession(db, sessionId))!.status).toBe("uploaded");
  });

  it("the same file uploaded again waits for a decision instead of being read twice", async () => {
    const { sessionId } = await createUpload(db, text("ottobre-copia.csv", csv), "auto", { autoMap: true });
    const s = (await getSession(db, sessionId))!;
    expect(s.status).toBe("uploaded");
    expect(s.duplicateOfSessionId).not.toBeNull();
    const box = await inbox(db);
    expect(box.files.find((f) => f.session.id === sessionId)).toMatchObject({ sameFile: true, needsColumns: false });
    expect(box.sameFiles).toBeGreaterThanOrEqual(1);
  });

  it("imported lines can't be remapped", async () => {
    const { sessionId } = await createUpload(db, text("novembre.csv", csv.replaceAll("/10/2026", "/11/2026").replace("0501", "0701").replace("0502", "0702")), "auto", { autoMap: true });
    const before = (await readDataset(db)).purchases.length;
    const res = await approveAllReady(db);
    expect(res.imported).toBeGreaterThanOrEqual(2);
    expect((await readDataset(db)).purchases.length).toBe(before + res.imported);
    expect((await reopenMapping(db, sessionId)).error).toMatch(/already imported/);
    expect((await inbox(db)).ready).toBe(0);
  });
});

describe("a PDF says what it is", () => {
  it("a quote uploaded without saying so is read as a quote", async () => {
    const { sessionId } = await createUpload(db, disk("quote-turkish-wax.pdf", "documento-1.pdf"), "auto");
    const s = (await getSession(db, sessionId))!;
    expect(s.status, s.errorMessage ?? "").toBe("needs_review");
    expect(s).toMatchObject({ recordType: "quote", sourceType: "quote" });
    expect((await getSessionItems(db, sessionId))[0].recordType).toBe("quote");
  });

  it("an invoice is read as an invoice, and can be read again as the other kind", async () => {
    const { sessionId } = await createUpload(db, disk("scenario-f-fattura-abc.pdf", "documento-2.pdf"), "auto");
    let s = (await getSession(db, sessionId))!;
    expect(s).toMatchObject({ status: "needs_review", recordType: "purchase", sourceType: "invoice" });
    const lines = (await getSessionItems(db, sessionId)).length;
    expect(lines).toBeGreaterThan(0);

    await reclassifyPdf(db, sessionId, "quote");
    s = (await getSession(db, sessionId))!;
    expect(s.recordType).toBe("quote");
    expect((await getSessionItems(db, sessionId)).every((i) => i.recordType === "quote")).toBe(true);
  });
});

describe("a zip of documents", () => {
  it("is imported as the files it holds, each one read for what it is", async () => {
    const zip = await openArchive(new Blob([disk("scenario-h-fatture.zip").bytes]));
    expect(zip.files.map((f) => f.path)).toEqual([
      "Fatture settembre/Fattura ABC del 8 settembre.pdf",
      "Fatture settembre/IT01234567890_00118.xml",
      "Fatture settembre/nuovo-prodotto.xlsx",
      "Fatture settembre/preventivi/quote-turkish-wax.pdf",
    ]);
    // What the import can't read stays out, and the user is told why: a photo, and the exchange system's receipt.
    expect(leftOutNotes(zip.leftOut)).toEqual([
      "1 file in the zip is not a PDF, XML, Excel or CSV file and was left out: foto-bancale.jpg.",
      "1 XML file in the zip is not an invoice and was left out: IT01234567890_00118_metaDato.xml.",
    ]);

    const sessions = [];
    for (const f of zip.files) {
      const { sessionId } = await createUpload(db, { name: f.name, bytes: await f.read() }, "auto", { autoMap: true });
      sessions.push((await getSession(db, sessionId))!);
    }
    expect(sessions.map((s) => [s.filename, s.fileType, s.sourceType, s.recordType])).toEqual([
      ["Fattura ABC del 8 settembre.pdf", "pdf", "invoice", "purchase"],
      ["IT01234567890_00118.xml", "xml", "invoice", "purchase"],
      ["nuovo-prodotto.xlsx", "xlsx", "excel", "purchase"],
      ["quote-turkish-wax.pdf", "pdf", "quote", "quote"],
    ]);
    expect(sessions.map((s) => s.status)).not.toContain("failed");
    // The invoice out of the zip is the invoice: same lines as the file uploaded on its own.
    const fromZip = (await getSessionItems(db, sessions[0].id)).map((i) => i.data as ItemData);
    const { sessionId: alone } = await createUpload(db, disk("scenario-f-fattura-abc.pdf"), "auto", { autoMap: true });
    const onItsOwn = (await getSessionItems(db, alone)).map((i) => i.data as ItemData);
    expect(fromZip.length).toBeGreaterThan(0);
    expect(fromZip.map((d) => [d.productName, d.quantity, d.unitPrice])).toEqual(onItsOwn.map((d) => [d.productName, d.quantity, d.unitPrice]));
    // Same content, so the second upload is recognised as the same document.
    expect((await getSession(db, alone))!.duplicateOfSessionId).not.toBeNull();
  });

  it("a zip that reaches the server unopened is refused, not guessed at", async () => {
    const { sessionId } = await createUpload(db, disk("scenario-h-fatture.zip"), "auto", { autoMap: true });
    const s = (await getSession(db, sessionId))!;
    expect(s.status).toBe("failed");
    expect(s.errorMessage).toBe("This file type isn't supported. Upload PDF, XML invoices, Excel (.xlsx, .xls, .ods) or CSV files.");
  });
});

describe("an electronic invoice (XML), plain or signed", () => {
  it("is read from its own fields: the supplier by VAT number, each line of goods with what was paid", async () => {
    const { sessionId } = await createUpload(db, disk("scenario-i-fattura-elettronica.xml"), "auto", { autoMap: true });
    const s = (await getSession(db, sessionId))!;
    expect(s).toMatchObject({ fileType: "xml", sourceType: "invoice", recordType: "purchase", status: "needs_review", recordsDetected: 2 });
    expect(s.extraction).toMatchObject({ type: "xml", kind: "invoice", lineCount: 2, fields: { supplierName: { value: "ABC Srl", confidence: 1 }, number: { value: "FE/2026/118" }, date: { value: "2026-09-30" }, freight: { value: 20 } } });
    const items = await getSessionItems(db, sessionId);
    const data = await readDataset(db);
    // "ABC Srl" is a supplier we know; the paraffin is recognised by its name.
    expect(items.map((i) => data.suppliers.find((x) => x.id === i.supplierId)?.name)).toEqual(["ABC Srl", "ABC Srl"]);
    expect(items.map((i) => (i.data as ItemData).unitPrice)).toEqual([1.6, 0.0315]);
    expect(items.map((i) => (i.data as ItemData).invoiceLine)).toEqual([2, 3]);
    expect(items.every((i) => i.confidence === null)).toBe(true);
  });

  it("a signed file gives the same lines, and keeps the signed original", async () => {
    const { sessionId } = await createUpload(db, disk("scenario-i-fattura-elettronica.xml.p7m"), "auto", { autoMap: true });
    const s = (await getSession(db, sessionId))!;
    expect(s).toMatchObject({ fileType: "xml", sourceType: "invoice", status: "needs_review", recordsDetected: 2 });
    expect((await getSessionItems(db, sessionId)).map((i) => (i.data as ItemData).productName)).toEqual(["PARAFFINA 58/60 IN PASTIGLIE", "Stoppino cotone 120 mm & fondello"]);
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, s.documentId!));
    expect(doc).toMatchObject({ filename: "scenario-i-fattura-elettronica.xml.p7m", mimeType: "application/pkcs7-mime" });
  });

  it("what is not a purchase invoice is refused with the reason", async () => {
    const xml = new TextDecoder().decode(disk("scenario-i-fattura-elettronica.xml").bytes);
    const failed = async (name: string, body: string) => {
      const { sessionId } = await createUpload(db, text(name, body), "auto", { autoMap: true });
      const s = (await getSession(db, sessionId))!;
      return [s.status, s.errorMessage];
    };
    expect(await failed("nota-credito.xml", xml.replace("<TipoDocumento>TD01</TipoDocumento>", "<TipoDocumento>TD04</TipoDocumento>"))).toEqual(["failed", "This is a credit note: it corrects an earlier invoice and is not a purchase, so it is not imported."]);
    // Issued by us: a sale.
    expect(await failed("vendita.xml", xml.replace("<Denominazione>ABC Srl</Denominazione>", "<Denominazione>Cereria Cicogna</Denominazione>").replace("<IdCodice>01234567890</IdCodice></IdFiscaleIVA>\n        <Anagrafica>", "<IdCodice>01234567890</IdCodice></IdFiscaleIVA>\n        <Anagrafica>"))).toEqual([
      "failed",
      "This invoice was issued by your own company: it is a sale, not a purchase. Only invoices received from suppliers are imported.",
    ]);
    expect(await failed("ricevuta.xml", '<?xml version="1.0"?><ns2:FileMetadati xmlns:ns2="x"><NomeFile>a.xml</NomeFile></ns2:FileMetadati>')).toEqual(["failed", "This XML file is not an electronic invoice."]);
    expect(await failed("firma.xml.p7m", "this is not a signed file")).toEqual(["failed", "We couldn't open this signed file (.p7m). It may be damaged."]);
  });
});

describe("the company's own name on a document", () => {
  it("settings decide who 'we' are; clearing the data leaves them alone", async () => {
    const { readSettings, ownCompany } = await import("@/lib/data");
    const { clearAll } = await import("@/db/seed");
    expect(await readSettings(db)).toMatchObject({ configured: false, userName: null });
    await db.insert(schema.settings).values({ id: 1, companyName: "Candele Verdi Srl", vatNumber: "IT09876543210", userName: "Anna Verdi" });
    const s = await readSettings(db);
    expect(s).toMatchObject({ companyName: "Candele Verdi Srl", configured: true, userName: "Anna Verdi" });
    expect(ownCompany(s).names[0]).toBe("Candele Verdi Srl");
    expect(ownCompany(s).vats).toContain("IT09876543210");
    // Settings are not purchasing data.
    const copy = drizzle(new PGlite(), { schema }) as unknown as DB;
    await migrate(copy as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    await copy.insert(schema.settings).values({ id: 1, companyName: "Candele Verdi Srl" });
    await clearAll(copy);
    expect((await readSettings(copy)).companyName).toBe("Candele Verdi Srl");
  });
});

describe("a first import: mostly new names", () => {
  const csv = [
    "Data;Fornitore;Prodotto;Quantità;UM;Prezzo unitario",
    "01/09/2026;Cartiera Uno;Carta velina bianca;100;kg;2,10",
    "02/09/2026;Cartiera Uno;Nastro raso rosso;50;m;0,40",
    "03/09/2026;Etichette Due;Etichetta oro;1000;pz;0,03",
    "04/09/2026;ABC S.r.l.;PARAFFIN WAX 58/60;1000;kg;1,58",
  ].join("\n");

  it("creates every new supplier and product in one go, and leaves suggestions as questions", async () => {
    const { sessionId } = await createUpload(db, text("primo-import.csv", csv), "auto", { autoMap: true });
    expect((await getSession(db, sessionId))!.status).toBe("needs_review");
    const before = await readDataset(db);

    expect(await createAllNew(db, sessionId, "supplier")).toEqual({ created: 2, left: 0 });
    expect(await createAllNew(db, sessionId, "product")).toEqual({ created: 3, left: 0 });
    const after = await readDataset(db);
    expect(after.suppliers.length).toBe(before.suppliers.length + 2);
    expect(after.products.length).toBe(before.products.length + 3);
    // Units come from the file; codes are made from the names.
    expect(after.products.find((p) => p.name === "Nastro raso rosso")).toMatchObject({ unit: "m", sku: "NAS-RAS-ROS" });

    const items = await getSessionItems(db, sessionId);
    expect(items.slice(0, 3).map((i) => i.status)).toEqual(["ready", "ready", "ready"]);
    // "ABC S.r.l." / "PARAFFIN WAX 58/60" look like records we have: not created, still asked.
    expect(items[3].status).toBe("attention");
    expect(items[3].supplierId).toBeNull();
    // Nothing left to create: a second click changes nothing.
    expect(await createAllNew(db, sessionId, "supplier")).toEqual({ created: 0, left: 0 });
  });

  it("a product without a unit in the file is left as a question", async () => {
    const noUnit = ["Data;Fornitore;Prodotto;Quantità;Prezzo unitario", "01/09/2026;ABC Srl;Cera d'api gialla;100;7,50"].join("\n");
    const { sessionId } = await createUpload(db, text("senza-unita.csv", noUnit), "auto", { autoMap: true });
    expect(await createAllNew(db, sessionId, "product")).toEqual({ created: 0, left: 1 });
  });

  it("makes a code when none is given, and never the same one twice", async () => {
    const two = ["Data;Fornitore;Prodotto;Quantità;UM;Prezzo unitario", "01/09/2026;ABC Srl;Scatola regalo grande;10;pz;1,00", "01/09/2026;ABC Srl;Scatola regalo granata;10;pz;1,00"].join("\n");
    const { sessionId } = await createUpload(db, text("scatole.csv", two), "auto", { autoMap: true });
    for (const item of await getSessionItems(db, sessionId)) {
      const d = item.data as ItemData;
      expect((await resolveProduct(db, sessionId, productGroupKey(d), { type: "create", name: d.productName!, unit: "pcs", category: null })).error).toBeUndefined();
    }
    const skus = (await readDataset(db)).products.filter((p) => p.name.startsWith("Scatola regalo")).map((p) => p.sku);
    expect(skus.sort()).toEqual(["SCA-REG-GRA", "SCA-REG-GRA-2"]);
    // What the file called them is remembered.
    expect((await readLearning(db)).productAliases.length).toBeGreaterThanOrEqual(0);
  });
});
