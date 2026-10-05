"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Languages } from "lucide-react";
import { setLanguage } from "@/app/actions";
import { useLocale, useT } from "@/lib/i18n/client";
import { LOCALES, LOCALE_NAME, type Locale } from "@/lib/i18n";
import { track } from "@/lib/track";
import { cx } from "../ui";
import { STATIC_DEMO, demoPathIn } from "./static-demo";

/** Saves the language and reloads the page data in it. */
function useLanguage() {
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const choose = (next: Locale, after?: () => void) => {
    if (next === locale) return after?.();
    // The read-only demo has no server to save the choice: each language is its own set of pages.
    if (STATIC_DEMO) return window.location.assign(demoPathIn(next));
    startTransition(async () => {
      const res = await setLanguage(next);
      track("language_changed", { to: next });
      after?.();
      if (res.ok) router.refresh();
    });
  };
  return { locale, pending, choose };
}

/** The language, one click away on every page (top bar). */
export function LanguageMenu() {
  const t = useT();
  const { locale, pending, choose } = useLanguage();
  const [shown, setShown] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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
        aria-label={t("Language: {name}", { name: LOCALE_NAME[locale] })}
        aria-haspopup="menu"
        aria-expanded={shown}
        onClick={() => setShown((s) => !s)}
        className={cx(
          "flex h-9 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-semibold text-ink-2 uppercase transition-colors hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-ledger",
          pending && "opacity-60",
        )}
      >
        <Languages size={16} strokeWidth={1.75} />
        {locale}
      </button>
      {shown && (
        <div role="menu" className="absolute top-[calc(100%+6px)] right-0 z-40 w-[180px] rounded-lg border border-rule-strong bg-canvas p-1.5 shadow-[0_12px_32px_-8px_rgba(17,17,19,.25)]">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={l === locale}
              lang={l}
              onClick={() => choose(l, () => setShown(false))}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-wash focus-visible:bg-wash focus-visible:outline-none"
            >
              <span className={l === locale ? "font-medium" : "text-ink-2"}>{LOCALE_NAME[l]}</span>
              {l === locale && <Check size={14} strokeWidth={2.25} className="text-ledger" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The same choice, spelled out, on the Settings page. */
export function LanguageChoice() {
  const { locale, pending, choose } = useLanguage();
  return (
    <div role="radiogroup" className={cx("inline-flex rounded-lg bg-wash p-1 transition-opacity", pending && "opacity-60")}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={l === locale}
          lang={l}
          disabled={pending}
          onClick={() => choose(l)}
          className={cx(
            "h-9 min-w-[110px] rounded-md px-4 text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ledger",
            l === locale ? "bg-canvas text-ink shadow-[0_1px_2px_rgba(17,17,19,.12)]" : "text-ink-3 hover:text-ink",
          )}
        >
          {LOCALE_NAME[l]}
        </button>
      ))}
    </div>
  );
}
