"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { undoProductMergeAction } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { Disclosure, buttonClass } from "../ui";

export interface MergeVM {
  id: string;
  kept: string;
  merged: string;
  date: string;
}

/**
 * The products the user said were one and the same. A merge deletes nothing:
 * taking it back puts the purchases, descriptions and everything else that
 * moved under the product they came from.
 */
export function MergesMade({ merges }: { merges: MergeVM[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!merges.length) return null;
  const undo = (id: string) =>
    start(async () => {
      const res = await undoProductMergeAction(id);
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      router.refresh();
    });
  return (
    <Disclosure className="mt-6" title={t("Products you merged")} description={t.n(merges.length, "{n} merge, which can be taken back", "{n} merges, each of which can be taken back")}>
      <ul className="flex flex-col gap-2 text-[13px]">
        {merges.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{m.merged}</span> <span className="text-ink-3">{t("is read as")}</span> <span className="font-medium">{m.kept}</span> <span className="num text-ink-3">· {m.date}</span>
            </span>
            <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => undo(m.id)}>
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
