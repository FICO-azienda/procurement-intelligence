/**
 * Data quality of a product's price information — shown next to the numbers
 * so that two purchases from last year are not read with the same trust as
 * thirty from this quarter.
 */
import { daysBetween } from "../analytics";
import { en, type T } from "../i18n";
import { INTEL_CONFIG, type IntelConfig } from "./config";

export type Quality = "high" | "medium" | "low";

export interface QualityFactor {
  label: string;
  state: "ok" | "caution" | "poor";
  detail: string;
}

export interface DataQuality {
  level: Quality;
  factors: QualityFactor[];
}

export interface QualityInput {
  /** Comparable price observations. */
  observations: number;
  lastPurchaseDate: string | null;
  /** Purchases whose unit can't be converted to the product's unit. */
  unitMismatch: number;
  /** Purchases without an exchange rate. */
  fxMissing: number;
  /** Purchases with no (or zero) quantity. */
  quantityMissing: number;
  /** Prices flagged as possible anomalies and not yet reviewed. */
  openOutliers: number;
  hasSupplier: boolean;
  asOf: string;
}

export function dataQuality(i: QualityInput, cfg: IntelConfig = INTEL_CONFIG, t: T = en): DataQuality {
  const q = cfg.dataQuality;
  const factors: QualityFactor[] = [];
  const n = i.observations;
  factors.push({
    label: t("Price observations"),
    state: n >= q.highObservations ? "ok" : n >= q.mediumObservations ? "caution" : "poor",
    detail: t.n(n, "{n} comparable purchase", "{n} comparable purchases"),
  });

  if (!i.lastPurchaseDate) {
    factors.push({ label: t("Recency"), state: "poor", detail: t("No purchases recorded") });
  } else {
    const days = Math.max(0, daysBetween(i.lastPurchaseDate, i.asOf));
    factors.push({
      label: t("Recency"),
      state: days <= q.freshDays ? "ok" : days <= q.staleDays ? "caution" : "poor",
      detail: t("Last purchase {days} days ago", { days }),
    });
  }

  factors.push(
    i.unitMismatch
      ? { label: t("Units"), state: "poor", detail: t.n(i.unitMismatch, "{n} purchase in a unit that can't be converted", "{n} purchases in a unit that can't be converted") }
      : { label: t("Units"), state: "ok", detail: t("All purchases in a comparable unit") },
  );
  factors.push(
    i.fxMissing
      ? { label: t("Currency"), state: "caution", detail: t.n(i.fxMissing, "{n} purchase without an exchange rate", "{n} purchases without an exchange rate") }
      : { label: t("Currency"), state: "ok", detail: t("All purchases comparable in EUR") },
  );
  if (i.quantityMissing) {
    factors.push({ label: t("Quantities"), state: "caution", detail: t.n(i.quantityMissing, "{n} purchase without a quantity", "{n} purchases without a quantity") });
  }
  if (i.openOutliers) {
    factors.push({ label: t("Anomalies"), state: "caution", detail: t.n(i.openOutliers, "{n} price flagged as possible data errors", "{n} prices flagged as possible data errors") });
  }
  if (!i.hasSupplier) factors.push({ label: t("Supplier"), state: "caution", detail: t("No current supplier set") });

  const level: Quality = factors.some((f) => f.state === "poor") ? "low" : factors.some((f) => f.state === "caution") ? "medium" : "high";
  return { level, factors };
}
