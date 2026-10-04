/**
 * The names of the engine's categories, as messages. Pure, so both the
 * server (pages, CSV exports) and client components can use them; whoever
 * shows one translates it.
 */
import type { ProductStatus, SupplierStatus } from "../analytics";
import type { Msg } from "../i18n";
import type { AgeClass, Comparability } from "./comparison";
import type { Confidence } from "./opportunities";
import type { AlertLevel, Sourcing } from "./portfolio";
import type { Trend } from "./price-metrics";
import type { Quality } from "./quality";
import type { OpportunityStatus } from "./statuses";

export const CONFIDENCE_LABEL: Record<Confidence, Msg> = { high: "High", medium: "Medium", low: "Low" };
export const CONFIDENCE_LONG: Record<Confidence, Msg> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
export const QUALITY_LABEL: Record<Quality, Msg> = { high: "High", medium: "Medium", low: "Low" };

export const COMPARABILITY_LABEL: Record<Comparability, Msg> = {
  comparable: "Comparable",
  partial: "Partially comparable",
  not: "Not comparable",
};

export const ALERT_LABEL: Record<AlertLevel, Msg> = { moderate: "Moderate increase", high: "High increase", critical: "Critical increase" };
export const ALERT_SHORT: Record<AlertLevel, Msg> = { moderate: "Moderate|increase", high: "High|increase", critical: "Critical|increase" };

export const SOURCING_LABEL: Record<Sourcing, Msg> = { single: "Single-source", dual: "Dual-source", multi: "Multi-source", none: "No purchases" };

export const TREND_LABEL: Record<Trend, Msg> = { increasing: "Increasing", stable: "Stable", decreasing: "Decreasing" };

export const AGE_LABEL: Record<AgeClass | "expired", Msg> = { fresh: "Fresh", recent: "Recent", old: "Old", expired: "Expired" };

export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, Msg> = {
  open: "Open|status",
  reviewing: "Reviewing",
  negotiating: "Negotiating",
  validated: "Validated",
  rejected: "Rejected",
  closed: "Closed",
};

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, Msg> = { increase: "Price increase", stable: "Stable", review: "Review|status" };

export const SUPPLIER_STATUS_LABEL: Record<SupplierStatus, Msg> = {
  active: "Active",
  inactive: "No recent purchases",
  "quote-only": "Quotes only",
  new: "New",
};

/** Where a price comes from: paid, or only offered. */
export const KIND_LABEL: Record<"purchase" | "quote", Msg> = { purchase: "Actual", quote: "Quote|basis" };
