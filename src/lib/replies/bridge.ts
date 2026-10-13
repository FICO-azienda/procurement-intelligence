/**
 * The bridge from the replies to the analysis: an offer that passed every
 * check — tied to a product, technically validated by a person, within its
 * date, in the product's unit, with a complete cost to the plant — is read by
 * Compare, the market view, negotiation and the sourcing strategy as a quote.
 *
 * Rules that must hold:
 *  - it is read, never copied: no row is written to `quotes` or `suppliers`.
 *    The offer stays the one source — when it expires, is superseded, is
 *    untied or loses its validation, it is no longer a quote for anybody, at
 *    the same instant and everywhere;
 *  - only comparable offers cross (lib/replies/offers.ts: `groupOf`). Anything
 *    short of that stays on the product's page among the offers to verify and
 *    enters no comparison, range or ranking;
 *  - what crosses is the cost to the plant, in euro, with everything the
 *    landed cost counted (lib/replies/landed.ts) — so it is a delivered price
 *    with duties paid, and nothing is added to it again. The price as the
 *    company quoted it, in its own currency and terms, stays on the offer;
 *  - the company that answered is not turned into a supplier: when it is not
 *    one already, it is carried into the analysis as itself, marked as a
 *    company that answered a request, and never listed among the suppliers.
 */
import type { Dataset, QuoteData, SupplierData } from "../analytics";
import { parsePaymentTerms } from "../import/normalize/terms";

/** The source of a quote that is an offer read through the bridge. */
export const REPLY_SOURCE = "rfq_reply";
const QUOTE = "offer:";
const COMPANY = "reply:";

export const bridgedQuoteId = (offerId: string) => `${QUOTE}${offerId}`;
/** The offer behind a quote of the analysis, when the quote is one read through the bridge. */
export const offerIdOf = (quoteId: string | null | undefined) => (quoteId?.startsWith(QUOTE) ? quoteId.slice(QUOTE.length) : null);
export const replySupplierId = (companyId: string) => `${COMPANY}${companyId}`;
/** The company behind a supplier of the analysis, when it is a company that answered a request and not a supplier on file. */
export const replyCompanyIdOf = (supplierId: string | null | undefined) => (supplierId?.startsWith(COMPANY) ? supplierId.slice(COMPANY.length) : null);

export interface BridgeOffer {
  offerId: string;
  productId: string;
  company: { id: string; name: string; country: string | null; email: string | null; website: string | null };
  /** The supplier on file this company is — by what identifies it, or because a person said so. Null: it is not a supplier. */
  supplierId: string | null;
  productName: string;
  /** EUR per unit of the product, at the plant: the complete landed cost. */
  landedPerUnit: number;
  /** One figure in it is an estimate. */
  estimated: boolean;
  date: string;
  validUntil: string | null;
  quantity: number | null;
  moq: number | null;
  paymentTerms: string | null;
  /** The price as quoted, in words: what the landed cost was worked out from. */
  quoted: string;
}

/**
 * The dataset the analysis reads: the one on file, plus the comparable
 * offers as quotes and — for the companies that are no supplier on file —
 * the companies themselves. The dataset on file is not touched.
 */
export function bridgeDataset(data: Dataset, offers: BridgeOffer[]): Dataset {
  const live = offers.filter((o) => data.products.some((p) => p.id === o.productId));
  if (!live.length) return data;
  const known = new Set(data.suppliers.map((s) => s.id));
  const companies = new Map<string, SupplierData>();
  const quotes: QuoteData[] = live.map((o) => {
    const supplierId = o.supplierId && known.has(o.supplierId) ? o.supplierId : replySupplierId(o.company.id);
    if (!known.has(supplierId) && !companies.has(supplierId))
      companies.set(supplierId, { id: supplierId, name: o.company.name, country: o.company.country, city: null, vatNumber: null, contactName: null, email: o.company.email, phone: null, website: o.company.website, currency: "EUR", paymentTermsDays: null, defaultLeadTimeDays: null, notes: null });
    return {
      id: bridgedQuoteId(o.offerId),
      productId: o.productId,
      supplierId,
      date: o.date,
      quantity: o.quantity,
      unitPrice: o.landedPerUnit,
      currency: "EUR",
      // Already in euro: the conversion, when there was one, is in the landed cost, with its rate and its date.
      fxRate: 1,
      moq: o.moq,
      leadTimeDays: null,
      paymentTermsDays: parsePaymentTerms(o.paymentTerms),
      // Everything to the plant is in the figure: nothing is to be added for transport, duty or clearance.
      incoterm: "DDP",
      freightCost: null,
      validUntil: o.validUntil,
      originalDescription: o.productName,
      source: REPLY_SOURCE,
      sourceDoc: null,
      notes: o.quoted,
      landed: true,
      validated: true,
    };
  });
  return { ...data, suppliers: [...data.suppliers, ...companies.values()], quotes: [...data.quotes, ...quotes] };
}
