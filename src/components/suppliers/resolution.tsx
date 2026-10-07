"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { keepSuppliersSeparateAction, mergeSuppliersAction, undoSupplierMergeAction, type SimpleResult } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { MATCH_CONFIDENCE_LABEL, type MatchConfidence } from "@/lib/suppliers/resolve";
import { buttonClass, cx } from "../ui";

export interface DuplicateVM {
  keep: { id: string; name: string; detail: string };
  merge: { id: string; name: string; detail: string };
  why: string;
  confidence: MatchConfidence;
  conflicts: string[];
}

const TONE: Record<MatchConfidence, string> = { high: "bg-down-wash text-down", medium: "bg-caution-wash text-caution", low: "bg-wash text-ink-2" };

function useDecision() {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<SimpleResult>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      router.refresh();
    });
  return { pending, error, run, t };
}

/**
 * Two supplier records that may be one company. The user decides: merge —
 * both records stay, one is read as the other, and it can be taken back — or
 * keep them separate, and the pair is not proposed again.
 */
export function DuplicateSuggestion({ pair }: { pair: DuplicateVM }) {
  const { pending, error, run, t } = useDecision();
  // Which of the two stays: the fuller record is proposed, the user can turn it round.
  const [keepFirst, setKeepFirst] = useState(true);
  const keep = keepFirst ? pair.keep : pair.merge;
  const merge = keepFirst ? pair.merge : pair.keep;
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-rule px-5 py-3.5 last:border-b-0">
      <div className="min-w-[260px] flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
          <span className="font-medium">{merge.name}</span>
          <span className="text-ink-3">{t("may be the same company as")}</span>
          <span className="font-medium">{keep.name}</span>
        </div>
        <div className="mt-0.5 text-[12px] text-ink-3">
          {merge.detail} · {keep.detail}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-2">
          <span className={cx("inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase", TONE[pair.confidence])}>{t(MATCH_CONFIDENCE_LABEL[pair.confidence])}</span>
          <span>{pair.why}</span>
        </div>
        {pair.conflicts.map((c) => (
          <div key={c} className="mt-1 text-[12.5px] font-medium text-up">
            {c}
          </div>
        ))}
        {error && (
          <div role="alert" className="mt-1 text-[12.5px] text-up">
            {error}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => setKeepFirst((x) => !x)} title={t("Choose which of the two names stays")}>
          {t("Stays as “{name}” · switch", { name: keep.name })}
        </button>
        <button type="button" className={buttonClass("primary", "sm")} disabled={pending} onClick={() => run(() => mergeSuppliersAction(merge.id, keep.id))}>
          {t("Merge")}
        </button>
        <button type="button" className={buttonClass("secondary", "sm")} disabled={pending} onClick={() => run(() => keepSuppliersSeparateAction(merge.id, keep.id))}>
          {t("Keep separate")}
        </button>
      </div>
    </li>
  );
}

/** Takes a merge back: the record stands for itself again, with everything it always had. */
export function UndoMergeButton({ supplierId }: { supplierId: string }) {
  const { pending, error, run, t } = useDecision();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => run(() => undoSupplierMergeAction(supplierId))}>
        {t("Undo merge")}
      </button>
      {error && (
        <span role="alert" className="text-[12.5px] text-up">
          {error}
        </span>
      )}
    </span>
  );
}
