"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordProductRelationAction, withdrawProductRelationAction, type SimpleResult } from "@/app/actions";
import { NEEDS_APPLICATION, RELATION_TYPES, RELATION_TYPE_LABEL, type RelationType } from "@/lib/catalog/technical";
import { useT } from "@/lib/i18n/client";
import { Input } from "../form-kit";
import { buttonClass } from "../ui";

function useRun() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<SimpleResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      after?.();
      router.refresh();
    });
  return { pending, run, error, t };
}

/**
 * What a person says two products are to each other. An equivalence validated or a technical alternative is said for
 * a use and with the reason; the app only proposed it.
 */
export function RelationDecision({ productId, otherId, initial = "possible_equivalent" }: { productId: string; otherId: string; initial?: RelationType }) {
  const { pending, run, error, t } = useRun();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<RelationType>(initial);
  const [application, setApplication] = useState("");
  const [reason, setReason] = useState("");
  const needs = NEEDS_APPLICATION.includes(type);
  if (!open)
    return (
      <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setOpen(true)}>
        {t("Say what it is")}
      </button>
    );
  return (
    <div className="mt-2 flex w-full flex-col gap-2 rounded-md bg-wash p-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label={t("What it is to this product")} className="h-8 rounded-md border border-rule-strong bg-canvas px-2 text-[13px]" value={type} onChange={(e) => setType(e.target.value as RelationType)}>
          {RELATION_TYPES.map((r) => (
            <option key={r} value={r}>
              {t(RELATION_TYPE_LABEL[r])}
            </option>
          ))}
        </select>
        {needs && <Input aria-label={t("For which use")} placeholder={t("For which use")} value={application} onChange={(e) => setApplication(e.target.value)} className="h-8 max-w-[220px]" />}
        <Input aria-label={t("Why")} placeholder={needs ? t("Why: data sheet, sample, test") : t("Why")} value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 min-w-[200px] flex-1" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("primary", "sm")} disabled={pending || (needs && (!application.trim() || !reason.trim()))} onClick={() => run(() => recordProductRelationAction(productId, otherId, { type, application, reason }), () => setOpen(false))}>
          {t("Save")}
        </button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
          {t("Cancel")}
        </button>
        {error && (
          <span role="alert" className="text-[12.5px] text-up">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

export function WithdrawRelation({ id }: { id: string }) {
  const { pending, run, error, t } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-[12.5px] font-medium text-ledger hover:underline disabled:opacity-50" disabled={pending} onClick={() => run(() => withdrawProductRelationAction(id))}>
        {t("Take back")}
      </button>
      {error && <span className="text-[12.5px] text-up">{error}</span>}
    </span>
  );
}
