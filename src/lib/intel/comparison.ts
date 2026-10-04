/**
 * Supplier comparison for one product: the latest price from every supplier
 * (paid or quoted), on the same unit and currency basis, with an explicit
 * judgement of whether each offer can be compared with what we buy today.
 *
 * Prices here are purchase/quote prices only — no freight, duties, FX costs,
 * inventory, quality or financing. The landed-cost phase extends these rows;
 * it does not replace them.
 */
import { basePrice, daysBetween, isPriced, type ProductData, type PurchaseData, type QuoteData, type SupplierData } from "../analytics";
import { en, type T } from "../i18n";
import { normalizeKey } from "../import/normalize/text";
import { INTEL_CONFIG, type IntelConfig } from "./config";

export type Comparability = "comparable" | "partial" | "not";
export type AgeClass = "fresh" | "recent" | "old";

export interface SupplierLink {
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  supplierProductName: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  specs: Record<string, string> | null;
  comparabilityOverride: Comparability | null;
  comparabilityNote: string | null;
}

export interface SpecDifference {
  name: string;
  ours: string;
  theirs: string;
}

export interface ComparisonRow {
  supplier: SupplierData;
  isCurrent: boolean;
  /** Where the latest price comes from. */
  kind: "purchase" | "quote" | null;
  recordId: string | null;
  /** Price per product unit in the document currency. */
  price: number | null;
  currency: string | null;
  /** EUR per product unit; null when the exchange rate is not known. */
  priceEUR: number | null;
  fxRequired: boolean;
  date: string | null;
  ageDays: number | null;
  age: AgeClass | null;
  /** Quote validity date has passed. */
  expired: boolean;
  moq: number | null;
  leadTimeDays: number | null;
  paymentTermsDays: number | null;
  incoterm: string | null;
  freightCost: number | null;
  /** Lead time / payment terms come from the supplier's defaults, not from an offer. */
  termsFromDefaults: boolean;
  /** Alternative minus current, EUR per unit and %. Null when not comparable in EUR. */
  difference: number | null;
  differencePct: number | null;
  comparability: Comparability;
  comparabilityReasons: string[];
  /** The user decided the comparability. */
  overridden: boolean;
  specsKnown: boolean;
  specDifferences: SpecDifference[];
  /** Lowest EUR price among suppliers other than the current one, and below it. */
  isLowest: boolean;
  source: string | null;
  reference: string | null;
  sourceDoc: PurchaseData["sourceDoc"];
  link: SupplierLink | null;
}

export function ageClass(days: number, cfg: IntelConfig = INTEL_CONFIG): AgeClass {
  return days < cfg.quoteAge.freshDays ? "fresh" : days <= cfg.quoteAge.recentDays ? "recent" : "old";
}

const cleanValue = (v: string) => v.toLowerCase().replace(/\s+/g, "").replace(",", ".");

/** Specifications present on both sides whose values differ. */
export function specDifferences(ours: Record<string, string> | null, theirs: Record<string, string> | null): SpecDifference[] {
  if (!ours || !theirs) return [];
  const mine = new Map(Object.entries(ours).map(([k, v]) => [normalizeKey(k), { name: k, value: v }]));
  const out: SpecDifference[] = [];
  for (const [k, v] of Object.entries(theirs)) {
    const m = mine.get(normalizeKey(k));
    if (m && cleanValue(m.value) !== cleanValue(v)) out.push({ name: m.name, ours: m.value, theirs: v });
  }
  return out;
}

const hasSpecs = (s: Record<string, string> | null | undefined) => !!s && Object.keys(s).length > 0;

export interface ComparisonInput {
  product: ProductData;
  suppliers: SupplierData[];
  /** Purchases of the product, in the product's unit (convertible ones only). */
  purchases: PurchaseData[];
  /** Purchases whose unit can't be converted (shown as not comparable). */
  unitMismatch: PurchaseData[];
  quotes: QuoteData[];
  links: SupplierLink[];
  currentSupplierId: string | null;
  /** EUR price we pay today (from price metrics). */
  currentPrice: number | null;
  /** Median order quantity, to judge MOQs. */
  typicalOrderQuantity: number | null;
  asOf: string;
}

export function compareSuppliers(input: ComparisonInput, cfg: IntelConfig = INTEL_CONFIG, t: T = en): ComparisonRow[] {
  const { product, asOf, currentPrice } = input;
  const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const supplierIds = new Set<string>([
    ...input.purchases.map((p) => p.supplierId),
    ...input.unitMismatch.map((p) => p.supplierId),
    ...input.quotes.map((q) => q.supplierId),
  ]);
  if (input.currentSupplierId) supplierIds.add(input.currentSupplierId);

  const rows: ComparisonRow[] = [];
  for (const supplierId of supplierIds) {
    const supplier = input.suppliers.find((s) => s.id === supplierId);
    if (!supplier) continue;
    const isCurrent = supplierId === input.currentSupplierId;
    const purchase = input.purchases.filter((p) => p.supplierId === supplierId && p.priceReview !== "excluded").sort(byDate).at(-1) ?? null;
    const mismatch = input.unitMismatch.filter((p) => p.supplierId === supplierId).sort(byDate).at(-1) ?? null;
    const quote = input.quotes.filter((q) => q.supplierId === supplierId).sort(byDate).at(-1) ?? null;
    const link = input.links.find((l) => l.supplierId === supplierId && l.productId === product.id) ?? null;

    // Current supplier: what we pay. Others: their most recent price, quote first on a tie.
    const useQuote = !!quote && (!purchase || (!isCurrent && quote.date >= purchase.date));
    const record = useQuote ? quote : purchase;
    const kind: ComparisonRow["kind"] = record ? (useQuote ? "quote" : "purchase") : null;

    const price = record?.unitPrice ?? null;
    const currency = record?.currency ?? mismatch?.currency ?? null;
    const priceEUR = record && isPriced(record) ? basePrice(record) : null;
    const fxRequired = !!record && !isPriced(record);
    const date = record?.date ?? mismatch?.date ?? null;
    const ageDays = date ? Math.max(0, daysBetween(date, asOf)) : null;
    const expired = useQuote && !!quote?.validUntil && quote.validUntil < asOf;

    const moq = quote?.moq ?? link?.moq ?? null;
    const leadTimeDays = quote?.leadTimeDays ?? link?.leadTimeDays ?? supplier.defaultLeadTimeDays;
    const paymentTermsDays = quote?.paymentTermsDays ?? (purchase?.paymentTermsDays ?? null) ?? supplier.paymentTermsDays;
    const termsFromDefaults = !quote && link?.leadTimeDays == null && purchase?.paymentTermsDays == null;

    const diffs = specDifferences(product.specs, link?.specs ?? null);
    const specsKnown = hasSpecs(product.specs) && hasSpecs(link?.specs);

    // ---- Comparability
    const reasons: string[] = [];
    let comparability: Comparability = "comparable";
    let overridden = false;
    if (!record && mismatch) {
      comparability = "not";
      reasons.push(t('Bought in "{from}", which can\'t be converted to {to}', { from: mismatch.unit, to: product.unit }));
    } else if (price == null) {
      comparability = "not";
      reasons.push(t("No price on record"));
    } else if (fxRequired) {
      comparability = "not";
      reasons.push(t("FX conversion required ({currency} price, no exchange rate on record)", { currency }));
    } else if (!isCurrent) {
      if (diffs.length) {
        comparability = "partial";
        reasons.push(t("Specification difference: {list}", { list: diffs.map((d) => t("{name} {theirs} vs {ours}", { name: d.name, theirs: d.theirs, ours: d.ours })).join(", ") }));
      }
      if (moq != null && input.typicalOrderQuantity != null && moq > input.typicalOrderQuantity * cfg.moqToleranceFactor) {
        comparability = "partial";
        const n = (v: number) => v.toLocaleString("it-IT", { useGrouping: "always", maximumFractionDigits: 2 });
        reasons.push(t("MOQ {moq} {unit} is above your typical order of {typical} {unit}", { moq: n(moq), typical: n(input.typicalOrderQuantity), unit: product.unit }));
      }
    }
    // A missing price, an unknown exchange rate or an unconvertible unit can't be overridden into "comparable".
    const hardBlock = price == null || fxRequired;
    if (!isCurrent && link?.comparabilityOverride && (!hardBlock || link.comparabilityOverride === "not")) {
      // Otherwise the user's judgement wins.
      comparability = link.comparabilityOverride;
      overridden = true;
      reasons.unshift(link.comparabilityNote ? t("Set by you: {note}", { note: link.comparabilityNote }) : t("Set by you"));
    }

    const difference = !isCurrent && priceEUR != null && currentPrice != null && comparability !== "not" ? priceEUR - currentPrice : null;

    rows.push({
      supplier,
      isCurrent,
      kind,
      recordId: record?.id ?? null,
      price,
      currency,
      priceEUR,
      fxRequired,
      date,
      ageDays,
      age: ageDays == null ? null : ageClass(ageDays, cfg),
      expired,
      moq,
      leadTimeDays,
      paymentTermsDays,
      incoterm: quote?.incoterm ?? purchase?.incoterm ?? null,
      freightCost: useQuote ? (quote?.freightCost ?? null) : null,
      termsFromDefaults,
      difference,
      differencePct: difference != null && currentPrice ? (difference / currentPrice) * 100 : null,
      comparability,
      comparabilityReasons: reasons,
      overridden,
      specsKnown,
      specDifferences: diffs,
      isLowest: false,
      source: record?.source ?? null,
      reference: useQuote ? null : (purchase?.invoiceReference ?? null),
      sourceDoc: record?.sourceDoc ?? null,
      link,
    });
  }

  // Lowest comparable price among the alternatives, if below what we pay.
  const candidates = rows.filter((r) => !r.isCurrent && r.priceEUR != null && r.comparability !== "not");
  const lowest = candidates.sort((a, b) => a.priceEUR! - b.priceEUR!)[0];
  if (lowest && (currentPrice == null || lowest.priceEUR! < currentPrice)) lowest.isLowest = true;

  // Current supplier first, then alphabetical: listed, not ranked.
  return rows.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.supplier.name.localeCompare(b.supplier.name));
}
