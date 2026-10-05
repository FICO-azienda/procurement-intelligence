/**
 * Procurement product profile: everything already known about one product,
 * field by field, each with its status (confirmed, estimated, missing), where
 * it comes from and — for estimates — how it was worked out. Then what that
 * is enough for: describing the product to a new supplier (sourcing
 * readiness) and computing its true cost, judged apart.
 *
 * Pure: it reads what the database already holds (purchases, quotes,
 * supplier records, documents, the description written for requests) and
 * what a person confirmed (`ledger`). It never fills a gap with a guess:
 * a value nobody gave and nothing proves is "missing".
 *
 * Confirmed is a fact from a document or a person, or plain arithmetic on
 * such facts (a sum, the lowest price paid). Estimated is an inference the
 * software makes — a median taken as the usual order, a year extrapolated
 * from a few months, a name read from the invoice — and says how.
 */
import { baseTotal, daysBetween, isPriced, minusMonths, normalizePurchases, type ProductData, type PurchaseData, type QuoteData, type SupplierData } from "../analytics";
import { attributesOf, ATTRIBUTE_LABEL, type AttributeKey } from "../catalog/attributes";
import * as f from "../format";
import { en, type Msg, type T } from "../i18n";
import type { ProductIntel } from "../intel/engine";
import { rfqSpec, type RfqSpec } from "../sourcing/rfq-spec";
import { DATASET_CONFIG, DELIVERED_TERMS, FIELDS, FIELD_KEYS, type Ask, type Dimension, type DocumentType, type FieldKey, type FieldStatus, type Readiness, type Section } from "./fields";

export type SourceKind = "invoice" | "invoices" | "quote" | "document" | "supplier_record" | "you" | "name" | "mapper" | "settings" | "computed";

export interface FieldSource {
  kind: SourceKind;
  /** In words: "Invoice 2026/118", "Purchase history", "Entered by you". */
  label: string;
  date: string | null;
  /** A document to open. */
  documentId?: string | null;
  sessionId?: string | null;
}

export interface ProfileField {
  key: FieldKey;
  section: Section;
  status: FieldStatus;
  /** As shown. Null when missing. */
  display: string | null;
  /** As a person would type it back (for the edit box). */
  raw: string | null;
  source: FieldSource | null;
  /** How an estimate was worked out — or how a confirmed figure was added up. */
  method: string | null;
  /** What the software had estimated before a person confirmed or corrected it. */
  original: { value: string; method: string | null; source: string | null } | null;
  /** Why it is missing, when there is something useful to say. */
  note: string | null;
  important: boolean;
  ask: Ask | null;
  /** An estimate a person can confirm with one click. */
  confirmable: boolean;
}

export interface LedgerRow {
  field: string;
  value: string | null;
  source: string;
  documentId: string | null;
  note: string | null;
  estimate: { value: string; method: string | null; source: string | null } | null;
  /** ISO timestamp. */
  updatedAt: string;
}

export interface ProductDocumentRef {
  id: string;
  documentId: string;
  filename: string;
  type: DocumentType | string;
  createdAt: string;
}

export interface ProfileInput {
  intel: Pick<ProductIntel, "product" | "metrics" | "price" | "typicalOrderQuantity">;
  /** Extra columns of the product that the analytics don't carry. */
  extra: { rfqName: string | null; application: string | null; mapped: boolean };
  family: string | null;
  /** Every purchase of this product. */
  purchases: PurchaseData[];
  quotes: QuoteData[];
  suppliers: SupplierData[];
  /** How each supplier sells this product: its code, minimum order, lead time. */
  supplierLinks: { supplierId: string; supplierSku: string | null; supplierProductName: string | null; moq: number | null; leadTimeDays: number | null }[];
  aliases: { alias: string; supplierId: string | null; supplierSku: string | null }[];
  documents: ProductDocumentRef[];
  ledger: LedgerRow[];
  company: { name: string | null; country: string | null };
  /** First and last purchase date of the whole company dataset: how much history there is. */
  coverage: { from: string; to: string } | null;
}

export interface ReadinessCheck {
  level: Readiness;
  /** Fields still missing for this check. */
  missing: FieldKey[];
  /** Other things missing that are not fields of the product (the delivery country). */
  other: string[];
}

export type NextAction =
  | { kind: "describe"; label: string; ask: "internal" }
  | { kind: "settings"; label: string; ask: "internal" }
  | { kind: "ask_supplier"; label: string; ask: "supplier"; fields: FieldKey[] }
  | { kind: "ask_internal"; label: string; ask: "internal"; fields: FieldKey[] }
  | { kind: "confirm"; label: string; ask: "internal"; fields: FieldKey[] }
  | { kind: "sourcing"; label: string; ask: null };

export interface ProductProfile {
  productId: string;
  name: string;
  unit: string;
  fields: Record<FieldKey, ProfileField>;
  readiness: Record<Dimension, ReadinessCheck>;
  /** Important fields with no value: what to ask, and whom. */
  missing: FieldKey[];
  /** Estimates waiting for a person to confirm them. */
  toConfirm: FieldKey[];
  counts: { confirmed: number; estimated: number; missing: number; important: number; importantKnown: number };
  /** The quantities requests and the true cost should use: confirmed first, then the software's estimate. */
  quantities: { annual: number | null; annualStatus: FieldStatus; typicalOrder: number | null; typicalOrderStatus: FieldStatus };
  /** The neutral description as requests see it (rfq-spec.ts): the same rules, the same verdict. */
  rfq: RfqSpec;
  currentSupplier: { id: string; name: string } | null;
  next: NextAction;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A number as the app stores it ("1500", "1.5"). */
export function readNumber(raw: string | null | undefined): number | null {
  if (raw == null || !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A number as a person types it back in the app: decimal comma, no grouping. */
const typed = (n: number) => String(Math.round(n * 10_000) / 10_000).replace(".", ",");

/** Specification keys as written by the company: compared without case and spaces. */
const specValue = (specs: Record<string, string> | null, key: string) => {
  if (!specs) return null;
  const k = key.toLowerCase().replace(/\s+/g, "");
  const hit = Object.entries(specs).find(([name]) => name.toLowerCase().replace(/\s+/g, "") === k);
  return hit?.[1]?.trim() || null;
};

/** What the name says, by field: a size is a dimension, a weight or a capacity is the weight/capacity, a pack is packaging. */
const FROM_NAME: Partial<Record<FieldKey, AttributeKey[]>> = {
  material: ["material"],
  dimensions: ["size", "diameter", "thickness"],
  capacity: ["capacity", "weight"],
  packaging: ["pack"],
};

export function productProfile(input: ProfileInput, t: T = en): ProductProfile {
  const { intel, extra, ledger, company } = input;
  const product: ProductData = intel.product;
  const own = input.purchases.filter((p) => p.productId === product.id);
  const { comparable } = normalizePurchases(product, own);
  const priced = comparable.filter(isPriced).filter((p) => p.priceReview !== "excluded");
  const supplierName = (id: string | null | undefined) => input.suppliers.find((s) => s.id === id)?.name ?? null;
  const currentSupplierId = product.currentSupplierId ?? intel.metrics.lastSupplierId ?? null;
  const currentSupplier = currentSupplierId ? input.suppliers.find((s) => s.id === currentSupplierId) ?? null : null;
  const fromCurrent = own.filter((p) => p.supplierId === currentSupplierId).sort((a, b) => (a.date < b.date ? 1 : -1));
  const link = input.supplierLinks.find((l) => l.supplierId === currentSupplierId) ?? null;
  const currentQuotes = input.quotes.filter((q) => q.productId === product.id && q.supplierId === currentSupplierId).sort((a, b) => (a.date < b.date ? 1 : -1));
  const ledgerOf = (key: FieldKey) => ledger.find((r) => r.field === key) ?? null;
  const you = (row: LedgerRow): FieldSource => ({ kind: row.documentId ? "document" : "you", label: row.documentId ? t("A document you pointed to") : t("Entered by you"), date: row.updatedAt.slice(0, 10), documentId: row.documentId });
  const invoiceSource = (p: PurchaseData): FieldSource => ({
    kind: "invoice",
    label: p.invoiceReference ? t("Invoice {ref}", { ref: p.invoiceReference }) : p.sourceDoc ? p.sourceDoc.filename : t("Purchase of {date}", { date: f.date(p.date) }),
    date: p.date,
    documentId: p.sourceDoc?.documentId ?? null,
    sessionId: p.sourceDoc?.sessionId ?? null,
  });
  const history = (n: number): FieldSource => ({ kind: "invoices", label: t.n(n, "Purchase history ({n} purchase)", "Purchase history ({n} purchases)"), date: own.length ? own.reduce((m, p) => (p.date > m ? p.date : m), own[0].date) : null });

  const fields = {} as Record<FieldKey, ProfileField>;
  const put = (key: FieldKey, v: Partial<ProfileField> & { status: FieldStatus }) => {
    const def = FIELDS[key];
    fields[key] = { key, section: def.section, display: null, raw: null, source: null, method: null, original: null, note: null, important: def.important, ask: def.ask, confirmable: false, ...v };
  };
  /** A value a person wrote, kept in the ledger: confirmed, with the estimate it replaced. */
  const fromLedger = (key: FieldKey, display?: (raw: string) => string): boolean => {
    const row = ledgerOf(key);
    if (!row?.value?.trim()) return false;
    const n = FIELDS[key].input === "number" ? readNumber(row.value) : null;
    put(key, { status: "confirmed", display: display ? display(row.value) : row.value, raw: n != null ? typed(n) : row.value, source: you(row), original: row.estimate, note: row.note });
    return true;
  };
  /** For values kept in their own column: the ledger only says who wrote it and what it replaced. */
  const provenance = (key: FieldKey) => {
    const row = ledgerOf(key);
    return row ? { source: you(row), original: row.estimate } : null;
  };

  // ---------------- Identity ----------------
  const knownSuppliers = [...new Set(own.map((p) => supplierName(p.supplierId)).filter((x): x is string => !!x))];
  const codes = [...new Set([...input.aliases.map((a) => a.supplierSku), ...input.supplierLinks.map((l) => l.supplierSku)].filter((x): x is string => !!x))];
  const datasheets = input.documents.filter((d) => d.type === "technical_datasheet");

  // The product's quantities: what a person confirmed, else what the history supports.
  const days = input.coverage ? daysBetween(input.coverage.from, input.coverage.to) + 1 : 0;
  const months = days / 30.44;
  const dated = comparable.filter((p) => !input.coverage || p.date <= input.coverage.to);
  const volumeOnFile = dated.reduce((s, p) => s + p.quantity, 0);
  let annual: { value: number; status: FieldStatus; method: string; source: FieldSource } | null = null;
  let annualNote: string | null = null;
  if (input.coverage && days >= DATASET_CONFIG.fullYearDays) {
    const since = minusMonths(input.coverage.to, 12);
    const year = comparable.filter((p) => p.date > since && p.date <= input.coverage!.to);
    if (year.length) annual = { value: year.reduce((s, p) => s + p.quantity, 0), status: "confirmed", method: t("Sum of the purchases of the 12 months to {date}.", { date: f.date(input.coverage.to) }), source: history(year.length) };
    else annualNote = t("No purchases in the last 12 months of history.");
  } else if (input.coverage && days >= DATASET_CONFIG.minDaysToAnnualize && dated.length >= DATASET_CONFIG.minPurchasesToAnnualize) {
    annual = {
      value: (volumeOnFile * 365) / days,
      status: "estimated",
      method: t("Annualized: {qty} bought in {months} months of purchase history ({from} – {to}), scaled to 12 months. Not a real yearly figure.", { qty: f.quantity(volumeOnFile, product.unit), months: f.number(months, 1), from: f.date(input.coverage.from), to: f.date(input.coverage.to) }),
      source: history(dated.length),
    };
  } else annualNote = input.coverage ? t("Too little history to estimate a year: {months} months, {n} purchases.", { months: f.number(months, 1), n: dated.length }) : t("No purchase history.");

  const recentQty = comparable.filter((p) => input.coverage && p.date > minusMonths(input.coverage.to, 12)).map((p) => p.quantity);
  const qtyBasis = recentQty.length ? recentQty : comparable.map((p) => p.quantity);
  const typical = intel.typicalOrderQuantity ?? (qtyBasis.length ? median(qtyBasis) : null);

  const annualRow = ledgerOf("annual_volume");
  const typicalRow = ledgerOf("typical_order");
  const annualConfirmed = readNumber(annualRow?.value);
  const typicalConfirmed = readNumber(typicalRow?.value);
  const quantities = {
    annual: annualConfirmed ?? annual?.value ?? null,
    annualStatus: (annualConfirmed != null ? "confirmed" : (annual?.status ?? "missing")) as FieldStatus,
    typicalOrder: typicalConfirmed ?? typical,
    typicalOrderStatus: (typicalConfirmed != null ? "confirmed" : typical != null ? "estimated" : "missing") as FieldStatus,
  };

  const specs = product.specs ?? null;
  const rfq = rfqSpec(
    {
      name: product.name,
      rfqName: extra.rfqName,
      technical: product.technicalSpecifications ?? product.description,
      application: extra.application,
      specs,
      supplierCodes: codes,
      knownSuppliers,
      companyName: company.name,
      unit: product.unit,
      annualQuantity: quantities.annual,
      typicalOrderQuantity: quantities.typicalOrder,
      deliveryCountry: company.country,
      documents: input.documents.filter((d) => d.type === "technical_datasheet" || d.type === "specification").length,
    },
    t,
  );

  if (extra.rfqName?.trim()) put("neutral_name", { status: "confirmed", display: extra.rfqName.trim(), raw: extra.rfqName.trim(), ...(provenance("neutral_name") ?? { source: { kind: "you", label: t("Entered by you"), date: null } }) });
  else if (rfq.neutralName) put("neutral_name", { status: "estimated", display: rfq.neutralName, raw: rfq.neutralName, source: { kind: "name", label: t("The name on the invoices"), date: null }, method: t("The invoice name with the supplier's name and codes taken out."), confirmable: true });
  else put("neutral_name", { status: "missing", raw: rfq.suggestedName, note: t("The invoice name does not say what the product is to someone who is not the current supplier.") });

  const descriptions = [...new Set([...input.aliases.map((a) => a.alias), ...own.map((p) => p.originalDescription)].filter((x): x is string => !!x?.trim()))];
  if (descriptions.length) put("invoice_descriptions", { status: "confirmed", display: descriptions.slice(0, 4).join(" · ") + (descriptions.length > 4 ? ` ${t("and {n} more", { n: descriptions.length - 4 })}` : ""), source: history(own.length) });
  else put("invoice_descriptions", { status: "missing" });

  const category = [product.category, product.subcategory].filter(Boolean).join(" › ");
  if (category) put("category", extra.mapped ? { status: "confirmed", display: category, source: { kind: "you", label: t("Confirmed in the Product Mapper"), date: null } } : { status: "estimated", display: category, source: { kind: "mapper", label: t("Proposed by the Product Mapper"), date: null }, method: t("Read from the product name by the classification rules. Confirm it in “What this product is”.") });
  else put("category", { status: "missing" });

  if (input.family) put("family", extra.mapped ? { status: "confirmed", display: input.family, source: { kind: "you", label: t("Confirmed in the Product Mapper"), date: null } } : { status: "estimated", display: input.family, source: { kind: "mapper", label: t("Proposed by the Product Mapper"), date: null } });
  else put("family", { status: "missing" });

  if (currentSupplier) put("current_supplier", { status: "confirmed", display: currentSupplier.name, source: fromCurrent[0] ? { ...invoiceSource(fromCurrent[0]), label: t("Latest invoice: {source}", { source: invoiceSource(fromCurrent[0]).label }) } : { kind: "supplier_record", label: t("Supplier record"), date: null } });
  else put("current_supplier", { status: "missing" });

  const currentCode = input.aliases.find((a) => a.supplierId === currentSupplierId && a.supplierSku)?.supplierSku ?? link?.supplierSku ?? null;
  if (currentCode) put("supplier_code", { status: "confirmed", display: currentCode, source: { kind: "invoices", label: t("The supplier's documents"), date: null } });
  else put("supplier_code", { status: "missing" });

  if (!fromLedger("internal_code")) put("internal_code", { status: "missing", note: t("The app's own code {sku} is made from the name: it is not your internal code.", { sku: product.sku }) });

  // ---------------- Technical ----------------
  const technical = product.technicalSpecifications?.trim() || product.description?.trim() || null;
  if (technical) put("technical_spec", { status: "confirmed", display: technical, raw: product.technicalSpecifications ?? technical, ...(provenance("technical_spec") ?? { source: { kind: "you", label: t("Product record"), date: null } }) });
  else put("technical_spec", { status: "missing", note: rfq.figures.length ? t("The name states {figures}: say what it means.", { figures: rfq.figures.join(", ") }) : null });

  const nameAttributes = attributesOf([product.name, ...input.aliases.map((a) => a.alias)].join(" · "));
  for (const key of ["material", "grade", "dimensions", "capacity", "form", "packaging"] as const) {
    const def = FIELDS[key];
    const written = specValue(specs, def.specKey!);
    if (written) {
      put(key, { status: "confirmed", display: written, raw: written, ...(provenance(key) ?? { source: { kind: "you", label: t("Product record"), date: null } }) });
      continue;
    }
    const read = nameAttributes.filter((a) => FROM_NAME[key]?.includes(a.key));
    const figures = key === "grade" ? rfq.figures : [];
    // The attribute's own name only when the field gathers several kinds ("Diameter 85 mm, Thickness 2 mm").
    const named = (FROM_NAME[key]?.length ?? 0) > 1;
    const value = read.length ? read.map((a) => (named ? `${t(ATTRIBUTE_LABEL[a.key])} ${a.value}` : a.value)).join(", ") : figures.length ? figures.join(", ") : null;
    if (value) put(key, { status: "estimated", display: value, raw: read.length ? read.map((a) => a.value).join(", ") : value, source: { kind: "name", label: t("The name on the invoices"), date: null }, method: key === "grade" ? t("A grade or measure written in the name: what it refers to is not stated.") : t("Read from the product name."), confirmable: true });
    else put(key, { status: "missing" });
  }

  if (extra.application?.trim()) put("application", { status: "confirmed", display: extra.application.trim(), raw: extra.application.trim(), ...(provenance("application") ?? { source: { kind: "you", label: t("Product record"), date: null } }) });
  else put("application", { status: "missing" });

  if (datasheets.length) put("datasheet", { status: "confirmed", display: datasheets.map((d) => d.filename).join(", "), source: { kind: "document", label: datasheets[0].filename, date: datasheets[0].createdAt.slice(0, 10), documentId: datasheets[0].documentId } });
  else put("datasheet", { status: "missing" });

  // ---------------- Purchasing ----------------
  const current = intel.metrics.currentPurchaseId ? own.find((p) => p.id === intel.metrics.currentPurchaseId) ?? null : null;
  if (intel.metrics.currentPrice != null && current) {
    const foreign = current.currency !== "EUR";
    put("current_price", { status: "confirmed", display: `${f.price(intel.metrics.currentPrice)}/${product.unit}${foreign ? ` (${f.price(current.unitPrice, current.currency)})` : ""}`, raw: String(intel.metrics.currentPrice), source: invoiceSource(current) });
    put("currency", { status: "confirmed", display: current.currency, source: invoiceSource(current) });
  } else {
    put("current_price", { status: "missing", note: own.length ? t("No purchase with a usable price (unit or exchange rate missing).") : null });
    put("currency", { status: "missing" });
  }
  put("unit", { status: "confirmed", display: product.unit, source: own.length ? history(own.length) : { kind: "you", label: t("Product record"), date: null } });

  const n = priced.length;
  const avg = intel.price.weightedAveragePrice;
  if (avg != null) put("weighted_average", { status: "confirmed", display: `${f.price(avg)}/${product.unit}`, source: history(n), method: t("Σ (quantity × price) ÷ Σ quantity over {n} purchases: each purchase weighs as much as it bought.", { n }) });
  else put("weighted_average", { status: "missing" });
  const point = (p: { price: number; date: string; purchaseId: string } | null, key: "historical_min" | "historical_max") => {
    const purchase = p ? own.find((x) => x.id === p.purchaseId) : null;
    if (p) put(key, { status: "confirmed", display: `${f.price(p.price)}/${product.unit} · ${f.month(p.date, t)}`, source: purchase ? invoiceSource(purchase) : history(n), method: t("Among {n} comparable purchases.", { n }) });
    else put(key, { status: "missing" });
  };
  point(intel.price.low, "historical_min");
  point(intel.price.high, "historical_max");

  const latest = [...own].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (latest) put("latest_purchase", { status: "confirmed", display: f.date(latest.date), source: invoiceSource(latest) });
  else put("latest_purchase", { status: "missing" });

  const spend = own.filter(isPriced).reduce((s, p) => s + baseTotal(p), 0);
  if (own.length) put("total_spend", { status: "confirmed", display: f.money(Math.round(spend)), source: history(own.length), method: input.coverage ? t("All purchases on file, {from} – {to}.", { from: f.date(own.reduce((m, p) => (p.date < m ? p.date : m), own[0].date)), to: f.date(latest!.date) }) : null });
  else put("total_spend", { status: "missing" });
  if (comparable.length) put("historical_volume", { status: "confirmed", display: f.quantity(comparable.reduce((s, p) => s + p.quantity, 0), product.unit), source: history(comparable.length), method: input.coverage ? t("{months} months of history.", { months: f.number(months, 1) }) : null });
  else put("historical_volume", { status: "missing" });

  if (!fromLedger("annual_volume", (raw) => f.quantity(readNumber(raw), product.unit))) {
    if (annual) put("annual_volume", { status: annual.status, display: `${f.quantity(Math.round(annual.value), product.unit)}${annual.status === "estimated" ? ` · ${t("annualized")}` : ""}`, raw: typed(Math.round(annual.value)), source: annual.source, method: annual.method, confirmable: annual.status === "estimated" });
    else put("annual_volume", { status: "missing", note: annualNote });
  }
  if (!fromLedger("typical_order", (raw) => f.quantity(readNumber(raw), product.unit))) {
    if (typical != null) put("typical_order", { status: "estimated", display: f.quantity(typical, product.unit), raw: typed(typical), source: history(qtyBasis.length), method: t.n(qtyBasis.length, "Median of {n} purchase.", "Median of {n} purchases: half the orders are smaller, half larger."), confirmable: true });
    else put("typical_order", { status: "missing" });
  }

  const dates = [...new Set(comparable.map((p) => p.date))].sort();
  if (!fromLedger("purchase_frequency")) {
    if (dates.length >= DATASET_CONFIG.minDatesForFrequency) {
      const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
      const every = Math.max(1, Math.round(median(gaps)));
      const display = t("About every {days} · {n} purchase dates in {months} months", { days: f.days(every, t), n: dates.length, months: f.number(Math.max(months, daysBetween(dates[0], dates.at(-1)!) / 30.44), 1) });
      put("purchase_frequency", { status: "estimated", display, raw: display, source: history(comparable.length), method: t("Median interval between {n} distinct purchase dates.", { n: dates.length }), confirmable: true });
    } else put("purchase_frequency", { status: "missing", note: t.n(dates.length, "Only {n} purchase date: not enough to tell a frequency.", "Only {n} purchase dates: not enough to tell a frequency.") });
  }

  // ---------------- Commercial (the current supplier) ----------------
  const withIncoterm = fromCurrent.find((p) => p.incoterm?.trim());
  const quoteIncoterm = currentQuotes.find((q) => q.incoterm?.trim());
  if (!fromLedger("delivery_basis")) {
    if (withIncoterm) put("delivery_basis", { status: "confirmed", display: withIncoterm.incoterm!.toUpperCase(), raw: withIncoterm.incoterm!.toUpperCase(), source: invoiceSource(withIncoterm) });
    else if (quoteIncoterm) put("delivery_basis", { status: "confirmed", display: quoteIncoterm.incoterm!.toUpperCase(), raw: quoteIncoterm.incoterm!.toUpperCase(), source: { kind: "quote", label: t("Quote of {date}", { date: f.date(quoteIncoterm.date) }), date: quoteIncoterm.date, documentId: quoteIncoterm.sourceDoc?.documentId ?? null } });
    else put("delivery_basis", { status: "missing", note: currentSupplier ? t("Neither the invoices nor the quotes of {supplier} state it.", { supplier: currentSupplier.name }) : null });
  }
  const basis = fields.delivery_basis.raw?.toUpperCase().trim() ?? null;
  const billed = fromCurrent.find((p) => p.freightCost > 0);
  if (!fromLedger("freight_included", (raw) => yesNo(raw, t))) {
    if (billed) put("freight_included", { status: "confirmed", display: t("No — billed separately on the invoice"), raw: "no", source: invoiceSource(billed) });
    else if (basis && /^[A-Z]{3}$/.test(basis)) put("freight_included", { status: "estimated", display: DELIVERED_TERMS.has(basis) ? t("Yes") : t("No"), raw: DELIVERED_TERMS.has(basis) ? "yes" : "no", source: fields.delivery_basis.source, method: DELIVERED_TERMS.has(basis) ? t("{incoterm}: the seller pays the transport to you.", { incoterm: basis }) : t("{incoterm}: transport to you is not in the price.", { incoterm: basis }), confirmable: true });
    else put("freight_included", { status: "missing", note: t("No freight line on the invoices: it may be in the price, or billed elsewhere.") });
  }

  const termsRow = provenance("payment_terms");
  const invoiceTerms = fromCurrent.find((p) => p.paymentTermsDays != null);
  if (termsRow && currentSupplier?.paymentTermsDays != null) put("payment_terms", { status: "confirmed", display: f.paymentTerms(currentSupplier.paymentTermsDays, t), raw: String(currentSupplier.paymentTermsDays), ...termsRow });
  else if (invoiceTerms) put("payment_terms", { status: "confirmed", display: f.paymentTerms(invoiceTerms.paymentTermsDays, t), raw: String(invoiceTerms.paymentTermsDays), source: invoiceSource(invoiceTerms) });
  else if (currentSupplier?.paymentTermsDays != null) put("payment_terms", { status: "confirmed", display: f.paymentTerms(currentSupplier.paymentTermsDays, t), raw: String(currentSupplier.paymentTermsDays), source: { kind: "supplier_record", label: t("Supplier record of {supplier}", { supplier: currentSupplier.name }), date: null } });
  else put("payment_terms", { status: "missing" });

  const moqQuote = currentQuotes.find((q) => q.moq != null);
  if (link?.moq != null) put("moq", { status: "confirmed", display: f.quantity(link.moq, product.unit), raw: typed(link.moq), ...(provenance("moq") ?? { source: { kind: "supplier_record", label: t("Supplier record of {supplier}", { supplier: currentSupplier?.name ?? "" }), date: null } }) });
  else if (moqQuote) put("moq", { status: "confirmed", display: f.quantity(moqQuote.moq, product.unit), raw: typed(moqQuote.moq!), source: { kind: "quote", label: t("Quote of {date}", { date: f.date(moqQuote.date) }), date: moqQuote.date } });
  else put("moq", { status: "missing" });

  const leadQuote = currentQuotes.find((q) => q.leadTimeDays != null);
  if (link?.leadTimeDays != null) put("lead_time", { status: "confirmed", display: f.days(link.leadTimeDays, t), raw: String(link.leadTimeDays), ...(provenance("lead_time") ?? { source: { kind: "supplier_record", label: t("Supplier record of {supplier}", { supplier: currentSupplier?.name ?? "" }), date: null } }) });
  else if (leadQuote) put("lead_time", { status: "confirmed", display: f.days(leadQuote.leadTimeDays, t), raw: String(leadQuote.leadTimeDays), source: { kind: "quote", label: t("Quote of {date}", { date: f.date(leadQuote.date) }), date: leadQuote.date } });
  else if (currentSupplier?.defaultLeadTimeDays != null) put("lead_time", { status: "confirmed", display: f.days(currentSupplier.defaultLeadTimeDays, t), raw: String(currentSupplier.defaultLeadTimeDays), source: { kind: "supplier_record", label: t("Supplier record of {supplier}", { supplier: currentSupplier.name }), date: null }, note: t("The supplier's usual lead time, not one stated for this product.") });
  else put("lead_time", { status: "missing" });

  // ---------------- Quality ----------------
  for (const key of ["quality_issues", "returns", "reliability"] as const) if (!fromLedger(key)) put(key, { status: "missing" });

  // ---------------- Readiness ----------------
  const has = (k: FieldKey) => fields[k].status !== "missing";
  const level = (keys: FieldKey[], critical: FieldKey[] = []): ReadinessCheck => {
    const missing = keys.filter((k) => !has(k));
    return { level: missing.length === 0 ? "ready" : missing.length === keys.length || critical.some((k) => !has(k)) ? "not_ready" : "partial", missing, other: [] };
  };
  const specKnown = !!rfq.technical || rfq.attributes.length > 0 || rfq.figures.length > 0 || rfq.documents > 0;
  const sourcingMissing: FieldKey[] = [...(rfq.neutralSource === "missing" ? ["neutral_name" as const] : []), ...(!specKnown ? ["technical_spec" as const] : []), ...(quantities.annual == null ? ["annual_volume" as const] : [])];
  const readiness: Record<Dimension, ReadinessCheck> = {
    identity: level(["neutral_name", "category", "current_supplier"]),
    technical: { ...level(["technical_spec", "application", "datasheet"]), level: has("technical_spec") || has("datasheet") ? (has("technical_spec") && has("application") && has("datasheet") ? "ready" : "partial") : "not_ready" },
    purchasing: level(["current_price", "unit", "latest_purchase", "annual_volume", "typical_order"], ["current_price"]),
    commercial: level(["delivery_basis", "freight_included", "payment_terms", "moq", "lead_time"]),
    // The same verdict as the request for quotation: the same rules, read in one place.
    sourcing: { level: rfq.readiness, missing: sourcingMissing, other: company.country ? [] : [t("Where it has to be delivered: set your country in Settings.")] },
    true_cost: level(["current_price", "annual_volume", "payment_terms", "delivery_basis", "freight_included", "typical_order"], ["current_price"]),
  };
  readiness.technical.missing = (["technical_spec", "application", "datasheet"] as const).filter((k) => !has(k));

  const all = FIELD_KEYS.map((k) => fields[k]);
  const order = (k: FieldKey) => (readiness.sourcing.missing.includes(k) ? 0 : readiness.true_cost.missing.includes(k) ? 1 : 2);
  const missing = all.filter((x) => x.important && x.status === "missing" && x.ask).map((x) => x.key).sort((a, b) => order(a) - order(b));
  const toConfirm = all.filter((x) => x.confirmable).map((x) => x.key);

  return {
    productId: product.id,
    name: product.name,
    unit: product.unit,
    fields,
    readiness,
    missing,
    toConfirm,
    counts: {
      confirmed: all.filter((x) => x.status === "confirmed").length,
      estimated: all.filter((x) => x.status === "estimated").length,
      missing: all.filter((x) => x.status === "missing").length,
      important: all.filter((x) => x.important).length,
      importantKnown: all.filter((x) => x.important && x.status !== "missing").length,
    },
    quantities,
    rfq,
    currentSupplier: currentSupplier ? { id: currentSupplier.id, name: currentSupplier.name } : null,
    next: nextAction(readiness, missing, toConfirm, currentSupplier?.name ?? null, t),
  };
}

const yesNo = (raw: string, t: T) => (/^(y|yes|si|sì|true|1)$/i.test(raw.trim()) ? t("Yes") : /^(n|no|false|0)$/i.test(raw.trim()) ? t("No") : raw);

const fieldList = (keys: FieldKey[], t: T, max = 3) => keys.slice(0, max).map((k) => t(FIELDS[k].label).toLowerCase()).join(", ") + (keys.length > max ? ` ${t("and {n} more", { n: keys.length - max })}` : "");

/** The one thing to do next with this product's data, and who can answer it. */
function nextAction(readiness: Record<Dimension, ReadinessCheck>, missing: FieldKey[], toConfirm: FieldKey[], supplier: string | null, t: T): NextAction {
  if (readiness.sourcing.missing.includes("neutral_name") || readiness.sourcing.missing.includes("technical_spec"))
    return { kind: "describe", label: t("Describe the product in neutral words, with its specification"), ask: "internal" };
  if (readiness.sourcing.missing.includes("annual_volume")) return { kind: "ask_internal", label: t("Say how much of it you need in a year"), ask: "internal", fields: ["annual_volume"] };
  if (readiness.sourcing.other.length) return { kind: "settings", label: t("Set the delivery country in Settings"), ask: "internal" };
  const fromSupplier = missing.filter((k) => FIELDS[k].ask === "supplier");
  if (fromSupplier.length) return { kind: "ask_supplier", label: supplier ? t("Ask {supplier} for: {fields}", { supplier, fields: fieldList(fromSupplier, t) }) : t("Ask the current supplier for: {fields}", { fields: fieldList(fromSupplier, t) }), ask: "supplier", fields: fromSupplier };
  const internal = missing.filter((k) => FIELDS[k].ask === "internal");
  if (internal.length) return { kind: "ask_internal", label: t("Complete: {fields}", { fields: fieldList(internal, t) }), ask: "internal", fields: internal };
  if (toConfirm.length) return { kind: "confirm", label: t.n(toConfirm.length, "Confirm {n} estimate", "Confirm {n} estimates"), ask: "internal", fields: toConfirm };
  return { kind: "sourcing", label: t("Data complete: look for alternative suppliers"), ask: null };
}

/** Readiness of all the data, as one word: the share of the important fields known. */
export function dataReadiness(p: ProductProfile): Readiness {
  const r = p.counts.importantKnown / p.counts.important;
  return r === 1 ? "ready" : p.readiness.sourcing.level === "not_ready" && r < 0.5 ? "not_ready" : "partial";
}

/** The rows of the dataset export: one line per product and field. Ready for CSV now, a spreadsheet later. */
export function datasetRows(profiles: ProductProfile[], t: T = en): string[][] {
  const header = [t("Product"), t("Section"), t("Field"), t("Value"), t("Status"), t("Source"), t("Source date"), t("Method")];
  const rows = profiles.flatMap((p) =>
    FIELD_KEYS.map((k) => {
      const x = p.fields[k];
      return [p.name, t(SECTION_WORD[x.section]), t(FIELDS[k].label), x.display ?? "", t(STATUS_WORD[x.status]), x.source?.label ?? "", x.source?.date ? f.date(x.source.date) : "", x.method ?? ""];
    }),
  );
  return [header, ...rows];
}

const SECTION_WORD: Record<Section, Msg> = { identity: "Identity", technical: "Technical", purchasing: "Purchasing", commercial: "Commercial", quality: "Quality and operations" };
const STATUS_WORD: Record<FieldStatus, Msg> = { confirmed: "Confirmed", estimated: "Estimated", missing: "Missing" };
