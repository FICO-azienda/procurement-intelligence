import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { OpportunityStatus } from "@/lib/intel/statuses";
import type { AgeClass, Comparability } from "@/lib/intel/comparison";
import type { Confidence } from "@/lib/intel/opportunities";
import type { AlertLevel, Sourcing } from "@/lib/intel/portfolio";
import type { Trend } from "@/lib/intel/price-metrics";
import type { Quality } from "@/lib/intel/quality";
import { cx } from "../ui";

/**
 * Colour is reserved for meaning: red = price increase / problem,
 * green = price decrease, orange = needs review. Everything else is neutral.
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

const CONF: Record<Confidence, { label: string; level: 1 | 2 | 3; className: string }> = {
  high: { label: "High", level: 3, className: "bg-wash text-ink" },
  medium: { label: "Medium", level: 2, className: "bg-wash text-ink-2" },
  low: { label: "Low", level: 1, className: "bg-caution-wash text-caution" },
};

export function ConfidenceBadge({ level, suffix = "" }: { level: Confidence | null; suffix?: string }) {
  if (!level) return <span className="text-ink-4">—</span>;
  const c = CONF[level];
  return (
    <span className={cx(pill, c.className)}>
      <Meter level={c.level} />
      {c.label}
      {suffix}
    </span>
  );
}

const COMP: Record<Comparability, { label: string; className: string }> = {
  comparable: { label: "Comparable", className: "bg-wash text-ink-2" },
  partial: { label: "Partially comparable", className: "bg-caution-wash text-caution" },
  not: { label: "Not comparable", className: "border border-dashed border-rule-strong text-ink-3" },
};

export function ComparabilityBadge({ level }: { level: Comparability }) {
  const c = COMP[level];
  return <span className={cx(pill, c.className)}>{c.label}</span>;
}

const ALERT: Record<AlertLevel, { label: string; className: string }> = {
  moderate: { label: "Moderate increase", className: "bg-up-wash text-up" },
  high: { label: "High increase", className: "bg-up/15 text-up" },
  critical: { label: "Critical increase", className: "bg-up text-white" },
};

export function AlertBadge({ level, short }: { level: AlertLevel | null; short?: boolean }) {
  if (!level) return null;
  const a = ALERT[level];
  return <span className={cx(pill, a.className)}>{short ? a.label.replace(" increase", "") : a.label}</span>;
}

const SOURCING: Record<Sourcing, { label: string; className: string }> = {
  single: { label: "Single-source", className: "bg-caution-wash text-caution" },
  dual: { label: "Dual-source", className: "bg-wash text-ink-2" },
  multi: { label: "Multi-source", className: "bg-wash text-ink-2" },
  none: { label: "No purchases", className: "bg-wash text-ink-3" },
};

export function SourcingBadge({ sourcing }: { sourcing: Sourcing }) {
  const s = SOURCING[sourcing];
  return <span className={cx(pill, s.className)}>{s.label}</span>;
}

export function QualityBadge({ level }: { level: Quality }) {
  const map = { high: ["High", 3, "bg-wash text-ink"], medium: ["Medium", 2, "bg-wash text-ink-2"], low: ["Low", 1, "bg-caution-wash text-caution"] } as const;
  const [label, n, cls] = map[level];
  return (
    <span className={cx(pill, cls)}>
      <Meter level={n} />
      {label}
    </span>
  );
}

export function TrendTag({ trend }: { trend: Trend | null }) {
  if (!trend) return <span className="text-ink-4">Not enough purchases</span>;
  const map = {
    increasing: ["Increasing", ArrowUpRight, "text-up"],
    stable: ["Stable", ArrowRight, "text-ink-2"],
    decreasing: ["Decreasing", ArrowDownRight, "text-down"],
  } as const;
  const [label, Icon, cls] = map[trend];
  return (
    <span className={cx("inline-flex items-center gap-1 font-medium", cls)}>
      <Icon size={14} strokeWidth={2} /> {label}
    </span>
  );
}

export function AgeTag({ age, days, expired }: { age: AgeClass | null; days: number | null; expired?: boolean }) {
  if (days == null || !age) return <span className="text-ink-4">—</span>;
  const label = expired ? "Expired" : age === "fresh" ? "Fresh" : age === "recent" ? "Recent" : "Old";
  return (
    <span className={cx("whitespace-nowrap", expired || age === "old" ? "text-caution" : "text-ink-3")}>
      {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`} · {label}
    </span>
  );
}

const STATUS: Record<OpportunityStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-ledger-wash text-ledger" },
  reviewing: { label: "Reviewing", className: "bg-wash text-ink-2" },
  negotiating: { label: "Negotiating", className: "bg-caution-wash text-caution" },
  validated: { label: "Validated", className: "bg-down-wash text-down" },
  rejected: { label: "Rejected", className: "bg-wash text-ink-3" },
  closed: { label: "Closed", className: "bg-wash text-ink-3" },
};

export const OPPORTUNITY_STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label])) as Record<OpportunityStatus, string>;

export function OpportunityStatusBadge({ status }: { status: OpportunityStatus }) {
  const s = STATUS[status];
  return <span className={cx(pill, s.className)}>{s.label}</span>;
}
