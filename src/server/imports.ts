/**
 * Import service: every database operation of the import pipeline.
 *
 *   upload → (spreadsheet: column mapping) → items → match → evaluate
 *   → user review (confirm / choose / create / edit / skip) → approve → facts
 *
 * Functions take a `db` handle so they run the same in the app and in tests.
 * Server actions (app/import/actions.ts) are thin wrappers around these.
 */
import { keepApart } from "@/lib/import/match/apart";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  documents,
  importItems,
  importSessions,
  productAliases,
  products,
  purchases,
  quotes,
  supplierAliases,
  supplierProducts,
  suppliers,
  type ImportItemRecord,
  type ImportSession,
  type Source,
} from "@/db/schema";
import { computeTotal, productMetrics, todayISO, type Dataset } from "@/lib/analytics";
import { isStrategic } from "@/lib/catalog/kinds";
import { en, type Msg, type T } from "@/lib/i18n";
import { ownCompany, readDataset, readLearning, readSettings, type Learning } from "@/lib/data";
import { documentToItems, extractDocument, type DocKind, type DocumentExtraction } from "@/lib/import/extract/document";
import { eInvoiceToItems, issuedByUs, readEInvoice } from "@/lib/import/extract/einvoice";
import { unwrapSigned } from "@/lib/import/extract/p7m";
import { readPdfLines } from "@/lib/import/extract/pdf";
import { buildRowItems } from "@/lib/import/extract/rows";
import { ImportError, readTable, SPREADSHEET_TYPES, cellText, type Table } from "@/lib/import/extract/tabular";
import { evaluateItems, inProductUnit, type ItemState } from "@/lib/import/evaluate";
import { inferByContent, isConfidentMapping, missingRequired, proposeMapping, type ColumnMapping } from "@/lib/import/fields";
import { MAX_FILE_BYTES } from "@/lib/import/files";
import { productGroupKey, supplierGroupKey } from "@/lib/import/groups";
import { matchProduct, matchSupplier, type MatchContext, type MatchResult } from "@/lib/import/match";
import { readSupplierRows } from "./suppliers";
import { companyKey, productKey, tidy } from "@/lib/import/normalize/text";
import { normalizeUnit } from "@/lib/import/normalize/units";
import type { CurrentData, DraftItem, ExtractedData, Issue, ItemData, RecordType } from "@/lib/import/types";
import { uniqueSku } from "@/lib/sku";
import { getStorage, storageKey } from "@/lib/storage";

/** "auto": the file says what it is (spreadsheet, or a PDF that reads as an invoice or a quote). */
export type UploadKind = "auto" | "spreadsheet" | "invoice" | "quote";

export interface MappingInfo {
  columns: ColumnMapping;
  recordType: RecordType;
  defaultCurrency: string | null;
  /** The columns were recognised and applied without asking (can be reopened). */
  auto?: boolean;
}

export interface UploadOptions {
  /** Skip the column screen when every needed column has a known name. */
  autoMap?: boolean;
}

export interface SpreadsheetExtraction {
  type: "spreadsheet";
  sheetName: string | null;
  headers: string[];
  sample: string[][];
  rowCount: number;
  skippedRows?: number;
  /** The file had no header row: columns were guessed from their values. */
  headerless?: boolean;
}

export interface PdfSessionExtraction {
  /** "xml": an electronic invoice, read from its own fields (every value is certain). */
  type: "pdf" | "xml";
  kind: DocKind;
  detectedKind: DocKind | null;
  fields: Record<string, { value: string | number | null; confidence: number }>;
  lineCount: number;
}

export interface PriceChangeSummary {
  productId: string;
  productName: string;
  unit: string;
  previousPrice: number;
  newPrice: number;
  pct: number;
  annualQuantity: number;
  annualImpact: number;
}

export interface ImportSummary {
  detected: number;
  imported: number;
  needReview: number;
  duplicatesSkipped: number;
  skipped: number;
  newSuppliers: number;
  newProducts: number;
  priceChanges: PriceChangeSummary[];
  /** Sum of annual impact of price increases (EUR/year). */
  increaseImpact: number;
}

export { MAX_FILE_BYTES };

/**
 * Errors are messages: written in English here (and stored so), shown in the
 * reader's language by whoever displays them (`t.any`).
 */
const error = (msg: Msg): { error: string } => ({ error: msg });
const SOMETHING_WRONG: Msg = "Something went wrong while reading this file. It has been saved; try again or contact support.";

const MIME: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  pdf: "application/pdf",
  xml: "application/xml",
  p7m: "application/pkcs7-mime",
};

function fileTypeOf(name: string, bytes: Uint8Array): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return "pdf";
  if (ext === "xml" || ext === "p7m") return ext;
  if (ext === "txt" || ext === "tsv") return "csv";
  if ((SPREADSHEET_TYPES as readonly string[]).includes(ext)) return ext;
  return null;
}

// ======================= Upload =======================

/**
 * Stores the file and starts a session. Never throws for bad files: it
 * records a failed session with a plain-language reason instead.
 */
export async function createUpload(
  db: DB,
  file: { name: string; bytes: Uint8Array },
  requested: UploadKind,
  options: UploadOptions = {},
): Promise<{ sessionId: string }> {
  let fileType = fileTypeOf(file.name, file.bytes);
  // A signed file (.p7m) is an envelope: what is inside decides how it is read. The envelope is what gets stored.
  const signed = fileType === "p7m";
  let payload = file.bytes;
  let signedError: Msg | null = null;
  if (signed) {
    try {
      payload = unwrapSigned(file.bytes);
      const start = payload.findIndex((x, i) => i > 2 || !(x === 0xef || x === 0xbb || x === 0xbf || x === 0x20 || x === 0x0a || x === 0x0d));
      if (payload[0] === 0x25 && payload[1] === 0x50 && payload[2] === 0x44 && payload[3] === 0x46) fileType = "pdf";
      else if (payload[Math.max(start, 0)] === 0x3c) fileType = "xml";
      else signedError = "This signed file holds neither an XML invoice nor a PDF.";
    } catch (err) {
      signedError = err instanceof ImportError ? (err.message as Msg) : SOMETHING_WRONG;
    }
  }
  const eInvoice = fileType === "xml";
  // "auto": spreadsheets are spreadsheets; a PDF is read as what it says it is (decided while reading it).
  const autoPdf = requested === "auto" && fileType === "pdf";
  const kind: Exclude<UploadKind, "auto"> = eInvoice
    ? "invoice"
    : requested !== "auto" ? requested : fileType === "pdf" ? (/(offerta|preventivo|quot|listino|price)/i.test(file.name) ? "quote" : "invoice") : "spreadsheet";
  const sourceType: Source = eInvoice ? "invoice" : fileType === "pdf" ? (kind === "quote" ? "quote" : "invoice") : fileType === "csv" ? "csv" : "excel";
  const recordType: RecordType = kind === "quote" ? "quote" : "purchase";

  const fail = async (message: Msg, documentId: string | null = null) => {
    const [s] = await db
      .insert(importSessions)
      .values({ filename: file.name, fileType: fileType ?? "unknown", sourceType, recordType, status: "failed", errorMessage: message, documentId })
      .returning({ id: importSessions.id });
    return { sessionId: s.id };
  };

  if (!fileType) return fail("This file type isn't supported. Upload PDF, XML invoices, Excel (.xlsx, .xls, .ods) or CSV files.");
  if (file.bytes.length === 0) return fail("The file is empty.");
  if (file.bytes.length > MAX_FILE_BYTES) return fail("This file is larger than 20 MB. Split it into smaller files and upload them separately.");
  if (signedError) return fail(signedError);
  if (kind !== "spreadsheet" && fileType !== "pdf" && !eInvoice) return fail("Invoices and quotes must be PDF files.");
  if (kind === "spreadsheet" && fileType === "pdf") return fail("This is a PDF, not a spreadsheet.");

  // Store the original once (same content = same document).
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  let [doc] = await db.select().from(documents).where(eq(documents.sha256, sha256));
  if (!doc) {
    const key = storageKey(file.name, sha256);
    try {
      await getStorage().put(key, file.bytes, MIME[signed ? "p7m" : fileType] ?? "application/octet-stream");
    } catch {
      return fail("We couldn't save the file. Please try again.");
    }
    [doc] = await db
      .insert(documents)
      .values({ filename: file.name, mimeType: MIME[signed ? "p7m" : fileType], sizeBytes: file.bytes.length, sha256, storagePath: key })
      .returning();
  }

  // Same file imported before?
  const [previous] = await db
    .select({ id: importSessions.id })
    .from(importSessions)
    .where(and(eq(importSessions.documentId, doc.id), inArray(importSessions.status, ["completed", "needs_review"])))
    .limit(1);

  const [session] = await db
    .insert(importSessions)
    .values({
      documentId: doc.id,
      filename: file.name,
      fileType,
      sourceType,
      recordType,
      status: "processing",
      duplicateOfSessionId: previous?.id ?? null,
    })
    .returning();

  try {
    if (fileType === "pdf") {
      await processPdf(db, session, payload, kind === "quote" ? "quote" : "invoice", autoPdf);
    } else if (eInvoice) {
      await processEInvoice(db, session, payload);
    } else {
      const table = readTable(file.bytes, fileType);
      let columns = proposeMapping(table.headers, table.rows.slice(0, 20));
      // Columns the headers don't explain (or no headers at all): look at the values.
      if (table.headerless || missingRequired(columns, "purchase").length) {
        const known = await db.select({ name: suppliers.name }).from(suppliers);
        const knownProducts = await db.select({ name: products.name }).from(products);
        columns = inferByContent(table.headers, table.rows, columns, { suppliers: known.map((x) => x.name), products: knownProducts.map((x) => x.name) });
      }
      const mapping: MappingInfo = { columns, recordType: guessRecordType(table), defaultCurrency: "EUR" };
      const extraction: SpreadsheetExtraction = {
        type: "spreadsheet",
        sheetName: table.sheetName,
        headers: table.headers,
        sample: table.rows.slice(0, 6).map((r) => r.map(cellText)),
        rowCount: table.rows.length,
        headerless: table.headerless,
      };
      await db.update(importSessions).set({ status: "uploaded", extraction, mapping, updatedAt: new Date() }).where(eq(importSessions.id, session.id));
      // Known column names: nothing to ask. Guessed from values: the user checks first.
      if (options.autoMap && !table.headerless && !previous && isConfidentMapping(columns, mapping.recordType)) {
        await applyMapping(db, session.id, { ...mapping, auto: true });
      }
    }
  } catch (err) {
    const message = err instanceof ImportError ? err.message : SOMETHING_WRONG;
    if (!(err instanceof ImportError)) console.error("[import] processing failed", err);
    await db.update(importSessions).set({ status: "failed", errorMessage: message, updatedAt: new Date() }).where(eq(importSessions.id, session.id));
  }
  return { sessionId: session.id };
}

function guessRecordType(table: Table): RecordType {
  const m = proposeMapping(table.headers);
  const fields = new Set(Object.values(m));
  return (fields.has("valid_until") || fields.has("moq")) && !fields.has("invoice_reference") ? "quote" : "purchase";
}

async function loadFile(db: DB, session: ImportSession): Promise<Uint8Array> {
  if (!session.documentId) throw new ImportError("The original file is no longer available.");
  const [doc] = await db.select().from(documents).where(eq(documents.id, session.documentId));
  const bytes = doc ? await getStorage().get(doc.storagePath) : null;
  if (!bytes) throw new ImportError("The original file is no longer available. Upload it again.");
  // A signed file is stored as it arrived: what is read is the document inside it.
  return /\.p7m$/i.test(doc.filename) ? unwrapSigned(bytes) : bytes;
}

// ======================= Spreadsheet mapping =======================

export async function applyMapping(db: DB, sessionId: string, mapping: MappingInfo, t: T = en): Promise<{ error?: string }> {
  const session = await getSession(db, sessionId);
  if (!session || session.status !== "uploaded") return error("This import has already been processed.");
  const missing = missingRequired(mapping.columns, mapping.recordType);
  if (missing.length) return { error: t("Map a column for: {fields}.", { fields: missing.map((m) => t(m)).join(", ") }) };

  try {
    const table = readTable(await loadFile(db, session), session.fileType);
    const { items, skippedRows } = buildRowItems(table, mapping.columns, {
      recordType: mapping.recordType,
      defaultCurrency: mapping.defaultCurrency,
    });
    if (items.length === 0) return error("No rows with products or prices were found with this mapping.");
    await db
      .update(importSessions)
      .set({
        mapping,
        recordType: mapping.recordType,
        extraction: { ...(session.extraction as SpreadsheetExtraction), skippedRows },
        status: "processing",
        updatedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId));
    await insertItems(db, sessionId, mapping.recordType, items);
  } catch (err) {
    if (err instanceof ImportError) return { error: err.message };
    console.error("[import] mapping failed", err);
    return error("Something went wrong while reading the rows. Please try again.");
  }
  return {};
}

// ======================= PDF =======================

async function processPdf(db: DB, session: ImportSession, bytes: Uint8Array, requested: DocKind, auto = false) {
  const { lines } = await readPdfLines(bytes);
  let kind = requested;
  const own = ownCompany(await readSettings(db));
  let doc = extractDocument(lines, kind, own);
  // Uploaded without saying what it is: believe the document's own title.
  if (auto && doc.detectedKind && doc.detectedKind !== kind) {
    kind = doc.detectedKind;
    doc = extractDocument(lines, kind, own);
  }
  if (kind !== requested) {
    await db
      .update(importSessions)
      .set({ sourceType: kind === "quote" ? "quote" : "invoice", recordType: kind === "quote" ? "quote" : "purchase" })
      .where(eq(importSessions.id, session.id));
  }
  if (doc.lines.length === 0) {
    throw new ImportError(
      kind === "quote"
        ? "We couldn't find product lines with prices in this quote. You can add the quote manually from the product page."
        : "We couldn't find product lines (quantity × price) in this invoice. You can add the purchases manually.",
    );
  }
  const extraction: PdfSessionExtraction = {
    type: "pdf",
    kind,
    detectedKind: doc.detectedKind,
    fields: Object.fromEntries(
      (["supplierName", "supplierVat", "number", "date", "validUntil", "currency", "paymentTermsDays", "incoterm", "leadTimeDays", "moq", "freight", "total"] as const).map((k) => [
        k,
        { value: doc[k].value, confidence: doc[k].confidence },
      ]),
    ),
    lineCount: doc.lines.length,
  };
  await db.update(importSessions).set({ extraction, updatedAt: new Date() }).where(eq(importSessions.id, session.id));
  await insertItems(db, session.id, kind === "quote" ? "quote" : "purchase", documentToItems(doc), doc);
}

// ======================= Electronic invoice (XML) =======================

async function processEInvoice(db: DB, session: ImportSession, bytes: Uint8Array) {
  const file = readEInvoice(bytes);
  if (issuedByUs(file, ownCompany(await readSettings(db)))) {
    throw new ImportError("This invoice was issued by your own company: it is a sale, not a purchase. Only invoices received from suppliers are imported.");
  }
  const { items, freight, read } = eInvoiceToItems(file);
  if (items.length === 0) throw new ImportError("We couldn't find product lines (quantity × price) in this invoice. You can add the purchases manually.");
  // Every value comes from its own field in the file: nothing here is a guess.
  const known = (value: string | number | null) => ({ value, confidence: value == null ? 0 : 1 });
  const extraction: PdfSessionExtraction = {
    type: "xml",
    kind: "invoice",
    detectedKind: "invoice",
    fields: {
      supplierName: known(file.supplier.name),
      supplierVat: known(file.supplier.vat ?? file.supplier.taxCode),
      number: known(read[0].number),
      date: known(read[0].date),
      currency: known(read[0].currency),
      paymentTermsDays: known(read[0].paymentTermsDays),
      freight: known(freight > 0 ? freight : null),
      total: known(read[0].total),
    },
    lineCount: items.length,
  };
  await db.update(importSessions).set({ extraction, updatedAt: new Date() }).where(eq(importSessions.id, session.id));
  await insertItems(db, session.id, "purchase", items);
}

// ======================= Items: match + evaluate =======================

async function matchContext(db: DB, data?: Dataset, learning?: Learning): Promise<{ ctx: MatchContext; data: Dataset }> {
  const d = data ?? (await readDataset(db));
  const l = learning ?? (await readLearning(db));
  const { rows, canon } = await readSupplierRows(db);
  return {
    data: d,
    ctx: {
      // Every record, merged ones too: a name or a VAT number written on a merged record leads to the company it is read as.
      suppliers: rows.map((s) => ({ id: canon.get(s.id) ?? s.id, name: s.name, vatNumber: s.vatNumber, taxCode: s.taxCode })),
      products: d.products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, description: p.description, kind: p.kind })),
      supplierAliases: l.supplierAliases,
      productAliases: l.productAliases,
      supplierProducts: l.supplierProducts,
    },
  };
}

/** Known supplier names written anywhere in a document (letterhead, footer…). */
function supplierInText(text: string, ctx: MatchContext): MatchResult | null {
  const hay = ` ${companyKey(text).replace(/\n/g, " ")} `;
  const hits = ctx.suppliers.filter((s) => {
    const k = companyKey(s.name);
    return k.length >= 4 && hay.includes(` ${k} `);
  });
  return hits.length === 1 ? { status: "probable", id: hits[0].id, confidence: 0.85, reason: "Name found in the document", alternatives: [] } : null;
}

function matchItem(row: ItemState, ctx: MatchContext, docText?: string) {
  const d = row.data;
  let { supplierId, supplierMatch, supplierResolution, productId, productMatch, productResolution } = row;
  if (!supplierResolution || supplierResolution === "auto") {
    let m = matchSupplier({ name: d.supplierName, vat: d.supplierVat, taxCode: d.supplierTaxCode }, ctx);
    if (m.status !== "exact" && docText) m = supplierInText(docText, ctx) ?? m;
    supplierMatch = m;
    supplierId = m.status === "exact" ? m.id : null;
    supplierResolution = m.status === "exact" ? "auto" : null;
  }
  if (!productResolution || productResolution === "auto") {
    const m = matchProduct({ sku: d.sku, supplierSku: d.supplierSku, name: d.productName, description: d.description }, supplierId, ctx);
    productMatch = m;
    productId = m.status === "exact" ? m.id : null;
    productResolution = m.status === "exact" ? "auto" : null;
  }
  return { supplierId, supplierMatch, supplierResolution, productId, productMatch, productResolution };
}

async function insertItems(db: DB, sessionId: string, recordType: RecordType, drafts: DraftItem[], doc?: DocumentExtraction) {
  const { ctx } = await matchContext(db);
  const matched = drafts.map((draft, index) => {
    const data: CurrentData = { ...stripIssues(draft.extracted), corrected: [] };
    const state: ItemState = {
      id: "",
      line: draft.line,
      recordType,
      extracted: draft.extracted,
      data,
      confidence: draft.confidence,
      supplierId: null,
      supplierMatch: null,
      supplierResolution: null,
      productId: null,
      productMatch: null,
      productResolution: null,
      acknowledged: false,
      duplicateDecision: null,
    };
    return { ...state, ...matchItem(state, ctx, doc?.fullText), raw: draft.raw, index };
  });
  // Two lines of one supplier on one day at two prices are two products: never matched to the same one unseen.
  const rows = keepApart(matched);
  if (rows.length) {
    await db.insert(importItems).values(
      rows.map((r) => ({
        sessionId,
        line: r.line,
        recordType,
        raw: r.raw,
        extracted: r.extracted,
        data: r.data,
        confidence: r.confidence,
        supplierId: r.supplierId,
        supplierMatch: r.supplierMatch,
        supplierResolution: r.supplierResolution,
        productId: r.productId,
        productMatch: r.productMatch,
        productResolution: r.productResolution,
        status: "attention" as const,
      })),
    );
  }
  await refreshSession(db, sessionId);
}

function stripIssues(e: ExtractedData): ItemData {
  const { parseIssues: _ignored, ...rest } = e;
  void _ignored;
  return rest;
}

function toState(r: ImportItemRecord): ItemState {
  return {
    id: r.id,
    line: r.line,
    recordType: r.recordType as RecordType,
    extracted: r.extracted as ExtractedData,
    data: r.data as CurrentData,
    confidence: r.confidence,
    supplierId: r.supplierId,
    supplierMatch: r.supplierMatch as MatchResult | null,
    supplierResolution: r.supplierResolution,
    productId: r.productId,
    productMatch: r.productMatch as MatchResult | null,
    productResolution: r.productResolution,
    acknowledged: r.acknowledged,
    duplicateDecision: r.duplicateDecision,
  };
}

/**
 * Re-matches unresolved items and re-evaluates every open item of a session,
 * then updates the session counts and status.
 */
export async function refreshSession(db: DB, sessionId: string, opts: { rematch?: boolean } = {}) {
  const { ctx, data } = await matchContext(db);
  const all = await db.select().from(importItems).where(eq(importItems.sessionId, sessionId));
  const open = all.filter((r) => r.status === "ready" || r.status === "attention");
  let states = open.map(toState);
  if (opts.rematch) states = keepApart(states.map((s) => ({ ...s, ...matchItem(s, ctx) })));
  const results = evaluateItems(states, { data });

  const before = new Map(open.map((r) => [r.id, r]));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const s of states) {
    const r = results.get(s.id)!;
    const was = before.get(s.id)!;
    // A large file is re-evaluated after every answer: only the lines that changed are written.
    if (
      was.status === r.status &&
      was.supplierId === s.supplierId &&
      was.productId === s.productId &&
      was.supplierResolution === s.supplierResolution &&
      was.productResolution === s.productResolution &&
      same(was.issues, r.issues) &&
      same(was.supplierMatch, s.supplierMatch) &&
      same(was.productMatch, s.productMatch)
    ) {
      continue;
    }
    await db
      .update(importItems)
      .set({
        issues: r.issues,
        status: r.status,
        supplierId: s.supplierId,
        supplierMatch: s.supplierMatch,
        supplierResolution: s.supplierResolution,
        productId: s.productId,
        productMatch: s.productMatch,
        productResolution: s.productResolution,
        updatedAt: new Date(),
      })
      .where(eq(importItems.id, s.id));
  }
  await updateCounts(db, sessionId);
}

async function updateCounts(db: DB, sessionId: string) {
  const counts = await db
    .select({ status: importItems.status, n: sql<number>`count(*)::int` })
    .from(importItems)
    .where(eq(importItems.sessionId, sessionId))
    .groupBy(importItems.status);
  const c = Object.fromEntries(counts.map((x) => [x.status, x.n])) as Record<string, number>;
  const detected = counts.reduce((s, x) => s + x.n, 0);
  const open = (c.ready ?? 0) + (c.attention ?? 0);
  const session = await getSession(db, sessionId);
  if (!session) return;
  await db
    .update(importSessions)
    .set({
      recordsDetected: detected,
      recordsImported: c.imported ?? 0,
      recordsReview: c.attention ?? 0,
      recordsRejected: c.skipped ?? 0,
      status: session.status === "failed" ? "failed" : open > 0 ? "needs_review" : "completed",
      updatedAt: new Date(),
    })
    .where(eq(importSessions.id, sessionId));
}

/** After learning something (alias, new product), other open imports may now match. */
export async function rematchOpenSessions(db: DB, exceptSessionId?: string) {
  const open = await db
    .select({ id: importSessions.id })
    .from(importSessions)
    .where(exceptSessionId ? and(eq(importSessions.status, "needs_review"), ne(importSessions.id, exceptSessionId)) : eq(importSessions.status, "needs_review"));
  for (const s of open) await refreshSession(db, s.id, { rematch: true });
}

// ======================= Grouping =======================

export { productGroupKey, supplierGroupKey };

async function openItems(db: DB, sessionId: string) {
  return (await db.select().from(importItems).where(eq(importItems.sessionId, sessionId))).filter(
    (r) => r.status === "ready" || r.status === "attention",
  );
}

// ======================= Resolutions (user decisions) =======================

export type SupplierDecision =
  | { type: "use"; supplierId: string }
  | { type: "create"; name: string; country: string | null; vatNumber: string | null };

export async function resolveSupplier(db: DB, sessionId: string, groupKey: string, decision: SupplierDecision, opts: { defer?: boolean } = {}) {
  const items = (await openItems(db, sessionId)).filter((i) => supplierGroupKey(i.data as ItemData) === groupKey);
  if (!items.length) return;
  const sample = items[0].data as ItemData;

  let supplierId: string;
  let resolution: string;
  if (decision.type === "create") {
    const [s] = await db
      .insert(suppliers)
      .values({ name: tidy(decision.name), country: decision.country, vatNumber: decision.vatNumber, taxCode: sample.supplierTaxCode && sample.supplierTaxCode !== decision.vatNumber ? sample.supplierTaxCode : null })
      .returning({ id: suppliers.id });
    supplierId = s.id;
    resolution = "created";
    await db.update(importSessions).set({ newSuppliers: sql`${importSessions.newSuppliers} + 1` }).where(eq(importSessions.id, sessionId));
  } else {
    supplierId = decision.supplierId;
    const suggested = (items[0].supplierMatch as MatchResult | null)?.id;
    resolution = suggested === supplierId ? "confirmed" : "chosen";
    // Learn: the name as written in this document now means this supplier.
    const [target] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
    if (!target) return;
    const names = [...new Set(items.map((i) => tidy((i.data as ItemData).supplierName)).filter(Boolean))];
    for (const alias of names) {
      if (alias.toLowerCase() === target.name.toLowerCase()) continue;
      await db
        .insert(supplierAliases)
        .values({ supplierId, alias, normalized: companyKey(alias) })
        .onConflictDoUpdate({ target: supplierAliases.normalized, set: { supplierId, alias } });
    }
    if (!target.vatNumber && sample.supplierVat) {
      await db.update(suppliers).set({ vatNumber: sample.supplierVat, updatedAt: new Date() }).where(eq(suppliers.id, supplierId));
    }
  }

  await db
    .update(importItems)
    .set({ supplierId, supplierResolution: resolution, updatedAt: new Date() })
    .where(inArray(importItems.id, items.map((i) => i.id)));
  if (opts.defer) return;
  // Supplier codes can now be recognised for these lines.
  await refreshSession(db, sessionId, { rematch: true });
  await rematchOpenSessions(db, sessionId);
}

export type ProductDecision =
  | { type: "use"; productId: string }
  | { type: "create"; name: string; sku?: string | null; unit: string; category: string | null };

export async function resolveProduct(db: DB, sessionId: string, groupKey: string, decision: ProductDecision, opts: { defer?: boolean } = {}): Promise<{ error?: string }> {
  const items = (await openItems(db, sessionId)).filter((i) => productGroupKey(i.data as ItemData) === groupKey);
  if (!items.length) return {};

  let productId: string;
  let resolution: string;
  if (decision.type === "create") {
    const unit = normalizeUnit(decision.unit) ?? decision.unit.trim();
    if (!decision.name.trim() || !unit) return error("Name and unit are required.");
    const taken = (await db.select({ sku: products.sku }).from(products)).map((x) => x.sku);
    // No code of their own? One is made from the name.
    const sku = decision.sku?.trim().toUpperCase() || uniqueSku(decision.name, taken);
    if (taken.some((code) => code.toUpperCase() === sku)) return error("Another product already uses this code.");
    const [p] = await db
      .insert(products)
      .values({ name: tidy(decision.name), sku, unit, category: decision.category?.trim() || null, currentSupplierId: items[0].supplierId })
      .returning({ id: products.id });
    productId = p.id;
    resolution = "created";
    await db.update(importSessions).set({ newProducts: sql`${importSessions.newProducts} + 1` }).where(eq(importSessions.id, sessionId));
  } else {
    productId = decision.productId;
    const suggested = (items[0].productMatch as MatchResult | null)?.id;
    resolution = suggested === productId ? "confirmed" : "chosen";
  }

  await learnProduct(db, productId, items, { sessionId });
  await db
    .update(importItems)
    .set({ productId, productResolution: resolution, updatedAt: new Date() })
    .where(inArray(importItems.id, items.map((i) => i.id)));
  if (opts.defer) return {};
  await refreshSession(db, sessionId);
  await rematchOpenSessions(db, sessionId);
  return {};
}

/**
 * A first import is mostly new names. Instead of one question per supplier or
 * product, the user can create all the unknown ones at once, as the file
 * writes them. Products need a unit: those whose lines carry none are left as
 * questions. Names we only suspect to be known (suggestions) are never touched.
 */
export async function createAllNew(db: DB, sessionId: string, kind: "supplier" | "product"): Promise<{ created: number; left: number }> {
  const items = await openItems(db, sessionId);
  const seen = new Set<string>();
  let created = 0;
  let left = 0;
  for (const item of items) {
    const d = item.data as ItemData;
    if (kind === "supplier") {
      const key = supplierGroupKey(d);
      if (item.supplierId || (item.supplierMatch as MatchResult | null)?.status === "probable" || seen.has(key)) continue;
      seen.add(key);
      const name = tidy(d.supplierName);
      if (!name) {
        left++;
        continue;
      }
      await resolveSupplier(db, sessionId, key, { type: "create", name, country: d.supplierCountry ?? null, vatNumber: d.supplierVat ?? null }, { defer: true });
      created++;
    } else {
      const key = productGroupKey(d);
      if (item.productId || (item.productMatch as MatchResult | null)?.status === "probable" || seen.has(key)) continue;
      seen.add(key);
      const name = tidy(d.productName ?? d.description);
      const unit = normalizeUnit(d.unit);
      if (!name || !unit) {
        left++;
        continue;
      }
      const res = await resolveProduct(db, sessionId, key, { type: "create", name, sku: d.sku ?? null, unit, category: d.category ?? null }, { defer: true });
      if (res.error) left++;
      else created++;
    }
  }
  if (created > 0) {
    await refreshSession(db, sessionId, { rematch: true });
    await rematchOpenSessions(db, sessionId);
  }
  return { created, left };
}

/**
 * One description, as one supplier writes it, now means this product. The
 * same words from the same supplier never point to two products: the latest
 * decision replaces the earlier one.
 */
export async function saveAlias(
  db: DB,
  a: { productId: string; alias: string; supplierId: string | null; supplierSku?: string | null; ean?: string | null; confidence?: string | null; confirmedByUser?: boolean; sessionId?: string | null },
) {
  const normalized = productKey(a.alias);
  if (!normalized) return;
  await db.delete(productAliases).where(and(eq(productAliases.normalized, normalized), a.supplierId ? eq(productAliases.supplierId, a.supplierId) : sql`${productAliases.supplierId} is null`));
  await db.insert(productAliases).values({
    productId: a.productId,
    alias: a.alias,
    normalized,
    supplierId: a.supplierId,
    supplierSku: a.supplierSku ?? null,
    ean: a.ean ?? null,
    confidence: a.confidence ?? null,
    confirmedByUser: a.confirmedByUser ?? true,
    sourceSessionId: a.sessionId ?? null,
  });
}

/** Save how this product was written (alias) and the supplier's code for it. */
export async function learnProduct(db: DB, productId: string, items: ImportItemRecord[], opts: { sessionId?: string | null; confidence?: string | null } = {}) {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return;
  const saved = new Set<string>();
  const linked = new Set<string>();
  for (const i of items) {
    const d = i.data as ItemData;
    for (const text of [d.productName, d.description]) {
      const alias = tidy(text);
      const once = `${i.supplierId}|${productKey(alias)}`;
      if (!alias || saved.has(once)) continue;
      saved.add(once);
      await saveAlias(db, { productId, alias, supplierId: i.supplierId, supplierSku: d.supplierSku, ean: d.ean, confidence: opts.confidence, sessionId: opts.sessionId ?? i.sessionId });
    }
    if (i.supplierId && (d.supplierSku || d.productName || d.description) && !linked.has(`${i.supplierId}|${d.supplierSku ?? ""}`)) {
      linked.add(`${i.supplierId}|${d.supplierSku ?? ""}`);
      await db
        .insert(supplierProducts)
        .values({ supplierId: i.supplierId, productId, supplierSku: d.supplierSku, supplierProductName: tidy(d.productName ?? d.description) || null })
        .onConflictDoUpdate({
          target: [supplierProducts.supplierId, supplierProducts.productId],
          set: {
            supplierSku: sql`coalesce(excluded.supplier_sku, ${supplierProducts.supplierSku})`,
            supplierProductName: sql`coalesce(${supplierProducts.supplierProductName}, excluded.supplier_product_name)`,
            updatedAt: new Date(),
          },
        });
    }
  }
}

/** User corrections of values. Keeps extracted values untouched for audit. */
export async function updateItem(db: DB, itemId: string, patch: Partial<ItemData>) {
  const [item] = await db.select().from(importItems).where(eq(importItems.id, itemId));
  if (!item || (item.status !== "ready" && item.status !== "attention")) return;
  const data = item.data as CurrentData;
  const corrected = new Set(data.corrected ?? []);
  for (const k of Object.keys(patch) as (keyof ItemData)[]) corrected.add(k);
  const next: CurrentData = { ...data, ...patch, corrected: [...corrected] };
  if (next.currency === "EUR") next.fxRate = 1;
  if ("unit" in patch && patch.unit) next.unitRaw = null;
  const rematch = "supplierName" in patch || "productName" in patch || "sku" in patch || "supplierSku" in patch;
  await db
    .update(importItems)
    .set({
      data: next,
      ...(rematch ? { supplierResolution: item.supplierResolution === "auto" ? null : item.supplierResolution, productResolution: item.productResolution === "auto" ? null : item.productResolution } : {}),
      updatedAt: new Date(),
    })
    .where(eq(importItems.id, itemId));
  await refreshSession(db, item.sessionId, { rematch });
}

/** Document-level fields (PDF header) applied to every open line of the session. */
export async function updateSessionFields(db: DB, sessionId: string, patch: Partial<ItemData>) {
  for (const item of await openItems(db, sessionId)) {
    const data = item.data as CurrentData;
    const corrected = new Set(data.corrected ?? []);
    for (const k of Object.keys(patch) as (keyof ItemData)[]) corrected.add(k);
    const next: CurrentData = { ...data, ...patch, corrected: [...corrected] };
    if (next.currency === "EUR") next.fxRate = 1;
    await db
      .update(importItems)
      .set({ data: next, ...("supplierName" in patch || "supplierVat" in patch ? { supplierResolution: null, supplierId: null } : {}), updatedAt: new Date() })
      .where(eq(importItems.id, item.id));
  }
  await refreshSession(db, sessionId, { rematch: "supplierName" in patch || "supplierVat" in patch });
}

export async function acknowledge(db: DB, target: { itemId: string } | { sessionId: string }) {
  if ("itemId" in target) {
    const [item] = await db.select().from(importItems).where(eq(importItems.id, target.itemId));
    if (!item) return;
    await db.update(importItems).set({ acknowledged: true }).where(eq(importItems.id, target.itemId));
    await refreshSession(db, item.sessionId);
  } else {
    // Only lines whose remaining problems are review flags (nothing blocking).
    const items = (await openItems(db, target.sessionId)).filter((i) => !(i.issues as Issue[]).some((x) => x.severity === "blocking"));
    if (items.length) await db.update(importItems).set({ acknowledged: true }).where(inArray(importItems.id, items.map((i) => i.id)));
    await refreshSession(db, target.sessionId);
  }
}

export async function decideDuplicate(db: DB, target: { itemId: string } | { sessionId: string }, decision: "skip" | "import") {
  const items =
    "itemId" in target
      ? await db.select().from(importItems).where(eq(importItems.id, target.itemId))
      : (await openItems(db, target.sessionId)).filter((i) => (i.issues as Issue[]).some((x) => x.code === "duplicate" || x.code === "duplicate_in_file"));
  if (!items.length) return;
  await db
    .update(importItems)
    .set(decision === "skip" ? { duplicateDecision: "skip", status: "skipped" } : { duplicateDecision: "import", acknowledged: true })
    .where(inArray(importItems.id, items.map((i) => i.id)));
  await refreshSession(db, items[0].sessionId);
}

export async function setSkipped(db: DB, itemId: string, skipped: boolean) {
  const [item] = await db.select().from(importItems).where(eq(importItems.id, itemId));
  if (!item || item.status === "imported") return;
  // Bringing back a line the system had set aside (a credit note…) is saying "import it anyway".
  const setAside = (item.extracted as ExtractedData).parseIssues?.some((x) => x.excludes);
  await db
    .update(importItems)
    .set(skipped ? { status: "skipped", acknowledged: false } : { status: "attention", ...(setAside ? { acknowledged: true } : {}) })
    .where(eq(importItems.id, itemId));
  await refreshSession(db, item.sessionId);
}

const SKIPPED_SAME_FILE: Msg = "Skipped — this file had already been imported.";

/** The same file was imported before: stop here, or go on anyway. */
export async function decideDuplicateFile(db: DB, sessionId: string, decision: "skip" | "continue") {
  if (decision === "continue") {
    await db.update(importSessions).set({ duplicateOfSessionId: null }).where(eq(importSessions.id, sessionId));
    return;
  }
  await db.update(importItems).set({ status: "skipped", duplicateDecision: "skip" }).where(eq(importItems.sessionId, sessionId));
  await db
    .update(importSessions)
    .set({ status: "completed", completedAt: new Date(), errorMessage: SKIPPED_SAME_FILE })
    .where(eq(importSessions.id, sessionId));
  await updateCountsKeepStatus(db, sessionId);
}

async function updateCountsKeepStatus(db: DB, sessionId: string) {
  const all = await db.select({ status: importItems.status }).from(importItems).where(eq(importItems.sessionId, sessionId));
  await db
    .update(importSessions)
    .set({ recordsDetected: all.length, recordsRejected: all.filter((i) => i.status === "skipped").length, recordsReview: 0 })
    .where(eq(importSessions.id, sessionId));
}

// ======================= Approval =======================

/** Writes every ready line as a purchase/quote. Lines needing attention stay in review. */
export async function approveSession(db: DB, sessionId: string): Promise<{ imported: number; summary?: ImportSummary; error?: string }> {
  const session = await getSession(db, sessionId);
  if (!session) return { imported: 0, ...error("Import not found.") };
  const before = await readDataset(db);
  const ready = (await db.select().from(importItems).where(and(eq(importItems.sessionId, sessionId), eq(importItems.status, "ready"))));
  if (!ready.length) return { imported: 0, ...error("No lines are ready to import yet.") };

  const touched = new Set<string>();
  await db.transaction(async (tx) => {
    for (const item of ready) {
      const d = item.data as CurrentData;
      const product = before.products.find((p) => p.id === item.productId);
      if (!product || !item.supplierId || !d.date || d.unitPrice == null || !d.currency) continue;
      // A product is stored in its own unit; spend that is not a product keeps the invoice's.
      const spend = !isStrategic(product.kind);
      const v = spend ? { quantity: d.quantity, unitPrice: d.unitPrice, moq: d.moq } : inProductUnit(d, product.unit);
      if (!v || v.unitPrice == null) continue;
      const fxRate = d.currency === "EUR" ? "1" : d.fxRate != null ? String(d.fxRate) : null;
      const originalDescription = tidy(d.productName ?? d.description) || null;

      if (item.recordType === "quote") {
        await tx.insert(quotes).values({
          productId: product.id,
          supplierId: item.supplierId,
          date: d.date,
          quantity: v.quantity == null ? null : String(v.quantity),
          unitPrice: String(v.unitPrice),
          currency: d.currency,
          fxRate,
          moq: v.moq == null ? null : String(v.moq),
          leadTimeDays: d.leadTimeDays,
          paymentTermsDays: d.paymentTermsDays,
          incoterm: d.incoterm,
          freightCost: d.freight == null ? null : String(d.freight),
          validUntil: d.validUntil,
          originalDescription,
          source: session.sourceType,
          importItemId: item.id,
          notes: d.notes,
        });
      } else {
        if (v.quantity == null) continue;
        await tx.insert(purchases).values({
          productId: product.id,
          supplierId: item.supplierId,
          date: d.date,
          quantity: String(v.quantity),
          unit: spend ? (d.unit ?? product.unit) : product.unit,
          unitPrice: String(v.unitPrice),
          currency: d.currency,
          fxRate,
          freightCost: String(d.freight ?? 0),
          otherCosts: String(d.otherCosts ?? 0),
          totalAmount: String(computeTotal(v.quantity, v.unitPrice, d.freight ?? 0, d.otherCosts ?? 0)),
          invoiceReference: d.invoiceReference,
          invoiceLine: d.invoiceLine ?? null,
          paymentTermsDays: d.paymentTermsDays,
          incoterm: d.incoterm,
          originalDescription,
          source: session.sourceType,
          importItemId: item.id,
          notes: d.notes,
        });
      }
      // Supplier-specific terms for this product
      if (!spend && (d.supplierSku || d.moq != null || d.leadTimeDays != null)) {
        await tx
          .insert(supplierProducts)
          .values({
            supplierId: item.supplierId,
            productId: product.id,
            supplierSku: d.supplierSku,
            supplierProductName: originalDescription,
            moq: v.moq == null ? null : String(v.moq),
            leadTimeDays: d.leadTimeDays,
          })
          .onConflictDoUpdate({
            target: [supplierProducts.supplierId, supplierProducts.productId],
            set: {
              supplierSku: sql`coalesce(excluded.supplier_sku, ${supplierProducts.supplierSku})`,
              moq: sql`coalesce(excluded.moq, ${supplierProducts.moq})`,
              leadTimeDays: sql`coalesce(excluded.lead_time_days, ${supplierProducts.leadTimeDays})`,
              updatedAt: new Date(),
            },
          });
      }
      if (!product.currentSupplierId) {
        await tx.update(products).set({ currentSupplierId: item.supplierId }).where(eq(products.id, product.id));
        product.currentSupplierId = item.supplierId;
      }
      await tx.update(importItems).set({ status: "imported", updatedAt: new Date() }).where(eq(importItems.id, item.id));
      if (!spend) touched.add(product.id); // price changes are watched on products only
    }
  });

  await db.update(importSessions).set({ completedAt: new Date() }).where(eq(importSessions.id, sessionId));
  await updateCounts(db, sessionId);
  const after = await readDataset(db);
  const summary = await buildSummary(db, sessionId, before, after, touched);
  await db.update(importSessions).set({ summary }).where(eq(importSessions.id, sessionId));
  // Other imports' price checks now compare against the new history.
  await rematchOpenSessions(db, sessionId);
  return { imported: ready.length, summary };
}

async function buildSummary(db: DB, sessionId: string, before: Dataset, after: Dataset, touched: Set<string>): Promise<ImportSummary> {
  const session = (await getSession(db, sessionId))!;
  const items = await db.select().from(importItems).where(eq(importItems.sessionId, sessionId));
  const asOf = todayISO();
  const prev = (session.summary as ImportSummary | null)?.priceChanges ?? [];
  const changes = new Map(prev.map((c) => [c.productId, c]));
  for (const productId of touched) {
    const pBefore = before.products.find((p) => p.id === productId);
    const pAfter = after.products.find((p) => p.id === productId);
    if (!pBefore || !pAfter) continue;
    const mb = productMetrics(pBefore, before.purchases, asOf);
    const ma = productMetrics(pAfter, after.purchases, asOf);
    if (mb.currentPrice == null || ma.currentPrice == null || Math.abs(ma.currentPrice - mb.currentPrice) < 1e-9) continue;
    // Across several approvals of the same import, compare with the price before the first one.
    const base = changes.get(productId)?.previousPrice ?? mb.currentPrice;
    changes.set(productId, {
      productId,
      productName: pAfter.name,
      unit: pAfter.unit,
      previousPrice: base,
      newPrice: ma.currentPrice,
      pct: (ma.currentPrice / base - 1) * 100,
      // Consumption before this import, as shown on each line during review.
      annualQuantity: mb.annualQuantity || ma.annualQuantity,
      annualImpact: (mb.annualQuantity || ma.annualQuantity) * (ma.currentPrice - base),
    });
  }
  const priceChanges = [...changes.values()].sort((a, b) => b.pct - a.pct);
  return {
    detected: items.length,
    imported: items.filter((i) => i.status === "imported").length,
    needReview: items.filter((i) => i.status === "ready" || i.status === "attention").length,
    duplicatesSkipped: items.filter((i) => i.status === "skipped" && i.duplicateDecision === "skip").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    newSuppliers: session.newSuppliers,
    newProducts: session.newProducts,
    priceChanges,
    increaseImpact: priceChanges.filter((c) => c.pct > 0).reduce((s, c) => s + c.annualImpact, 0),
  };
}

// ======================= Starting over =======================

/**
 * Back to the column screen (spreadsheets) — only while nothing of the file
 * has been imported, so no saved purchase loses its source line.
 */
export async function reopenMapping(db: DB, sessionId: string): Promise<{ error?: string }> {
  const session = await getSession(db, sessionId);
  if (!session || session.fileType === "pdf" || session.fileType === "xml") return error("This import has no columns to change.");
  const items = await getSessionItems(db, sessionId);
  if (items.some((i) => i.status === "imported")) return error("Some lines of this file are already imported. Upload the file again to map it differently.");
  await db.delete(importItems).where(eq(importItems.sessionId, sessionId));
  await db
    .update(importSessions)
    .set({ status: "uploaded", mapping: { ...(session.mapping as MappingInfo), auto: false }, recordsDetected: 0, recordsReview: 0, recordsRejected: 0, updatedAt: new Date() })
    .where(eq(importSessions.id, sessionId));
  return {};
}

/** Read a PDF again as the other kind of document (invoice ↔ quote), while nothing is imported. */
export async function reclassifyPdf(db: DB, sessionId: string, kind: DocKind): Promise<{ error?: string }> {
  const session = await getSession(db, sessionId);
  if (!session || session.fileType !== "pdf") return error("Only PDF documents can be read as an invoice or a quote.");
  const items = await getSessionItems(db, sessionId);
  if (items.some((i) => i.status === "imported")) return error("Some lines of this document are already imported.");
  try {
    const bytes = await loadFile(db, session);
    await db.delete(importItems).where(eq(importItems.sessionId, sessionId));
    await db
      .update(importSessions)
      .set({ sourceType: kind === "quote" ? "quote" : "invoice", recordType: kind === "quote" ? "quote" : "purchase", status: "processing", errorMessage: null, updatedAt: new Date() })
      .where(eq(importSessions.id, sessionId));
    await processPdf(db, { ...session, recordType: kind === "quote" ? "quote" : "purchase" }, bytes, kind);
  } catch (err) {
    const message: string = err instanceof ImportError ? err.message : ("Something went wrong while reading this document again." satisfies Msg);
    if (!(err instanceof ImportError)) console.error("[import] reclassify failed", err);
    await db.update(importSessions).set({ status: "failed", errorMessage: message, updatedAt: new Date() }).where(eq(importSessions.id, sessionId));
    return { error: message };
  }
  return {};
}

/** Imports the ready lines of every open file at once. */
export async function approveAllReady(db: DB): Promise<{ imported: number; files: number }> {
  const open = await db.select({ id: importSessions.id }).from(importSessions).where(eq(importSessions.status, "needs_review"));
  let imported = 0;
  let files = 0;
  for (const s of open) {
    const res = await approveSession(db, s.id);
    if (res.imported > 0) {
      imported += res.imported;
      files++;
    }
  }
  return { imported, files };
}

// ======================= Reads =======================

export async function getSession(db: DB, id: string) {
  const [s] = await db.select().from(importSessions).where(eq(importSessions.id, id));
  return s ?? null;
}

export async function listSessions(db: DB, limit = 50) {
  return db.select().from(importSessions).orderBy(desc(importSessions.uploadedAt)).limit(limit);
}

/** Open lines that need the user, across all imports (for the Review queue and badge). */
export async function attentionItems(db: DB) {
  return db
    .select({ item: importItems, session: importSessions })
    .from(importItems)
    .innerJoin(importSessions, eq(importItems.sessionId, importSessions.id))
    .where(and(eq(importItems.status, "attention"), eq(importSessions.status, "needs_review")))
    .orderBy(desc(importSessions.uploadedAt), importItems.line);
}

export async function attentionCount(db: DB) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(importItems)
    .innerJoin(importSessions, eq(importItems.sessionId, importSessions.id))
    .where(and(eq(importItems.status, "attention"), eq(importSessions.status, "needs_review")));
  return r?.n ?? 0;
}

export interface Inbox {
  /** Files still open: waiting for columns, for review, or simply ready. */
  files: { session: ImportSession; lines: number; ready: number; review: number; duplicates: number; needsColumns: boolean; sameFile: boolean }[];
  lines: number;
  ready: number;
  review: number;
  duplicates: number;
  needColumns: number;
  /** Files identical to one uploaded before, not processed yet. */
  sameFiles: number;
}

const DUPLICATE_CODES = new Set(["duplicate", "duplicate_in_file"]);

/** What is waiting in Import, across files — the numbers the user acts on. */
export async function inbox(db: DB): Promise<Inbox> {
  const sessions = (await listSessions(db, 200)).filter((s) => s.status === "needs_review" || s.status === "uploaded");
  const ids = sessions.filter((s) => s.status === "needs_review").map((s) => s.id);
  const items = ids.length ? await db.select().from(importItems).where(inArray(importItems.sessionId, ids)) : [];
  const files = sessions.map((session) => {
    const open = items.filter((i) => i.sessionId === session.id && (i.status === "ready" || i.status === "attention"));
    const attention = open.filter((i) => i.status === "attention");
    const duplicates = attention.filter((i) => (i.issues as Issue[]).some((x) => DUPLICATE_CODES.has(x.code))).length;
    return {
      session,
      lines: open.length,
      ready: open.length - attention.length,
      review: attention.length - duplicates,
      duplicates,
      needsColumns: session.status === "uploaded" && !session.duplicateOfSessionId,
      sameFile: session.status === "uploaded" && !!session.duplicateOfSessionId,
    };
  });
  const sum = (k: "lines" | "ready" | "review" | "duplicates") => files.reduce((s, f) => s + f[k], 0);
  return {
    files,
    lines: sum("lines"),
    ready: sum("ready"),
    review: sum("review"),
    duplicates: sum("duplicates"),
    needColumns: files.filter((f) => f.needsColumns).length,
    sameFiles: files.filter((f) => f.sameFile).length,
  };
}

export async function getSessionItems(db: DB, sessionId: string) {
  return db.select().from(importItems).where(eq(importItems.sessionId, sessionId)).orderBy(importItems.line);
}

export { ImportError };
