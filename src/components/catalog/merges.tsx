"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { undoProductMergeAction, undoProductMergesAction, type SimpleResult } from "@/app/actions";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { Disclosure, buttonClass } from "../ui";

export interface MergeVM {
  id: string;
  kept: string;
  merged: string;
  date: string;
  /** Lines of the two products billed by one supplier on the same day: at different prices they are two products. */
  sameDay: { date: string; low: number; high: number; different: boolean } | null;
}

function useUndo() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<SimpleResult>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      router.refresh();
    });
  return { t, pending, error, run };
}

/**
 * Merges the invoices contradict: the two products were billed by the same
 * supplier on the same day at two prices, so they are two products. Shown
 * first and in full — a merged pair like this reads as a price that went up.
 */
export function MergesToUndo({ merges }: { merges: MergeVM[] }) {
  const { t, pending, error, run } = useUndo();
  const wrong = merges.filter((m) => m.sameDay?.different);
  if (!wrong.length) return null;
  return (
    <section role="alert" className="mb-6 rounded-lg border border-up/40 bg-canvas px-5 py-4">
      <h2 className="text-[15px] font-semibold text-up">{t.n(wrong.length, "{n} merge puts two different products in one", "{n} merges put different products in one")}</h2>
      <p className="mt-1 text-[13px] text-ink-2">{t("The same supplier billed them on the same day at different prices: they are different products, however alike their names. Merged, the difference between their prices reads as a price increase that never happened. Taking the merge back puts every purchase under the product it came from.")}</p>
      <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
        {wrong.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-rule pt-1.5 first:border-t-0 first:pt-0">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{m.merged}</span> <span className="text-ink-3">{t("merged into")}</span> <span className="font-medium">{m.kept}</span>
              <span className="num block text-[12px] text-ink-3">{t("billed on {date} at {low} and {high}", { date: f.date(m.sameDay!.date), low: f.price(m.sameDay!.low), high: f.price(m.sameDay!.high) })}</span>
            </span>
            <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => run(() => undoProductMergeAction(m.id))}>
              {t("Undo merge")}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${buttonClass("primary", "sm")} mt-3`} disabled={pending} onClick={() => run(() => undoProductMergesAction(wrong.map((m) => m.id)))}>
        {pending ? t("Undoing…") : t.n(wrong.length, "Undo this merge", "Undo these {n} merges")}
      </button>
      {error && <div className="mt-2 text-[12.5px] text-up">{error}</div>}
    </section>
  );
}

/**
 * The products the user said were one and the same. A merge deletes nothing:
 * taking it back puts the purchases, descriptions and everything else that
 * moved under the product they came from.
 */
export function MergesMade({ merges }: { merges: MergeVM[] }) {
  const { t, pending, error, run } = useUndo();
  if (!merges.length) return null;
  return (
    <Disclosure className="mt-6" title={t("Products you merged")} description={t.n(merges.length, "{n} merge, which can be taken back", "{n} merges, each of which can be taken back")}>
      <ul className="flex flex-col gap-2 text-[13px]">
        {merges.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{m.merged}</span> <span className="text-ink-3">{t("is read as")}</span> <span className="font-medium">{m.kept}</span> <span className="num text-ink-3">· {m.date}</span>
              {m.sameDay && !m.sameDay.different && <span className="block text-[12px] text-caution">{t("The supplier billed them as two separate lines on {date}, at the same price ({price}): check that they are one product.", { date: f.date(m.sameDay.date), price: f.price(m.sameDay.low) })}</span>}
              {m.sameDay?.different && <span className="block text-[12px] text-up">{t("billed on {date} at {low} and {high}", { date: f.date(m.sameDay.date), low: f.price(m.sameDay.low), high: f.price(m.sameDay.high) })}</span>}
            </span>
            <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => run(() => undoProductMergeAction(m.id))}>
              {t("Undo merge")}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <div role="alert" className="mt-2 text-[12.5px] text-up">
          {error}
        </div>
      )}
    </Disclosure>
  );
}
