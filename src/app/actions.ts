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
  settings,
  supplierProducts,
  suppliers,
  type OpportunityStatus,
} from "@/db/schema";
import { computeTotal, todayISO } from "@/lib/analytics";
import { isProductKind, type ProductKind } from "@/lib/catalog/kinds";
import { catalogueOf } from "@/lib/catalog/spend";
import { getT, readDataset, readLearning, readOpportunityStates } from "@/lib/data";
import { isLocale, type Msg, type T } from "@/lib/i18n";
import { matchProduct, matchSupplier, type MatchContext } from "@/lib/import/match";
import { analyze } from "@/lib/intel/engine";
import { parseQuickPurchase } from "@/lib/quick-add";
import { uniqueSku } from "@/lib/sku";
import { addBenchmark, addCandidate, addProductDocument, deleteBenchmark, deleteCandidate, getMarketViews, markRequestsSent, recordCandidateQuote, removeProductDocument, saveRfqSpec, saveTrueCostInputs, setBenchmarkMonth, setCandidatesStatus, setPilot, updateCandidate } from "@/server/sourcing";
import { parseNumber } from "@/lib/import/normalize/numbers";
import { connectedProviders } from "@/server/providers";
import { convertCandidate, importResearch, planResearch, runResearch, setCustomsCode, setResearchClass, type ImportOutcome, type PlanView, type ResearchOutcome } from "@/server/research";
import { parseResearchFile } from "@/lib/research/file";
import { isCandidateStatus, isTechnicalFit } from "@/lib/sourcing/types";
import { DataFieldError, confirmDataField, linkProductDocument, saveDataField, uploadProductFile } from "@/server/product-data";
import { isFieldKey } from "@/lib/dataset/fields";
import { isJudgementKey, isLevel } from "@/lib/negotiation/engine";
import { keepEstimateHistory, saveJudgement } from "@/server/negotiation";
import { SupplierMergeError, autoMergeSuppliers, canonicalSupplierId, keepSuppliersResolved, keepSuppliersSeparate, matchOf, mergeSuppliers, undoSupplierMerge } from "@/server/suppliers";
import { isVariantBy } from "@/lib/catalog/macro";
import { MapperError, confirmMappings, confirmVariants, keepSeparate, mergeProducts, saveMapping, undoProductMerge, type MappingEdit } from "@/server/mapper";
import {
  benchmarkInput,
  candidateInput,
  fieldErrors,
  parseSpecs,
  productInput,
  purchaseInput,
  quoteInput,
  candidateQuoteInput,
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
const invalid = (t: T, errors: FieldErrors): FormState => ({
  ok: false,
  error: t("Please check the highlighted fields."),
  fieldErrors: errors,
});

function refresh() {
  revalidatePath("/", "layout");
  // A write may have created a supplier that a VAT number proves to be one already on file (server/suppliers.ts)…
  keepSuppliersResolved();
  // …and may change what a price could be negotiated to: the history of the estimates follows (server/negotiation.ts).
  keepEstimateHistory();
}

/**
 * Database errors never reach the user as they are. Whatever went wrong, the
 * message says what did not happen and what to do next.
 */
const WHAT: Record<"supplier" | "product" | "purchase" | "quote", Msg> = { supplier: "supplier|this", product: "product|this", purchase: "purchase|this", quote: "quote|this" };

function failed(t: T, what: keyof typeof WHAT, err: unknown): FormState {
  console.error(`[save ${what}]`, err);
  const text = String((err as { cause?: { message?: string }; message?: string })?.cause?.message ?? (err as Error)?.message ?? "");
  if (/foreign key|violates/i.test(text)) {
    return { ok: false, error: t("We couldn't save this {~what}. The supplier or product you selected no longer exists — choose another one and try again.", { what: WHAT[what] }) };
  }
  return { ok: false, error: t("We couldn't save this {~what}. Nothing was changed — please try again.", { what: WHAT[what] }) };
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
  const t = await getT();
  const parsed = supplierInput.safeParse(formObject(formData));
  if (!parsed.success) return invalid(t, fieldErrors(parsed.error, t));
  const id = editingId(formData);
  // A new supplier needs a country: it tells a domestic offer from an import.
  if (!id && !parsed.data.country) return invalid(t, { country: t("{~label} is required", { label: "Country" }) });
  const values = { ...parsed.data, updatedAt: new Date() };

  let createdId: string | null = null;
  try {
    const db = await getDb();
    if (id) await db.update(suppliers).set(values).where(eq(suppliers.id, id));
    else createdId = (await db.insert(suppliers).values(values).returning({ id: suppliers.id }))[0].id;
    // The same VAT number as a supplier on file: it is that supplier, under another name.
    await autoMergeSuppliers(db);
    if (createdId) createdId = await canonicalSupplierId(db, createdId);
  } catch (err) {
    return failed(t, "supplier", err);
  }
  refresh();
  if (createdId) redirect(`/suppliers/${createdId}`);
  return done();
}

export async function deleteSupplier(id: string) {
  const db = await getDb();
  await db.delete(suppliers).where(eq(suppliers.id, id)); // cascades purchases & quotes
  refresh();
  redirect("/suppliers");
}

// ---------------- Products ----------------

export async function saveProduct(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const parsed = productInput.safeParse(formObject(formData));
  if (!parsed.success) return invalid(t, fieldErrors(parsed.error, t));
  const id = editingId(formData);

  let createdId: string | null = null;
  try {
    const db = await getDb();
    // No code typed: one is made from the name ("Paraffina 58/60" → PAR-58-60).
    const sku = parsed.data.sku || uniqueSku(parsed.data.name, (await db.select({ sku: products.sku }).from(products)).map((p) => p.sku));
    const clash = await db
      .select({ n: count() })
      .from(products)
      .where(id ? and(eq(products.sku, sku), ne(products.id, id)) : eq(products.sku, sku));
    if (clash[0].n > 0) return invalid(t, { sku: t("Another product already uses this code") });

    const values = { ...parsed.data, sku, updatedAt: new Date() };
    if (id) await db.update(products).set(values).where(eq(products.id, id));
    // Written by hand: its name and category are the user's own, there is nothing to confirm.
    else createdId = (await db.insert(products).values({ ...values, mappedAt: new Date() }).returning({ id: products.id }))[0].id;
  } catch (err) {
    return failed(t, "product", err);
  }
  refresh();
  if (createdId) redirect(`/products/${createdId}`);
  return done();
}

export async function deleteProduct(id: string) {
  const db = await getDb();
  await db.delete(products).where(eq(products.id, id)); // cascades purchases & quotes
  refresh();
  redirect("/products");
}

// ---------------- Purchases ----------------

export async function savePurchase(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const parsed = purchaseInput.safeParse(formObject(formData));
  if (!parsed.success) return invalid(t, fieldErrors(parsed.error, t));
  const d = parsed.data;
  try {
    const db = await getDb();

    const [product] = await db.select().from(products).where(eq(products.id, d.productId));
    if (!product) return invalid(t, { productId: t("This product no longer exists — choose another one") });

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
      // A foreign currency without a rate stays unconverted: never 1:1.
      fxRate: d.currency === "EUR" ? "1" : str(d.fxRate),
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
  } catch (err) {
    return failed(t, "purchase", err);
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
  const t = await getT();
  const parsed = quoteInput.safeParse(formObject(formData));
  if (!parsed.success) return invalid(t, fieldErrors(parsed.error, t));
  const d = parsed.data;
  try {
    const db = await getDb();
    const values = {
      productId: d.productId,
      supplierId: d.supplierId,
      date: d.date!,
      quantity: str(d.quantity),
      unitPrice: String(d.unitPrice!),
      currency: d.currency,
      fxRate: d.currency === "EUR" ? "1" : str(d.fxRate),
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
  } catch (err) {
    return failed(t, "quote", err);
  }
  refresh();
  return done();
}

export async function deleteQuote(id: string) {
  const db = await getDb();
  await db.delete(quotes).where(eq(quotes.id, id));
  refresh();
}

// ---------------- Creating on the fly, from inside another form ----------------

export type QuickCreated = { ok: true; id: string; name: string } | { ok: false; error: string };

/** A supplier created without leaving the purchase or quote being entered. */
export async function quickCreateSupplier(input: { name: string; country: string; email?: string }): Promise<QuickCreated> {
  const name = input.name.trim();
  const country = input.country.trim();
  const email = input.email?.trim() || null;
  const t = await getT();
  if (!name) return { ok: false, error: t("Give the supplier a name.") };
  if (!country) return { ok: false, error: t("Add the supplier's country.") };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: t("That email doesn't look right.") };
  try {
    const db = await getDb();
    const existing = (await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)).find((s) => s.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) return { ok: true, id: existing.id, name: existing.name };
    const [row] = await db.insert(suppliers).values({ name, country, email }).returning({ id: suppliers.id });
    refresh();
    return { ok: true, id: row.id, name };
  } catch (err) {
    console.error("[quick supplier]", err);
    return { ok: false, error: t("We couldn't create the supplier. Please try again.") };
  }
}

/** A product created without leaving the purchase or quote being entered. */
export async function quickCreateProduct(input: { name: string; unit: string; category?: string }): Promise<QuickCreated & { unit?: string }> {
  const name = input.name.trim();
  const unit = input.unit.trim();
  const t = await getT();
  if (!name) return { ok: false, error: t("Give the product a name.") };
  if (!unit) return { ok: false, error: t("Choose the unit you buy it in.") };
  try {
    const db = await getDb();
    const all = await db.select({ id: products.id, name: products.name, sku: products.sku, unit: products.unit }).from(products);
    const existing = all.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) return { ok: true, id: existing.id, name: existing.name, unit: existing.unit };
    const [row] = await db
      .insert(products)
      .values({ name, unit, category: input.category?.trim() || null, sku: uniqueSku(name, all.map((p) => p.sku)), mappedAt: new Date() })
      .returning({ id: products.id });
    refresh();
    return { ok: true, id: row.id, name, unit };
  } catch (err) {
    console.error("[quick product]", err);
    return { ok: false, error: t("We couldn't create the product. Please try again.") };
  }
}

// ---------------- Quick add: a purchase written in words ----------------

export interface QuickAddProposal {
  supplierId: string | null;
  /** What the sentence called the supplier, when we could not tell which one it is. */
  supplierText: string | null;
  productId: string | null;
  productText: string | null;
  quantity: number | null;
  unitPrice: number | null;
  currency: string | null;
  date: string | null;
  /** What we read, in plain words, for the user to check. */
  notes: string[];
}

/**
 * Reads a sentence and proposes a purchase. Never saves: the proposal opens
 * the normal form, where the user checks and confirms.
 */
export async function interpretPurchase(text: string): Promise<QuickAddProposal> {
  const parsed = parseQuickPurchase(text, todayISO());
  const t = await getT();
  const db = await getDb();
  const [data, learning] = await Promise.all([readDataset(db), readLearning(db)]);
  const ctx: MatchContext = {
    suppliers: data.suppliers.map((s) => ({ id: s.id, name: s.name, vatNumber: s.vatNumber })),
    products: data.products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, description: p.description })),
    supplierAliases: learning.supplierAliases,
    productAliases: learning.productAliases,
    supplierProducts: learning.supplierProducts,
  };
  const notes: string[] = [];
  // A short name is fine in speech ("ABC" for "ABC Srl"): the start of a supplier's name counts.
  let supplierId: string | null = null;
  if (parsed.supplierText) {
    const m = matchSupplier({ name: parsed.supplierText }, ctx);
    const said = parsed.supplierText.toLowerCase();
    const starts = data.suppliers.filter((s) => s.name.toLowerCase().startsWith(said) || s.name.toLowerCase().split(/\s+/).includes(said));
    supplierId = m.id ?? (starts.length === 1 ? starts[0].id : null);
    if (!supplierId) notes.push(t("We don't know a supplier called “{name}” — choose one or create it.", { name: parsed.supplierText }));
  }
  let productId: string | null = null;
  if (parsed.productText) {
    const m = matchProduct({ name: parsed.productText }, supplierId, ctx);
    const said = parsed.productText.toLowerCase();
    const contains = data.products.filter((p) => p.name.toLowerCase().includes(said));
    productId = m.id ?? (contains.length === 1 ? contains[0].id : null);
    if (!productId) notes.push(t("We don't know a product called “{name}” — choose one or create it.", { name: parsed.productText }));
  }
  const product = data.products.find((p) => p.id === productId);
  if (product && !supplierId && !parsed.supplierText && product.currentSupplierId) {
    supplierId = product.currentSupplierId;
    notes.push(t("No supplier in the sentence: we filled in the one you usually buy this from."));
  }
  if (product && parsed.unit && parsed.unit !== product.unit) {
    notes.push(t("You wrote {written}, but this product is bought in {unit} — check the quantity and price.", { written: parsed.unit, unit: product.unit }));
  }
  if (parsed.quantity == null) notes.push(t("We didn't find a quantity."));
  if (parsed.unitPrice == null) notes.push(t("We didn't find a price."));
  if (!parsed.date) notes.push(t("No date in the sentence: today is filled in."));
  return {
    supplierId,
    supplierText: supplierId ? null : parsed.supplierText,
    productId,
    productText: productId ? null : parsed.productText,
    quantity: parsed.quantity,
    unitPrice: parsed.unitPrice,
    currency: parsed.currency,
    date: parsed.date,
    notes,
  };
}

// ---------------- Company settings ----------------

export async function saveSettings(_: FormState, formData: FormData): Promise<FormState> {
  const text = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const companyName = text("companyName");
  const t = await getT();
  if (!companyName) return invalid(t, { companyName: t("Your company's name is needed") });
  const rate = (k: string) => {
    const n = text(k) ? parseNumber(text(k)) : null;
    return n && n.value != null && !n.ambiguous && n.value >= 0 && n.value <= 100 ? n.value : null;
  };
  const values = { companyName, country: text("country"), vatNumber: text("vatNumber"), userName: text("userName"), financingRatePct: rate("financingRatePct"), holdingRatePct: rate("holdingRatePct"), updatedAt: new Date() };
  try {
    const db = await getDb();
    await db.insert(settings).values({ id: 1, ...values }).onConflictDoUpdate({ target: settings.id, set: values });
  } catch (err) {
    console.error("[save settings]", err);
    return { ok: false, error: t("We couldn't save your settings. Nothing was changed — please try again.") };
  }
  refresh();
  return done();
}

/** The language of the interface. Saved with the company settings; every page follows it. */
export async function setLanguage(language: string): Promise<SimpleResult> {
  if (!isLocale(language)) return { ok: false, error: "Unknown language." };
  try {
    const db = await getDb();
    await db.insert(settings).values({ id: 1, language }).onConflictDoUpdate({ target: settings.id, set: { language, updatedAt: new Date() } });
  } catch (err) {
    console.error("[language]", err);
    return { ok: false, error: (await getT())("Could not save. Please try again.") };
  }
  refresh();
  return { ok: true };
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

/** What a product is for the company's spend: decides whether it is in the catalogue or in the other spend. */
export async function setProductKind(productId: string, kind: ProductKind): Promise<SimpleResult> {
  const t = await getT();
  if (!isProductKind(kind)) return { ok: false, error: t("Something went wrong.") };
  try {
    const db = await getDb();
    await db.update(products).set({ kind, updatedAt: new Date() }).where(eq(products.id, productId));
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("[product kind]", err);
    return { ok: false, error: t("Something went wrong.") };
  }
}

// ---------------- Supplier entity resolution ----------------

const MERGE_ERROR: Record<string, Msg> = {
  not_found: "One of the two suppliers is no longer on file.",
  same: "These are already the same supplier.",
  not_merged: "This supplier is not merged into another.",
};
const mergeFailed = (t: T, err: unknown): SimpleResult => {
  if (err instanceof SupplierMergeError && MERGE_ERROR[err.message]) return { ok: false, error: t(MERGE_ERROR[err.message]) };
  console.error("[supplier resolution]", err);
  return { ok: false, error: t("Something went wrong. Nothing was changed — please try again.") };
};

/**
 * The user says two supplier records are one company: `mergeId` is read as
 * `keepId` from now on. Both records stay as they are; the merge can be taken
 * back. What the match rests on is worked out here, not taken from the page.
 */
export async function mergeSuppliersAction(mergeId: string, keepId: string): Promise<SimpleResult> {
  const t = await getT();
  try {
    const db = await getDb();
    const match = await matchOf(db, mergeId, keepId);
    await mergeSuppliers(db, mergeId, keepId, { basis: match?.basis ?? [], confidence: match?.confidence ?? null, decidedBy: "user" });
    refresh();
    return { ok: true };
  } catch (err) {
    return mergeFailed(t, err);
  }
}

/** The user says two supplier records are two companies: the pair is not proposed again. */
export async function keepSuppliersSeparateAction(a: string, b: string): Promise<SimpleResult> {
  const t = await getT();
  try {
    const db = await getDb();
    const match = await matchOf(db, a, b);
    await keepSuppliersSeparate(db, a, b, { basis: match?.basis ?? [], confidence: match?.confidence ?? null });
    refresh();
    return { ok: true };
  } catch (err) {
    return mergeFailed(t, err);
  }
}

/** Takes a merge back: the record stands for itself again, with every purchase and quote it always had. */
export async function undoSupplierMergeAction(supplierId: string): Promise<SimpleResult> {
  const t = await getT();
  try {
    await undoSupplierMerge(await getDb(), supplierId);
    // The pair comes back as a suggestion: a merge taken back is never made again by itself.
    refresh();
    return { ok: true };
  } catch (err) {
    return mergeFailed(t, err);
  }
}

// ---------------- Sourcing: alternative suppliers and market references ----------------

export type SourcingResult = SimpleResult & { errors?: FieldErrors };

const sourcingFailed = (t: T, err: unknown): SourcingResult => {
  console.error("[sourcing]", err);
  return { ok: false, error: t("Something went wrong.") };
};

/** A possible supplier found by the user: kept with where it was found, to review like any other. */
export async function addCandidateAction(productId: string, input: Record<string, string>): Promise<SourcingResult> {
  const t = await getT();
  const parsed = candidateInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error, t) };
  try {
    await addCandidate(await getDb(), productId, parsed.data);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

export async function updateCandidateAction(id: string, patch: { status?: string; technicalCompatibility?: string | null; notes?: string | null }): Promise<SourcingResult> {
  const t = await getT();
  try {
    await updateCandidate(await getDb(), id, {
      ...(isCandidateStatus(patch.status) ? { status: patch.status } : {}),
      ...("technicalCompatibility" in patch ? { technicalCompatibility: isTechnicalFit(patch.technicalCompatibility) ? patch.technicalCompatibility : null } : {}),
      ...("notes" in patch ? { notes: patch.notes?.trim() || null } : {}),
    });
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** The whole basket at once: "quote requested" for every supplier a request was prepared for. */
export async function setCandidatesStatusAction(ids: string[], status: string): Promise<SourcingResult> {
  const t = await getT();
  if (!isCandidateStatus(status)) return { ok: false, error: t("Something went wrong.") };
  try {
    await setCandidatesStatus(await getDb(), ids, status);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

export async function deleteCandidateAction(id: string): Promise<SourcingResult> {
  const t = await getT();
  try {
    await deleteCandidate(await getDb(), id);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** A market reference typed from a report or a public source, with who published it and when. */
export async function addBenchmarkAction(productId: string, unit: string, input: Record<string, string>): Promise<SourcingResult> {
  const t = await getT();
  const parsed = benchmarkInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error, t) };
  try {
    await addBenchmark(await getDb(), productId, parsed.data, unit);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

export async function deleteBenchmarkAction(id: string): Promise<SourcingResult> {
  const t = await getT();
  try {
    await deleteBenchmark(await getDb(), id);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** The user says these requests were sent: who was asked, for what, when. Nothing is sent by the app. */
export async function markRequestsSentAction(items: { supplierName: string; candidateIds: string[]; productIds: string[]; kind: string }[]): Promise<SourcingResult> {
  const t = await getT();
  try {
    const db = await getDb();
    for (const item of items) await markRequestsSent(db, [item], item.kind === "update" || item.kind === "follow_up" ? item.kind : "request");
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/**
 * A candidate's answer, checked by the user, becomes a quote on file. A price
 * in another currency gets the official rate of its date when the rate
 * source is connected; without it the quote is kept and left out of EUR comparisons.
 */
export async function recordCandidateQuoteAction(candidateId: string, input: Record<string, string>, original: string): Promise<SourcingResult> {
  const freight = (input.freightPerUnit ?? "").trim() ? parseNumber(input.freightPerUnit) : null;
  const t = await getT();
  const parsed = candidateQuoteInput.safeParse(input);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error, t) };
  const v = parsed.data;
  try {
    let fxRate: number | null = v.currency === "EUR" ? 1 : null;
    if (v.currency !== "EUR") {
      try {
        const rate = await connectedProviders().fx[0]?.rate(v.currency, v.date!);
        if (rate?.rate) fxRate = 1 / rate.rate;
      } catch {
        fxRate = null;
      }
    }
    await recordCandidateQuote(await getDb(), candidateId, { date: v.date!, unitPrice: v.unitPrice!, currency: v.currency, fxRate, moq: v.moq, leadTimeDays: v.leadTimeDays, paymentTermsDays: v.paymentTermsDays, incoterm: v.incoterm, validUntil: v.validUntil, notes: v.notes, original: original.trim() || null, freightPerUnit: freight && freight.value != null && !freight.ambiguous ? freight.value : null });
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

// ---------------- Request specification, pilot, true cost ----------------

/** What the product is called and described as to someone who is not its current supplier: the company's own words. */
export async function saveRfqSpecAction(productId: string, input: { rfqName: string; technical: string; application: string }): Promise<SourcingResult> {
  const t = await getT();
  try {
    await saveRfqSpec(await getDb(), productId, { rfqName: input.rfqName, technical: input.technical, application: input.application });
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** A technical data sheet kept with the product, to attach to requests. Stored as it is. */
export async function uploadProductDocumentAction(productId: string, formData: FormData): Promise<SourcingResult> {
  const t = await getT();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: t("Choose a file.") };
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: t("The file is larger than 20 MB.") };
  if (!/\.(pdf|png|jpe?g|webp|docx?|xlsx?|txt)$/i.test(file.name)) return { ok: false, error: t("Attach a PDF, an image or an office document.") };
  try {
    await addProductDocument(await getDb(), productId, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || null });
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

export async function removeProductDocumentAction(id: string): Promise<SourcingResult> {
  const t = await getT();
  try {
    await removeProductDocument(await getDb(), id);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** Puts products in the live pilot, or takes them out: the first real round of requests is for these. */
export async function setPilotAction(productIds: string[], on: boolean): Promise<SourcingResult> {
  const t = await getT();
  try {
    await setPilot(await getDb(), productIds, on);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** Transport, duty and other costs of a quote, as the user knows or estimates them. Empty means not known — never zero. */
export async function saveTrueCostInputsAction(quoteId: string, input: Record<string, string>): Promise<SourcingResult> {
  const t = await getT();
  const errors: FieldErrors = {};
  const number = (key: string) => {
    const raw = (input[key] ?? "").trim();
    if (!raw) return null;
    const n = parseNumber(raw);
    if (n.value == null || n.ambiguous || n.value < 0) errors[key] = t("Write a number, zero or more.");
    return n.value;
  };
  const values = { freightPerUnit: number("freightPerUnit"), freightBasis: input.freightBasis === "estimate" ? "estimate" : input.freightBasis === "quote" ? "quote" : "manual", dutyRatePct: number("dutyRatePct"), customsPerUnit: number("customsPerUnit"), otherPerUnit: number("otherPerUnit"), notes: (input.notes ?? "").trim() || null };
  if (Object.keys(errors).length) return { ok: false, errors };
  try {
    await saveTrueCostInputs(await getDb(), quoteId, values);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** The month a reference is about ("2026-09"): its exchange rate becomes that month's average at the next research. */
export async function setBenchmarkMonthAction(id: string, month: string): Promise<SourcingResult> {
  const t = await getT();
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, error: t("Write the month as year-month, like 2026-09.") };
  try {
    await setBenchmarkMonth(await getDb(), id, month || null);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

// ---------------- Procurement product dataset ----------------

const DATA_ERROR: Record<string, Msg> = {
  number: "Write a number, zero or more.",
  days: "Write a whole number of days, zero or more.",
  yesno: "Answer yes or no.",
  not_editable: "This value comes from your documents: it can't be typed here.",
  no_supplier: "No current supplier on file: import or add a purchase first.",
  nothing_to_confirm: "There is no estimate to confirm.",
  document_type: "Choose what kind of document it is.",
};

/**
 * What a person knows better than the rules about a product — how hard
 * switching would be, how standard or critical it is — with the reason. An
 * empty level takes the correction back, and the software's estimate returns.
 */
export async function saveJudgementAction(productId: string, key: string, level: string, reason: string): Promise<SourcingResult> {
  const t = await getT();
  if (!isJudgementKey(key) || (level !== "" && !isLevel(level))) return { ok: false, error: t("Something went wrong.") };
  try {
    await saveJudgement(await getDb(), productId, key, level === "" ? null : (level as "low" | "medium" | "high"), reason);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** A field of the product's data, typed by a person. Empty clears it. */
export async function saveDataFieldAction(productId: string, field: string, raw: string): Promise<SourcingResult> {
  const t = await getT();
  if (!isFieldKey(field)) return { ok: false, error: t("Something went wrong.") };
  try {
    await saveDataField(await getDb(), productId, field, raw);
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof DataFieldError && DATA_ERROR[err.message]) return { ok: false, error: t(DATA_ERROR[err.message]) };
    return sourcingFailed(t, err);
  }
}

/** The software's estimate, confirmed as it is: it becomes a confirmed value, the estimate is kept with it. */
export async function confirmDataFieldAction(productId: string, field: string): Promise<SourcingResult> {
  const t = await getT();
  if (!isFieldKey(field)) return { ok: false, error: t("Something went wrong.") };
  try {
    await confirmDataField(await getDb(), productId, field);
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof DataFieldError && DATA_ERROR[err.message]) return { ok: false, error: t(DATA_ERROR[err.message]) };
    return sourcingFailed(t, err);
  }
}

/** A document already in the app (an invoice, a quote), linked to the product — not copied. */
export async function linkProductDocumentAction(productId: string, documentId: string, type: string): Promise<SourcingResult> {
  const t = await getT();
  try {
    await linkProductDocument(await getDb(), productId, documentId, type);
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof DataFieldError && DATA_ERROR[err.message]) return { ok: false, error: t(DATA_ERROR[err.message]) };
    return sourcingFailed(t, err);
  }
}

/** A new document for the product, with what kind it is. The same file twice is stored once. */
export async function uploadProductFileAction(productId: string, formData: FormData): Promise<SourcingResult> {
  const t = await getT();
  const file = formData.get("file");
  const type = String(formData.get("type") ?? "");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: t("Choose a file.") };
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: t("The file is larger than 20 MB.") };
  if (!/\.(pdf|png|jpe?g|webp|docx?|xlsx?|txt)$/i.test(file.name)) return { ok: false, error: t("Attach a PDF, an image or an office document.") };
  try {
    await uploadProductFile(await getDb(), productId, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type || null }, type);
    refresh();
    return { ok: true };
  } catch (err) {
    if (err instanceof DataFieldError && DATA_ERROR[err.message]) return { ok: false, error: t(DATA_ERROR[err.message]) };
    return sourcingFailed(t, err);
  }
}

// ---------------- Deep research ----------------

/**
 * Researches one product: suppliers, their own sites, price evidence, trade
 * data — whatever the connected sources allow. It adds candidates, evidence
 * and references; it never changes a purchase, a price or a supplier.
 */
export async function runResearchAction(productId: string): Promise<SourcingResult & { outcome?: ResearchOutcome }> {
  const t = await getT();
  try {
    const outcome = await runResearch(await getDb(), productId, undefined, t);
    refresh();
    return { ok: true, outcome };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** What researching the priority products would take — searches, providers, estimated cost — before anything is started. */
export async function planResearchAction(): Promise<SourcingResult & { plan?: PlanView }> {
  const t = await getT();
  try {
    const { review } = await getMarketViews();
    return { ok: true, plan: await planResearch(await getDb(), review.products.map((v) => v.productId), undefined, t) };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** Research done outside the app: read the file and say what it would load; load it only when `confirm` is set. */
export async function importResearchAction(raw: string, confirm: boolean): Promise<SourcingResult & { outcome?: ImportOutcome }> {
  const t = await getT();
  const parsed = parseResearchFile(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error === "not_json" ? t("This is not a research file: it has to be JSON, in the format shown below.") : t("The file can't be read — {detail}", { detail: `${parsed.where}: ${t.any(parsed.message)}` }) };
  try {
    const outcome = await importResearch(await getDb(), parsed.file, { dryRun: !confirm }, undefined, t);
    if (confirm) refresh();
    return { ok: true, outcome };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

/** A candidate becomes a supplier on file: the user's decision, never the research's. */
export async function convertCandidateAction(id: string): Promise<SourcingResult & { supplierId?: string }> {
  const t = await getT();
  try {
    const { supplierId } = await convertCandidate(await getDb(), id);
    refresh();
    return { ok: true, supplierId };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

export async function setCustomsCodeAction(productId: string, code: string, confirmed: boolean): Promise<SourcingResult> {
  const t = await getT();
  const digits = code.replace(/[\s.]/g, "");
  if (digits && !/^\d{4,10}$/.test(digits)) return { ok: false, error: t("A customs code is 4 to 10 digits.") };
  try {
    await setCustomsCode(await getDb(), productId, digits || null, confirmed);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

export async function setResearchClassAction(productId: string, productClass: string): Promise<SourcingResult> {
  const t = await getT();
  try {
    await setResearchClass(await getDb(), productId, productClass || null);
    refresh();
    return { ok: true };
  } catch (err) {
    return sourcingFailed(t, err);
  }
}

// ---------------- Product Mapper ----------------

const mapperFailed = (t: T, err: unknown): SimpleResult => {
  console.error("[product mapper]", err);
  return { ok: false, error: err instanceof MapperError ? err.message : t("Something went wrong.") };
};

/**
 * Confirm what the Product Mapper proposes: with no argument, every product
 * classified with high confidence; with products, only those — optionally
 * with the user's own answer (a subcategory, or a kind of spend) and names.
 */
export async function confirmMappingsAction(input: { productIds?: string[]; answer?: string; names?: Record<string, string> } = {}): Promise<SimpleResult & { confirmed?: number }> {
  const t = await getT();
  try {
    const { confirmed } = await confirmMappings(await getDb(), { ...input, t });
    refresh();
    return { ok: true, confirmed };
  } catch (err) {
    return mapperFailed(t, err);
  }
}

/** Several products are the same one: they become one, under the name given. */
export async function mergeProductsAction(productIds: string[], name: string): Promise<SimpleResult> {
  const t = await getT();
  try {
    await mergeProducts(await getDb(), productIds, name, t);
    refresh();
    return { ok: true };
  } catch (err) {
    return mapperFailed(t, err);
  }
}

/** Several products are versions of one: filed under the same macro product, each kept as it is. */
export async function confirmVariantsAction(productIds: string[], name: string, variantBy: string): Promise<SimpleResult> {
  const t = await getT();
  if (!isVariantBy(variantBy)) return { ok: false, error: t("Say what changes between them.") };
  try {
    await confirmVariants(await getDb(), productIds, name, variantBy, t);
    refresh();
    return { ok: true };
  } catch (err) {
    return mapperFailed(t, err);
  }
}

/** A merge of two products taken back: what moved goes back, the merged product is listed again. */
export async function undoProductMergeAction(mergeId: string): Promise<SimpleResult> {
  const t = await getT();
  try {
    await undoProductMerge(await getDb(), mergeId, t);
    refresh();
    return { ok: true };
  } catch (err) {
    return mapperFailed(t, err);
  }
}

/** They look alike but are different products: remembered, not asked again. */
export async function keepSeparateAction(productIds: string[]): Promise<SimpleResult> {
  const t = await getT();
  try {
    await keepSeparate(await getDb(), productIds);
    refresh();
    return { ok: true };
  } catch (err) {
    return mapperFailed(t, err);
  }
}

/** Name, category, family and variant written by the user on the product's page. */
export async function saveMappingAction(productId: string, edit: MappingEdit): Promise<SimpleResult> {
  const t = await getT();
  if (!edit.name.trim()) return { ok: false, error: t("A product needs a name.") };
  if (!isProductKind(edit.kind)) return { ok: false, error: t("Something went wrong.") };
  try {
    await saveMapping(await getDb(), productId, edit);
    refresh();
    return { ok: true };
  } catch (err) {
    return mapperFailed(t, err);
  }
}

/**
 * Status of an opportunity. The figures stay computed by the engine; here we
 * store the decision and a snapshot of the numbers at that moment.
 */
export async function setOpportunityStatus(key: string, status: OpportunityStatus, note?: string | null): Promise<SimpleResult> {
  const t = await getT();
  if (!OPPORTUNITY_STATUSES.includes(status)) return { ok: false, error: t("Unknown status.") };
  try {
    const db = await getDb();
    const [data, learning, states] = await Promise.all([readDataset(db), readLearning(db), readOpportunityStates(db)]);
    // The snapshot keeps the reason in the language it was decided in.
    const intel = analyze(catalogueOf(data), learning.supplierProducts, states, todayISO(), undefined, t);
    const o = intel.opportunities.find((x) => x.key === key);
    const [existing] = await db.select().from(opportunities).where(eq(opportunities.key, key));
    if (!o && !existing) return { ok: false, error: t("This opportunity is no longer detected.") };
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
    return { ok: false, error: t("Could not save the status. Please try again.") };
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
    return { ok: false, error: (await getT())("Could not save. Please try again.") };
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
    return { ok: false, error: (await getT())("Could not save. Please try again.") };
  }
}
