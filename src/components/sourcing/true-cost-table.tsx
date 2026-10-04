import Link from "next/link";
import { Disclosure, Table, Td, Th, cx } from "@/components/ui";
import * as f from "@/lib/format";
import type { T } from "@/lib/i18n";
import { CONFIDENCE_WORD } from "@/lib/intel/summary";
import { perUnit } from "@/lib/sourcing/market";
import { BASIS_LABEL, COST_LABEL, OPPORTUNITY_LEVEL, type CostKey } from "@/lib/sourcing/true-cost";
import { COMPARABILITY_LABEL } from "@/lib/sourcing/types";
import type { ProductCosts, QuoteCost } from "@/server/sourcing";
import { TrueCostForm } from "./spec";
import { PriceTypeTag } from "./tags";

const money = (n: number) => (Math.abs(n) < 0.0005 ? "€0" : `${n < 0 ? "−" : ""}${f.priceShort(Math.abs(n))}`);

/**
 * What is paid today next to every quote on file, on true cost: the quoted
 * price and, one by one, what stands between it and the goods at the door.
 * A component nobody has given is "missing", and the total is then not
 * shown. The lowest quote and the lowest true cost are named apart: they
 * need not be the same supplier.
 */
export function TrueCostTable({ productId, unit, currentSupplier, costs, t }: { productId: string; unit: string; currentSupplier: string | null; costs: ProductCosts; t: T }) {
  const quotes = costs.quotes;
  const component = (q: QuoteCost, key: CostKey) => q.cost.components.find((c) => c.key === key)!;
  const cell = (q: QuoteCost, key: CostKey) => {
    const c = component(q, key);
    return (
      <Td key={q.quoteId} align="right" className="whitespace-normal!">
        <span className={cx("num", c.perUnit == null && c.required ? "font-medium text-up" : c.perUnit == null ? "text-ink-3" : "")}>{c.perUnit == null ? (c.required ? t("Missing") : "—") : key === "price" ? perUnit(c.perUnit, unit) : money(c.perUnit)}</span>
        <div className="text-[11px] text-ink-3">{c.perUnit == null && !c.required ? c.note : t(BASIS_LABEL[c.basis])}</div>
      </Td>
    );
  };
  const row = (label: string, current: React.ReactNode, each: (q: QuoteCost) => React.ReactNode, strong = false) => (
    <tr className={strong ? "bg-wash/60" : undefined}>
      <Td className={cx("whitespace-normal! text-[12.5px]", strong ? "font-semibold" : "text-ink-2")}>{label}</Td>
      <Td align="right" muted className="text-[12.5px]">
        {current}
      </Td>
      {quotes.map((q) => each(q))}
    </tr>
  );
  const plain = (q: QuoteCost, value: React.ReactNode) => (
    <Td key={q.quoteId} align="right" className="whitespace-normal! text-[12.5px]">
      {value}
    </Td>
  );
  const dash = <span className="text-ink-4">—</span>;
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th />
            <Th align="right">
              {currentSupplier ?? t("Current supplier")}
              <div className="text-[11px] font-normal text-ink-3 normal-case">{t("today")}</div>
            </Th>
            {quotes.map((q) => (
              <Th key={q.quoteId} align="right">
                {q.supplierName}
                <div className="text-[11px] font-normal text-ink-3 normal-case">{q.expired ? t("Offer expired") : q.date ? t("offer of {date}", { date: f.date(q.date) }) : ""}</div>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row(
            t("Nominal price"),
            costs.baseline != null ? (
              <span className="inline-flex flex-col items-end gap-0.5">
                <span className="num font-medium text-ink">{perUnit(costs.baseline, unit)}</span>
                <PriceTypeTag type="actual" />
              </span>
            ) : (
              dash
            ),
            (q) => (
              <Td key={q.quoteId} align="right">
                <span className="inline-flex flex-col items-end gap-0.5">
                  <span className="num font-medium">{q.priceEUR != null ? perUnit(q.priceEUR, unit) : `${q.currency} ${f.number(q.price)}/${unit}`}</span>
                  <PriceTypeTag type="quote" />
                </span>
              </Td>
            ),
          )}
          {row(t("Delivery terms"), dash, (q) => plain(q, q.incoterm ?? <span className="font-medium text-caution">{t("Delivery terms unknown")}</span>))}
          {row(COST_LABEL.freight ? t(COST_LABEL.freight) : "", <span className="text-[11.5px]">{t("in the invoice price")}</span>, (q) => cell(q, "freight"))}
          {row(t(COST_LABEL.duty), dash, (q) => cell(q, "duty"))}
          {quotes.some((q) => component(q, "customs").basis !== "none") && row(t(COST_LABEL.customs), dash, (q) => cell(q, "customs"))}
          {quotes.some((q) => q.currency !== "EUR") && row(t("Exchange rate"), dash, (q) => plain(q, q.currency === "EUR" ? dash : q.priceEUR != null ? `${f.number(q.price / q.priceEUR, 4)} ${q.currency}/EUR` : <span className="font-medium text-up">{t("Missing")}</span>))}
          {row(t(COST_LABEL.moq), dash, (q) => cell(q, "moq"))}
          {row(t(COST_LABEL.payment), costs.baselinePaymentDays != null ? t("{n} days", { n: costs.baselinePaymentDays }) : dash, (q) => cell(q, "payment"))}
          {row(
            t("Estimated true cost"),
            costs.baseline != null ? <span className="num font-semibold text-ink">{perUnit(costs.baseline, unit)}</span> : dash,
            (q) => (
              <Td key={q.quoteId} align="right" className="whitespace-normal!">
                {q.cost.perUnit != null ? <span className="num font-semibold">{perUnit(q.cost.perUnit, unit)}</span> : <span className="font-medium text-up">{t("Incomplete")}</span>}
                {q.cost.perUnit == null && <div className="text-[11px] text-ink-3">{t("missing: {list}", { list: q.cost.missing.join(", ").toLowerCase() })}</div>}
              </Td>
            ),
            true,
          )}
          {row(t("Lead time"), dash, (q) => plain(q, q.leadTimeDays != null ? t("{n} days", { n: q.leadTimeDays }) : dash))}
          {row(t("Minimum order"), dash, (q) => plain(q, q.moq != null ? `${f.number(q.moq, 0)} ${unit}` : dash))}
          {row(t("Technical match"), dash, (q) => plain(q, q.technicalConfirmed ? <span className="font-medium text-down">{t("Confirmed by you")}</span> : <span className="text-caution">{`${t(COMPARABILITY_LABEL[q.comparability])} · ${t("to confirm")}`}</span>))}
          {row(t("Confidence"), t("From your invoices"), (q) => plain(q, q.cost.confidence ? t(CONFIDENCE_WORD[q.cost.confidence]) : dash))}
        </tbody>
      </Table>
      <div className="space-y-1.5 px-5 py-3 text-[13px]">
        <p className="text-[12.5px] text-ink-3">{t("Current baseline based on invoice price. Cost breakdown unavailable.")}</p>
        <p>
          <span className="font-medium">{t("Lowest quote:")}</span>{" "}
          {costs.lowestQuote ? `${costs.lowestQuote.supplierName}, ${perUnit(costs.lowestQuote.priceEUR!, unit)}` : <span className="text-ink-3">{t("shown when at least two comparable offers are on file")}</span>}
        </p>
        <p>
          <span className="font-medium">{t("Lowest estimated true cost:")}</span>{" "}
          {costs.lowestTrueCost ? `${costs.lowestTrueCost.supplierName}, ${perUnit(costs.lowestTrueCost.cost.perUnit!, unit)}` : <span className="text-ink-3">{t("shown when at least two offers have a complete true cost")}</span>}
        </p>
        {quotes.flatMap((q) => q.cost.warnings.map((w) => `${q.supplierName}: ${w}`)).map((w) => (
          <p key={w} className="text-[12.5px] text-caution">
            {w}
          </p>
        ))}
        <p className="text-[12px] text-ink-3">
          {t("Payment terms are valued at {financing}% a year and stock at {holding}% a year.", { financing: costs.rates.financing, holding: costs.rates.holding })} {costs.rates.own ? t("Your own rates, from Settings.") : t("Starting assumptions: set your own in Settings.")}{" "}
          <Link href={`/compare?product=${productId}`} className="font-medium text-ledger hover:underline">
            {t("Open the full comparison")}
          </Link>
        </p>
      </div>
      {quotes.map((q) => (
        <Disclosure key={q.quoteId} flush={false} className="mx-5 mb-3" title={t("True cost inputs: {name}", { name: q.supplierName })} description={q.cost.complete ? t("Complete — adjust if you know better") : t("Missing: {list}", { list: q.cost.missing.join(", ").toLowerCase() })} defaultOpen={!q.cost.complete}>
          <ul className="mb-3 space-y-0.5 text-[12.5px] text-ink-2">
            {q.cost.components
              .filter((c) => c.note)
              .map((c) => (
                <li key={c.key}>
                  <span className="text-ink-3">{t(COST_LABEL[c.key])}:</span> {c.note}
                </li>
              ))}
          </ul>
          <TrueCostForm quoteId={q.quoteId} unit={unit} inputs={q.inputs} needs={{ freight: q.cost.components.find((c) => c.key === "freight")!.basis !== "included", customs: !["none", "included"].includes(q.cost.components.find((c) => c.key === "duty")!.basis) }} />
        </Disclosure>
      ))}
    </>
  );
}

/** What the difference is worth, and what it may be called: a validated opportunity only when a real quote, its true cost and the specification all stand. */
export function QuoteOpportunityBlock({ unit, costs, annualQuantity, t }: { unit: string; costs: ProductCosts; annualQuantity: number; t: T }) {
  const best = costs.best;
  if (!best?.opportunity || costs.baseline == null) return null;
  const o = best.opportunity;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx("inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-semibold", o.level === "validated" ? "bg-down-wash text-down" : "bg-caution-wash text-caution")}>{t(OPPORTUNITY_LEVEL[o.level].label)}</span>
        <span className="text-[12.5px] text-ink-3">{t(OPPORTUNITY_LEVEL[o.level].meaning)}</span>
      </div>
      <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13px] @2xl:grid-cols-2">
        {[
          [t("Current baseline"), perUnit(costs.baseline, unit)],
          [t("{name}: estimated true cost", { name: best.supplierName }), perUnit(best.cost.perUnit!, unit)],
          [t("Difference"), perUnit(o.perUnit, unit)],
          [t("Annual volume"), `${f.number(annualQuantity, 0)} ${unit}`],
          [t("Estimated annual opportunity"), o.annual != null ? f.moneyApprox(o.annual) : "—"],
          [t("Confidence"), t(CONFIDENCE_WORD[o.confidence])],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-rule pb-1.5">
            <dt className="text-ink-3">{label}</dt>
            <dd className="num font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {o.pending.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[13px] text-caution">
          {o.pending.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12.5px] text-ink-3">{t("Not a saving: a saving is what an invoice proves, after you have bought.")}</p>
    </div>
  );
}
