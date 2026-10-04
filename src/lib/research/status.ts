/**
 * Where a product stands in its research, in one word: from "not researched"
 * to "validated". Read from what is on file — the runs, the candidates and
 * their statuses, the evidence — never set by hand.
 */
import type { Msg } from "../i18n";
import type { MarketView } from "../sourcing/market";

export const RESEARCH_STATUSES = ["not_researched", "researching", "no_evidence", "suppliers_found", "market_data", "rfq_needed", "awaiting_quotes", "quotes_received", "opportunity", "validated"] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const RESEARCH_STATUS: Record<ResearchStatus, { label: Msg; meaning: Msg }> = {
  not_researched: { label: "Not researched", meaning: "No research has been run and nothing is on file yet." },
  researching: { label: "Researching", meaning: "A research is running." },
  no_evidence: { label: "Nothing found", meaning: "Researched: no supplier and no market evidence could be found. Ask the suppliers you know for a quote." },
  suppliers_found: { label: "Suppliers found", meaning: "Possible suppliers found through research: not validated yet. Review them and choose who to ask." },
  market_data: { label: "Market data found", meaning: "There is outside price evidence on file, and no alternative supplier yet." },
  rfq_needed: { label: "RFQ needed", meaning: "You validated at least one candidate: the next step is to request quotes." },
  awaiting_quotes: { label: "Waiting for quotes", meaning: "Requests sent: the comparison waits for the answers." },
  quotes_received: { label: "Quotes received", meaning: "At least one quote has arrived: record it and check that it is comparable." },
  opportunity: { label: "Opportunity to validate", meaning: "Your price is above the comparable evidence: a gap to confirm, not a saving yet." },
  validated: { label: "Validated|sourcing", meaning: "A comparable quote has been received and checked." },
};

export interface RunState {
  status: string;
  startedAt: string;
}

/** A run still marked as running long after it started did not finish: the server stopped, or the page was closed. */
export const isRunning = (run: RunState | null, now: Date, staleMinutes: number) => !!run && run.status === "running" && now.getTime() - new Date(run.startedAt).getTime() < staleMinutes * 60_000;

export function researchStatus(view: MarketView, run: RunState | null, now: Date, staleMinutes: number): ResearchStatus {
  if (isRunning(run, now, staleMinutes)) return "researching";
  if (view.status === "validated") return "validated";
  if (view.status === "opportunity") return "opportunity";
  const active = view.candidates.filter((r) => r.candidate.status !== "rejected").map((r) => r.candidate.status);
  if (active.includes("quote_received") || view.observations.some((o) => o.type === "quote")) return "quotes_received";
  if (active.includes("quote_requested") || active.includes("contacted")) return "awaiting_quotes";
  if (active.includes("validated") || active.includes("converted")) return "rfq_needed";
  if (active.length) return "suppliers_found";
  if (view.range || view.observations.some((o) => o.key.startsWith("benchmark:"))) return "market_data";
  return run ? "no_evidence" : "not_researched";
}

/** How pressing a product is in the review: what can be acted on first, the largest spend first within each. */
const ACTION_ORDER: ResearchStatus[] = ["opportunity", "quotes_received", "rfq_needed", "suppliers_found", "awaiting_quotes", "market_data", "not_researched", "no_evidence", "researching", "validated"];
export const byActionability = (a: { status: ResearchStatus; view: MarketView }, b: { status: ResearchStatus; view: MarketView }) =>
  (b.view.opportunity?.high ?? 0) - (a.view.opportunity?.high ?? 0) || b.view.history.annualSpend - a.view.history.annualSpend || ACTION_ORDER.indexOf(a.status) - ACTION_ORDER.indexOf(b.status);
