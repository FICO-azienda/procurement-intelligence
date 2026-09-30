/**
 * All business calculations live here, as pure functions over plain data.
 *
 * Nothing is stored pre-computed: pages (and, later, AI tools) call these on
 * the current purchases/quotes, so every number updates as soon as a record is
 * added, edited or deleted.
 *
 * Conventions
 * - Prices and amounts are converted to the base currency (EUR) via fx_rate.
 * - "Annual" = the last 12 months up to `asOf` (a rolling window, not the
 *   calendar year).
 * - "12M change" = latest price paid vs. the price paid ~12 months earlier
 *   (the last purchase on/before the window start, otherwise the oldest one).
 */

export const RULES = {
  /** A 12M price change above this % marks the product "Price increase". */
  priceIncreasePct: 5,
  /** No purchase for longer than this → "Review" (price may be outdated). */
  staleAfterDays: 180,
  windowMonths: 12,
} as const;

// ---------- Plain data shapes (numbers already parsed) ----------

export interface SupplierData {
  id: string;
  name: string;
  country: string | null;
  city: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  currency: string;
  paymentTermsDays: number | null;
  defaultLeadTimeDays: number | null;
  notes: string | null;
}

export interface ProductData {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  technicalSpecifications: string | null;
  currentSupplierId: string | null;
}

export interface PurchaseData {
  id: string;
  productId: string;
  supplierId: string;
  date: string; // YYYY-MM-DD
  quantity: number;
  unit: string;
  unitPrice: number;
  currency: string;
  fxRate: number;
  freightCost: number;
  otherCosts: number;
  totalAmount: number;
  invoiceReference: string | null;
  source: string;
  notes: string | null;
}

export interface QuoteData {
  id: string;
  productId: string;
  supplierId: string;
  date: string;
  quantity: number | null;
  unitPrice: number;
  currency: string;
  fxRate: number;
  moq: number | null;
  leadTimeDays: number | null;
  paymentTermsDays: number | null;
  incoterm: string | null;
  validUntil: string | null;
  source: string;
  notes: string | null;
}

export interface Dataset {
  suppliers: SupplierData[];
  products: ProductData[];
  purchases: PurchaseData[];
  quotes: QuoteData[];
}

// ---------- Date helpers (ISO date strings compare lexicographically) ----------

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function minusMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}

export function windowStart(asOf: string): string {
  return minusMonths(asOf, RULES.windowMonths);
}

// ---------- Unit helpers ----------

/** Unit price in base currency. */
export const basePrice = (p: { unitPrice: number; fxRate: number }) => p.unitPrice * p.fxRate;
/** Total paid in base currency (goods + freight + other costs). */
export const baseTotal = (p: PurchaseData) => p.totalAmount * p.fxRate;

export function computeTotal(quantity: number, unitPrice: number, freight = 0, other = 0) {
  return Math.round((quantity * unitPrice + freight + other) * 100) / 100;
}

function byDate<T extends { date: string }>(a: T, b: T) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

export function pctChange(from: number | null, to: number | null): number | null {
  if (from == null || to == null || from === 0) return null;
  return (to / from - 1) * 100;
}

// ---------- Price change over a set of purchases ----------

export interface PriceChange {
  currentPrice: number | null;
  currentDate: string | null;
  referencePrice: number | null;
  referenceDate: string | null;
  /** Current vs. ~12 months ago, in %. Null with fewer than 2 purchases. */
  changePct: number | null;
  /** Price before the most recent price change (last different price). */
  previousPrice: number | null;
  previousDate: string | null;
}

/**
 * @param currentSupplierId when given, "current price" is the latest price
 *   paid to that supplier (so price and supplier shown together match); the
 *   12-month reference still looks at all suppliers.
 */
export function priceChange(
  purchases: PurchaseData[],
  asOf: string,
  currentSupplierId?: string | null,
): PriceChange {
  const sorted = [...purchases].sort(byDate);
  const fromCurrent = currentSupplierId ? sorted.filter((p) => p.supplierId === currentSupplierId) : [];
  const last = fromCurrent.at(-1) ?? sorted.at(-1);
  if (!last) {
    return {
      currentPrice: null,
      currentDate: null,
      referencePrice: null,
      referenceDate: null,
      changePct: null,
      previousPrice: null,
      previousDate: null,
    };
  }
  // Everything bought up to the current purchase, excluding it.
  const earlier = sorted.filter((p) => p !== last && p.date <= last.date);
  const start = windowStart(asOf);
  const reference = earlier.filter((p) => p.date <= start).at(-1) ?? earlier[0];
  const currentPrice = basePrice(last);
  const previous = earlier.findLast((p) => Math.abs(basePrice(p) - currentPrice) > 1e-9);

  return {
    currentPrice,
    currentDate: last.date,
    referencePrice: reference ? basePrice(reference) : null,
    referenceDate: reference?.date ?? null,
    changePct: reference ? pctChange(basePrice(reference), currentPrice) : null,
    previousPrice: previous ? basePrice(previous) : null,
    previousDate: previous?.date ?? null,
  };
}

// ---------- Product metrics ----------

export type ProductStatus = "stable" | "increase" | "review";

export interface ProductMetrics extends PriceChange {
  productId: string;
  purchaseCount: number;
  lastSupplierId: string | null;
  /** Quantity bought in the last 12 months. */
  annualQuantity: number;
  /** Actual spend in the last 12 months (incl. freight/other costs), EUR. */
  annualSpend: number;
  /** Same annual quantity at today's price (goods only), EUR. */
  spendAtCurrentPrice: number | null;
  /** Extra yearly cost of the 12M price change at current volume, EUR. */
  changeImpact: number | null;
  status: ProductStatus;
  statusReason: string;
}

export function productMetrics(
  product: ProductData,
  allPurchases: PurchaseData[],
  asOf: string,
): ProductMetrics {
  const own = allPurchases.filter((p) => p.productId === product.id).sort(byDate);
  const change = priceChange(own, asOf, product.currentSupplierId);
  const start = windowStart(asOf);
  const inWindow = own.filter((p) => p.date > start);
  const annualQuantity = sum(inWindow.map((p) => p.quantity));
  const annualSpend = sum(inWindow.map(baseTotal));

  const spendAtCurrentPrice =
    change.currentPrice != null ? annualQuantity * change.currentPrice : null;
  const changeImpact =
    change.currentPrice != null && change.referencePrice != null
      ? annualQuantity * (change.currentPrice - change.referencePrice)
      : null;

  let status: ProductStatus = "stable";
  let statusReason = "Price within ±" + RULES.priceIncreasePct + "% over 12 months";
  if (own.length === 0) {
    status = "review";
    statusReason = "No purchases recorded yet";
  } else if (change.currentDate && daysBetween(change.currentDate, asOf) > RULES.staleAfterDays) {
    status = "review";
    statusReason = "No purchase in the last 6 months — price may be outdated";
  } else if (change.changePct != null && Number(change.changePct.toFixed(1)) > RULES.priceIncreasePct) {
    // Decide on the rounded % the user sees, so "+5,0%" is never an increase.
    status = "increase";
    statusReason = `Price up more than ${RULES.priceIncreasePct}% in 12 months`;
  }

  return {
    ...change,
    productId: product.id,
    purchaseCount: own.length,
    lastSupplierId: own.at(-1)?.supplierId ?? null,
    annualQuantity,
    annualSpend,
    spendAtCurrentPrice,
    changeImpact,
    status,
    statusReason,
  };
}

/** Current supplier = the one set on the product, else the last one bought from. */
export function currentSupplierId(product: ProductData, m: ProductMetrics) {
  return product.currentSupplierId ?? m.lastSupplierId;
}

// ---------- Quotes ----------

/** Most recent quote per supplier for one product. */
export function latestQuotesBySupplier(quotes: QuoteData[], productId: string) {
  const latest = new Map<string, QuoteData>();
  for (const q of quotes.filter((q) => q.productId === productId).sort(byDate)) {
    latest.set(q.supplierId, q);
  }
  return [...latest.values()];
}

export interface SupplierTerms {
  moq: number | null;
  leadTimeDays: number | null;
  paymentTermsDays: number | null;
  incoterm: string | null;
  /** True when a value comes from supplier defaults rather than a quote. */
  fromDefaults: boolean;
}

export function supplierTermsFor(
  supplier: SupplierData,
  quotes: QuoteData[],
  productId: string,
): SupplierTerms {
  const quote = latestQuotesBySupplier(quotes, productId).find(
    (q) => q.supplierId === supplier.id,
  );
  return {
    moq: quote?.moq ?? null,
    leadTimeDays: quote?.leadTimeDays ?? supplier.defaultLeadTimeDays,
    paymentTermsDays: quote?.paymentTermsDays ?? supplier.paymentTermsDays,
    incoterm: quote?.incoterm ?? null,
    fromDefaults: !quote,
  };
}

export interface CompareRow {
  supplier: SupplierData;
  isCurrent: boolean;
  /** Quoted price in EUR (or last paid price if the supplier has no quote). */
  price: number | null;
  priceBasis: "quote" | "last-paid" | "none";
  quote: QuoteData | null;
  terms: SupplierTerms;
}

export function compareRows(product: ProductData, data: Dataset, asOf: string): CompareRow[] {
  const m = productMetrics(product, data.purchases, asOf);
  const currentId = currentSupplierId(product, m);
  const quotes = latestQuotesBySupplier(data.quotes, product.id);
  const ids = new Set(quotes.map((q) => q.supplierId));
  if (currentId) ids.add(currentId);

  const rows: CompareRow[] = [];
  for (const id of ids) {
    const supplier = data.suppliers.find((s) => s.id === id);
    if (!supplier) continue;
    const quote = quotes.find((q) => q.supplierId === id) ?? null;
    const lastPaid = data.purchases
      .filter((p) => p.productId === product.id && p.supplierId === id)
      .sort(byDate)
      .at(-1);
    rows.push({
      supplier,
      isCurrent: id === currentId,
      price: quote ? basePrice(quote) : lastPaid ? basePrice(lastPaid) : null,
      priceBasis: quote ? "quote" : lastPaid ? "last-paid" : "none",
      quote,
      terms: supplierTermsFor(supplier, data.quotes, product.id),
    });
  }
  // Current supplier first, then alphabetical: listed, deliberately not ranked
  // by price until landed cost exists.
  return rows.sort(
    (a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.supplier.name.localeCompare(b.supplier.name),
  );
}

// ---------- Supplier metrics ----------

export type SupplierStatus = "active" | "inactive" | "quote-only" | "new";

export interface SupplierMetrics {
  supplierId: string;
  annualSpend: number;
  purchaseCount: number;
  lastPurchaseDate: string | null;
  /** Products bought from (ever) or currently assigned to this supplier. */
  productIds: string[];
  quotedProductIds: string[];
  avgLeadTimeDays: number | null;
  status: SupplierStatus;
}

export function supplierMetrics(supplier: SupplierData, data: Dataset, asOf: string): SupplierMetrics {
  const own = data.purchases.filter((p) => p.supplierId === supplier.id).sort(byDate);
  const start = windowStart(asOf);
  const inWindow = own.filter((p) => p.date > start);
  const productIds = new Set(own.map((p) => p.productId));
  for (const p of data.products) if (p.currentSupplierId === supplier.id) productIds.add(p.id);

  const ownQuotes = data.quotes.filter((q) => q.supplierId === supplier.id);
  const quotedProductIds = [...new Set(ownQuotes.map((q) => q.productId))];
  const leadTimes = quotedProductIds
    .map((pid) => latestQuotesBySupplier(ownQuotes, pid)[0]?.leadTimeDays)
    .filter((n): n is number => n != null);

  let status: SupplierStatus = "new";
  if (inWindow.length > 0) status = "active";
  else if (own.length > 0) status = "inactive";
  else if (ownQuotes.length > 0) status = "quote-only";

  return {
    supplierId: supplier.id,
    annualSpend: sum(inWindow.map(baseTotal)),
    purchaseCount: own.length,
    lastPurchaseDate: own.at(-1)?.date ?? null,
    productIds: [...productIds],
    quotedProductIds,
    avgLeadTimeDays: leadTimes.length
      ? sum(leadTimes) / leadTimes.length
      : supplier.defaultLeadTimeDays,
    status,
  };
}

// ---------- Overview (Today page) ----------

export interface Overview {
  asOf: string;
  windowStart: string;
  totalAnnualSpend: number;
  totalAtCurrentPrices: number;
  purchaseCountInWindow: number;
  productsTracked: number;
  activeSuppliers: number;
  otherSuppliers: number;
  priceIncreases: number;
  /** Extra yearly cost of all 12M price increases at current volumes. */
  increaseImpact: number;
  products: { product: ProductData; metrics: ProductMetrics }[];
}

export function overview(data: Dataset, asOf: string): Overview {
  const products = data.products.map((product) => ({
    product,
    metrics: productMetrics(product, data.purchases, asOf),
  }));
  const start = windowStart(asOf);
  const supplierStats = data.suppliers.map((s) => supplierMetrics(s, data, asOf));
  const active = supplierStats.filter((s) => s.status === "active").length;

  return {
    asOf,
    windowStart: start,
    totalAnnualSpend: sum(products.map((p) => p.metrics.annualSpend)),
    totalAtCurrentPrices: sum(products.map((p) => p.metrics.spendAtCurrentPrice ?? 0)),
    purchaseCountInWindow: data.purchases.filter((p) => p.date > start).length,
    productsTracked: products.length,
    activeSuppliers: active,
    otherSuppliers: data.suppliers.length - active,
    priceIncreases: products.filter((p) => p.metrics.status === "increase").length,
    increaseImpact: sum(
      products.map((p) => ((p.metrics.changeImpact ?? 0) > 0 ? p.metrics.changeImpact! : 0)),
    ),
    products,
  };
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}
