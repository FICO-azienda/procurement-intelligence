import type { T } from "@/lib/i18n";
import { REPLY_STATUS_LABEL, REPLY_STATUS_MEANING, type ReplyStatus } from "@/lib/replies/types";
import { cx } from "../ui";

const TONE: Record<ReplyStatus, string> = {
  quote_received: "bg-ledger-wash text-ledger",
  needs_information: "bg-caution-wash text-caution",
  awaiting_reply: "bg-wash text-ink-2",
  technical_validation_required: "border border-caution/30 text-caution",
  not_suitable: "bg-wash text-ink-3",
};

/** Where a conversation stands — the same pill on the list and on the company's page. */
export function ReplyStatusPills({ statuses, t }: { statuses: ReplyStatus[]; t: T }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {statuses.map((s) => (
        <span key={s} title={t(REPLY_STATUS_MEANING[s])} className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap", TONE[s])}>
          {t(REPLY_STATUS_LABEL[s])}
        </span>
      ))}
    </span>
  );
}
