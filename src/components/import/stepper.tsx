"use client";

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { buttonClass } from "../ui";

/**
 * One question at a time. Answering it removes it from the list, so the next
 * one slides into place; "Skip" leaves it for later.
 */
export function OneAtATime({ items }: { items: { key: string; from: string; node: ReactNode }[] }) {
  const t = useT();
  const [at, setAt] = useState(0);
  if (items.length === 0) return null;
  const i = Math.min(at, items.length - 1);
  const item = items[i];
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] text-ink-3">
          <span className="font-semibold text-ink">{t("Question {n} of {total}", { n: i + 1, total: items.length })}</span> · {t("from {file}", { file: item.from })}
        </div>
        {items.length > 1 && (
          <div className="flex items-center gap-1">
            <button type="button" disabled={i === 0} onClick={() => setAt(i - 1)} className={buttonClass("ghost", "sm")} aria-label={t("Previous question")}>
              <ChevronLeft size={14} /> {t("Back")}
            </button>
            <button type="button" disabled={i === items.length - 1} onClick={() => setAt(i + 1)} className={buttonClass("ghost", "sm")}>
              {t("Skip for now")} <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
      {/* The key resets the card's own state (an open chooser) when the question changes. */}
      <div key={item.key}>{item.node}</div>
    </div>
  );
}
