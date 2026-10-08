"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
import { confirmMappingsAction, keepSeparateAction, mergeProductsAction, type SimpleResult } from "@/app/actions";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { Input, Select } from "../form-kit";
import { buttonClass, cx } from "../ui";

export interface MapProductVM {
  id: string;
  /** The name today (as the invoice wrote it) and the one proposed. */
  current: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  /** The value of the "what it is" choice: a subcategory, or a kind of spend. Empty when unknown. */
  answer: string;
  family: string | null;
  variant: string | null;
  spend: number;
  supplier: string | null;
}

export interface DuplicateVM {
  key: string;
  level: "high" | "possible";
  reason: string;
  suggestion: "merge" | null;
  proposedName: string;
  spend: number;
  products: { id: string; name: string; spend: number; supplier: string | null }[];
}

export interface CardVM {
  key: string;
  type: "check" | "classify";
  supplier: string | null;
  answer: string;
  reason: string;
  spend: number;
  products: MapProductVM[];
  /** What the product could be, when its words name several different things: offered, never chosen for the user. */
  ask?: { value: string; label: string; noun: string }[];
  /** The supplier's code that tells it apart, to keep in the name until a specification is on file. */
  code?: string | null;
}

export interface OptionGroup {
  label: string;
  options: { value: string; label: string }[];
}

export interface ReviewVM {
  analysed: number;
  spend: number;
  confirmed: number;
  highSpend: number;
  reviewProducts: number;
  reviewSpend: number;
  otherSpend: { items: number; amount: number };
  pareto: { share: number; products: number; reached: number }[];
  high: MapProductVM[];
  duplicates: DuplicateVM[];
  cards: CardVM[];
  options: OptionGroup[];
  families: { name: string; subcategory: string | null; products: number; spend: number }[];
}

function useRun() {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<SimpleResult>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? t("Something went wrong."));
      else router.refresh();
    });
  return { pending, error, run, t };
}

function WhatSelect({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: OptionGroup[]; placeholder?: string }) {
  const t = useT();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("What it is")}>
      {(placeholder || !value) && <option value="">{placeholder ?? t("Choose what it is…")}</option>}
      {options.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

const Place = ({ p }: { p: Pick<MapProductVM, "category" | "subcategory" | "family"> }) =>
  p.category ? (
    <span className="text-[12px] text-ink-3">
      {[p.category, p.subcategory].filter(Boolean).join(" › ")}
      {p.family && <span className="text-ink-4"> · {p.family}</span>}
    </span>
  ) : null;

/**
 * Product Mapper: what the catalogue's products are, said by the software;
 * the user confirms the sure ones in one click and looks only at the cases
 * that need a person — the most expensive first.
 */
export function MapperReview({ review: r }: { review: ReviewVM }) {
  const t = useT();
  const open = r.high.length + r.reviewProducts + r.duplicates.length;
  const cases = [...r.duplicates.map((d) => ({ kind: "duplicate" as const, spend: d.spend, d })), ...r.cards.map((c) => ({ kind: "card" as const, spend: c.spend, c }))].sort((a, b) => b.spend - a.spend);
  const stat = (value: string, label: string, tone?: string) => (
    <div>
      <div className={cx("num text-[22px] leading-none font-semibold tracking-[-0.02em]", tone)}>{value}</div>
      <div className="mt-1.5 text-[12.5px] leading-snug text-ink-3">{label}</div>
    </div>
  );
  const eighty = r.pareto.find((p) => p.share === 0.8);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-rule px-5 py-5 sm:px-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{t.n(r.analysed, "We analysed {n} product", "We analysed {n} products")}</h2>
        <p className="mt-1 max-w-[72ch] text-[13px] text-ink-3">
          {open > 0
            ? t("We worked out what you buy: a readable name, a category and a family for each product. You only check where we are in doubt. What the invoices wrote stays linked to every product, and no price, quantity or supplier is touched.")
            : t("Every product has been confirmed. New products from the next imports will appear here.")}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 @3xl:grid-cols-5">
          {r.confirmed > 0 && stat(f.number(r.confirmed, 0), t("already confirmed"), "text-down")}
          {stat(f.number(r.high.length, 0), t("classified automatically"))}
          {stat(f.number(r.duplicates.length, 0), t("possible duplicates"), r.duplicates.length ? "text-caution" : undefined)}
          {stat(f.number(r.reviewProducts, 0), t("need your check"), r.reviewProducts ? "text-caution" : undefined)}
          {stat(f.number(r.otherSpend.items, 0), t("items of services and other spend"))}
        </div>
        {open > 0 && (
          <p className="mt-4 border-t border-rule pt-3 text-[13px] text-ink-2">
            {t("Spend classified automatically:")} <span className="num font-semibold text-ink">{f.money(Math.round(r.highSpend))}</span> · {t("spend to check:")}{" "}
            <span className="num font-semibold text-ink">{f.money(Math.round(r.reviewSpend + r.duplicates.reduce((s, d) => s + d.spend, 0)))}</span>
            {r.otherSpend.items > 0 && (
              <>
                {" "}
                · {t("other company spend, kept out of the catalogue:")} <span className="num font-medium text-ink">{f.money(Math.round(r.otherSpend.amount))}</span>
              </>
            )}
          </p>
        )}
      </div>

      {eighty && r.analysed > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-rule px-5 py-4 sm:px-6">
          <div className="min-w-[260px] flex-1">
            <div className="text-[15px] font-semibold">
              {t.n(eighty.products, "{n} product makes up {pct}% of your product spend", "{n} products make up {pct}% of your product spend", { pct: Math.round(eighty.reached * 100) })}
            </div>
            <div className="mt-0.5 text-[13px] text-ink-3">{t("That is where a check is worth the most. The cases below are in the same order: the largest spend first.")}</div>
          </div>
          <div className="flex gap-5">
            {r.pareto.map((p) => (
              <div key={p.share} className="text-center">
                <div className="num text-[18px] leading-none font-semibold">{p.products}</div>
                <div className="mt-1 text-[11.5px] text-ink-3">{t("{pct}% of spend", { pct: Math.round(p.share * 100) })}</div>
              </div>
            ))}
          </div>
          <Link href="/products?view=high-spend" className={buttonClass("secondary")}>
            {t("See the top-spend products")}
          </Link>
        </div>
      )}

      {r.high.length > 0 && <Bulk products={r.high} spend={r.highSpend} options={r.options} />}

      {cases.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[14px] font-semibold">
            {t.n(cases.length, "{n} case to check", "{n} cases to check")} <span className="font-normal text-ink-3">· {t("largest spend first")}</span>
          </h3>
          <ul className="space-y-3">
            {cases.map((x) => (
              <li key={x.kind === "duplicate" ? x.d.key : x.c.key}>{x.kind === "duplicate" ? <DuplicateCard d={x.d} /> : <ReviewCardView c={x.c} options={r.options} />}</li>
            ))}
          </ul>
        </div>
      )}

      {r.families.length > 0 && <Families families={r.families} />}
    </div>
  );
}

/** "133 products classified with high confidence — Confirm all", with the list for those who want to look. */
function Bulk({ products, spend, options }: { products: MapProductVM[]; spend: number; options: OptionGroup[] }) {
  const { pending, error, run, t } = useRun();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(40);
  return (
    <div className="overflow-hidden rounded-xl border border-ledger/25">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 bg-ledger-wash/50 px-5 py-4 sm:px-6">
        <div className="min-w-[240px] flex-1">
          <div className="text-[15px] font-semibold">{t.n(products.length, "{n} product classified with high confidence", "{n} products classified with high confidence")}</div>
          <div className="mt-0.5 text-[13px] text-ink-2">
            <span className="num">{f.money(Math.round(spend))}</span> {t("of spend covered")} — {t("the name itself says what they are")}
          </div>
          {error && <div className="mt-1.5 text-[12.5px] text-up">{error}</div>}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={buttonClass("secondary")}>
          <ChevronRight size={14} className={cx("transition-transform duration-150", open && "rotate-90")} /> {open ? t("Hide details") : t("See details")}
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => confirmMappingsAction())} className={buttonClass("primary")}>
          <Check size={14} /> {pending ? t("Confirming…") : t("Confirm all")}
        </button>
      </div>
      {open && (
        <ul className="border-t border-rule">
          {products.slice(0, shown).map((p) => (
            <HighRow key={p.id} p={p} options={options} />
          ))}
          {products.length > shown && (
            <li className="px-5 py-3 text-center sm:px-6">
              <button type="button" className="text-[13px] font-medium text-ledger hover:underline" onClick={() => setShown((n) => n + 100)}>
                {t("Show {n} more", { n: Math.min(100, products.length - shown) })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function HighRow({ p, options }: { p: MapProductVM; options: OptionGroup[] }) {
  const { pending, error, run, t } = useRun();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(p.name);
  const [answer, setAnswer] = useState(p.answer);
  const renamed = p.name !== p.current;
  return (
    <li className="border-b border-rule last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2.5 text-left hover:bg-well sm:px-6">
        <ChevronRight size={13} className={cx("shrink-0 text-ink-4 transition-transform duration-150", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
          <Place p={p} />
        </span>
        <span className="num text-[12.5px] text-ink-3">{f.money(Math.round(p.spend))}</span>
      </button>
      {open && (
        <div className="space-y-3 bg-well px-5 pt-1 pb-4 pl-[45px] sm:px-6 sm:pl-[49px]">
          <div className="text-[12.5px] text-ink-3">
            {renamed ? t("On the invoices:") : t("Name unchanged:")} <span className="text-ink-2">{p.current}</span>
            {p.supplier && ` · ${p.supplier}`}
            {p.variant && p.family && ` · ${t("variant {variant} of {family}", { variant: p.variant, family: p.family })}`}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1 text-[12px] font-medium text-ink-3">
              {t("Name")}
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full" />
            </label>
            <label className="text-[12px] font-medium text-ink-3">
              {t("What it is")}
              <div className="mt-1">
                <WhatSelect value={answer} onChange={setAnswer} options={options} />
              </div>
            </label>
            <button
              type="button"
              disabled={pending || !name.trim() || !answer}
              className={buttonClass("primary")}
              onClick={() => run(() => confirmMappingsAction({ productIds: [p.id], answer: answer !== p.answer ? answer : undefined, names: { [p.id]: name } }))}
            >
              {pending ? t("Confirming…") : t("Confirm")}
            </button>
          </div>
          {error && <div className="text-[12.5px] text-up">{error}</div>}
        </div>
      )}
    </li>
  );
}

/** "We think these are the same product": merge them into one, or say they are different. */
function DuplicateCard({ d }: { d: DuplicateVM }) {
  const { pending, error, run, t } = useRun();
  const [name, setName] = useState(d.proposedName);
  const merge = d.suggestion === "merge";
  const ids = d.products.map((p) => p.id);
  return (
    <div className="rounded-lg border border-rule px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-[14px] font-semibold">{d.level === "high" ? t("The same product, written twice") : t("They may be the same product")}</h4>
        <span className="text-[12.5px] text-ink-3">
          <span className="num">{f.money(Math.round(d.spend))}</span> {t("a year")}
          {d.products[0].supplier && ` · ${d.products[0].supplier}`}
        </span>
      </div>
      <ul className="mt-2 space-y-1 text-[13.5px]">
        {d.products.map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-x-3">
            <Link href={`/products/${p.id}`} className="min-w-0 font-medium break-words hover:underline">
              {p.name}
            </Link>
            <span className="num text-[12px] text-ink-3">{f.money(Math.round(p.spend))}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-[13px] text-ink-2">
        <span className="text-ink-3">{t("Reason:")}</span> {d.reason}
        {merge && (
          <>
            {" "}
            <span className="text-ink-3">{t("Suggestion:")}</span> <span className="font-medium">{t("merge them")}</span>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1 text-[12px] font-medium text-ink-3">
          {t("Name if merged")}
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full" />
        </label>
        <button type="button" disabled={pending || !name.trim()} className={buttonClass(merge ? "primary" : "secondary")} onClick={() => run(() => mergeProductsAction(ids, name))}>
          {t("Merge")}
        </button>
        <button type="button" disabled={pending} className={buttonClass(merge ? "secondary" : "primary")} onClick={() => run(() => keepSeparateAction(ids))}>
          {t("Keep separate")}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-ink-4">{t("Merging moves every purchase under one product; each purchase keeps its own price, quantity, date and original description.")}</p>
      {error && <div className="mt-2 text-[12.5px] text-up">{error}</div>}
    </div>
  );
}

const SHOWN = 8;

/** Products the software read from their supplier's context (to check), or could not read at all (to classify): one answer for the group. */
function ReviewCardView({ c, options }: { c: CardVM; options: OptionGroup[] }) {
  const { pending, error, run, t } = useRun();
  // Nothing says which of several things it is: no answer is chosen in advance, and "I don't know yet" is to leave it.
  const asking = (c.ask?.length ?? 0) > 0;
  const [answer, setAnswer] = useState(asking ? "" : c.answer);
  const [names, setNames] = useState<Record<string, string>>(Object.fromEntries(c.products.slice(0, SHOWN).map((p) => [p.id, p.name])));
  const [named, setNamed] = useState("");
  const check = c.type === "check";
  const ids = c.products.map((p) => p.id);
  const choose = (value: string) => {
    setAnswer(value);
    const noun = c.ask?.find((o) => o.value === value)?.noun;
    if (noun) setNamed([noun, c.code].filter(Boolean).join(" "));
  };
  return (
    <div className="rounded-lg border border-rule px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-[14px] font-semibold">{check ? t("Check what we read") : asking ? t("Needs technical identification") : c.products.length > 1 ? t("What are these?") : t("What is this?")}</h4>
        <span className="text-[12.5px] text-ink-3">
          {t.n(c.products.length, "{n} product", "{n} products")} · <span className="num">{f.money(Math.round(c.spend))}</span> {t("a year")}
          {c.supplier && ` · ${c.supplier}`}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] text-ink-2">{c.reason}</p>
      {check ? (
        <ul className="mt-3 space-y-2.5">
          {c.products.slice(0, SHOWN).map((p) => (
            <li key={p.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-ink-3">
                <span className="min-w-0 break-words">
                  {t("On the invoices:")}{" "}
                  <Link href={`/products/${p.id}`} className="text-ink-2 hover:underline">
                    {p.current}
                  </Link>
                </span>
                <span className="num">{f.money(Math.round(p.spend))}</span>
              </div>
              <Input value={names[p.id] ?? p.name} onChange={(e) => setNames((n) => ({ ...n, [p.id]: e.target.value }))} aria-label={t("Name")} className="mt-1 w-full" />
            </li>
          ))}
          {c.products.length > SHOWN && <li className="text-[12.5px] text-ink-3">{t("and {n} more", { n: c.products.length - SHOWN })}</li>}
        </ul>
      ) : (
        <>
          <ul className="mt-2 space-y-1 text-[13.5px]">
            {c.products.slice(0, SHOWN).map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`/products/${p.id}`} className="min-w-0 font-medium break-words hover:underline">
                  {p.current}
                </Link>
                <span className="num text-[12px] text-ink-3">{f.money(Math.round(p.spend))}</span>
              </li>
            ))}
            {c.products.length > SHOWN && <li className="text-[12.5px] text-ink-3">{t("and {n} more", { n: c.products.length - SHOWN })}</li>}
          </ul>
          {asking ? (
            <div className="mt-3">
              <div className="text-[13px] font-medium">{t("Do you know which description fits best?")}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.ask!.map((o) => (
                  <button key={o.value} type="button" aria-pressed={answer === o.value} onClick={() => choose(o.value)} className={cx(buttonClass(answer === o.value ? "primary" : "secondary", "sm"))}>
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-ink-3">
                {t("Something else: choose it from the list below. If you don't know yet, leave it: it keeps the name it has and waits here.")}{" "}
                <Link href={`/products/${ids[0]}`} className="text-ledger hover:underline">
                  {t("Have the technical data sheet? Add it on the product's page.")}
                </Link>
              </p>
              {answer && (
                <label className="mt-2 block text-[12px] text-ink-3">
                  {t("The name it will have — the supplier's code stays in it until a grade or a specification is known. Change it if you know better.")}
                  <Input value={named} onChange={(e) => setNamed(e.target.value)} aria-label={t("Name")} className="mt-1 w-full" />
                </label>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-ink-4">{t("A name that starts with a size or a code gets what it is in front (“Label 50x70 …”). You can change any name afterwards.")}</p>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <WhatSelect value={answer} onChange={choose} options={options} placeholder={c.products.length > 1 ? t("Choose what they are…") : t("Choose what it is…")} />
        <button
          type="button"
          disabled={pending || !answer || (check && Object.values(names).some((n) => !n.trim()))}
          className={buttonClass("primary")}
          onClick={() => run(() => confirmMappingsAction({ productIds: ids, answer: !check || answer !== c.answer ? answer : undefined, names: check ? names : asking && named.trim() ? { [ids[0]]: named.trim() } : undefined }))}
        >
          {pending ? t("Confirming…") : t("Confirm")}
        </button>
      </div>
      {error && <div className="mt-2 text-[12.5px] text-up">{error}</div>}
    </div>
  );
}

function Families({ families }: { families: ReviewVM["families"] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-rule">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3.5 text-left sm:px-6">
        <ChevronRight size={14} className={cx("shrink-0 text-ink-4 transition-transform duration-150", open && "rotate-90")} />
        <span className="flex-1 text-[14px] font-semibold">{t.n(families.length, "{n} product family", "{n} product families")}</span>
        <span className="text-[12.5px] text-ink-3">{t("the same product in several sizes, colours or types")}</span>
      </button>
      {open && (
        <ul className="border-t border-rule">
          {families.map((x) => (
            <li key={`${x.name}|${x.subcategory}`} className="flex flex-wrap items-baseline gap-x-3 border-b border-rule px-5 py-2 text-[13.5px] last:border-b-0 sm:px-6">
              <Link href={`/products?show=all&q=${encodeURIComponent(x.name)}`} className="min-w-0 flex-1 font-medium hover:underline">
                {x.name}
              </Link>
              <span className="text-[12px] text-ink-3">{x.subcategory}</span>
              <span className="text-[12px] text-ink-3">{t.n(x.products, "{n} variant", "{n} variants")}</span>
              <span className="num w-[90px] text-right text-[12.5px] text-ink-2">{f.money(Math.round(x.spend))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
