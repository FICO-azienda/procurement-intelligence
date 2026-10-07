"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveJudgementAction } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { JUDGEMENT_KEYS, JUDGEMENT_LABEL, LEVELS, LEVEL_LABEL, type Judgement, type JudgementKey } from "@/lib/negotiation/engine";
import * as f from "@/lib/format";
import { Input, Select } from "../form-kit";
import { buttonClass } from "../ui";

/**
 * What a person knows better than the rules: how hard it would be to change
 * supplier, how standard and how critical the product is. Each correction is
 * kept with its reason and date next to what the software had estimated, and
 * the estimate is worked out again with it.
 */
export function JudgementForm({ productId, judgements }: { productId: string; judgements: Record<JudgementKey, Judgement> }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const initial = Object.fromEntries(JUDGEMENT_KEYS.map((k) => [k, { level: judgements[k].user?.level ?? "", reason: judgements[k].user?.reason ?? "" }])) as Record<JudgementKey, { level: string; reason: string }>;
  const [v, setV] = useState(initial);
  const changed = JUDGEMENT_KEYS.filter((k) => v[k].level !== initial[k].level || v[k].reason !== initial[k].reason);
  const set = (key: JudgementKey, patch: Partial<{ level: string; reason: string }>) => {
    setSaved(false);
    setError(null);
    setV((x) => ({ ...x, [key]: { ...x[key], ...patch } }));
  };
  const save = () =>
    start(async () => {
      for (const key of changed) {
        const res = await saveJudgementAction(productId, key, v[key].level, v[key].reason);
        if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      }
      setSaved(true);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      {JUDGEMENT_KEYS.map((key) => {
        const j = judgements[key];
        return (
          <div key={key} className="grid gap-x-4 gap-y-1.5 @2xl:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)] @2xl:items-start">
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{t(JUDGEMENT_LABEL[key].label)}</div>
              <div className="text-[12px] text-ink-3">{t(JUDGEMENT_LABEL[key].question)}</div>
              <div className="mt-0.5 text-[12px] text-ink-3">
                {j.system ? t("The software's estimate: {level}.", { level: t(LEVEL_LABEL[j.system]).toLowerCase() }) : t("The software cannot tell.")} {j.systemWhy}
                {j.user && ` ${t("Corrected by you on {date}.", { date: f.date(j.user.date) })}`}
              </div>
            </div>
            <Select aria-label={t(JUDGEMENT_LABEL[key].label)} value={v[key].level} onChange={(e) => set(key, { level: e.target.value })}>
              <option value="">{j.system ? t("As estimated") : t("Not stated")}</option>
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(LEVEL_LABEL[level])}
                </option>
              ))}
            </Select>
            <Input aria-label={t("Reason")} value={v[key].reason} onChange={(e) => set(key, { reason: e.target.value })} placeholder={t("Why — e.g. it needs a production test")} disabled={!v[key].level} />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("secondary", "sm")} disabled={pending || !changed.length} onClick={save}>
          {pending ? t("Saving…") : t("Save and recalculate")}
        </button>
        {saved && <span className="text-[12.5px] text-down">{t("Saved: the estimate above uses it.")}</span>}
        {error && (
          <span role="alert" className="text-[12.5px] text-up">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
