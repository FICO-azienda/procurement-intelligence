/**
 * What a price is, for the purpose of who may see it.
 *
 * A price on a buyer's invoice is that buyer's private transaction: it is
 * never shown outside the account that loaded it, and never turned into
 * "supplier X sells at…" for someone else. The same holds for the offers a
 * buyer received and for everything worked out from them — the achievable
 * range and the target are built on private prices, so they are private too.
 * What can be shown about a supplier to anyone is only what the supplier
 * itself publishes or authorizes, or a benchmark aggregated enough to name
 * nobody.
 *
 * The app has one company per database today. The classes are kept on every
 * price the negotiation engine uses, and on every stored estimate, so that
 * the day several buyers share a platform nothing has to be reclassified.
 */
import type { Msg } from "../i18n";
import type { PriceType } from "../sourcing/types";

export const PRICE_DATA_CLASSES = ["private_purchase_price", "real_quote", "supplier_published_price", "anonymized_benchmark", "trade_benchmark", "model_estimate", "negotiation_target", "realized_price"] as const;
export type PriceDataClass = (typeof PRICE_DATA_CLASSES)[number];
export const isPriceDataClass = (v: unknown): v is PriceDataClass => typeof v === "string" && (PRICE_DATA_CLASSES as readonly string[]).includes(v);

/** account: only the buyer that owns it. public: published by its source, or an aggregate that names no buyer. */
export type Visibility = "account" | "public";

export const DATA_CLASS: Record<PriceDataClass, { label: Msg; visibility: Visibility; meaning: Msg }> = {
  private_purchase_price: { label: "Private purchase price", visibility: "account", meaning: "A price from your invoices: your own transaction." },
  real_quote: { label: "Real quote", visibility: "account", meaning: "An offer a supplier made to you." },
  supplier_published_price: { label: "Supplier-published price", visibility: "public", meaning: "A price the supplier itself publishes." },
  anonymized_benchmark: { label: "Published benchmark", visibility: "public", meaning: "A published or aggregated reference that names no buyer." },
  trade_benchmark: { label: "Trade benchmark", visibility: "public", meaning: "Official import and export statistics." },
  model_estimate: { label: "Model estimate", visibility: "account", meaning: "Worked out by the software from your own data." },
  negotiation_target: { label: "Negotiation target", visibility: "account", meaning: "The price suggested as the aim of a negotiation." },
  realized_price: { label: "Realized price", visibility: "account", meaning: "A price really paid after a negotiation." },
};

/** The class of each kind of price the app already keeps. */
const FROM_PRICE_TYPE: Record<PriceType, PriceDataClass> = {
  actual: "private_purchase_price",
  quote: "real_quote",
  internal_range: "real_quote",
  direct_benchmark: "anonymized_benchmark",
  trade_benchmark: "trade_benchmark",
  cost_driver: "anonymized_benchmark",
  indicative: "supplier_published_price",
  estimate: "model_estimate",
};
export const dataClassOf = (type: PriceType): PriceDataClass => FROM_PRICE_TYPE[type];

export const isPublic = (c: PriceDataClass) => DATA_CLASS[c].visibility === "public";

/** Anything worked out from several prices is as private as the most private of them. */
export const derivedVisibility = (classes: PriceDataClass[]): Visibility => (classes.length > 0 && classes.every(isPublic) ? "public" : "account");

/** Of a set of price facts, the ones that may be shown outside the account that owns them. */
export const publicOnly = <X extends { dataClass: PriceDataClass }>(items: X[]): X[] => items.filter((x) => isPublic(x.dataClass));
