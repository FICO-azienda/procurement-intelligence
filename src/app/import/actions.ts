"use server";

import { eq, isNull, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { products, purchases, suppliers } from "@/db/schema";
import { getDataset } from "@/lib/data";
import { planPurchaseImport, type PreviewRow } from "@/lib/import/purchases-csv";

const MAX_PREVIEW_ROWS = 300;

export type ImportPreview = {
  fatal?: string;
  total: number;
  valid: number;
  invalid: number;
  newSuppliers: string[];
  newProducts: { sku: string; name: string; unit: string }[];
  rows: PreviewRow[];
  truncated: boolean;
};

export async function previewPurchaseImport(csv: string): Promise<ImportPreview> {
  const plan = planPurchaseImport(csv, await getDataset());
  // Show problem rows first so they can't be missed.
  const ordered = [...plan.rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || a.line - b.line);
  return {
    fatal: plan.fatal,
    total: plan.rows.length,
    valid: plan.validRows.length,
    invalid: plan.rows.length - plan.validRows.length,
    newSuppliers: plan.newSuppliers,
    newProducts: plan.newProducts,
    rows: ordered.slice(0, MAX_PREVIEW_ROWS),
    truncated: ordered.length > MAX_PREVIEW_ROWS,
  };
}

export async function commitPurchaseImport(csv: string): Promise<{ imported: number; skipped: number; error?: string }> {
  const data = await getDataset();
  const plan = planPurchaseImport(csv, data);
  if (plan.fatal) return { imported: 0, skipped: 0, error: plan.fatal };
  if (plan.validRows.length === 0) return { imported: 0, skipped: plan.rows.length, error: "No valid rows to import." };

  const db = await getDb();
  await db.transaction(async (tx) => {
    const supplierIds = new Map(data.suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
    for (const name of plan.newSuppliers) {
      const country = plan.validRows.find((r) => r.supplier.toLowerCase() === name.toLowerCase() && r.country)?.country ?? null;
      const [row] = await tx.insert(suppliers).values({ name, country }).returning({ id: suppliers.id });
      supplierIds.set(name.toLowerCase(), row.id);
    }

    // Latest supplier per SKU becomes the current supplier for new products.
    const latestSupplierBySku = new Map<string, { date: string; supplierId: string }>();
    for (const r of plan.validRows) {
      const sid = supplierIds.get(r.supplier.toLowerCase())!;
      const prev = latestSupplierBySku.get(r.sku);
      if (!prev || r.date! >= prev.date) latestSupplierBySku.set(r.sku, { date: r.date!, supplierId: sid });
    }

    const productIds = new Map(data.products.map((p) => [p.sku.toUpperCase(), p.id]));
    for (const p of plan.newProducts) {
      const category = plan.validRows.find((r) => r.sku === p.sku && r.category)?.category ?? null;
      const [row] = await tx
        .insert(products)
        .values({ ...p, category, currentSupplierId: latestSupplierBySku.get(p.sku)?.supplierId ?? null })
        .returning({ id: products.id });
      productIds.set(p.sku, row.id);
    }

    await tx.insert(purchases).values(
      plan.validRows.map((r) => ({
        productId: productIds.get(r.sku)!,
        supplierId: supplierIds.get(r.supplier.toLowerCase())!,
        date: r.date!,
        quantity: String(r.quantity),
        unit: r.unit,
        unitPrice: String(r.unitPrice),
        currency: r.currency,
        fxRate: String(r.fxRate),
        freightCost: String(r.freight),
        otherCosts: String(r.other),
        totalAmount: String(r.total),
        invoiceReference: r.invoice,
        notes: r.notes,
        source: "csv" as const,
      })),
    );

    // Existing products without a current supplier get one from the import.
    for (const [sku, { supplierId }] of latestSupplierBySku) {
      const pid = productIds.get(sku);
      if (pid) {
        await tx
          .update(products)
          .set({ currentSupplierId: supplierId })
          .where(and(eq(products.id, pid), isNull(products.currentSupplierId)));
      }
    }
  });

  revalidatePath("/", "layout");
  return { imported: plan.validRows.length, skipped: plan.rows.length - plan.validRows.length };
}
