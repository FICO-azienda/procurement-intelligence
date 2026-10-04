import type { Msg } from "../i18n";

/**
 * The one status of a product, the same everywhere in the app. Kept here,
 * away from the engine, so a badge can name it without loading the engine.
 */
export type DecisionStatus = "action" | "review" | "needs_classification" | "needs_cost" | "needs_history" | "needs_alternative" | "ready" | "good";

export const DECISION_STATUS: Record<DecisionStatus, { label: Msg; meaning: Msg }> = {
  action: { label: "Action", meaning: "High-confidence opportunity worth reviewing." },
  review: { label: "Review|status", meaning: "Possible opportunity or unusual price movement." },
  needs_classification: { label: "To classify", meaning: "Its name and category still come from the invoice: confirm what it is." },
  needs_cost: { label: "Needs cost data", meaning: "No purchase price on record yet." },
  needs_history: { label: "Needs history", meaning: "No purchase in the last 6 months: the price may be outdated." },
  needs_alternative: { label: "Needs alternative", meaning: "It weighs on your spend, or has offers on file, but nothing recent and comparable to judge the price with." },
  ready: { label: "Ready|status", meaning: "Price and supplier known. No other offer to compare with yet — which is not a problem." },
  good: { label: "Good", meaning: "No significant issue identified." },
};

/** Something is missing before the price can be judged. A product that is only "ready" misses nothing. */
export const DATA_GAPS: DecisionStatus[] = ["needs_classification", "needs_cost", "needs_history", "needs_alternative"];
export const isDataGap = (status: DecisionStatus) => DATA_GAPS.includes(status);

/** Where the user is with an opportunity. No workflow: any status can follow any other. */
export const OPPORTUNITY_STATUSES = ["open", "reviewing", "negotiating", "validated", "rejected", "closed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
