"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n";
import { BASE_PATH as ROOT_PATH, DEMO_ROOT as ROOT, STATIC_DEMO } from "@/lib/static-demo";
import { buttonClass } from "../ui";

export { STATIC_DEMO };

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
      // Only what the person just did is told: a page that asks something by itself on opening is not an action of theirs.
      if (headers.has("next-action")) {
        if (navigator.userActivation?.isActive ?? true) setBlocked(true);
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

declare global {
  interface Window {
    /** The filters of the page the demo is showing, as the snapshot saved it (its head script sets it). */
    __demoLoaded?: string;
  }
}

const DEMO_QUERY_EVENT = "demo:query";

/**
 * Typing in a search box of the demo: the words go in the address without
 * leaving the page (there is no server to ask), and the rows are filtered here.
 * Returns false outside the demo, where the page asks the server as usual.
 */
export function demoSearch(pathname: string, params: URLSearchParams): boolean {
  if (!STATIC_DEMO) return false;
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${ROOT_PATH}${pathname}${query ? `?${query}` : ""}`);
  window.dispatchEvent(new Event(DEMO_QUERY_EVENT));
  return true;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * What the saved pages cannot do by themselves. Each filter the snapshot
 * reached is a page of its own (scripts/snapshot.mjs); what it did not — the
 * words of a search, a combination never saved — is done or said here:
 * the words filter the rows of the page's table, a combination shows the
 * closest page saved and says which filters it leaves out.
 */
export function StaticDemoView() {
  const t = useT();
  const [state, setState] = useState<{ q: string; shown: number; dropped: boolean } | null>(null);

  useEffect(() => {
    const apply = () => {
      const params = new URLSearchParams(window.location.search);
      const loaded = new URLSearchParams(window.__demoLoaded ?? "");
      const q = params.get("q")?.trim() ?? "";
      const dropped = [...params].some(([k, v]) => v && k !== "q" && loaded.get(k) !== v);
      // The page's main table: the one the search box above it is about — still in its streamed part, maybe, not yet moved into <main>.
      const table = document.querySelector("main table") ?? document.querySelector("table");
      const rows = [...(table?.querySelectorAll<HTMLTableRowElement>("tbody > tr") ?? [])];
      const words = norm(q).split(" ").filter(Boolean);
      let shown = 0;
      for (const row of rows) {
        const hay = ` ${norm(row.textContent ?? "")} `;
        const match = words.every((w) => hay.includes(w));
        row.style.display = match ? "" : "none";
        if (match) shown++;
      }
      setState(q || dropped ? { q, shown, dropped } : null);
    };
    apply();
    window.addEventListener(DEMO_QUERY_EVENT, apply);
    window.addEventListener("popstate", apply);
    return () => {
      window.removeEventListener(DEMO_QUERY_EVENT, apply);
      window.removeEventListener("popstate", apply);
    };
  }, []);

  if (!state) return null;
  return (
    <p role="status" className="mb-4 rounded-md border border-ledger/25 bg-ledger-wash/50 px-3 py-2 text-[12.5px] text-ink-2 print:hidden">
      <span className="font-medium text-ledger">{t("Read-only demo")}</span>
      {" · "}
      {state.q && t("Rows that contain “{query}”: {n}. In this copy the search reads the words shown in the table.", { query: state.q, n: state.shown })}
      {state.q && state.dropped && " "}
      {state.dropped && t("This combination of filters is not saved in the demo: the page shows the closest one, without some of them.")}
    </p>
  );
}
