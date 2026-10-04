import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Hint } from "@/components/hint";
import { ConfidenceBadge } from "@/components/intel/badges";
import { ProductFilters } from "@/components/intel/product-filters";
import { PrintButton } from "@/components/review/print-button";
import { DecisionStatusPill, ProductCard, Why } from "@/components/review/product-card";
import { Basis, ButtonLink, Delta, Empty, PageHeader, Section, cx } from "@/components/ui";
import { getDataset, getIntel, getOverview, getT } from "@/lib/data";
import * as f from "@/lib/format";
import type { T } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
import { DATA_GAPS, DECISION_STATUS, OVERVIEW_SORTS, filterDecisions, type DecisionStatus } from "@/lib/intel/decision";
import { explain } from "@/lib/intel/explain";
import type { SpendSlice } from "@/lib/intel/portfolio";
import { lookups } from "@/lib/lookups";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Full review") };
}

/** Cards rendered before "Show all": the page is a summary, the first ones matter most. */
const PAGE_SIZE = 24;
const STATUSES = Object.keys(DECISION_STATUS) as DecisionStatus[];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  const sp = await searchParams;
  const [data, ov, intel, t] = await Promise.all([getDataset(), getOverview(), getIntel(), getT()]);
  const EXPLAIN = explain(t);
  const l = lookups(data);
  const tot = ov.totals;
  const detail = one(sp.view) === "detail";
  const status = STATUSES.find((s) => s === one(sp.status)) ?? null;
  const query = { status, supplierId: one(sp.supplier) || null, category: one(sp.category) || null, search: one(sp.q) || null, sort: one(sp.sort) || null };
  const visible = filterDecisions(ov.products, query);
  const showAll = one(sp.all) === "1";
  const shown = showAll ? visible : visible.slice(0, PAGE_SIZE);
  const filtered = !!(status || query.supplierId || query.category || query.search);

  // Same page, one parameter changed.
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) next.set(k, v);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    return s ? `/report?${s}` : "/report";
  };

  if (ov.products.length === 0) {
    return (
      <>
        <PageHeader title={t("Full review")} meta={t("Every product, one by one: what you pay, what it compares with, what to check.")} />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title={t("Nothing to summarise yet")}
            body={t("Import invoices, quotes or spreadsheets: this page then tells you, product by product, what you pay and where it is worth looking.")}
            action={
              <ButtonLink href="/import" variant="primary">
                {t("Import data")}
              </ButtonLink>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/" className="hover:text-ink">
            {t("Overview")}
          </Link>
        }
        title={t("Full review")}
        meta={
          <>
            {t("Every product, one by one: what you pay, what it compares with, what to check. Made to be printed or saved as PDF.")}
            <span className="mt-1 block text-[12px] text-ink-4">
              {t("Figures as of {date}", { date: f.date(ov.asOf) })}
              {ov.lastUpdated.purchases && ` · ${t("latest purchase {date}", { date: f.date(ov.lastUpdated.purchases) })}`}
              {ov.lastUpdated.quotes && ` · ${t("latest quote {date}", { date: f.date(ov.lastUpdated.quotes) })}`} · {t("market data not connected")}
            </span>
          </>
        }
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <div className="inline-flex rounded-md border border-rule-strong p-0.5 text-[12.5px]" role="group" aria-label={t("Level of detail")}>
              {[
                { key: null, label: t("Simple") },
                { key: "detail", label: t("Detail") },
              ].map((v) => (
                <Link
                  key={v.label}
                  href={href({ view: v.key })}
                  scroll={false}
                  aria-pressed={detail === (v.key === "detail")}
                  className={cx("rounded-[5px] px-2.5 py-1 font-medium transition-colors", detail === (v.key === "detail") ? "bg-ink text-white" : "text-ink-2 hover:bg-wash")}
                >
                  {v.label}
                </Link>
              ))}
            </div>
            <PrintButton />
          </div>
        }
      />

      {/* Four numbers */}
      <section aria-label={t("Key figures")} className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule xl:grid-cols-4">
        <Figure label={t("Annual purchasing spend")} hint={EXPLAIN.annualSpend} value={f.money(Math.round(tot.annualSpend))} note={t("last 12 months")} />
        <Figure
          label={t("Products analyzed")}
          value={String(tot.productsAnalyzed)}
          note={tot.productsAnalyzed < tot.productsTotal ? t("of {n} on file", { n: tot.productsTotal }) : t.n(data.suppliers.length, "{n} supplier on file", "{n} suppliers on file")}
        />
        <Figure
          label={t("Potential savings")}
          hint={EXPLAIN.potentialTotal}
          value={tot.potentialSavings > 0 ? f.moneyApprox(tot.potentialSavings) : "—"}
          unit={tot.potentialSavings > 0 ? t("/year") : undefined}
          note={
            tot.potentialSavings > 0 ? (
              <>
                {rich(t("{amount} high-confidence"), { amount: <span className="num font-medium text-ink-2">{f.moneyApprox(tot.highConfidenceSavings)}</span> })} <Hint text={EXPLAIN.highConfidence} /> · {t("price only")}
              </>
            ) : (
              t("needs comparable quotes")
            )
          }
        />
        <Figure
          label={t("Products to review")}
          hint={EXPLAIN.decisionStatus}
          value={String(tot.productsToReview)}
          note={t("{action} action · {review} review · {data} need data", { action: tot.byStatus.action, review: tot.byStatus.review, data: DATA_GAPS.reduce((n, s) => n + tot.byStatus[s], 0) })}
        />
      </section>

      {/* The page in a paragraph, and the first three things to do */}
      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title={t("Executive summary")}>
          <div className="max-w-[72ch] space-y-2 text-[14.5px] leading-relaxed text-ink-2">
            {ov.executiveSummary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </Section>
        <Section title={t("What should I check first?")} description={t("Suggestions from your data — the decision stays yours")}>
          {ov.checkFirst.length === 0 ? (
            <p className="text-[13.5px] text-ink-3">{t("Nothing needs your attention right now.")}</p>
          ) : (
            <ol className="space-y-3">
              {ov.checkFirst.map((c, i) => (
                <li key={c.productId} className="grid grid-cols-[20px_minmax(0,1fr)] text-[13.5px]">
                  <span className="num font-medium text-ink-4">{i + 1}</span>
                  <div>
                    <div className="font-medium">{c.action.label}</div>
                    <a href={`#p-${c.productId}`} className="text-[12.5px] text-ink-3 hover:text-ledger hover:underline">
                      {c.productName}
                    </a>
                    <Why action={c.action} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Section title={t("Top opportunities")} description={t("Largest yearly impact, one per product")} flush>
          {ov.topOpportunities.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-ink-3">{t("None yet. They appear when a comparable quote is below what you pay, or a price rises sharply.")}</p>
          ) : (
            <ol className="border-t border-rule">
              {ov.topOpportunities.map((op, i) => (
                <li key={op.key} className="border-b border-rule last:border-b-0 hover:bg-well">
                  <Link href={`/opportunities/${op.key}`} className="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-3 px-5 py-3">
                    <span className="num text-[12px] text-ink-4">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{op.productName}</div>
                      <div className="text-[12.5px] text-ink-3">{op.reason}</div>
                    </div>
                    <div className="num text-right">
                      <div className={cx("font-semibold", !op.isSaving && "text-up")}>
                        {!op.isSaving && "+"}
                        {t("{amount}/yr", { amount: f.moneyApprox(op.amount) })}
                      </div>
                      <div className="text-[11.5px] text-ink-3">{op.isSaving ? t("potential saving") : t("extra cost")}</div>
                      {op.confidence && (
                        <div className="mt-1 flex justify-end">
                          <ConfidenceBadge level={op.confidence} />
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section
          title={
            <>
              {t("Supply risks")} <Hint text={EXPLAIN.supplyRisk} />
            </>
          }
          description={
            ov.supplyRisks.length
              ? t.n(ov.supplyRisks.length, "{n} high-spend product has only one supplier", "{n} high-spend products have only one supplier")
              : t("No high-spend product depends on a single supplier")
          }
          flush
        >
          {ov.supplyRisks.length > 0 && (
            <ul className="border-t border-rule">
              {ov.supplyRisks.slice(0, 5).map((r) => (
                <li key={r.productId} className="border-b border-rule hover:bg-well">
                  <a href={`#p-${r.productId}`} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-[12.5px] text-ink-3">
                        {r.supplierName ?? t("One supplier")} · {r.alternativesQuoted ? t.n(r.alternativesQuoted, "{n} other on file", "{n} others on file") : t("no other on file")}
                      </span>
                    </span>
                    <span className="num shrink-0 text-right font-medium">{f.money(Math.round(r.annualSpend))}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <dl className="space-y-1.5 px-5 py-4 text-[13px]">
            {ov.concentration.productsWithSpend > ov.concentration.topN && (
              <Line label={t("Top {n} products", { n: ov.concentration.topN })} value={t("{pct}% of spend", { pct: f.number(ov.concentration.topProductsShare * 100, 0) })} />
            )}
            {ov.concentration.topSupplier && (
              <Line label={t("Top supplier · {name}", { name: ov.concentration.topSupplier.name })} value={t("{pct}% of spend", { pct: f.number(ov.concentration.topSupplier.share * 100, 0) })} />
            )}
            <Line
              label={`${t("Single-source spend")} · ${t.n(ov.concentration.singleSourceProducts, "{n} product", "{n} products")}`}
              value={f.money(Math.round(ov.concentration.singleSourceSpend))}
            />
          </dl>
        </Section>

        <Section
          title={
            <>
              {t("What changed recently")} <Hint text={EXPLAIN.recentChanges} />
            </>
          }
          flush
        >
          {ov.recentChanges.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-ink-3">{t("No price changes or new quotes in the last weeks.")}</p>
          ) : (
            <ul className="border-t border-rule">
              {ov.recentChanges.map((c, i) => (
                <li key={i} className="border-b border-rule last:border-b-0 hover:bg-well">
                  <a href={`#p-${c.productId}`} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.productName}</span>
                      <span className="block truncate text-[12.5px] text-ink-3">{c.text}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      {c.pct != null ? <Delta value={c.pct} className="justify-end text-[13px]" /> : <Basis>{t("Quote|basis")}</Basis>}
                      <span className="num block text-[11.5px] text-ink-4">{c.daysAgo === 0 ? t("today") : t.n(c.daysAgo, "{n} day ago", "{n} days ago")}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Product by product */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 className="flex items-center gap-1.5 text-[18px] font-semibold tracking-[-0.015em]">
          {t("Product by product")} <Hint text={EXPLAIN.priorityOrder} label={t("How products are ordered")} />
        </h2>
        <span className="text-[12.5px] text-ink-3">{t("Where to look first comes first")}</span>
      </div>

      <nav aria-label={t("Status")} className="mb-3 flex flex-wrap gap-1.5 print:hidden">
        {[null, ...STATUSES].map((s) => {
          const on = status === s;
          const count = s ? tot.byStatus[s] : tot.productsTotal;
          return (
            <Link
              key={s ?? "all"}
              href={href({ status: s, all: null })}
              aria-pressed={on}
              scroll={false}
              title={s ? t(DECISION_STATUS[s].meaning) : undefined}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
                on ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-2 hover:border-ink/30 hover:bg-wash",
                count === 0 && !on && "opacity-50",
              )}
            >
              {s ? t(DECISION_STATUS[s].label) : t("All")}
              <span className={cx("num text-[12px]", on ? "text-white/60" : "text-ink-4")}>{count}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mb-5">
        <Suspense>
          <ProductFilters suppliers={l.supplierOptions} categories={l.categories} sorts={OVERVIEW_SORTS} defaultSort="priority" placeholder={t("Search product…")} />
        </Suspense>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-rule">
          <Empty
            title={t("No products match these filters")}
            action={
              filtered ? (
                <Link href={detail ? "/report?view=detail" : "/report"} className="text-[13px] font-medium text-ledger hover:underline">
                  {t("Clear filters")}
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-5">
          {shown.map((d) => (
            <ProductCard key={d.productId} d={d} detail={detail} />
          ))}
        </div>
      )}
      {visible.length > shown.length && (
        <div className="mt-5 text-center print:hidden">
          <ButtonLink href={href({ all: "1" })} scroll={false}>
            {t("Show all {n} products", { n: visible.length })}
          </ButtonLink>
        </div>
      )}

      {/* Where the money goes */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title={t("Spend by supplier")} description={t("Last 12 months")}>
          <Bars t={t} slices={intel.spendBySupplier} href={(x) => `/suppliers/${x.key}`} />
        </Section>
        <Section title={t("Spend by category")} description={t("Last 12 months")}>
          <Bars t={t} slices={intel.spendByCategory} href={(x) => `/products?category=${encodeURIComponent(x.label)}`} />
        </Section>
      </div>

      {/* From estimate to money in the bank */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          title={
            <>
              {t("From potential to realised")} <Hint text={EXPLAIN.funnel} />
            </>
          }
          description={t("An estimate is not a saving until it is checked and then seen on invoices")}
        >
          <ol className="space-y-3">
            <Step t={t} label={t("Potential")} note={t("Calculated from prices")} amount={tot.potentialSavings} of={tot.potentialSavings} />
            <Step t={t} label={t("High-confidence")} note={t("Comparable on every check")} amount={tot.highConfidenceSavings} of={tot.potentialSavings} />
            <Step t={t} label={t("Validated by you")} note={t("Quote and specifications checked")} amount={tot.validatedSavings} of={tot.potentialSavings} href="/opportunities?view=validated" />
            <Step t={t} label={t("Realised")} note={t("Seen on invoices after a change")} amount={null} of={tot.potentialSavings} />
          </ol>
        </Section>

        <Section title={t("How to read this page")}>
          <dl className="space-y-2.5 text-[13px]">
            {STATUSES.map((s) => (
              <div key={s} className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3">
                <dt>
                  <DecisionStatusPill status={s} />
                </dt>
                <dd className="text-ink-2">{t(DECISION_STATUS[s].meaning)}</dd>
              </div>
            ))}
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3 border-t border-rule pt-2.5">
              <dt>
                <Basis>{t("Actual")}</Basis>
              </dt>
              <dd className="text-ink-2">{t("A price you paid, from an invoice or purchase.")}</dd>
            </div>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3">
              <dt>
                <Basis>{t("Quote|basis")}</Basis>
              </dt>
              <dd className="text-ink-2">{t("A price a supplier offered. Not yet paid.")}</dd>
            </div>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3">
              <dt>
                <Basis>{t("Estimate")}</Basis>
              </dt>
              <dd className="text-ink-2">{t("Calculated by the system. A figure to check, not a fact.")}</dd>
            </div>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3">
              <dt>
                <Basis tone="muted">{t("Benchmark")}</Basis>
              </dt>
              <dd className="text-ink-3">{t("External market and trade data. Not connected yet.")}</dd>
            </div>
          </dl>
        </Section>
      </div>
    </>
  );
}

function Figure({ label, hint, value, unit, note }: { label: string; hint?: string; value: string; unit?: string; note?: React.ReactNode }) {
  return (
    <div className="bg-canvas p-4 sm:p-5">
      <div className="flex items-center gap-1.5 text-[11.5px] font-medium tracking-[0.04em] text-ink-3 uppercase">
        {label} {hint && <Hint text={hint} />}
      </div>
      <div className="num mt-2 text-[26px] leading-none font-semibold tracking-[-0.025em] sm:text-[32px]">
        {value}
        {unit && <span className="text-[14px] font-medium tracking-normal text-ink-3">{unit}</span>}
      </div>
      {note && <div className="mt-2 text-[12px] text-ink-3">{note}</div>}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 truncate text-ink-3">{label}</dt>
      <dd className="num shrink-0 font-medium">{value}</dd>
    </div>
  );
}

/** One step of the savings funnel: a bar relative to the potential total. */
function Step({ t, label, note, amount, of, href }: { t: T; label: string; note: string; amount: number | null; of: number; href?: string }) {
  const width = amount != null && of > 0 ? Math.min(100, (amount / of) * 100) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
        <span>
          {href ? (
            <Link href={href} className="font-medium hover:text-ledger hover:underline">
              {label}
            </Link>
          ) : (
            <span className="font-medium">{label}</span>
          )}
          <span className="text-ink-3"> · {note}</span>
        </span>
        <span className={cx("num shrink-0 font-semibold", amount == null && "font-normal text-ink-3")}>{amount == null ? t("Not tracked yet") : t("{amount}/yr", { amount: f.moneyApprox(amount) })}</span>
      </div>
      <div className={cx("mt-1.5 h-1.5 overflow-hidden rounded-full", amount == null ? "border border-dashed border-rule-strong" : "bg-wash")}>
        <div className="h-full rounded-full bg-ledger/75" style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}

/** Horizontal bars: share of spend, largest first. */
function Bars({ t, slices, href, max = 8 }: { t: T; slices: SpendSlice[]; href: (s: SpendSlice) => string; max?: number }) {
  if (slices.length === 0) return <p className="text-[13px] text-ink-3">{t("No purchases in the last 12 months.")}</p>;
  const shown = slices.slice(0, max);
  const rest = slices.slice(max);
  return (
    <ul className="space-y-3">
      {shown.map((s) => (
        <li key={s.key}>
          <Link href={href(s)} className="group block">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate font-medium group-hover:text-ledger">{s.label}</span>
              <span className="num shrink-0 text-ink-2">
                <span className="font-medium text-ink">{f.money(Math.round(s.spend))}</span> · {f.number(s.share * 100, 0)}%
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-wash">
              <div className="h-full rounded-full bg-ledger/75" style={{ width: `${(s.spend / slices[0].spend) * 100}%` }} />
            </div>
          </Link>
        </li>
      ))}
      {rest.length > 0 && (
        <li className="text-[12.5px] text-ink-3">
          {t("{n} more", { n: rest.length })} · {f.money(Math.round(rest.reduce((a, s) => a + s.spend, 0)))}
        </li>
      )}
    </ul>
  );
}
