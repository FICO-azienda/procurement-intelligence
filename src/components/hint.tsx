"use client";

import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/**
 * Explains how a figure is calculated. Opens on hover, focus or tap; rendered
 * in a portal so it is never clipped by a card.
 */
export function Hint({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const open = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = 272;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    const above = r.bottom + 160 > window.innerHeight;
    setPos({ left, top: above ? r.top - 8 : r.bottom + 8, above });
  }, []);
  const close = useCallback(() => setPos(null), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label ?? t("How this is calculated")}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pos) close();
          else open();
        }}
        className="relative z-10 inline-grid size-4 shrink-0 place-items-center rounded-full align-[-2px] text-ink-4 transition-colors hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-ledger"
      >
        <Info size={12} strokeWidth={2} />
      </button>
      {pos &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ left: pos.left, top: pos.top, width: 272, transform: pos.above ? "translateY(-100%)" : undefined }}
            className="pointer-events-none fixed z-50 rounded-md bg-ink px-3 py-2 text-[12px] leading-snug font-normal tracking-normal text-white normal-case shadow-[0_6px_20px_-4px_rgba(17,17,19,.35)]"
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}
