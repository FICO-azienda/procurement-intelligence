/**
 * Data quality of a product's price information — shown next to the numbers
 * so that two purchases from last year are not read with the same trust as
 * thirty from this quarter.
 */
import { daysBetween } from "../analytics";
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

export function dataQuality(i: QualityInput, cfg: IntelConfig = INTEL_CONFIG): DataQuality {
  const q = cfg.dataQuality;
  const factors: QualityFactor[] = [];
  const n = i.observations;
  factors.push({
    label: "Price observations",
    state: n >= q.highObservations ? "ok" : n >= q.mediumObservations ? "caution" : "poor",
    detail: `${n} comparable purchase${n === 1 ? "" : "s"}`,
  });

  if (!i.lastPurchaseDate) {
    factors.push({ label: "Recency", state: "poor", detail: "No purchases recorded" });
  } else {
    const days = Math.max(0, daysBetween(i.lastPurchaseDate, i.asOf));
    factors.push({
      label: "Recency",
      state: days <= q.freshDays ? "ok" : days <= q.staleDays ? "caution" : "poor",
      detail: `Last purchase ${days} days ago`,
    });
  }

  factors.push(
    i.unitMismatch
      ? { label: "Units", state: "poor", detail: `${i.unitMismatch} purchase${i.unitMismatch > 1 ? "s" : ""} in a unit that can't be converted` }
      : { label: "Units", state: "ok", detail: "All purchases in a comparable unit" },
  );
  factors.push(
    i.fxMissing
      ? { label: "Currency", state: "caution", detail: `${i.fxMissing} purchase${i.fxMissing > 1 ? "s" : ""} without an exchange rate` }
      : { label: "Currency", state: "ok", detail: "All purchases comparable in EUR" },
  );
  if (i.quantityMissing) {
    factors.push({ label: "Quantities", state: "caution", detail: `${i.quantityMissing} purchase${i.quantityMissing > 1 ? "s" : ""} without a quantity` });
  }
  if (i.openOutliers) {
    factors.push({ label: "Anomalies", state: "caution", detail: `${i.openOutliers} price${i.openOutliers > 1 ? "s" : ""} flagged as possible data errors` });
  }
  if (!i.hasSupplier) factors.push({ label: "Supplier", state: "caution", detail: "No current supplier set" });

  const level: Quality = factors.some((f) => f.state === "poor") ? "low" : factors.some((f) => f.state === "caution") ? "medium" : "high";
  return { level, factors };
}
