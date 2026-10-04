/** The steps of a research, as they are named to the user when the details are opened. */
import type { Msg } from "../i18n";

export const STEPS = ["understand", "queries", "discover", "inspect", "pricing", "trade", "conclude", "imported"] as const;
export type StepKey = (typeof STEPS)[number];

export const STEP_LABEL: Record<StepKey, Msg> = {
  understand: "Understand the product",
  queries: "Prepare the searches",
  discover: "Look for possible suppliers",
  inspect: "Check the suppliers' own sites",
  pricing: "Collect price evidence",
  trade: "Trade statistics",
  conclude: "Conclusions and next step",
  imported: "Research loaded from outside",
};

export type StepStatus = "done" | "skipped" | "not_configured" | "failed";
export const STEP_STATUS_LABEL: Record<StepStatus, Msg> = { done: "Done|step", skipped: "Skipped", not_configured: "Not configured", failed: "Failed|step" };

export const EVIDENCE_TYPES = ["supplier", "product", "price", "specification", "benchmark", "trade", "freight", "tariff", "fx", "other"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, Msg> = {
  supplier: "Supplier|evidence",
  product: "Product|evidence",
  price: "Price|evidence",
  specification: "Specification|evidence",
  benchmark: "Benchmark|evidence",
  trade: "Trade data|evidence",
  freight: "Freight|evidence",
  tariff: "Duties|evidence",
  fx: "Exchange rate|evidence",
  other: "Other|evidence",
};
export const isEvidenceType = (v: unknown): v is EvidenceType => typeof v === "string" && (EVIDENCE_TYPES as readonly string[]).includes(v);

export const RUN_STATUS_LABEL: Record<string, Msg> = { running: "Running|run", completed: "Completed|run", partial: "Completed in part", failed: "Failed|run" };
