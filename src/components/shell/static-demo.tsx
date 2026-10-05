"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";
import { buttonClass } from "../ui";

/**
 * The read-only demo on GitHub Pages (scripts/snapshot.mjs): saved HTML, no
 * server. Set at build time by the Pages workflow; empty everywhere else.
 */
export const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";
/** Where each language of the demo is published: the English pages at the root, the Italian ones under /it. */
const ROOT = process.env.NEXT_PUBLIC_DEMO_ROOT ?? "";

/** The same page in the other language of the demo. */
export function demoPathIn(locale: Locale, pathname = window.location.pathname): string {
  const rest = pathname.startsWith(`${ROOT}/it/`) || pathname === `${ROOT}/it` ? pathname.slice(`${ROOT}/it`.length) : pathname.slice(ROOT.length);
  return `${ROOT}${locale === "it" ? "/it" : ""}${rest || "/"}`;
}

/**
 * Anything that would write or run on the server (save, research, import…)
 * can't work on saved pages. Instead of a broken page, the demo says so.
 */
export function StaticDemoGuard() {
  const t = useT();
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!STATIC_DEMO) return;
    const original = window.fetch;
    window.fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      // A Server Action: there is no server to answer it. It stays pending; the notice offers to reload.
      if (headers.has("next-action")) {
        setBlocked(true);
        return new Promise<Response>(() => {});
      }
      return original(input, init);
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  if (!blocked) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4">
      <div className="w-full max-w-[420px] rounded-xl border border-rule-strong bg-canvas p-5 shadow-[0_12px_32px_-8px_rgba(17,17,19,.35)]">
        <h2 className="text-[15.5px] font-semibold">{t("Read-only demo")}</h2>
        <p className="mt-1.5 text-[13.5px] text-ink-2">{t("This is a saved copy of the app, with example data: saving, importing and researching need the app running on a server. Everything else can be browsed.")}</p>
        <div className="mt-4 flex justify-end">
          <button type="button" className={buttonClass("primary")} onClick={() => window.location.reload()}>
            {t("OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
