"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
import {
  answerKindAction,
  answerSameAction,
  confirmProductsAction,
  type ActionResult,
} from "@/app/import/actions";
import {
  KIND_LABEL,
  PRODUCT_KINDS,
  type ProductKind,
} from "@/lib/catalog/kinds";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { Input, Select } from "../form-kit";
import { buttonClass, cx } from "../ui";

export interface DraftVM {
  key: string;
  name: string;
  kind: ProductKind;
  strategic: boolean;
  unit: string;
  reason: string | null;
  /** The descriptions as written on the documents (the first ones; `descriptionCount` says how many there are). */
  descriptions: string[];
  descriptionCount: number;
  lines: number;
  amount: number;
  suppliers: string[];
  canSplit: boolean;
}

export interface QuestionVM {
  key: string;
  type: "same" | "kind";
  reason: string;
  suggestion: "merge" | "separate" | null;
  mergedName: string;
  drafts: DraftVM[];
  lines: number;
  amount: number;
  suppliers: string[];
}

export interface AnalysisVM {
  descriptions: number;
  grouped: number;
  products: number;
  otherSpend: number;
  confident: DraftVM[];
  confidentLines: number;
  confidentAmount: number;
  questions: QuestionVM[];
}

function useRun() {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? t("Something went wrong."));
      else router.refresh();
    });
  return { pending, error, run, t };
}

const KIND_TONE: Record<"product" | "spend", string> = {
  product: "bg-ledger-wash text-ledger",
  spend: "bg-wash text-ink-2",
};

function KindPill({
  kind,
  strategic,
}: {
  kind: ProductKind;
  strategic: boolean;
}) {
  const t = useT();
  return (
    <span
      className={cx(
        "inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap",
        KIND_TONE[strategic ? "product" : "spend"],
      )}
    >
      {t(KIND_LABEL[kind])}
    </span>
  );
}

function Meta({
  lines,
  amount,
  suppliers,
  descriptions,
}: {
  lines: number;
  amount: number;
  suppliers: string[];
  descriptions?: number;
}) {
  const t = useT();
  return (
    <span className="text-[12.5px] text-ink-3">
      {descriptions != null &&
        descriptions > 1 &&
        `${t.n(descriptions, "{n} description", "{n} descriptions")} · `}
      {t.n(lines, "{n} invoice line", "{n} invoice lines")} ·{" "}
      <span className="num">{f.money(amount)}</span>
      {suppliers.length > 0 &&
        ` · ${suppliers.length <= 2 ? suppliers.join(", ") : t("{n} suppliers", { n: suppliers.length })}`}
    </span>
  );
}

/**
 * What the import's unknown descriptions are: how many were put together,
 * what can be confirmed in one click, and the few cases that need a person —
 * the most expensive first.
 */
export function ProductAnalysis({
  sessionId,
  analysis: a,
}: {
  sessionId: string;
  analysis: AnalysisVM;
}) {
  const t = useT();
  if (a.confident.length === 0 && a.questions.length === 0) return null;
  const stat = (n: number, label: string, tone?: string) => (
    <div>
      <div
        className={cx(
          "num text-[22px] leading-none font-semibold tracking-[-0.02em]",
          tone,
        )}
      >
        {f.number(n, 0)}
      </div>
      <div className="mt-1.5 text-[12.5px] leading-snug text-ink-3">
        {label}
      </div>
    </div>
  );
  return (
    <section
      aria-labelledby="analysis"
      id="analysis-section"
      className="scroll-mt-20 space-y-4"
    >
      {/* Once everything sure is confirmed, only the doubts are left: no need for the summary. */}
      {a.confident.length > 0 && (
        <div className="rounded-xl border border-rule px-5 py-5 sm:px-6">
          <h2
            id="analysis"
            className="text-[17px] font-semibold tracking-[-0.01em]"
          >
            {t.n(
              a.descriptions,
              "We analysed {n} description",
              "We analysed {n} descriptions",
            )}
          </h2>
          <p className="mt-1 max-w-[70ch] text-[13px] text-ink-3">
            {t(
              "The same product written in different ways is put together; transport, services and utilities are kept as spend, not as products. Every description stays linked to its product, as written.",
            )}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 @2xl:grid-cols-4">
            {stat(a.grouped, t("put together automatically"))}
            {stat(a.products, t("distinct products identified"))}
            {stat(
              a.otherSpend,
              t("items of services and other spend classified"),
            )}
            {stat(
              a.questions.length,
              t("need your check"),
              a.questions.length ? "text-caution" : "text-down",
            )}
          </div>
        </div>
      )}

      {a.confident.length > 0 && (
        <ConfidentGroups
          sessionId={sessionId}
          drafts={a.confident}
          lines={a.confidentLines}
          amount={a.confidentAmount}
        />
      )}

      {a.questions.length > 0 && (
        <div className="space-y-3">
          <h3
            id={a.confident.length > 0 ? undefined : "analysis"}
            className="text-[14px] font-semibold"
          >
            {t.n(a.questions.length, "{n} case to check", "{n} cases to check")}{" "}
            <span className="font-normal text-ink-3">
              · {t("largest spend first")}
            </span>
          </h3>
          <ul className="space-y-3">
            {a.questions.map((q) => (
              <li key={q.key}>
                {q.type === "same" ? (
                  <SameCard sessionId={sessionId} q={q} />
                ) : (
                  <KindCard sessionId={sessionId} q={q} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** "128 high-confidence groups — Confirm all", with the list to open for those who want to look. */
function ConfidentGroups({
  sessionId,
  drafts,
  lines,
  amount,
}: {
  sessionId: string;
  drafts: DraftVM[];
  lines: number;
  amount: number;
}) {
  const { pending, error, run, t } = useRun();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(40);
  return (
    <div className="overflow-hidden rounded-xl border border-ledger/25">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 bg-ledger-wash/50 px-5 py-4 sm:px-6">
        <div className="min-w-[240px] flex-1">
          <div className="text-[15px] font-semibold">
            {t.n(
              drafts.length,
              "{n} high-confidence group",
              "{n} high-confidence groups",
            )}
          </div>
          <div className="mt-0.5 text-[13px] text-ink-2">
            {t.n(lines, "{n} invoice line", "{n} invoice lines")} ·{" "}
            <span className="num">{f.money(amount)}</span> —{" "}
            {t("ready to import as soon as you confirm")}
          </div>
          {error && <div className="mt-1.5 text-[12.5px] text-up">{error}</div>}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={buttonClass("secondary")}
        >
          <ChevronRight
            size={14}
            className={cx(
              "transition-transform duration-150",
              open && "rotate-90",
            )}
          />{" "}
          {open ? t("Hide details") : t("See details")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => confirmProductsAction(sessionId))}
          className={buttonClass("primary")}
        >
          <Check size={14} /> {pending ? t("Confirming…") : t("Confirm all")}
        </button>
      </div>
      {open && (
        <ul className="border-t border-rule">
          {drafts.slice(0, shown).map((d) => (
            <DraftRow key={d.key} sessionId={sessionId} draft={d} />
          ))}
          {drafts.length > shown && (
            <li className="px-5 py-3 text-center sm:px-6">
              <button
                type="button"
                className="text-[13px] font-medium text-ledger hover:underline"
                onClick={() => setShown((n) => n + 100)}
              >
                {t("Show {n} more", {
                  n: Math.min(100, drafts.length - shown),
                })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** One proposed product: its name, what it is, the descriptions it gathers. Can be confirmed, renamed, re-classified or split. */
function DraftRow({
  sessionId,
  draft: d,
}: {
  sessionId: string;
  draft: DraftVM;
}) {
  const { pending, error, run, t } = useRun();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(d.name);
  const [kind, setKind] = useState<ProductKind>(d.kind);
  const edits = { [d.key]: { name, kind } };
  return (
    <li className="border-b border-rule last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-left hover:bg-well sm:px-6"
      >
        <ChevronRight
          size={13}
          className={cx(
            "shrink-0 text-ink-4 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
          {d.name}
        </span>
        <KindPill kind={d.kind} strategic={d.strategic} />
        <span className="w-full pl-[25px] @3xl:w-auto @3xl:pl-0">
          <Meta
            lines={d.lines}
            amount={d.amount}
            suppliers={d.suppliers}
            descriptions={d.descriptionCount}
          />
        </span>
      </button>
      {open && (
        <div className="space-y-3 bg-well px-5 pt-1 pb-4 pl-[45px] sm:px-6 sm:pl-[49px]">
          {d.reason && (
            <div className="text-[12.5px] text-ink-3">{d.reason}</div>
          )}
          <div>
            <div className="text-[12px] font-medium text-ink-3">
              {t("Written on the invoices as")}
            </div>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink-2">
              {d.descriptions.map((x) => (
                <li key={x} className="break-words">
                  {x}
                </li>
              ))}
              {d.descriptionCount > d.descriptions.length && (
                <li className="text-ink-4">
                  {t("and {n} more", {
                    n: d.descriptionCount - d.descriptions.length,
                  })}
                </li>
              )}
            </ul>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1 text-[12px] font-medium text-ink-3">
              {t("Name")}
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full"
              />
            </label>
            <label className="text-[12px] font-medium text-ink-3">
              {t("What it is")}
              <div className="mt-1">
                <Select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ProductKind)}
                >
                  {PRODUCT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(KIND_LABEL[k])}
                    </option>
                  ))}
                </Select>
              </div>
            </label>
            <button
              type="button"
              disabled={pending || !name.trim()}
              className={buttonClass("primary")}
              onClick={() =>
                run(() =>
                  confirmProductsAction(sessionId, { keys: [d.key], edits }),
                )
              }
            >
              {pending ? t("Confirming…") : t("Confirm")}
            </button>
            {d.canSplit && (
              <button
                type="button"
                disabled={pending}
                className={buttonClass("secondary")}
                onClick={() =>
                  run(() =>
                    confirmProductsAction(sessionId, {
                      keys: [d.key],
                      separate: [d.key],
                    }),
                  )
                }
              >
                {t("Split")}
              </button>
            )}
          </div>
          {error && <div className="text-[12.5px] text-up">{error}</div>}
        </div>
      )}
    </li>
  );
}

function Names({ drafts, max = 6 }: { drafts: DraftVM[]; max?: number }) {
  const t = useT();
  return (
    <ul className="mt-2 space-y-1 text-[13.5px]">
      {drafts.slice(0, max).map((d) => (
        <li key={d.key} className="flex flex-wrap items-baseline gap-x-3">
          <span className="min-w-0 font-medium break-words">{d.name}</span>
          <span className="text-[12px] text-ink-3">
            {t.n(d.lines, "{n} line", "{n} lines")} ·{" "}
            <span className="num">{f.money(d.amount)}</span>
          </span>
        </li>
      ))}
      {drafts.length > max && (
        <li className="text-[12.5px] text-ink-3">
          {t("and {n} more", { n: drafts.length - max })}
        </li>
      )}
    </ul>
  );
}

/** "They may be the same product": merge, or keep apart. The evidence and what it points to are said; the user decides. */
function SameCard({ sessionId, q }: { sessionId: string; q: QuestionVM }) {
  const { pending, error, run, t } = useRun();
  const [name, setName] = useState(q.mergedName);
  const merge = q.suggestion === "merge";
  return (
    <div className="rounded-lg border border-rule px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-[14px] font-semibold">
          {t("They may be the same product")}
        </h4>
        <Meta lines={q.lines} amount={q.amount} suppliers={q.suppliers} />
      </div>
      <Names drafts={q.drafts} />
      <div className="mt-3 text-[13px] text-ink-2">
        <span className="text-ink-3">{t("Reason:")}</span> {q.reason}
        {q.suggestion && (
          <>
            {" "}
            <span className="text-ink-3">{t("Suggestion:")}</span>{" "}
            <span className="font-medium">
              {merge ? t("merge them") : t("keep them separate")}
            </span>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1 text-[12px] font-medium text-ink-3">
          {t("Name if merged")}
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full"
          />
        </label>
        <button
          type="button"
          disabled={pending || !name.trim()}
          className={buttonClass(merge ? "primary" : "secondary")}
          onClick={() =>
            run(() => answerSameAction(sessionId, q.key, "merge", name))
          }
        >
          {t("Merge")}
        </button>
        <button
          type="button"
          disabled={pending}
          className={buttonClass(merge ? "secondary" : "primary")}
          onClick={() =>
            run(() => answerSameAction(sessionId, q.key, "separate"))
          }
        >
          {t("Keep separate")}
        </button>
      </div>
      {error && <div className="mt-2 text-[12.5px] text-up">{error}</div>}
    </div>
  );
}

/** "What are these?": lines whose words say nothing. One answer covers all of the supplier's. */
function KindCard({ sessionId, q }: { sessionId: string; q: QuestionVM }) {
  const { pending, error, run, t } = useRun();
  const [kind, setKind] = useState<ProductKind | "">("");
  return (
    <div className="rounded-lg border border-rule px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-[14px] font-semibold">{t("What are these?")}</h4>
        <Meta lines={q.lines} amount={q.amount} suppliers={q.suppliers} />
      </div>
      <Names drafts={q.drafts} max={4} />
      <p className="mt-3 text-[13px] text-ink-3">
        {t(
          "Nothing in these lines says what they are. Materials, components and packaging enter the product catalogue, one product per description; anything else is kept as spend from this supplier.",
        )}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as ProductKind)}
          aria-label={t("What it is")}
        >
          <option value="">{t("Choose what they are…")}</option>
          {PRODUCT_KINDS.filter((k) => k !== "needs_review").map((k) => (
            <option key={k} value={k}>
              {t(KIND_LABEL[k])}
            </option>
          ))}
        </Select>
        <button
          type="button"
          disabled={pending || !kind}
          className={buttonClass("primary")}
          onClick={() =>
            kind && run(() => answerKindAction(sessionId, q.key, kind))
          }
        >
          {pending ? t("Confirming…") : t("Confirm")}
        </button>
      </div>
      {error && <div className="mt-2 text-[12.5px] text-up">{error}</div>}
    </div>
  );
}
