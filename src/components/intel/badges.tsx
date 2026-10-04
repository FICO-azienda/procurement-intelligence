"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { AgeClass, Comparability } from "@/lib/intel/comparison";
import {
  AGE_LABEL,
  ALERT_LABEL,
  ALERT_SHORT,
  COMPARABILITY_LABEL,
  CONFIDENCE_LABEL,
  CONFIDENCE_LONG,
  OPPORTUNITY_STATUS_LABEL,
  QUALITY_LABEL,
  SOURCING_LABEL,
  TREND_LABEL,
} from "@/lib/intel/labels";
import type { Confidence } from "@/lib/intel/opportunities";
import type { AlertLevel, Sourcing } from "@/lib/intel/portfolio";
import type { Trend } from "@/lib/intel/price-metrics";
import type { Quality } from "@/lib/intel/quality";
import { DECISION_STATUS, type DecisionStatus, type OpportunityStatus } from "@/lib/intel/statuses";
import { cx } from "../ui";

/**
 * Colour is reserved for meaning: red = price increase / problem,
 * green = price decrease, orange = needs review. Everything else is neutral.
 * The names come from lib/intel/labels.ts; here they get a colour and the
 * reader's language.
 */
const pill = "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium whitespace-nowrap";

/** Three-step meter: filled dots = level. Neutral on purpose. */
function Meter({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex gap-[3px]" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cx("size-1.5 rounded-full", i <= level ? "bg-current" : "bg-current opacity-20")} />
      ))}
    </span>
  );
}

const CONF: Record<Confidence, { level: 1 | 2 | 3; className: string }> = {
  high: { level: 3, className: "bg-wash text-ink" },
  medium: { level: 2, className: "bg-wash text-ink-2" },
  low: { level: 1, className: "bg-caution-wash text-caution" },
};

/** `long`: "High confidence" instead of "High". */
export function ConfidenceBadge({ level, long }: { level: Confidence | null; long?: boolean }) {
  const t = useT();
  if (!level) return <span className="text-ink-4">—</span>;
  const c = CONF[level];
  return (
    <span className={cx(pill, c.className)}>
      <Meter level={c.level} />
      {t((long ? CONFIDENCE_LONG : CONFIDENCE_LABEL)[level])}
    </span>
  );
}

const COMP: Record<Comparability, string> = {
  comparable: "bg-wash text-ink-2",
  partial: "bg-caution-wash text-caution",
  not: "border border-dashed border-rule-strong text-ink-3",
};

export function ComparabilityBadge({ level }: { level: Comparability }) {
  const t = useT();
  return <span className={cx(pill, COMP[level])}>{t(COMPARABILITY_LABEL[level])}</span>;
}

const ALERT: Record<AlertLevel, string> = {
  moderate: "bg-up-wash text-up",
  high: "bg-up/15 text-up",
  critical: "bg-up text-white",
};

export function AlertBadge({ level, short }: { level: AlertLevel | null; short?: boolean }) {
  const t = useT();
  if (!level) return null;
  return <span className={cx(pill, ALERT[level])}>{t(short ? ALERT_SHORT[level] : ALERT_LABEL[level])}</span>;
}

const SOURCING: Record<Sourcing, string> = {
  single: "bg-caution-wash text-caution",
  dual: "bg-wash text-ink-2",
  multi: "bg-wash text-ink-2",
  none: "bg-wash text-ink-3",
};

export function SourcingBadge({ sourcing }: { sourcing: Sourcing }) {
  const t = useT();
  return <span className={cx(pill, SOURCING[sourcing])}>{t(SOURCING_LABEL[sourcing])}</span>;
}

export function QualityBadge({ level }: { level: Quality }) {
  const t = useT();
  const map = { high: [3, "bg-wash text-ink"], medium: [2, "bg-wash text-ink-2"], low: [1, "bg-caution-wash text-caution"] } as const;
  const [n, cls] = map[level];
  return (
    <span className={cx(pill, cls)}>
      <Meter level={n} />
      {t(QUALITY_LABEL[level])}
    </span>
  );
}

export function TrendTag({ trend }: { trend: Trend | null }) {
  const t = useT();
  if (!trend) return <span className="text-ink-4">{t("Not enough purchases")}</span>;
  const map = {
    increasing: [ArrowUpRight, "text-up"],
    stable: [ArrowRight, "text-ink-2"],
    decreasing: [ArrowDownRight, "text-down"],
  } as const;
  const [Icon, cls] = map[trend];
  return (
    <span className={cx("inline-flex items-center gap-1 font-medium", cls)}>
      <Icon size={14} strokeWidth={2} /> {t(TREND_LABEL[trend])}
    </span>
  );
}

export function AgeTag({ age, days, expired }: { age: AgeClass | null; days: number | null; expired?: boolean }) {
  const t = useT();
  if (days == null || !age) return <span className="text-ink-4">—</span>;
  return (
    <span className={cx("whitespace-nowrap", expired || age === "old" ? "text-caution" : "text-ink-3")}>
      {days === 0 ? t("today") : t.n(days, "{n} day", "{n} days")} · {t(AGE_LABEL[expired ? "expired" : age])}
    </span>
  );
}

const STATUS: Record<OpportunityStatus, string> = {
  open: "bg-ledger-wash text-ledger",
  reviewing: "bg-wash text-ink-2",
  negotiating: "bg-caution-wash text-caution",
  validated: "bg-down-wash text-down",
  rejected: "bg-wash text-ink-3",
  closed: "bg-wash text-ink-3",
};

export function OpportunityStatusBadge({ status }: { status: OpportunityStatus }) {
  const t = useT();
  return <span className={cx(pill, STATUS[status])}>{t(OPPORTUNITY_STATUS_LABEL[status])}</span>;
}

const DECISION: Record<DecisionStatus, string> = {
  action: "bg-ledger text-white",
  review: "bg-caution-wash text-caution",
  needs_classification: "border border-dashed border-caution/60 text-caution",
  needs_cost: "border border-dashed border-rule-strong text-ink-3",
  needs_history: "border border-dashed border-rule-strong text-ink-3",
  needs_alternative: "border border-dashed border-rule-strong text-ink-2",
  ready: "bg-wash text-ink-2",
  good: "bg-down-wash text-down",
};

/**
 * The one status of a product, the same everywhere in the app:
 * Action · Review · what is still missing (to classify, cost, history, alternative) · Ready · Good.
 */
export function DecisionStatusPill({ status }: { status: DecisionStatus }) {
  const t = useT();
  return (
    <span className={cx(pill, "tracking-[0.02em] uppercase", DECISION[status])} title={t(DECISION_STATUS[status].meaning)}>
      {t(DECISION_STATUS[status].label)}
    </span>
  );
}
