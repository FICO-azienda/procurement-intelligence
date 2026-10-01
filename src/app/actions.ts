"use server";

/**
 * All writes go through here. Each action validates input with the shared
 * schemas, writes, then revalidates so every page recomputes its numbers.
 *
 * Future: AI/email/document ingestion will produce *proposed* changes that a
 * user approves; the approved change then calls these same write functions.
 */
import { and, count, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clearAll, seedDemo } from "@/db/seed";
import {
  OPPORTUNITY_STATUSES,
  opportunities,
  products,
  purchases,
  quotes,
  supplierProducts,
  suppliers,
  type OpportunityStatus,
} from "@/db/schema";
import { computeTotal, todayISO } from "@/lib/analytics";
import { readDataset, readLearning, readOpportunityStates } from "@/lib/data";
import { analyze } from "@/lib/intel/engine";
import {
  fieldErrors,
  parseSpecs,
  productInput,
  purchaseInput,
  quoteInput,
  supplierInput,
  type FieldErrors,
} from "@/lib/validation";

export type FormState = {
  ok: boolean;
  /** Changes on every successful submit so the client can react once. */
  at?: number;
  error?: string;
  fieldErrors?: FieldErrors;
};

const done = (): FormState => ({ ok: true, at: Date.now() });
const invalid = (errors: FieldErrors): FormState => ({
  ok: false,
  error: "Please check the highlighted fields.",
  fieldErrors: errors,
});

function refresh() {
  revalidatePath("/", "layout");
}

function formObject(formData: FormData) {
  return Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string"));
}

function editingId(formData: FormData) {
  const id = formData.get("id");
  return typeof id === "string" && id !== "" ? id : null;
}

const str = (n: number | null) => (n == null ? null : String(n));

// ---------------- Suppliers ----------------

export async function saveSupplier(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = supplierInput.safeParse(formObject(formData));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const db = await getDb();
  const id = editingId(formData);
  const values = { ...parsed.data, updatedAt: new Date() };

  if (id) {
    await db.update(suppliers).set(values).where(eq(suppliers.id, id));
    refresh();
    return done();
  }
  const [row] = await db.insert(suppliers).values(values).returning({ id: suppliers.id });
  refresh();
  redirect(`/suppliers/${row.id}`);
}

export async function deleteSupplier(id: string) {
  const db = await getDb();
  await db.delete(suppliers).where(eq(suppliers.id, id)); // cascades purchases & quotes
  refresh();
  redirect("/suppliers");
}

// ---------------- Products ----------------

export async function saveProduct(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = productInput.safeParse(formObject(formData));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const db = await getDb();
  const id = editingId(formData);

  const clash = await db
    .select({ n: count() })
    .from(products)
    .where(id ? and(eq(products.sku, parsed.data.sku), ne(products.id, id)) : eq(products.sku, parsed.data.sku));
  if (clash[0].n > 0) return invalid({ sku: "Another product already uses this SKU" });

  const values = { ...parsed.data, updatedAt: new Date() };
  if (id) {
    await db.update(products).set(values).where(eq(products.id, id));
    refresh();
    return done();
  }
  const [row] = await db.insert(products).values(values).returning({ id: products.id });
  refresh();
  redirect(`/products/${row.id}`);
}

export async function deleteProduct(id: string) {
  const db = await getDb();
  await db.delete(products).where(eq(products.id, id)); // cascades purchases & quotes
  refresh();
  redirect("/products");
}

// ---------------- Purchases ----------------

export async function savePurchase(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = purchaseInput.safeParse(formObject(formData));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const d = parsed.data;
  const db = await getDb();

  const [product] = await db.select().from(products).where(eq(products.id, d.productId));
  if (!product) return invalid({ productId: "Product not found" });

  const quantity = d.quantity!;
  const unitPrice = d.unitPrice!;
  const freight = d.freightCost ?? 0;
  const other = d.otherCosts ?? 0;
  const values = {
    productId: d.productId,
    supplierId: d.supplierId,
    date: d.date!,
    quantity: String(quantity),
    unit: product.unit,
    unitPrice: String(unitPrice),
    currency: d.currency,
    fxRate: String(d.currency === "EUR" ? 1 : (d.fxRate ?? 1)),
    freightCost: String(freight),
    otherCosts: String(other),
    totalAmount: String(computeTotal(quantity, unitPrice, freight, other)),
    invoiceReference: d.invoiceReference,
    notes: d.notes,
    updatedAt: new Date(),
  };

  const id = editingId(formData);
  if (id) {
    await db.update(purchases).set(values).where(eq(purchases.id, id));
  } else {
    await db.insert(purchases).values({ ...values, source: "manual" });
  }
  // First purchase of a product defines its current supplier.
  if (!product.currentSupplierId) {
    await db.update(products).set({ currentSupplierId: d.supplierId }).where(eq(products.id, product.id));
  }
  refresh();
  return done();
}

export async function deletePurchase(id: string) {
  const db = await getDb();
  await db.delete(purchases).where(eq(purchases.id, id));
  refresh();
}

// ---------------- Quotes ----------------

export async function saveQuote(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = quoteInput.safeParse(formObject(formData));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));
  const d = parsed.data;
  const db = await getDb();
  const values = {
    productId: d.productId,
    supplierId: d.supplierId,
    date: d.date!,
    quantity: str(d.quantity),
    unitPrice: String(d.unitPrice!),
    currency: d.currency,
    fxRate: String(d.currency === "EUR" ? 1 : (d.fxRate ?? 1)),
    moq: str(d.moq),
    leadTimeDays: d.leadTimeDays,
    paymentTermsDays: d.paymentTermsDays,
    incoterm: d.incoterm,
    validUntil: d.validUntil,
    notes: d.notes,
    updatedAt: new Date(),
  };
  const id = editingId(formData);
  if (id) {
    await db.update(quotes).set(values).where(eq(quotes.id, id));
  } else {
    await db.insert(quotes).values({ ...values, source: "manual" });
  }
  refresh();
  return done();
}

export async function deleteQuote(id: string) {
  const db = await getDb();
  await db.delete(quotes).where(eq(quotes.id, id));
  refresh();
}

// ---------------- Data management ----------------

export async function clearAllData() {
  const db = await getDb();
  await clearAll(db);
  refresh();
}

export async function loadDemoData() {
  const db = await getDb();
  await clearAll(db);
  await seedDemo(db);
  refresh();
}

// ---------------- Price intelligence: user decisions ----------------

export type SimpleResult = { ok: boolean; error?: string };

/**
 * Status of an opportunity. The figures stay computed by the engine; here we
 * store the decision and a snapshot of the numbers at that moment.
 */
export async function setOpportunityStatus(key: string, status: OpportunityStatus, note?: string | null): Promise<SimpleResult> {
  if (!OPPORTUNITY_STATUSES.includes(status)) return { ok: false, error: "Unknown status." };
  try {
    const db = await getDb();
    const [data, learning, states] = await Promise.all([readDataset(db), readLearning(db), readOpportunityStates(db)]);
    const intel = analyze(data, learning.supplierProducts, states, todayISO());
    const o = intel.opportunities.find((x) => x.key === key);
    const [existing] = await db.select().from(opportunities).where(eq(opportunities.key, key));
    if (!o && !existing) return { ok: false, error: "This opportunity is no longer detected." };
    const snapshot = o
      ? {
          type: o.type,
          productId: o.productId,
          productName: data.products.find((p) => p.id === o.productId)?.name ?? null,
          currentSupplierId: o.currentSupplierId,
          alternativeSupplierId: o.alternativeSupplierId,
          alternativeName: data.suppliers.find((s) => s.id === o.alternativeSupplierId)?.name ?? null,
          currentPrice: o.currentPrice,
          comparePrice: o.comparePrice,
          annualQuantity: o.annualQuantity,
          impact: o.impact,
          impactBasis: o.impactBasis,
          potentialSaving: o.potentialSaving,
          confidence: o.confidence,
          reason: o.reason,
          at: new Date().toISOString(),
        }
      : existing.snapshot;
    await db
      .insert(opportunities)
      .values({
        key,
        type: o?.type ?? existing.type,
        productId: o?.productId ?? existing.productId,
        alternativeSupplierId: o?.alternativeSupplierId ?? existing.alternativeSupplierId,
        status,
        note: note === undefined ? (existing?.note ?? null) : note,
        snapshot,
      })
      .onConflictDoUpdate({
        target: opportunities.key,
        set: { status, snapshot, updatedAt: new Date(), ...(note === undefined ? {} : { note }) },
      });
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("[opportunity status]", err);
    return { ok: false, error: "Could not save the status. Please try again." };
  }
}

/** The user's view of one supplier's offer for a product: comparability and specifications. */
export async function saveOffer(
  supplierId: string,
  productId: string,
  input: { comparability: "auto" | "comparable" | "partial" | "not"; note: string; specs: string },
): Promise<SimpleResult> {
  try {
    const db = await getDb();
    const values = {
      comparabilityOverride: input.comparability === "auto" ? null : input.comparability,
      comparabilityNote: input.note.trim() || null,
      specs: parseSpecs(input.specs),
      updatedAt: new Date(),
    };
    await db
      .insert(supplierProducts)
      .values({ supplierId, productId, ...values })
      .onConflictDoUpdate({ target: [supplierProducts.supplierId, supplierProducts.productId], set: values });
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("[offer]", err);
    return { ok: false, error: "Could not save. Please try again." };
  }
}

/** Decision on a price flagged as a possible anomaly (null = undecided again). */
export async function reviewPrice(purchaseId: string, decision: "confirmed" | "excluded" | null): Promise<SimpleResult> {
  try {
    const db = await getDb();
    await db.update(purchases).set({ priceReview: decision, updatedAt: new Date() }).where(eq(purchases.id, purchaseId));
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("[price review]", err);
    return { ok: false, error: "Could not save. Please try again." };
  }
}
