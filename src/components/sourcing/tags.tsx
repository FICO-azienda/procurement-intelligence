"use client";

import { useT } from "@/lib/i18n/client";
import { COMPARABILITY_LABEL, MATCH_LABEL, PRICE_TYPE_LABEL, PRICE_TYPE_MEANING, SOURCING_STATUS, type Comparability, type MatchStrength, type PriceType, type SourcingStatus } from "@/lib/sourcing/types";
import { RESEARCH_STATUS, type ResearchStatus } from "@/lib/research/status";
import { STAGE_LABEL, STAGE_MEANING, type FunnelStage } from "@/lib/sourcing/screening";
import { cx } from "../ui";

const tag = "inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase whitespace-nowrap";

/** A price that was paid is solid, an offer is tinted, anything from outside is outlined, an estimate is dashed. */
const PRICE_TONE: Record<PriceType, string> = {
  actual: "bg-ink text-white",
  quote: "bg-ledger-wash text-ledger",
  internal_range: "bg-ledger-wash text-ledger",
  direct_benchmark: "border border-ink/40 text-ink-2",
  trade_benchmark: "border border-ink/40 text-ink-2",
  cost_driver: "border border-rule-strong text-ink-3",
  indicative: "border border-dashed border-ink/40 text-ink-3",
  estimate: "border border-dashed border-ink/40 text-ink-3",
};

/** What kind of price a number is: the same label, the same look, wherever a price is shown. */
export function PriceTypeTag({ type }: { type: PriceType }) {
  const t = useT();
  return (
    <span className={cx(tag, PRICE_TONE[type])} title={t(PRICE_TYPE_MEANING[type])}>
      {t(PRICE_TYPE_LABEL[type])}
    </span>
  );
}

const pill = "inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap";

const STATUS_TONE: Record<SourcingStatus, string> = {
  no_market_data: "border border-dashed border-rule-strong text-ink-3",
  suppliers_found: "bg-wash text-ink-2",
  quotes_needed: "bg-caution-wash text-caution",
  benchmark_available: "bg-ledger-wash text-ledger",
  opportunity: "bg-ledger text-white",
  validated: "bg-down-wash text-down",
};

export function SourcingStatusPill({ status }: { status: SourcingStatus }) {
  const t = useT();
  return (
    <span className={cx(pill, STATUS_TONE[status])} title={t(SOURCING_STATUS[status].meaning)}>
      {t(SOURCING_STATUS[status].label)}
    </span>
  );
}

const RESEARCH_TONE: Record<ResearchStatus, string> = {
  not_researched: "border border-dashed border-rule-strong text-ink-3",
  researching: "bg-ledger-wash text-ledger",
  no_evidence: "border border-rule-strong text-ink-3",
  suppliers_found: "bg-wash text-ink-2",
  market_data: "bg-wash text-ink-2",
  rfq_needed: "bg-caution-wash text-caution",
  awaiting_quotes: "bg-caution-wash text-caution",
  quotes_received: "bg-ledger-wash text-ledger",
  opportunity: "bg-ledger text-white",
  validated: "bg-down-wash text-down",
};

/** Where a product stands in its research: the same word everywhere. */
export function ResearchStatusPill({ status }: { status: ResearchStatus }) {
  const t = useT();
  return (
    <span className={cx(pill, RESEARCH_TONE[status])} title={t(RESEARCH_STATUS[status].meaning)}>
      {t(RESEARCH_STATUS[status].label)}
    </span>
  );
}

const STAGE_TONE: Record<FunnelStage, string> = {
  strong: "bg-down-wash text-down",
  plausible: "bg-wash text-ink-2",
  discovered: "border border-dashed border-rule-strong text-ink-3",
  low_priority: "border border-rule-strong text-ink-3",
  not_suitable: "border border-rule-strong text-ink-4 line-through",
};

/** Where a candidate stands on the funnel, in words — never a score. */
export function StagePill({ stage }: { stage: FunnelStage }) {
  const t = useT();
  return (
    <span className={cx(pill, STAGE_TONE[stage])} title={t(STAGE_MEANING[stage])}>
      {t(STAGE_LABEL[stage])}
    </span>
  );
}

const MATCH_TONE: Record<MatchStrength, string> = { strong: "bg-down-wash text-down", possible: "bg-wash text-ink-2", needs_validation: "border border-dashed border-rule-strong text-ink-3" };

/** How well a possible supplier's product matches, in words — never a score. */
export function MatchPill({ strength }: { strength: MatchStrength }) {
  const t = useT();
  return <span className={cx(pill, MATCH_TONE[strength])}>{t(MATCH_LABEL[strength])}</span>;
}

const COMPARABILITY_TONE: Record<Comparability, string> = { comparable: "text-down", partial: "text-caution", not: "text-up" };

export function ComparabilityText({ level }: { level: Comparability | null }) {
  const t = useT();
  return <span className={cx("text-[12px] font-medium", level ? COMPARABILITY_TONE[level] : "text-ink-3")}>{level ? t(COMPARABILITY_LABEL[level]) : t("Comparability not checked")}</span>;
}
