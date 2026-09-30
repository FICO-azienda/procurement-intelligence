/**
 * Read layer: loads rows from the database and hands plain, typed data to
 * src/lib/analytics.ts. An SME has thousands of purchases, not millions, so
 * loading the dataset per request keeps the code simple. When that stops being
 * true, push the aggregations into SQL behind these same functions.
 */
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db";
import { products, purchases, quotes, suppliers } from "@/db/schema";
import type { Dataset } from "./analytics";

const num = (v: string) => Number(v);
const numOrNull = (v: string | null) => (v == null ? null : Number(v));

export const getDataset = cache(async (): Promise<Dataset> => {
  await connection(); // always read fresh data at request time
  const db = await getDb();
  const [s, p, pu, q] = await Promise.all([
    db.select().from(suppliers).orderBy(suppliers.name),
    db.select().from(products).orderBy(products.name),
    db.select().from(purchases).orderBy(purchases.date, purchases.createdAt),
    db.select().from(quotes).orderBy(quotes.date, quotes.createdAt),
  ]);

  return {
    suppliers: s.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      city: r.city,
      contactName: r.contactName,
      email: r.email,
      phone: r.phone,
      website: r.website,
      currency: r.currency,
      paymentTermsDays: r.paymentTermsDays,
      defaultLeadTimeDays: r.defaultLeadTimeDays,
      notes: r.notes,
    })),
    products: p.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      description: r.description,
      category: r.category,
      unit: r.unit,
      technicalSpecifications: r.technicalSpecifications,
      currentSupplierId: r.currentSupplierId,
    })),
    purchases: pu.map((r) => ({
      id: r.id,
      productId: r.productId,
      supplierId: r.supplierId,
      date: r.date,
      quantity: num(r.quantity),
      unit: r.unit,
      unitPrice: num(r.unitPrice),
      currency: r.currency,
      fxRate: num(r.fxRate),
      freightCost: num(r.freightCost),
      otherCosts: num(r.otherCosts),
      totalAmount: num(r.totalAmount),
      invoiceReference: r.invoiceReference,
      source: r.source,
      notes: r.notes,
    })),
    quotes: q.map((r) => ({
      id: r.id,
      productId: r.productId,
      supplierId: r.supplierId,
      date: r.date,
      quantity: numOrNull(r.quantity),
      unitPrice: num(r.unitPrice),
      currency: r.currency,
      fxRate: num(r.fxRate),
      moq: numOrNull(r.moq),
      leadTimeDays: r.leadTimeDays,
      paymentTermsDays: r.paymentTermsDays,
      incoterm: r.incoterm,
      validUntil: r.validUntil,
      source: r.source,
      notes: r.notes,
    })),
  };
});
