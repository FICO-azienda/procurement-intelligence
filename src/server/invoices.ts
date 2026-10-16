/**
 * Invoices as the buyer reads them: each with its lines (the purchases), its
 * total worked out from them, and the original document when one is on file.
 * Nothing here changes a purchase; attaching the original stores a copy of the
 * file and points the invoice to it, logged.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { documents, invoices, products, purchases, suppliers } from "@/db/schema";
import { en, type T } from "@/lib/i18n";
import type { Actor } from "@/lib/replies/types";
import { getStorage, storageKey } from "@/lib/storage";
import { logEvents } from "./audit";

export class InvoiceError extends Error {}

export interface InvoiceRow {
  id: string;
  number: string;
  date: string | null;
  supplier: { id: string; name: string };
  lines: number;
  /** In euro, from the lines' own totals and exchange rates; lines in another currency with no rate are counted apart. */
  total: number;
  unpriced: number;
  document: { id: string; filename: string } | null;
}

const eur = (total: string, currency: string, fx: string | null) => (currency === "EUR" ? Number(total) : fx == null ? null : Number(total) * Number(fx));

export async function readInvoices(db: DB, q: { supplierId?: string | null; text?: string | null; page: number; size: number }): Promise<{ rows: InvoiceRow[]; count: number }> {
  const where = and(q.supplierId ? eq(invoices.supplierId, q.supplierId) : undefined, q.text ? or(ilike(invoices.number, `%${q.text}%`), ilike(suppliers.name, `%${q.text}%`)) : undefined);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(invoices).innerJoin(suppliers, eq(invoices.supplierId, suppliers.id)).where(where);
  const head = await db
    .select({ id: invoices.id, number: invoices.number, date: invoices.date, supplierId: suppliers.id, supplierName: suppliers.name, documentId: documents.id, filename: documents.filename })
    .from(invoices)
    .innerJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(documents, eq(invoices.documentId, documents.id))
    .where(where)
    .orderBy(desc(invoices.date), invoices.number)
    .limit(q.size)
    .offset((q.page - 1) * q.size);
  const lines = head.length ? await db.select({ invoiceId: purchases.invoiceId, total: purchases.totalAmount, currency: purchases.currency, fx: purchases.fxRate }).from(purchases).where(inArray(purchases.invoiceId, head.map((h) => h.id))) : [];
  return {
    count: n,
    rows: head.map((h) => {
      const mine = lines.filter((l) => l.invoiceId === h.id);
      const values = mine.map((l) => eur(l.total, l.currency, l.fx));
      return {
        id: h.id,
        number: h.number,
        date: h.date ? String(h.date) : null,
        supplier: { id: h.supplierId, name: h.supplierName },
        lines: mine.length,
        total: values.reduce<number>((s, v) => s + (v ?? 0), 0),
        unpriced: values.filter((v) => v == null).length,
        document: h.documentId ? { id: h.documentId, filename: h.filename! } : null,
      };
    }),
  };
}

export interface InvoiceDetail extends InvoiceRow {
  items: { id: string; line: number | null; productId: string; product: string; description: string | null; quantity: number; unit: string; unitPrice: number; currency: string; total: number }[];
}

export async function readInvoice(db: DB, id: string): Promise<InvoiceDetail | null> {
  const [h] = await db
    .select({ id: invoices.id, number: invoices.number, date: invoices.date, supplierId: suppliers.id, supplierName: suppliers.name, documentId: documents.id, filename: documents.filename })
    .from(invoices)
    .innerJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(documents, eq(invoices.documentId, documents.id))
    .where(eq(invoices.id, id));
  if (!h) return null;
  const rows = await db.select({ p: purchases, name: products.name }).from(purchases).innerJoin(products, eq(purchases.productId, products.id)).where(eq(purchases.invoiceId, id)).orderBy(purchases.invoiceLine, purchases.date);
  const values = rows.map((r) => eur(r.p.totalAmount, r.p.currency, r.p.fxRate));
  return {
    id: h.id,
    number: h.number,
    date: h.date ? String(h.date) : null,
    supplier: { id: h.supplierId, name: h.supplierName },
    lines: rows.length,
    total: values.reduce<number>((s, v) => s + (v ?? 0), 0),
    unpriced: values.filter((v) => v == null).length,
    document: h.documentId ? { id: h.documentId, filename: h.filename! } : null,
    items: rows.map((r) => ({ id: r.p.id, line: r.p.invoiceLine, productId: r.p.productId, product: r.name, description: r.p.originalDescription, quantity: Number(r.p.quantity), unit: r.p.unit, unitPrice: Number(r.p.unitPrice), currency: r.p.currency, total: Number(r.p.totalAmount) })),
  };
}

/** The original of an invoice, attached by a person: a copy is stored (the same file once), and the invoice points to it. */
export async function attachInvoiceDocument(db: DB, invoiceId: string, file: { name: string; bytes: Uint8Array; mimeType: string | null }, actor: Actor, t: T = en): Promise<void> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new InvoiceError(t("This invoice is no longer on file."));
  if (!file.bytes.length) throw new InvoiceError(t("The file is empty."));
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  let [doc] = await db.select().from(documents).where(eq(documents.sha256, sha256));
  if (!doc) {
    const key = storageKey(file.name, sha256);
    await getStorage().put(key, file.bytes, file.mimeType ?? "application/octet-stream");
    [doc] = await db.insert(documents).values({ filename: file.name, mimeType: file.mimeType, sizeBytes: file.bytes.length, sha256, storagePath: key }).returning();
  }
  await db.transaction(async (tx) => {
    await tx.update(invoices).set({ documentId: doc.id, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
    await logEvents(tx as unknown as DB, actor, [{ action: "attach", entity: "invoice", entityId: invoiceId, field: "document", oldValue: inv.documentId, newValue: doc.id, note: file.name, source: "ui" }]);
  });
}
