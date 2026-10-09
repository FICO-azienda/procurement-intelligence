"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, CircleAlert, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { importResearchAction, listResearchFilesAction, planResearchAction, readResearchFileAction, runResearchAction, setCustomsCodeAction, setResearchClassAction } from "@/app/actions";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { CLASS_LABEL, PRODUCT_CLASSES, type ProductClass } from "@/lib/research/strategy";
import type { ImportOutcome, PlanView, ResearchOutcome } from "@/server/research";
import type { ResearchFileInfo } from "@/server/research-files";
import { Input, Select, Textarea } from "../form-kit";
import { buttonClass, cx } from "../ui";

/** What a run did, in one line. */
function useOutcomeText() {
  const t = useT();
  return (o: ResearchOutcome) =>
    [
      o.status === "failed" ? t("The research could not be completed.") : o.status === "partial" ? t("Research completed in part: some sources did not answer.") : t("Research completed."),
      t.n(o.added, "{n} new candidate", "{n} new candidates"),
      t.n(o.checked, "{n} page read", "{n} pages read"),
      t.n(o.evidence, "{n} piece of evidence saved", "{n} pieces of evidence saved"),
    ].join(" · ");
}

/**
 * "Deep Research": one product, researched with the sources that are
 * connected. Nothing is changed in what the company buys — the run adds
 * candidates, evidence and references, each with its source.
 */
export function DeepResearchButton({ productId, researched, goTo, compact }: { productId: string; researched: boolean; goTo?: string; compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const describe = useOutcomeText();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ outcome?: ResearchOutcome; error?: string }>({});
  const run = () =>
    start(async () => {
      setState({});
      const res = await runResearchAction(productId);
      if (!res.ok || !res.outcome) return setState({ error: res.error ?? t("Something went wrong.") });
      setState({ outcome: res.outcome });
      if (goTo) router.push(goTo);
      else router.refresh();
    });
  return (
    <div className={cx("flex flex-col gap-1.5", compact ? "items-end" : "items-start")}>
      <button type="button" disabled={pending} onClick={run} className={buttonClass("primary")}>
        {pending ? <Loader2 size={14} className="animate-spin" /> : researched ? <RefreshCw size={14} /> : <Sparkles size={14} />}
        {pending ? t("Researching…") : researched ? t("Refresh research") : t("Deep Research")}
      </button>
      {!compact && <span className="text-[12.5px] text-ink-3">{t("Find suppliers, benchmarks and market evidence.")}</span>}
      {pending && <span className="text-[12.5px] text-ink-3">{t("Reading the sources: it can take a minute. Nothing you buy is changed.")}</span>}
      {state.outcome && <span className={cx("text-[12.5px]", state.outcome.status === "completed" ? "text-down" : "text-caution")}>{describe(state.outcome)}</span>}
      {state.error && <span className="text-[12.5px] text-up">{state.error}</span>}
    </div>
  );
}

type Progress = { id: string; name: string; state: "waiting" | "running" | "done" | "failed"; outcome?: ResearchOutcome };

/**
 * "Research priority products": first what it will take — products,
 * searches, sources, estimated cost — then, only on "Start", one product
 * after the other. Each is saved as it finishes; one that fails does not
 * stop the others.
 */
export function ResearchPriority({ count }: { count: number }) {
  const t = useT();
  const router = useRouter();
  const describe = useOutcomeText();
  const [pending, start] = useTransition();
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress[] | null>(null);
  const stop = useRef(false);
  const running = progress?.some((p) => p.state === "running" || p.state === "waiting") ?? false;

  const prepare = () =>
    start(async () => {
      setError(null);
      const res = await planResearchAction();
      if (!res.ok || !res.plan) setError(res.error ?? t("Something went wrong."));
      else setPlan(res.plan);
    });

  const go = async () => {
    if (!plan) return;
    stop.current = false;
    let list: Progress[] = plan.products.map((p) => ({ id: p.productId, name: p.name, state: "waiting" }));
    setProgress(list);
    for (const p of plan.products) {
      if (stop.current) break;
      list = list.map((x) => (x.id === p.productId ? { ...x, state: "running" } : x));
      setProgress(list);
      let outcome: ResearchOutcome | undefined;
      try {
        outcome = (await runResearchAction(p.productId)).outcome;
      } catch {
        outcome = undefined;
      }
      list = list.map((x) => (x.id === p.productId ? { ...x, state: outcome && outcome.status !== "failed" ? "done" : "failed", outcome } : x));
      setProgress(list);
    }
    setProgress(list.map((x) => (x.state === "waiting" ? { ...x, state: "failed" } : x)));
    router.refresh();
  };

  if (!plan) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button type="button" className={buttonClass("secondary")} disabled={pending} onClick={prepare}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {t("Research priority products")}
        </button>
        <span className="text-[12.5px] text-ink-3">{t("You see what it takes before anything starts.")}</span>
        {error && <span className="text-[12.5px] text-up">{error}</span>}
      </div>
    );
  }

  const fresh = plan.queries - plan.cachedQueries;
  return (
    <div className="rounded-xl border border-ledger/25">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 bg-ledger-wash/50 px-5 py-4">
        <div className="min-w-[240px] flex-1">
          <div className="text-[14.5px] font-semibold">{t.n(count, "Research {n} priority product", "Research {n} priority products")}</div>
          <dl className="mt-2 grid gap-x-8 gap-y-1.5 text-[13px] @2xl:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-ink-3">{t("Web search")}:</dt>
              <dd>{plan.searchProvider ?? <span className="text-caution">{t("not configured — no new supplier will be looked for")}</span>}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-3">{t("Estimated searches")}:</dt>
              <dd>{plan.searchProvider ? `${fresh}${plan.cachedQueries ? ` (+${t.n(plan.cachedQueries, "{n} already answered, reused", "{n} already answered, reused")})` : ""}` : "0"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-3">{t("Pages read")}:</dt>
              <dd>{t("up to {n} per product", { n: plan.limits.maxPagesPerProduct })}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-3">{t("Estimated cost")}:</dt>
              <dd>
                {!plan.searchProvider
                  ? t("none: only free public sources are used")
                  : plan.estimatedCost == null
                    ? t("not known: the price per search is not set")
                    : f.money(plan.estimatedCost)}
                {plan.limits.dailyCostLimit != null && ` · ${t("daily limit {amount}", { amount: f.money(plan.limits.dailyCostLimit) })}`}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[12.5px] text-ink-3">{t("Free public sources are always used: the candidates' own websites, ECB exchange rates and Eurostat trade statistics.")}</p>
          {plan.overDailyLimit && <p className="mt-1 text-[12.5px] text-caution">{t("This would go over today's spending limit: the research stops when the limit is reached.")}</p>}
        </div>
        <div className="flex items-center gap-2">
          {!progress && (
            <button type="button" className={buttonClass("primary")} onClick={go}>
              {t("Start research")}
            </button>
          )}
          {running && (
            <button type="button" className={buttonClass("secondary")} onClick={() => (stop.current = true)}>
              {t("Stop after this product")}
            </button>
          )}
          {!running && (
            <button type="button" className={buttonClass("ghost")} onClick={() => (setPlan(null), setProgress(null))}>
              {t("Close")}
            </button>
          )}
        </div>
      </div>
      {progress && (
        <ul className="divide-y divide-rule border-t border-rule text-[13px]">
          {progress.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2">
              {p.state === "running" ? <Loader2 size={13} className="animate-spin text-ledger" /> : p.state === "done" ? <Check size={13} className="text-down" /> : p.state === "failed" ? <CircleAlert size={13} className="text-caution" /> : <span className="inline-block size-[13px] rounded-full border border-rule-strong" />}
              <span className="min-w-[180px] flex-1 truncate font-medium">{p.name}</span>
              <span className="text-[12.5px] text-ink-3">{p.state === "running" ? t("Researching…") : p.state === "waiting" ? t("Waiting") : p.outcome ? describe(p.outcome) : t("Not researched")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const EXAMPLE = `{
  "source": "Web research",
  "researchedAt": "2026-10-04",
  "candidates": [
    {
      "products": ["Product name or code"],
      "name": "Supplier name",
      "country": "Poland",
      "website": "https://…",
      "sourceUrl": "https://… (the page that shows it sells the product)",
      "sourceLevel": "supplier_official",
      "companyType": "manufacturer",
      "matchedProduct": "What the page says it sells",
      "notes": "What is still to confirm"
    }
  ],
  "benchmarks": [
    { "product": "Product name or code", "label": "What it refers to", "low": 1.56, "currency": "USD", "unit": "kg", "sourceName": "Who published it", "sourceUrl": "https://…", "sourceDate": "2026-09-21" }
  ]
}`;

/**
 * Research done outside the app, loaded with its sources: first what the
 * file would add, then — on confirmation — candidates and references to
 * review. Never suppliers, never prices paid.
 */
export function ResearchImport() {
  const t = useT();
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ preview?: ImportOutcome; loaded?: ImportOutcome; error?: string }>({});
  // Research saved on this computer by an earlier session: one click puts a file in the box, to check and load like any other.
  const [files, setFiles] = useState<ResearchFileInfo[]>([]);
  useEffect(() => {
    listResearchFilesAction().then(setFiles, () => setFiles([]));
  }, []);
  const gaps = useMemo(() => {
    try {
      const g = (JSON.parse(raw) as { coverage?: { gaps?: unknown } }).coverage?.gaps;
      return Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }, [raw]);
  const send = (confirm: boolean) =>
    start(async () => {
      const res = await importResearchAction(raw, confirm);
      if (!res.ok || !res.outcome) return setState({ error: res.error ?? t("Something went wrong.") });
      if (confirm) {
        setState({ loaded: res.outcome });
        setRaw("");
        router.refresh();
      } else setState({ preview: res.outcome });
    });
  const o = state.preview;
  return (
    <div className="space-y-3">
      <p className="max-w-[76ch] text-[13px] text-ink-2">
        {t("Suppliers and price references found by you, a colleague or an agency, with the page each one comes from. They are loaded as candidates and references to review — never as suppliers, never as prices paid.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".json,application/json"
          aria-label={t("Research file")}
          className="text-[12.5px] text-ink-2 file:mr-2 file:rounded-md file:border file:border-rule-strong file:bg-canvas file:px-2.5 file:py-1 file:text-[12.5px]"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              setRaw(await file.text());
              setState({});
            }
          }}
        />
        <span className="text-[12.5px] text-ink-3">{t("or paste its content below")}</span>
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="text-ink-3">{t("Saved on this computer:")}</span>
          {files.map((file) => (
            <button
              key={file.name}
              type="button"
              className={buttonClass("ghost", "sm")}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await readResearchFileAction(file.name);
                  if (!res.ok || res.raw == null) return setState({ error: t("Something went wrong.") });
                  setRaw(res.raw);
                  setState({});
                })
              }
            >
              {file.name.replace(/\.json$/, "")}
            </button>
          ))}
        </div>
      )}
      <Textarea value={raw} onChange={(e) => (setRaw(e.target.value), setState({}))} rows={6} placeholder={EXAMPLE} className="w-full font-mono text-[12px]" aria-label={t("Research file content")} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("secondary")} disabled={pending || !raw.trim()} onClick={() => send(false)}>
          {t("Check the file")}
        </button>
        {o && o.candidates + o.benchmarks > 0 && (
          <button type="button" className={buttonClass("primary")} disabled={pending} onClick={() => send(true)}>
            {t("Load {n} items to review", { n: o.candidates + o.benchmarks })}
          </button>
        )}
        {state.error && <span className="text-[12.5px] text-up">{state.error}</span>}
        {state.loaded && (
          <span className="text-[12.5px] text-down">
            {t("Loaded, all to review — candidates: {candidates}, price references: {benchmarks}, products concerned: {products}.", { candidates: state.loaded.candidates, benchmarks: state.loaded.benchmarks, products: state.loaded.products.length })}
          </span>
        )}
      </div>
      {gaps.length > 0 && (
        <div className="rounded-lg border border-dashed border-rule-strong px-4 py-3 text-[12.5px] text-ink-2">
          <div className="font-medium text-ink">{t("What this research did not cover")}</div>
          <ul className="mt-1 list-disc pl-4">
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      {o && (
        <div className="rounded-lg border border-rule px-4 py-3 text-[13px]">
          <div className="font-medium">
            {t("The file would add — candidates: {candidates}, price references: {benchmarks}, products concerned: {products}.", { candidates: o.candidates, benchmarks: o.benchmarks, products: o.products.length })}
          </div>
          {o.products.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-ink-2">
              {o.products.map((p) => (
                <li key={p.id}>
                  {p.name} <span className="text-ink-3">— {[p.candidates ? t.n(p.candidates, "{n} candidate", "{n} candidates") : null, p.benchmarks ? t.n(p.benchmarks, "{n} reference", "{n} references") : null].filter(Boolean).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
          {o.unknown.length > 0 && (
            <p className="mt-2 text-caution">
              {t("Not in your catalogue, left out:")} {o.unknown.join("; ")}
            </p>
          )}
          {o.skipped.length > 0 && <p className="mt-2 text-ink-3">{t.n(o.skipped.length, "{n} entry left out: already on file, or a supplier you buy from.", "{n} entries left out: already on file, or suppliers you buy from.")}</p>}
        </div>
      )}
    </div>
  );
}

/** The customs code of a product, for trade statistics: confirmed by the user, or a suggestion still to confirm. */
export function CustomsCodeForm({ productId, code, confirmed, suggested }: { productId: string; code: string | null; confirmed: boolean; suggested: string | null }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(code ?? suggested ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      const res = await setCustomsCodeAction(productId, value, true);
      if (!res.ok) setError(res.error ?? t("Something went wrong."));
      else {
        setError(null);
        router.refresh();
      }
    });
  const state = code && confirmed ? t("Confirmed by you") : value && (code || suggested) ? t("Suggested from the product's category: confirm it") : t("Not known: trade statistics are skipped");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
      <span className="text-ink-3">{t("Customs code (HS/CN)")}</span>
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="271220" className="h-7! w-[130px] text-[12.5px]" aria-label={t("Customs code (HS/CN)")} />
      <button type="button" className={buttonClass("secondary", "sm")} disabled={pending || (value === (code ?? "") && confirmed)} onClick={save}>
        {value ? t("Confirm") : t("Remove")}
      </button>
      <span className={cx("text-[12.5px]", code && confirmed ? "text-down" : "text-ink-3")}>{state}</span>
      {error && <span className="text-[12.5px] text-up">{error}</span>}
    </div>
  );
}

/** How the product is researched: what the rules read, or what the user chose instead. */
export function ResearchClassSelect({ productId, value, auto, chosen }: { productId: string; value: ProductClass; auto: ProductClass; chosen: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      value={chosen ? value : ""}
      disabled={pending}
      aria-label={t("Kind of product")}
      className="h-7! text-[12.5px]"
      onChange={(e) =>
        start(async () => {
          await setResearchClassAction(productId, e.target.value);
          router.refresh();
        })
      }
    >
      <option value="">{t("Automatic: {label}", { label: t(CLASS_LABEL[auto]) })}</option>
      {PRODUCT_CLASSES.map((c) => (
        <option key={c} value={c}>
          {t(CLASS_LABEL[c])}
        </option>
      ))}
    </Select>
  );
}
