"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmVariantsAction, keepSeparateAction, mergeProductsAction, type SimpleResult } from "@/app/actions";
import { VARIANT_BYS, VARIANT_BY_LABEL, type VariantBy } from "@/lib/catalog/macro";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { buttonClass, cx } from "../ui";

export interface MacroVM {
  key: string;
  name: string;
  supplier: string | null;
  unit: string;
  spend: number;
  suggestion: "variants" | "merge" | null;
  confidence: "high" | "medium" | "low";
  differs: VariantBy | null;
  /** False when the invoices say these are different products: merging is not offered. */
  mergeable: boolean;
  reason: string;
  members: { id: string; name: string; variant: string | null; price: number | null; spend: number; original: string | null }[];
  leftOut: { name: string; price: number | null }[];
}

const field = "h-8 rounded-md border border-rule-strong bg-canvas px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-ledger";
const CONFIDENCE = { high: "High", medium: "Medium", low: "Low" } as const;

/** "They are versions of one product": what changes between them is asked, never assumed. */
export function VariantsPanel({ ids, name, differs, pending, run }: { ids: string[]; name: string; differs: VariantBy | null; pending: boolean; run: (fn: () => Promise<SimpleResult>) => void }) {
  const t = useT();
  const [by, setBy] = useState<string>(differs ?? "");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-well px-3 py-2.5">
      <label className="flex items-center gap-2 text-[13px]">
        <span className="font-medium">{t("What changes between them?")}</span>
        <select className={field} value={by} onChange={(e) => setBy(e.target.value)}>
          <option value="">{t("Choose…")}</option>
          {VARIANT_BYS.map((k) => (
            <option key={k} value={k}>
              {t(VARIANT_BY_LABEL[k])}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={buttonClass("primary", "sm")} disabled={pending || !by || !name.trim()} onClick={() => run(() => confirmVariantsAction(ids, name, by))}>
        {t("Confirm the variants")}
      </button>
      <span className="text-[12px] text-ink-3">{t("They stay separate products, each with its own purchases and price, under one macro product.")}</span>
    </div>
  );
}

function MacroCard({ m }: { m: MacroVM }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(m.name);
  const [asking, setAsking] = useState(m.suggestion === "variants");
  // Merging turns several products into one: asked twice, and never offered where the invoices say they are different.
  const [merging, setMerging] = useState(false);
  const ids = m.members.map((x) => x.id);
  const run = (fn: () => Promise<SimpleResult>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      router.refresh();
    });
  return (
    <li className="rounded-lg border border-rule bg-canvas px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[14px] font-semibold">{t("These articles seem to belong to the same product")}</h3>
        <span className="text-[12.5px] text-ink-3">
          {m.supplier} · <span className="num">{f.money(Math.round(m.spend))}</span> {t("a year")} · {t("confidence: {level}", { level: t(CONFIDENCE[m.confidence]).toLowerCase() })}
        </span>
      </div>
      <label className="mt-2 block text-[12px] text-ink-3">
        {t("Macro product")}
        <input className={cx(field, "mt-1 block w-full max-w-[520px] font-medium text-ink")} value={name} onChange={(e) => setName(e.target.value)} aria-label={t("Macro product")} />
      </label>
      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11.5px] tracking-[0.04em] text-ink-3 uppercase">
            <th className="py-1 pr-3 font-medium">{t("Variant")}</th>
            <th className="py-1 pr-3 font-medium">{t("Product")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("Price")}</th>
            <th className="py-1 text-right font-medium">{t("Per year")}</th>
          </tr>
        </thead>
        <tbody>
          {m.members.map((x) => (
            <tr key={x.id} className="border-t border-rule align-top">
              <td className="py-1.5 pr-3 font-medium">{x.variant ?? <span className="font-normal text-ink-3">{t("the plain article")}</span>}</td>
              <td className="py-1.5 pr-3">
                <Link href={`/products/${x.id}`} className="break-words hover:underline">
                  {x.name}
                </Link>
                {x.original && <div className="text-[12px] break-words text-ink-3">{t("on the invoices: {text}", { text: x.original })}</div>}
              </td>
              <td className="num py-1.5 pr-3 text-right whitespace-nowrap">{x.price != null ? `${f.price(x.price)}/${m.unit}` : "—"}</td>
              <td className="num py-1.5 text-right whitespace-nowrap">{f.money(Math.round(x.spend))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12.5px] text-ink-2">{m.reason}</p>
      {m.leftOut.length > 0 && <p className="mt-1 text-[12px] text-ink-3">{t("Left out, at a price too far from the others to be a version of the same thing: {names}.", { names: m.leftOut.map((x) => `${x.name} (${f.price(x.price)}/${m.unit})`).join(", ") })}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass(m.suggestion === "variants" ? "primary" : "secondary", "sm")} disabled={pending} aria-expanded={asking} onClick={() => setAsking((x) => !x)}>
          {t("They are variants")}
        </button>
        {m.mergeable && (
          <button type="button" className={buttonClass(m.suggestion === "merge" ? "primary" : "secondary", "sm")} disabled={pending || !name.trim()} aria-expanded={merging} onClick={() => setMerging((x) => !x)} title={t("One product written in several ways: the purchases go under one, and it can be undone.")}>
            {t("They are the same article")}
          </button>
        )}
        <button type="button" className={buttonClass("secondary", "sm")} disabled={pending} onClick={() => run(() => keepSeparateAction(ids))} title={t("Different products: not proposed together again.")}>
          {t("Keep separate")}
        </button>
      </div>
      {!m.mergeable && <p className="mt-2 text-[12px] text-ink-3">{t("Merging is not offered: the supplier billed them on the same day at different prices, so they are different products.")}</p>}
      {asking && <VariantsPanel ids={ids} name={name} differs={m.differs} pending={pending} run={run} />}
      {merging && m.mergeable && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-caution/40 bg-caution-wash px-3 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1 text-ink-2">{t.n(ids.length, "{n} product becomes one.", "{n} products become one: their purchases go under a single product and their prices are read as one price over time. Right only if they are the very same article written in several ways — not for colours, sizes or versions.")}</span>
          <button type="button" className={buttonClass("secondary", "sm")} disabled={pending || !name.trim()} onClick={() => run(() => mergeProductsAction(ids, name))}>
            {t.n(ids.length, "Merge into one product", "Merge {n} products into one")}
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 text-[12.5px] text-up">
          {error}
        </div>
      )}
    </li>
  );
}

const FIRST = 6;

/**
 * Macro products: articles of one supplier that may be versions of the same
 * product. Proposed with the evidence, never grouped by the software: one
 * product, versions of one product, or different products is the user's call.
 */
export function MacroReview({ macros, products }: { macros: MacroVM[]; products: number }) {
  const t = useT();
  const [all, setAll] = useState(false);
  if (!macros.length) return null;
  const shown = all ? macros : macros.slice(0, FIRST);
  return (
    <section className="mb-6" aria-label={t("One product, several versions?")}>
      <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{t("One product, several versions?")}</h2>
      <p className="mt-1 mb-3 text-[13px] text-ink-3">
        {t.n(macros.length, "{n} group of articles with names that begin the same way, from one supplier, in one unit: {k} products in all.", "{n} groups of articles with names that begin the same way, from one supplier, in one unit: {k} products in all.", { k: products })}{" "}
        {t("A price that matches supports it and never decides it. The largest first.")}
      </p>
      <ul className="flex flex-col gap-3">
        {shown.map((m) => (
          <MacroCard key={m.key} m={m} />
        ))}
      </ul>
      {macros.length > FIRST && (
        <button type="button" className={cx(buttonClass("ghost", "sm"), "mt-2")} onClick={() => setAll((x) => !x)}>
          {all ? t("Show fewer") : t("Show all {n}", { n: macros.length })}
        </button>
      )}
    </section>
  );
}
