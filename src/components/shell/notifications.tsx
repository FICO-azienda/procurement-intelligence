"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cx } from "../ui";

export interface Notice {
  key: string;
  text: string;
  href: string;
  /** Needs a decision from the user (counts on the bell); otherwise it is just news. */
  todo: boolean;
}

/**
 * Only what can be acted on: questions from imports, lines waiting to be
 * saved, prices that moved. No history, no "mark as read" — when the thing is
 * done, the line disappears by itself.
 */
export function Notifications({ notices }: { notices: Notice[] }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const todo = notices.filter((n) => n.todo).length;

  useEffect(() => {
    if (!shown) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setShown(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setShown(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [shown]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-label={todo ? t("Notifications: {n} to do", { n: todo }) : t("Notifications")}
        aria-expanded={shown}
        onClick={() => setShown((s) => !s)}
        className="relative grid size-9 place-items-center rounded-md text-ink-2 transition-colors hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-ledger"
      >
        <Bell size={17} strokeWidth={1.75} />
        {todo > 0 && (
          <span className="num absolute top-1 right-1 grid min-w-[16px] place-items-center rounded-full bg-up px-1 text-[10.5px] leading-4 font-semibold text-white">{todo}</span>
        )}
      </button>
      {shown && (
        <div className="absolute top-[calc(100%+6px)] right-0 z-40 w-[320px] max-w-[calc(100vw-24px)] rounded-lg border border-rule-strong bg-canvas p-1.5 shadow-[0_12px_32px_-8px_rgba(17,17,19,.25)]">
          {notices.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-ink-3">{t("Nothing needs you right now.")}</p>
          ) : (
            <ul>
              {notices.map((n) => (
                <li key={n.key}>
                  <Link href={n.href} onClick={() => setShown(false)} className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition-colors hover:bg-wash">
                    <span className={cx("mt-[7px] size-1.5 shrink-0 rounded-full", n.todo ? "bg-caution" : "bg-ink-4")} aria-hidden />
                    <span className={n.todo ? "font-medium" : "text-ink-2"}>{n.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
