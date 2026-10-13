"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { AwaitingRow, OfferRow } from "@/lib/replies/rows";
import { Input } from "../form-kit";
import { cx } from "../ui";
import { SuggestionButtons } from "./offer-controls";

const pill = (tone: "blue" | "amber" | "grey" | "red" | "green") =>
  cx(
    "inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap",
    tone === "blue" ? "bg-ledger-wash text-ledger" : tone === "amber" ? "bg-caution-wash text-caution" : tone === "red" ? "bg-up-wash text-up" : tone === "green" ? "bg-down-wash text-down" : "bg-wash text-ink-2",
  );
const COMPATIBILITY_TONE = { not_analyzed: "grey", possible: "amber", awaiting_specs: "amber", sample_to_test: "blue", validated: "green", not_equivalent: "grey" } as const;
const chip = (on: boolean) =>
  cx("inline-flex h-7 items-center rounded-full border px-2.5 text-[12.5px] whitespace-nowrap", on ? "border-ledger/30 bg-ledger-wash font-medium text-ledger" : "border-rule-strong text-ink-2 hover:border-ink/25 hover:bg-wash");

/** One offer in a line or two: who, what, at what price and on what terms; how it stands; what to do. Its full detail is one click away. */
function OfferLine({ row }: { row: OfferRow }) {
  const t = useT();
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <div className="min-w-0">
          <Link href={row.supplierHref} className="font-medium hover:text-ledger">
            {row.supplier}
          </Link>
          <span className="text-ink-3"> · </span>
          <Link href={row.href} className="text-ink-2 hover:text-ledger hover:underline">
            {row.product}
          </Link>
          {row.detail && <span className="text-[12.5px] text-ink-3"> · {row.detail}</span>}
        </div>
        <div className="num text-[14px] font-semibold whitespace-nowrap">
          {row.price} <span className="text-[12.5px] font-normal text-ink-3">{row.terms}</span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className={pill(COMPATIBILITY_TONE[row.compatibilityKey])}>{row.compatibility}</span>
        {row.stateKey !== "quote_received" && row.stateKey !== "not_comparable" && <span className={pill(row.stateKey === "expired" || row.stateKey === "rejected" ? "red" : row.stateKey === "validated" ? "green" : "grey")}>{row.state}</span>}
        <span className={cx("text-[12.5px]", row.validityTone === "expired" ? "font-medium text-up" : row.validityTone === "soon" ? "font-medium text-caution" : "text-ink-3")}>{row.validity}</span>
        {row.quantity && <span className="text-[12.5px] text-ink-3">· {row.quantity}</span>}
      </div>
      {row.reasons.length > 0 && <p className="mt-1.5 text-[12.5px] text-ink-2">{row.reasons.join(" ")}</p>}
      {row.group === "to_verify" && row.shortfalls.length > 0 && (
        <p className="mt-1 text-[12.5px] text-caution">
          {t("To become comparable")}: {row.shortfalls.join(" · ")}
        </p>
      )}
      {row.nextAction && (
        <p className="mt-1 text-[12.5px] text-ink-2">
          <span className="font-medium">{t("Next action")}:</span> {row.nextAction}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        {row.link === "proposed" && <SuggestionButtons offerId={row.offerId} productId={row.productId} compatibility={row.compatibilityKey} reasons={row.reasons} />}
        <Link href={row.href} className="text-[12.5px] font-medium text-ledger hover:underline">
          {t("Open the offer")}
        </Link>
      </div>
    </li>
  );
}

function Comparable({ row }: { row: OfferRow }) {
  const t = useT();
  const fact = (label: string, value: string | null) =>
    value ? (
      <div className="min-w-0">
        <dt className="text-[12px] text-ink-3">{label}</dt>
        <dd className="num">{value}</dd>
      </div>
    ) : null;
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <div className="min-w-0">
          <Link href={row.supplierHref} className="font-medium hover:text-ledger">
            {row.supplier}
          </Link>
          <span className="text-ink-3"> · </span>
          <Link href={row.href} className="text-ink-2 hover:text-ledger hover:underline">
            {row.product}
          </Link>
        </div>
        <div className="num text-[14px] font-semibold whitespace-nowrap">{row.landed}</div>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-[13px] @xl:grid-cols-3 @4xl:grid-cols-6">
        {fact(t("Price as quoted"), `${row.price} ${row.terms}`)}
        {fact(t("Quantity"), row.quantity)}
        {fact(t("Payment terms"), row.payment)}
        {fact(t("Validity"), row.validity)}
        {row.compare && fact(row.compare.lower ? t("Lower than today by") : t("Higher than today by"), `${row.compare.perUnit}${row.compare.pct ? ` (${row.compare.pct})` : ""}`)}
        {row.compare?.lower && fact(t("Potential saving, on the volume of the last 12 months"), row.compare.annual)}
      </dl>
      {row.compare && <p className="mt-1.5 text-[12.5px] text-ink-3">{t("Against {current}, the last price you paid. A potential saving, on the volume of the last 12 months: nothing is saved until an invoice says so.", { current: row.compare.current })}</p>}
      {row.compare?.limit && <p className="mt-1 text-[12.5px] text-caution">{row.compare.limit}</p>}
    </li>
  );
}

/**
 * What the replies to requests say about one product: the offers ready to be
 * compared, the ones still to verify, the companies that answered without a
 * price. Offers that are not the same product, and the ones time or a person
 * set aside, are kept apart and closed.
 */
export function ProductOffersPanel({ comparable, toVerify, otherGrades, history, awaiting, notSuitable }: { comparable: OfferRow[]; toVerify: OfferRow[]; otherGrades: OfferRow[]; history: OfferRow[]; awaiting: AwaitingRow[]; notSuitable: number }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const all = [...toVerify, ...otherGrades];
  const kinds = [...new Map(all.map((r) => [r.compatibilityKey, r.compatibility])).entries()];
  const match = (text: string) => !q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());
  const shown = (rows: OfferRow[]) => rows.filter((r) => (!only || r.compatibilityKey === only) && match(`${r.supplier} ${r.product} ${r.detail ?? ""}`));
  const head = (title: string, n: number, about: string) => (
    <div className="border-t border-rule bg-well px-5 py-2.5 first:border-t-0">
      <div className="text-[13px] font-semibold">
        {title} <span className="num ml-1 text-[12px] font-normal text-ink-3">{n}</span>
      </div>
      <div className="text-[12.5px] text-ink-3">{about}</div>
    </div>
  );
  const verify = shown(toVerify);
  const others = shown(otherGrades);

  return (
    <div>
      {all.length > 4 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search a supplier or a product")} className="h-8! w-full text-[13px]! @xl:w-[260px]" aria-label={t("Search a supplier or a product")} />
          <button type="button" className={chip(!only)} onClick={() => setOnly(null)}>
            {t("All")}
          </button>
          {kinds.map(([key, label]) => (
            <button key={key} type="button" className={chip(only === key)} onClick={() => setOnly(only === key ? null : key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {head(t("Comparable offers"), comparable.length, t("Technically validated, still valid, with the cost known all the way to your plant."))}
      {comparable.length === 0 ? (
        <p className="px-5 py-3 text-[13px] text-ink-3">{t("No offer can be compared yet. It takes a validated technical equivalence, a validity that has not run out and a complete cost to your plant: until then no price here is set against what you pay.")}</p>
      ) : (
        <ul className="divide-y divide-rule">{comparable.map((r) => <Comparable key={r.offerId} row={r} />)}</ul>
      )}

      {head(t("Offers to verify"), toVerify.length, t("Prices received that are not comparable yet: each says what it still takes."))}
      {verify.length === 0 ? <p className="px-5 py-3 text-[13px] text-ink-3">{toVerify.length ? t("None matches the search.") : t("No offer to verify for this product.")}</p> : <ul className="divide-y divide-rule">{verify.map((r) => <OfferLine key={r.offerId} row={r} />)}</ul>}

      {head(t("Suppliers with no price yet"), awaiting.length, t("They answered about this kind of product and need something more before they quote."))}
      {awaiting.length === 0 ? (
        <p className="px-5 py-3 text-[13px] text-ink-3">{t("No company is waiting on you for this product.")}</p>
      ) : (
        <ul className="divide-y divide-rule">
          {awaiting.filter((a) => match(a.supplier)).map((a) => (
            <li key={a.key} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Link href={a.supplierHref} className="font-medium hover:text-ledger">
                  {a.supplier}
                </Link>
                <span className={pill(a.statusKey === "needs_information" ? "amber" : "grey")}>{a.status}</span>
                <span className="text-[12px] text-ink-3">{a.basis}</span>
              </div>
              {a.missing && (
                <p className="mt-1 text-[12.5px] text-caution">
                  <span className="font-medium">{t("Still missing")}:</span> {a.missing}
                </p>
              )}
              {a.nextAction && (
                <p className="mt-1 text-[12.5px] text-ink-2">
                  <span className="font-medium">{t("Next action")}:</span> {a.nextAction}
                  {a.followUp && <span className="text-ink-3"> · {t("by {date}", { date: a.followUp })}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {otherGrades.length > 0 && (
        <details className="group border-t border-rule">
          <summary className="cursor-pointer list-none px-5 py-2.5 text-[13px] font-semibold select-none hover:bg-well [&::-webkit-details-marker]:hidden">
            {t("Other grades and offers that are not equivalent")} <span className="num ml-1 text-[12px] font-normal text-ink-3">{otherGrades.length}</span>
            <span className="ml-2 text-[12.5px] font-normal text-ink-3">{t("Shown for what they are: never compared with this product")}</span>
          </summary>
          <ul className="divide-y divide-rule border-t border-rule">{others.map((r) => <OfferLine key={r.offerId} row={r} />)}</ul>
        </details>
      )}
      {history.length > 0 && (
        <details className="group border-t border-rule">
          <summary className="cursor-pointer list-none px-5 py-2.5 text-[13px] font-semibold select-none hover:bg-well [&::-webkit-details-marker]:hidden">
            {t("Earlier versions and offers turned down")} <span className="num ml-1 text-[12px] font-normal text-ink-3">{history.length}</span>
          </summary>
          <ul className="divide-y divide-rule border-t border-rule">{history.map((r) => <OfferLine key={r.offerId} row={r} />)}</ul>
        </details>
      )}
      {notSuitable > 0 && <p className="border-t border-rule px-5 py-2.5 text-[12.5px] text-ink-3">{t.n(notSuitable, "{n} company said it cannot supply this kind of product: kept on file, so that it is not asked again.", "{n} companies said they cannot supply this kind of product: kept on file, so that they are not asked again.")}</p>}
    </div>
  );
}
