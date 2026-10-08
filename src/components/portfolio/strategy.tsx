import Link from "next/link";
import type { ReactNode } from "react";
import { Hint } from "@/components/hint";
import { PriceTypeTag } from "@/components/sourcing/tags";
import { ButtonLink, Disclosure, Section, Table, Td, Th, buttonClass, cx } from "@/components/ui";
import { countryName, flagOf } from "@/lib/countries";
import * as f from "@/lib/format";
import type { Msg, T } from "@/lib/i18n";
import { LEVEL_LABEL, type Level } from "@/lib/negotiation/engine";
import { CRITERIA, CRITERION_LABEL, OBJECTIVE_LABEL, type Objective } from "@/lib/portfolio/config";
import type { Allocation, Bundle, CurrentSupplierView, Decision, Missing, MissingKind, Portfolio, PortfolioProduct, Scenario, ScenarioStatus, Specialist, SpecialistVerdict } from "@/lib/portfolio/engine";
import { limitsSet, strategyHref, type StrategyParams } from "@/lib/portfolio/params";
import { OPPORTUNITY_LEVEL, type OpportunityLevel } from "@/lib/sourcing/true-cost";

const pill = "inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap";

/** Totals at three significant figures: a yearly cost built on estimated volumes carries no more. */
export function approx(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n) || n === 0) return f.money(n);
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(n))) - 2);
  return f.money(Math.round(n / step) * step);
}

const signed = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

const DECISION: Record<Decision, { label: Msg; tone: string; meaning: Msg }> = {
  keep: { label: "Keep current supplier", tone: "bg-down-wash text-down", meaning: "The offers on file do not do better than what you have." },
  switch: { label: "Evaluate a switch", tone: "bg-ledger text-white", meaning: "Another supplier does better on this objective at the prices on file. To validate — samples, terms, a first order — before any decision: the software chooses nothing." },
  negotiate: { label: "Negotiate with current supplier", tone: "bg-ledger-wash text-ledger", meaning: "The evidence on file gives you something to bring to the table with the supplier you have." },
  dual_source: { label: "Dual source", tone: "bg-caution-wash text-caution", meaning: "The product is shared between two suppliers: less dependence, at the cost of managing both." },
  need_data: { label: "Need more data", tone: "border border-dashed border-rule-strong text-ink-3", meaning: "Nothing on file to compare the current supplier with." },
};

const STATUS: Record<ScenarioStatus, { label: Msg; tone: string }> = {
  changed: { label: "A different mix", tone: "bg-ledger text-white" },
  unchanged: { label: "Same as today", tone: "bg-wash text-ink-2" },
  not_enough_data: { label: "Not enough data", tone: "border border-dashed border-rule-strong text-ink-3" },
};

const LEVEL_TONE: Record<Level, string> = { low: "text-down", medium: "text-caution", high: "text-up" };
/** A risk or a potential is "alto", a concentration "alta": the masculine words are their own. */
const RISK_LABEL: Record<Level, Msg> = { low: "Low|risk", medium: "Medium|risk", high: "High|risk" };
const OPPORTUNITY_TONE: Record<OpportunityLevel, string> = { theoretical: "bg-caution-wash text-caution", to_validate: "bg-ledger-wash text-ledger", validated: "bg-down-wash text-down" };

export function DecisionPill({ decision, t }: { decision: Decision; t: T }) {
  const d = DECISION[decision];
  return (
    <span className={cx(pill, d.tone)} title={t(d.meaning)}>
      {t(d.label)}
    </span>
  );
}

function LevelTag({ level, t }: { level: OpportunityLevel; t: T }) {
  return (
    <span className={cx(pill, OPPORTUNITY_TONE[level])} title={t(OPPORTUNITY_LEVEL[level].meaning)}>
      {t(OPPORTUNITY_LEVEL[level].label)}
    </span>
  );
}

function Figure({ label, value, note, hint }: { label: string; value: ReactNode; note?: ReactNode; hint?: string }) {
  return (
    <div className="bg-canvas px-4 py-3">
      <div className="flex items-center gap-1 text-[12px] text-ink-3">
        {label}
        {hint && <Hint text={hint} />}
      </div>
      <div className="num mt-0.5 text-[17px] leading-tight font-semibold tracking-[-0.01em]">{value}</div>
      {note && <div className="mt-0.5 text-[12px] text-ink-3">{note}</div>}
    </div>
  );
}

const leadOf = (s: Scenario, total: number, t: T) => (s.measures.lead.days == null ? t("Not on file") : f.days(s.measures.lead.days, t) + (s.measures.lead.known < total ? ` · ${t("{k} of {n} products", { k: s.measures.lead.known, n: total })}` : ""));
const paymentOf = (s: Scenario, total: number, t: T) => (s.measures.payment.days == null ? t("Not on file") : f.days(s.measures.payment.days, t) + (s.measures.payment.known < total ? ` · ${t("{k} of {n} products", { k: s.measures.payment.known, n: total })}` : ""));
const qualityOf = (s: Scenario, t: T) => (s.quality.status === "insufficient" ? t("Insufficient data") : t(LEVEL_LABEL[s.quality.level]));
const concentrationOf = (s: Scenario, t: T) => `${t(LEVEL_LABEL[s.measures.concentration])} · ${Math.round(s.measures.topShare * 100)}%`;

/** The figures every mix is read by — the same eight for today's and for each scenario. */
function Figures({ s, today, total, t }: { s: Scenario; today?: Scenario; total: number; t: T }) {
  const m = s.measures;
  const differs = !!today && s.status === "changed";
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule @2xl:grid-cols-4">
      <Figure label={t("Annual cost")} value={approx(m.cost)} note={differs ? t("today {amount}", { amount: approx(today!.measures.cost) }) : t("at the prices on file")} hint={t("The price of each product in this mix × what you buy in a year. Where yearly volumes are estimated from the invoices, so is this figure.")} />
      <Figure
        label={t("Estimated economic advantage")}
        value={s.benefit.total > 0 ? t("{amount} a year", { amount: f.moneyApprox(s.benefit.total) }) : s.benefit.total < 0 ? t("−{amount} a year", { amount: f.moneyApprox(-s.benefit.total) }) : "—"}
        note={s.benefit.level ? <LevelTag level={s.benefit.level} t={t} /> : s.negotiationUpside ? t("negotiation upside about {amount}, theoretical", { amount: f.moneyApprox(s.negotiationUpside) }) : t("no offer to compare")}
        hint={t("Today's yearly cost minus this mix's, at the prices on file. An estimate, called by what stands behind it — never a saving: a saving is proved by an invoice.")}
      />
      <Figure label={t("Suppliers")} value={m.suppliers.length} note={differs && today!.measures.suppliers.length !== m.suppliers.length ? t("today {n}", { n: today!.measures.suppliers.length }) : t("for {n} products", { n: total })} />
      <Figure label={t("Average lead time")} value={leadOf(s, total, t)} hint={t("Weighted by spend, over the products whose lead time is on file. It is never estimated.")} />
      <Figure label={t("Spend concentration")} value={<span className={LEVEL_TONE[m.concentration]}>{concentrationOf(s, t)}</span>} note={m.suppliers[0] ? t("with {supplier}", { supplier: m.suppliers[0].name }) : null} hint={t("The share of this spend that goes to the largest supplier. Consolidating gives weight at the table and dependence at the same time.")} />
      <Figure label={t("Supply risk")} value={<span className={LEVEL_TONE[m.risk.level]}>{t(RISK_LABEL[m.risk.level])}</span>} note={t("{pct}% of the spend with a single source", { pct: Math.round((1 - m.risk.shared) * 100) })} hint={t("Read from four things: dependence on one supplier, products with a single source, spend moved to suppliers never bought from, distance.")} />
      <Figure label={t("Quality confidence")} value={qualityOf(s, t)} note={s.quality.status === "insufficient" ? t("no quality record on file") : null} hint={t("How much of the spend goes to suppliers with a recorded quality. No quality history, certification or defect observation is on file yet: nothing is assumed in its place.")} />
      <Figure label={t("Negotiation leverage")} value={t(LEVEL_LABEL[m.leverage.level])} note={t("payment: {terms}", { terms: paymentOf(s, total, t) })} hint={t("What each supplier of the mix would be worth in a year, with everything else you buy from it — the same scale negotiation intelligence reads a relationship with.")} />
    </div>
  );
}

function Parts({ a, t }: { a: Allocation; t: T }) {
  return (
    <div className="flex flex-col gap-1">
      {a.parts.map((x) => (
        <div key={x.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cx("font-medium", !x.current && "text-ledger")}>{x.name}</span>
          {a.parts.length > 1 && <span className="num text-ink-3">{Math.round(x.share * 100)}%</span>}
          <span className="num text-ink-2">{`${f.price(x.unitCost)}/${a.unit}`}</span>
          <PriceTypeTag type={x.evidence === "actual" ? "actual" : "quote"} />
          {x.evidence === "quoted_price" && <span className="text-[12px] text-caution">{t("true cost incomplete")}</span>}
          {!x.known && <span className="text-[12px] text-ink-3">{t("never bought from")}</span>}
        </div>
      ))}
    </div>
  );
}

function AllocationTable({ rows, today, t }: { rows: Allocation[]; today: boolean; t: T }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{t("Product")}</Th>
          <Th>{today ? t("Supplier today") : t("In this mix")}</Th>
          <Th align="right" className="hidden @xl:table-cell">
            {t("Per year")}
          </Th>
          {!today && <Th align="right">{t("Against today")}</Th>}
          <Th>{t("What the data supports")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.productId} className="align-top">
            <Td className="max-w-[260px] whitespace-normal!">
              <Link href={`/products/${a.productId}`} className="font-medium hover:underline">
                {a.name}
              </Link>
              <div className="num text-[12px] text-ink-3">{t("{pct}% of this spend", { pct: f.number(a.weight * 100, 1) })}</div>
            </Td>
            <Td className="whitespace-normal!">
              <Parts a={a} t={t} />
              {!today && a.parts.some((x) => !x.current) && <div className="mt-0.5 text-[12px] text-ink-3">{t("today {supplier} at {price}", { supplier: a.currentSupplier, price: `${f.price(a.currentPrice)}/${a.unit}` })}</div>}
            </Td>
            <Td align="right" className="hidden @xl:table-cell">
              {approx(a.annualCost)}
            </Td>
            {!today && (
              <Td align="right" className="whitespace-normal!">
                {a.difference == null ? (
                  <span className="text-ink-4">—</span>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <span className={cx("num font-medium", a.difference < 0 && "text-up")}>{a.difference >= 0 ? t("{amount} less", { amount: f.moneyApprox(a.difference) }) : t("{amount} more", { amount: f.moneyApprox(-a.difference) })}</span>
                    {a.level && a.difference > 0 && <LevelTag level={a.level} t={t} />}
                  </div>
                )}
              </Td>
            )}
            <Td className="max-w-[420px] whitespace-normal!">
              <DecisionPill decision={a.decision} t={t} />
              <div className="mt-1 text-[12.5px] text-ink-2">{a.reason}</div>
              {a.target != null && (
                <div className="mt-0.5 text-[12.5px]">
                  <Link href={`/products/${a.productId}#negotiation`} className="text-ledger hover:underline">
                    {t("Suggested negotiation target: {price}", { price: `${f.price(a.target)}/${a.unit}` })}
                  </Link>
                </div>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ---------------- Today ----------------

export function TodayPortfolio({ portfolio, products, t }: { portfolio: Portfolio; products: PortfolioProduct[]; t: T }) {
  const s = portfolio.today;
  const estimated = products.filter((p) => p.quantityStatus !== "confirmed").length;
  return (
    <Section
      title={t("Your portfolio today")}
      description={estimated ? t.n(estimated, "Yearly volume of {n} product is estimated from the invoices on file: the yearly figures are estimates too.", "Yearly volumes of {n} products are estimated from the invoices on file: the yearly figures are estimates too.") : t("At the prices you pay and the yearly volumes you confirmed.")}
      flush
    >
      <div className="px-5 pb-4">
        <Figures s={s} total={products.length} t={t} />
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
          {s.measures.suppliers.map((x) => (
            <li key={x.key}>
              <span className="font-medium text-ink">{x.name}</span> <span className="num">{`${Math.round(x.share * 100)}% · ${t.n(x.products.length, "{n} product", "{n} products")}`}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-rule">
        <AllocationTable rows={s.allocation} today t={t} />
      </div>
    </Section>
  );
}

// ---------------- The objectives ----------------

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="num text-right font-medium">{value}</dd>
    </div>
  );
}

export function ObjectiveCards({ portfolio, params, selected, total, t }: { portfolio: Portfolio; params: StrategyParams; selected: Objective; total: number; t: T }) {
  const cards: Objective[] = [...portfolio.scenarios.map((s) => s.objective), ...(portfolio.scenarios.some((s) => s.objective === "custom") ? [] : (["custom"] as Objective[]))];
  return (
    <section aria-label={t("What do you want to optimize?")} className="mb-6">
      <h2 className="mb-1 text-[16px] font-semibold tracking-[-0.01em]">{t("What do you want to optimize?")}</h2>
      <p className="mb-3 text-[13px] text-ink-3">{t("No supplier is right for everything. Each card is the mix that does best on one thing, with what it gains and what it gives up.")}</p>
      <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
        {cards.map((o) => {
          const s = portfolio.scenarios.find((x) => x.objective === o);
          const on = o === selected;
          const suggested = portfolio.suggested?.objective === o;
          return (
            <Link key={o} href={`${strategyHref(params, { goal: o })}#mix`} scroll={false} aria-current={on ? "true" : undefined} className={cx("flex flex-col rounded-lg border bg-canvas px-4 py-3.5 transition-colors hover:border-ledger", on ? "border-ledger ring-1 ring-ledger" : "border-rule")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold tracking-[-0.005em]">{t(OBJECTIVE_LABEL[o].label)}</span>
                {suggested && <span className={cx(pill, "bg-ink text-white")}>{t("Suggested mix")}</span>}
                {s && <span className={cx(pill, "ml-auto", STATUS[s.status].tone)}>{t(STATUS[s.status].label)}</span>}
              </div>
              <p className="mt-1 text-[12.5px] text-ink-3">{t(OBJECTIVE_LABEL[o].question)}</p>
              {!s ? (
                <p className="mt-2 text-[12.5px] text-ink-2">{t("Set your own weights below and see the mix they lead to.")}</p>
              ) : s.status === "not_enough_data" ? (
                <p className="mt-2 text-[12.5px] text-ink-2">{s.headline}</p>
              ) : (
                <dl className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] @md:grid-cols-2">
                  <Row label={t("Annual cost")} value={approx(s.measures.cost)} />
                  <Row label={t("Advantage")} value={s.benefit.total > 0 ? f.moneyApprox(s.benefit.total) : s.benefit.total < 0 ? `−${f.moneyApprox(-s.benefit.total)}` : "—"} />
                  <Row label={t("Suppliers")} value={s.measures.suppliers.length} />
                  <Row label={t("Lead time")} value={s.measures.lead.days == null ? "—" : f.days(s.measures.lead.days, t)} />
                  <Row label={t("Concentration")} value={concentrationOf(s, t)} />
                  <Row label={t("Quality|criterion")} value={qualityOf(s, t)} />
                  <Row label={t("Leverage")} value={t(LEVEL_LABEL[s.measures.leverage.level])} />
                  <Row label={t("Data confidence")} value={t(LEVEL_LABEL[s.confidence])} />
                </dl>
              )}
            </Link>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] text-ink-3">{t("{n} products in this analysis.", { n: total })}</p>
    </section>
  );
}

// ---------------- One scenario ----------------

const ACTION: Record<MissingKind, { label: Msg; href: (ids: string[]) => string }> = {
  request_quotes: { label: "Prepare the requests", href: () => "/sourcing" },
  find_suppliers: { label: "Search for suppliers", href: (ids) => `/sourcing/${ids[0]}` },
  complete_true_cost: { label: "Complete the true cost", href: (ids) => `/sourcing/${ids[0]}` },
  lead_time: { label: "Add to the product data", href: () => "/products/data" },
  payment_terms: { label: "Add to the product data", href: () => "/products/data" },
  quality_data: { label: "Collect quality data", href: () => "/products/data" },
  confirm_volume: { label: "Confirm the volumes", href: () => "/products/data" },
  confirm_match: { label: "Check the specification", href: (ids) => `/sourcing/${ids[0]}` },
};

function MissingList({ items, t }: { items: Missing[]; t: T }) {
  if (!items.length) return <p className="text-[13px] text-ink-3">{t("Nothing this objective needs is missing.")}</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-[13px]">
      {items.map((m) => (
        <li key={m.kind} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <span className="min-w-0 flex-1 text-ink-2">{m.label}</span>
          <Link href={ACTION[m.kind].href(m.productIds)} className="shrink-0 text-ledger hover:underline">
            {t(ACTION[m.kind].label)} →
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Points({ title, items, empty, tone }: { title: string; items: string[]; empty: string; tone: string }) {
  return (
    <div>
      <h3 className={cx("mb-1.5 text-[12px] font-semibold tracking-[0.04em] uppercase", tone)}>{title}</h3>
      {items.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-ink-2">
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-3">{empty}</p>
      )}
    </div>
  );
}

export function ScenarioDetail({ s, portfolio, total, t }: { s: Scenario; portfolio: Portfolio; total: number; t: T }) {
  const suggested = portfolio.suggested?.objective === s.objective ? portfolio.suggested : null;
  const split = [
    { level: "validated" as const, amount: s.benefit.validated },
    { level: "to_validate" as const, amount: s.benefit.toValidate },
    { level: "theoretical" as const, amount: s.benefit.theoretical },
  ].filter((x) => x.amount > 0);
  const weighed = CRITERIA.filter((k) => s.weights[k] > 0);
  return (
    <section id="mix" className="mb-6 scroll-mt-6 rounded-lg border border-rule bg-canvas">
      <div className="px-5 pt-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{t(OBJECTIVE_LABEL[s.objective].label)}</h2>
          <span className={cx(pill, STATUS[s.status].tone)}>{t(STATUS[s.status].label)}</span>
          {suggested && <span className={cx(pill, "bg-ink text-white")}>{t("Suggested mix")}</span>}
        </div>
        <p className="mt-1 text-[13.5px] text-ink-2">{s.headline}</p>
        {suggested && (
          <p className="mt-2 rounded-md bg-well px-3 py-2 text-[13px] text-ink-2">
            <span className="font-medium text-ink">{t("Why this one first.")}</span> {suggested.why} {t("A mix to examine, not a decision: nothing here changes a supplier.")}
          </p>
        )}
        {s.unmet.length > 0 && (
          <div role="alert" className="mt-3 rounded-md border border-caution/40 bg-caution-wash px-3 py-2 text-[13px] text-caution">
            <div className="font-medium">{t("Limits nothing on file allows to respect")}</div>
            <ul className="mt-1 list-disc pl-4">
              {s.unmet.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4">
          <Figures s={s} today={portfolio.today} total={total} t={t} />
        </div>
        {split.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
            <span>{t("What stands behind the advantage:")}</span>
            {split.map((x) => (
              <span key={x.level} className="inline-flex items-center gap-1.5">
                <LevelTag level={x.level} t={t} />
                <span className="num">{f.moneyApprox(x.amount)}</span>
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-col gap-0.5 text-[12.5px] text-ink-3">
          {s.negotiationUpside != null && <div>{t("Potential negotiation upside with the suppliers that stay: about {amount} a year — theoretical, not counted in the advantage.", { amount: f.moneyApprox(s.negotiationUpside) })}</div>}
          {s.cash != null && Math.abs(s.cash) >= 1 && <div>{s.cash > 0 ? t("Working capital: about {amount} more kept in the company.", { amount: f.moneyApprox(s.cash) }) : t("Working capital: about {amount} more tied up.", { amount: f.moneyApprox(-s.cash) })}</div>}
          {s.administration.relationships !== 0 && (
            <div>
              {s.administration.amount != null
                ? t("Administration: {n} supplier relationships, {amount} a year at the cost you gave.", { n: signed(s.administration.relationships), amount: f.money(s.administration.amount) })
                : t("Administration: {n} supplier relationships — not valued in euro: say what one costs you a year under Limits and weights.", { n: signed(s.administration.relationships) })}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-rule">
        <AllocationTable rows={s.allocation} today={false} t={t} />
      </div>
      <div className="grid gap-x-10 gap-y-5 border-t border-rule px-5 py-4 @2xl:grid-cols-2">
        <Points title={t("What you gain")} items={s.gains} empty={s.status === "changed" ? t("Nothing measurable on the data on file.") : t("Nothing: this is today's mix.")} tone="text-down" />
        <Points title={t("What you give up")} items={s.tradeoffs} empty={s.status === "changed" ? t("Nothing measurable on the data on file.") : t("Nothing: this is today's mix.")} tone="text-up" />
      </div>
      <div className="grid gap-x-10 gap-y-5 border-t border-rule px-5 py-4 @2xl:grid-cols-2">
        <div>
          <h3 className="mb-1.5 text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{t("Missing information")}</h3>
          <MissingList items={s.missing} t={t} />
        </div>
        <div>
          <h3 className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">
            {t("Data confidence")}: {t(LEVEL_LABEL[s.confidence])}
          </h3>
          <p className="text-[13px] text-ink-2">{s.confidenceWhy}</p>
          <h3 className="mt-3 mb-1.5 text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{t("What this objective weighs")}</h3>
          <p className="text-[13px] text-ink-2">{weighed.map((k) => `${t(CRITERION_LABEL[k])} ${Math.round(s.weights[k] * 100)}%`).join(" · ")}</p>
          <p className="mt-1 text-[12px] text-ink-3">{t("Each is read as the advantage over today's mix. What is not on file gives no advantage: a supplier is never preferred on a lead time, a payment term or a quality nobody wrote down.")}</p>
        </div>
      </div>
    </section>
  );
}

// ---------------- Coverage ----------------

const where = (country: string | null, t: T) => (country ? `${flagOf(country) ?? ""} ${countryName(country, t.locale)}`.trim() : null);

export function BundleTable({ bundles, total, t }: { bundles: Bundle[]; total: number; t: T }) {
  if (!bundles.length) return null;
  return (
    <Section
      className="mb-6"
      title={t("Who could cover several products")}
      description={t("Coverage is weighed by spend, not by the number of products — and it is a bonus next to the cost, never a reason by itself. A company with no offer can be counted, not compared.")}
      flush
    >
      <Table>
        <thead>
          <tr>
            <Th>{t("Company")}</Th>
            <Th align="right">{t("Products")}</Th>
            <Th align="right">{t("Spend covered")}</Th>
            <Th align="right" className="hidden @2xl:table-cell">
              {t("Technical fit established")}
            </Th>
            <Th>{t("Bundle negotiation potential")}</Th>
            <Th>{t("What the bundle is worth")}</Th>
          </tr>
        </thead>
        <tbody>
          {bundles.map((b) => (
            <tr key={b.key} className="align-top">
              <Td className="max-w-[240px] whitespace-normal!">
                <span className="font-medium">{b.name}</span>
                <div className="text-[12px] text-ink-3">{[where(b.country, t), b.current ? t("your supplier today") : b.known ? t("a supplier you already buy from") : b.asked ? t("asked") : t("not asked yet")].filter(Boolean).join(" · ")}</div>
              </Td>
              <Td align="right" className="whitespace-normal!">
                <span className="num font-medium">{`${b.products} / ${total}`}</span>
                <div className="max-w-[220px] text-[12px] text-ink-3">{b.lines.map((l) => l.name).join(" · ")}</div>
              </Td>
              <Td align="right">
                <span className="num font-medium">{approx(b.spend)}</span>
                <div className="num text-[12px] text-ink-3">{t("{pct}% of this spend", { pct: Math.round(b.spendShare * 100) })}</div>
              </Td>
              <Td align="right" className="hidden @2xl:table-cell">
                <span className="num">{`${Math.round(b.technicalShare * 100)}%`}</span>
              </Td>
              <Td className="max-w-[260px] whitespace-normal!">
                <span className="font-medium">{t(RISK_LABEL[b.potential])}</span>
                <div className="text-[12px] text-ink-3">{b.potentialWhy}</div>
              </Td>
              <Td className="max-w-[260px] whitespace-normal!">
                {b.value ? (
                  <>
                    <span className={cx("num font-medium", b.value.amount < 0 && "text-up")}>{b.value.amount >= 0 ? t("{amount} a year", { amount: f.moneyApprox(b.value.amount) }) : t("−{amount} a year", { amount: f.moneyApprox(-b.value.amount) })}</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
                      {b.value.level && b.value.amount > 0 && <LevelTag level={b.value.level} t={t} />}
                      {t("prices on {k} of {n} new products", { k: b.value.priced, n: b.value.of })}
                    </div>
                    <ul className="mt-1 text-[12px] text-ink-2">
                      {b.lines
                        .filter((l) => l.difference != null)
                        .map((l) => (
                          <li key={l.productId} className="num">
                            {l.name}: {l.difference! >= 0 ? `+${f.moneyApprox(l.difference)}` : `−${f.moneyApprox(-l.difference!)}`}
                          </li>
                        ))}
                    </ul>
                  </>
                ) : b.current ? (
                  <span className="text-[12.5px] text-ink-3">{t("What you buy from it today.")}</span>
                ) : (
                  <span className="text-[12.5px] text-ink-3">{t("No offer yet: one request for all its products.")}</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

const VERDICT: Record<SpecialistVerdict, { label: Msg; tone: string }> = {
  keep: { label: "Keep the specialist", tone: "bg-down-wash text-down" },
  ahead: { label: "Ahead on this product", tone: "bg-ledger text-white" },
  ask: { label: "Worth a request for quotation", tone: "bg-ledger-wash text-ledger" },
  behind: { label: "Not ahead on price", tone: "bg-wash text-ink-2" },
};

export function SpecialistList({ items, t }: { items: Specialist[]; t: T }) {
  if (!items.length) return null;
  return (
    <Section className="mb-6" title={t("Single-product specialists")} description={t("Companies that cover one of these products only. Covering one product is never held against a supplier: it is judged on that product.")} flush>
      <Table>
        <thead>
          <tr>
            <Th>{t("Company")}</Th>
            <Th>{t("Product")}</Th>
            <Th>{t("Technical specialization")}</Th>
            <Th align="right">{t("Against today")}</Th>
            <Th>{t("Reading")}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={`${s.key}:${s.productId}`} className="align-top">
              <Td className="whitespace-normal!">
                <span className="font-medium">{s.name}</span>
                <div className="text-[12px] text-ink-3">{where(s.country, t)}</div>
              </Td>
              <Td className="max-w-[240px] whitespace-normal!">
                <Link href={`/sourcing/${s.productId}`} className="hover:underline">
                  {s.product}
                </Link>
              </Td>
              <Td className="max-w-[300px] whitespace-normal!">
                <span className="font-medium">{t(LEVEL_LABEL[s.specialization])}</span>
                <div className="text-[12px] text-ink-3">{s.why}</div>
              </Td>
              <Td align="right">{s.difference == null ? <span className="text-ink-4">—</span> : <span className={cx("num font-medium", s.difference < 0 && "text-up")}>{s.difference >= 0 ? t("{amount} less", { amount: f.moneyApprox(s.difference) }) : t("{amount} more", { amount: f.moneyApprox(-s.difference) })}</span>}</Td>
              <Td>
                <span className={cx(pill, VERDICT[s.verdict].tone)}>{t(VERDICT[s.verdict].label)}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

export function CurrentSuppliers({ items, t }: { items: CurrentSupplierView[]; t: T }) {
  const many = items.filter((s) => s.products.length >= 2);
  if (!many.length) return null;
  return (
    <Section className="mb-6" title={t("Your suppliers with several of these products")} description={t("What you buy from each, and who could take several products away from it at once: what a negotiation can stand on.")}>
      <ul className="flex flex-col gap-4">
        {many.map((s) => (
          <li key={s.key} className="text-[13px]">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-[14px] font-semibold">{s.name}</span>
              <span className="num text-ink-2">{t("{k} products · {amount} a year · {pct}% of this spend", { k: s.products.length, amount: approx(s.spend), pct: Math.round(s.share * 100) })}</span>
            </div>
            {s.outside.products > 0 && <div className="num mt-0.5 text-[12.5px] text-ink-3">{t.n(s.outside.products, "Beyond these: {n} more product, about {amount} a year.", "Beyond these: {n} more products, about {amount} a year.", { amount: f.moneyApprox(s.outside.spend) })}</div>}
            <p className="mt-1 text-ink-2">{s.note}</p>
            {s.alternatives.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-2">
                {s.alternatives.map((a) => (
                  <li key={a.key}>
                    <span className="font-medium text-ink">{a.name}</span> <span className="num">{t("{k} products · {pct}%", { k: a.products, pct: Math.round(a.share * 100) })}</span> {a.priced ? <PriceTypeTag type="quote" /> : <span className="text-ink-3">{t("no price")}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------- Limits and weights ----------------

const input = "h-8 w-24 rounded-md border border-rule-strong bg-canvas px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-ledger";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
      <span className="flex items-center gap-1 text-ink-2">
        {label}
        {hint && <Hint text={hint} />}
      </span>
      {children}
    </label>
  );
}

export function LimitsForm({ params, products, portfolio, selected, t }: { params: StrategyParams; products: PortfolioProduct[]; portfolio: Portfolio; selected: Objective; t: T }) {
  const c = params.constraints;
  const set = limitsSet(c);
  const weights = params.custom ?? portfolio.scenarios.find((s) => s.objective === "balanced")!.weights;
  const others = [...new Map(products.flatMap((p) => p.options.filter((o) => o.unitCost != null)).map((o) => [o.key, o.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <Disclosure title={t("Limits and weights")} description={set ? t.n(set, "{n} limit set", "{n} limits set") : t("None set: every mix is free")} defaultOpen={set > 0 || selected === "custom"} className="mb-6">
      <form method="get" action="/strategy" className="grid gap-x-12 gap-y-6 @3xl:grid-cols-2">
        {params.top !== 5 && <input type="hidden" name="top" value={params.top} />}
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2 text-[13px] font-semibold">{t("Limits every mix must respect")}</legend>
          <Field label={t("Most of the spend with one supplier (%)")}>
            <input className={input} type="number" name="max_share" min={1} max={100} defaultValue={c.maxShare != null ? Math.round(c.maxShare * 100) : ""} />
          </Field>
          <Field label={t("Most suppliers")}>
            <input className={input} type="number" name="max_suppliers" min={1} defaultValue={c.maxSuppliers ?? ""} />
          </Field>
          <Field label={t("Longest lead time (days)")} hint={t("A supplier whose lead time is not on file cannot be checked against it, and is left out unless it is your supplier today.")}>
            <input className={input} type="number" name="max_lead" min={1} defaultValue={c.maxLeadDays ?? ""} />
          </Field>
          <Field label={t("Where suppliers may be")}>
            <select className={cx(input, "w-44")} name="region" defaultValue={c.region ?? ""}>
              <option value="">{t("Anywhere")}</option>
              <option value="eu">{t("European Union only")}</option>
              <option value="home">{t("Your country only")}</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" name="confirmed" value="1" defaultChecked={c.confirmedOnly} />
            {t("Only suppliers whose technical fit is established")}
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" name="critical" value="1" defaultChecked={c.criticalSources != null} />
            {t("Two suppliers for the products you marked as critical")}
          </label>
          <Field label={t("What one more supplier costs you to manage (EUR a year)")} hint={t("Orders, accounts, audits, visits. With it, more or fewer supplier relationships are valued in euro; without it they are only counted.")}>
            <input className={input} type="number" name="admin" min={0} step={100} defaultValue={c.adminCost ?? ""} />
          </Field>
          {others.length > 1 && (
            <div className="mt-1">
              <div className="mb-1 text-[13px] text-ink-2">{t("Leave out a supplier")}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {others.map(([key, name]) => (
                  <label key={key} className="flex items-center gap-1.5 text-[13px]">
                    <input type="checkbox" name="exclude" value={key} defaultChecked={c.exclude.includes(key)} />
                    {name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="mt-1">
            <div className="mb-1 text-[13px] text-ink-2">{t("Keep the current supplier for")}</div>
            <div className="flex flex-col gap-1">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" name="keep" value={p.id} defaultChecked={c.keep.includes(p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2 text-[13px] font-semibold">{t("Your own weights (the Custom mix)")}</legend>
          <p className="text-[12.5px] text-ink-3">{t("Any numbers: they are brought back to 100%. The starting values are those of the balanced mix.")}</p>
          {CRITERIA.map((k) => (
            <Field key={k} label={t(CRITERION_LABEL[k])}>
              <input className={input} type="number" name={`w_${k}`} min={0} max={100} defaultValue={Math.round(weights[k] * 100)} />
            </Field>
          ))}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" name="goal" value="custom" className={buttonClass("primary", "sm")}>
              {t("See the Custom mix")}
            </button>
            <button type="submit" name="goal" value={selected === "custom" ? "balanced" : selected} className={buttonClass("secondary", "sm")}>
              {t("Apply the limits")}
            </button>
            <ButtonLink href={params.top !== 5 ? `/strategy?top=${params.top}` : "/strategy"} variant="ghost" size="sm">
              {t("Clear")}
            </ButtonLink>
          </div>
        </fieldset>
      </form>
    </Disclosure>
  );
}
