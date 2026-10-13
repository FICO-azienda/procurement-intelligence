/**
 * Supplier comparison for one product: the latest price from every supplier
 * (paid or quoted), on the same unit and currency basis, with an explicit
 * judgement of whether each offer can be compared with what we buy today.
 *
 * Prices here are purchase/quote prices only — no freight, duties, FX costs,
 * inventory, quality or financing are added to them. For that very reason a
 * quoted price is set against the price paid only when the two stand on the
 * same ground:
 *
 *  - what is paid is the price on the invoice, taken as the goods at the plant;
 *  - a quote is comparable with it only when it is a cost to the plant too: an
 *    offer whose landed cost is complete, or a price quoted delivered (DDP, or
 *    DAP/DPU from inside the same customs area). Ex-works, FOB, CIF, a price
 *    whose terms nobody stated: NOT COMPARABLE — INSUFFICIENT DATA. No
 *    difference, no saving, no "lowest" is worked out from it, and no missing
 *    cost is read as zero;
 *  - a quote written for another grade or size than the product (56/58 for a
 *    52/54) is another product: not comparable, unless the user says so.
 */
import { basePrice, daysBetween, isPriced, type ProductData, type PurchaseData, type QuoteData, type SupplierData } from "../analytics";
import { compareIdentity, identityOf } from "../catalog/identity";
import { numbersOf } from "../catalog/specs";
import { en, type T } from "../i18n";
import { parseIncoterm } from "../import/normalize/terms";
import { normalizeKey } from "../import/normalize/text";
import { crossesCustoms } from "../sourcing/regions";
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
  /**
   * The price is a cost to the plant, like the price paid: a purchase, an offer with its landed cost complete, a
   * quote delivered with nothing left to add. False: transport, duties or the terms themselves are not known — the
   * row is "not comparable" for that reason alone, until a complete true cost says what it comes to.
   */
  deliveredBasis: boolean;
  /** How far it is the product bought, the delivery terms aside: what a complete true cost is judged with. */
  specComparability: Comparability;
  /** The user decided the comparability. */
  overridden: boolean;
  specsKnown: boolean;
  /** The price is a whole cost to the plant (an offer read from the replies, with its landed cost complete): transport and import costs are in it. */
  landed: boolean;
  /** A person validated that the offer is technically the product. */
  validated: boolean;
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
  /** The buyer's country: says whether a price quoted "delivered" still has customs to pay. Unknown: it is not assumed away. */
  homeCountry?: string | null;
}

/** Terms under which the seller brings the goods to the buyer's door. */
const TO_THE_DOOR = new Set(["DAP", "DPU", "DDP"]);

/**
 * Whether a quoted price is a cost to the buyer's plant — and when it is not, what is missing, in words. Nothing is
 * assumed: terms nobody stated are unknown, and a delivered price from a country that may be across customs is not
 * taken as duty-free.
 */
export function deliveredBasis(
  quote: Pick<QuoteData, "incoterm" | "landed">,
  supplierCountry: string | null,
  /** The buyer's country — or, when it is not on file, the country the product is bought from today: a supplier of that same country stands where today's does. */
  homeCountry: string | null | undefined,
  t: T = en,
): { delivered: boolean; why: string | null } {
  if (quote.landed) return { delivered: true, why: null };
  const incoterm = parseIncoterm(quote.incoterm);
  if (!incoterm) return { delivered: false, why: t("the delivery terms are not stated, so it is not known what the price includes") };
  if (!TO_THE_DOOR.has(incoterm)) return { delivered: false, why: t("quoted {incoterm}: transport to your plant, and what comes with it, is not in the price", { incoterm }) };
  if (incoterm === "DDP") return { delivered: true, why: null };
  const customs = crossesCustoms(supplierCountry, homeCountry);
  if (customs === false) return { delivered: true, why: null };
  return { delivered: false, why: customs == null ? t("quoted {incoterm}, but the supplier's country or yours is not on file: it is not known whether duties are due", { incoterm }) : t("quoted {incoterm} from outside your customs area: duties and clearance are not in the price", { incoterm }) };
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

  // Where the product comes from today: with the buyer's own country not on file, it is the ground the price paid stands on.
  const paidFrom = input.suppliers.find((s) => s.id === input.currentSupplierId)?.country ?? null;

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
    // The ground the price stands on: a purchase is an invoice price like the one paid; a quote must be a cost to the plant.
    const basis = useQuote && !isCurrent ? deliveredBasis(quote!, supplier.country, input.homeCountry ?? paidFrom, t) : { delivered: true, why: null };
    // The grade or size the quote was written for, when its own words state one: another one is another product.
    const quoted = useQuote && !isCurrent && !quote!.validated && quote!.originalDescription ? identityOf(quote!.originalDescription, { names: [supplier.name] }) : null;
    const otherGrade = !!quoted && quoted.numbers.length > 0 && compareIdentity(quoted, identityOf(product.name)).match === "other_spec";
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
      if (otherGrade) {
        comparability = "not";
        reasons.push(t("Another grade or size: quoted for {theirs}, you buy {ours}. Not the same product", { theirs: quoted!.numbers.join("/"), ours: numbersOf(product.name).join("/") }));
      }
      if (diffs.length && comparability !== "not") {
        comparability = "partial";
        reasons.push(t("Specification difference: {list}", { list: diffs.map((d) => t("{name} {theirs} vs {ours}", { name: d.name, theirs: d.theirs, ours: d.ours })).join(", ") }));
      }
      if (comparability !== "not" && moq != null && input.typicalOrderQuantity != null && moq > input.typicalOrderQuantity * cfg.moqToleranceFactor) {
        comparability = "partial";
        const n = (v: number) => v.toLocaleString("it-IT", { useGrouping: "always", maximumFractionDigits: 2 });
        reasons.push(t("MOQ {moq} {unit} is above your typical order of {typical} {unit}", { moq: n(moq), typical: n(input.typicalOrderQuantity), unit: product.unit }));
      }
    }
    // A missing price, an unknown exchange rate or an unconvertible unit can't be overridden into "comparable".
    const hardBlock = price == null || fxRequired;
    const specComparability: Comparability = !isCurrent && link?.comparabilityOverride && (!hardBlock || link.comparabilityOverride === "not") ? link.comparabilityOverride : comparability;
    if (!isCurrent && link?.comparabilityOverride && (!hardBlock || link.comparabilityOverride === "not")) {
      // Otherwise the user's judgement wins.
      comparability = link.comparabilityOverride;
      overridden = true;
      reasons.unshift(link.comparabilityNote ? t("Set by you: {note}", { note: link.comparabilityNote }) : t("Set by you"));
    }

    // Not a cost to the plant: whatever else is true of it, it is not set against the price paid. This is not a
    // judgement the user can overrule — it is data that is missing; a complete true cost is what settles it.
    if (!basis.delivered && price != null && !fxRequired) {
      comparability = "not";
      reasons.unshift(t("NOT COMPARABLE — INSUFFICIENT DATA: {why}", { why: basis.why ?? "" }));
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
      deliveredBasis: basis.delivered,
      specComparability,
      overridden,
      specsKnown,
      landed: useQuote && quote?.landed === true,
      validated: useQuote && quote?.validated === true,
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
