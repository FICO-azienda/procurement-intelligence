import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Hint } from "@/components/hint";
import { ConfidenceBadge } from "@/components/intel/badges";
import { ProductFilters } from "@/components/intel/product-filters";
import { PrintButton } from "@/components/overview/print-button";
import { DecisionStatusPill, ProductCard, Why } from "@/components/overview/product-card";
import { Basis, ButtonLink, Delta, Empty, PageHeader, Section, cx } from "@/components/ui";
import { getDataset, getOverview } from "@/lib/data";
import * as f from "@/lib/format";
import { DECISION_STATUS, OVERVIEW_SORTS, filterDecisions, type DecisionStatus } from "@/lib/intel/decision";
import { EXPLAIN } from "@/lib/intel/explain";
import { lookups, plural } from "@/lib/lookups";

export const metadata: Metadata = { title: "Overview" };

/** Cards rendered before "Show all": the page is a summary, the first ones matter most. */
const PAGE_SIZE = 24;
const STATUSES = Object.keys(DECISION_STATUS) as DecisionStatus[];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function OverviewPage({ searchParams }: PageProps<"/overview">) {
  const sp = await searchParams;
  const [data, ov] = await Promise.all([getDataset(), getOverview()]);
  const l = lookups(data);
  const t = ov.totals;
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
    return s ? `/overview?${s}` : "/overview";
  };

  if (ov.products.length === 0) {
    return (
      <>
        <PageHeader title="Purchasing overview" meta="Understand what you buy, what you pay and where opportunities may exist." />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title="Nothing to summarise yet"
            body="Import invoices, quotes or spreadsheets: this page then tells you, product by product, what you pay and where it is worth looking."
            action={
              <ButtonLink href="/import" variant="primary">
                Import data
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
        title="Purchasing overview"
        meta={
          <>
            Understand what you buy, what you pay and where opportunities may exist.
            <span className="mt-1 block text-[12px] text-ink-4">
              Figures as of {f.date(ov.asOf)}
              {ov.lastUpdated.purchases && ` · latest purchase ${f.date(ov.lastUpdated.purchases)}`}
              {ov.lastUpdated.quotes && ` · latest quote ${f.date(ov.lastUpdated.quotes)}`} · market data not connected
            </span>
          </>
        }
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <div className="inline-flex rounded-md border border-rule-strong p-0.5 text-[12.5px]" role="group" aria-label="Level of detail">
              {[
                { key: null, label: "Simple" },
                { key: "detail", label: "Detail" },
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
      <section aria-label="Key figures" className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule xl:grid-cols-4">
        <Figure label="Annual purchasing spend" hint={EXPLAIN.annualSpend} value={f.money(Math.round(t.annualSpend))} note="last 12 months" />
        <Figure label="Products analyzed" value={String(t.productsAnalyzed)} note={t.productsAnalyzed < t.productsTotal ? `of ${t.productsTotal} on file` : `${plural(data.suppliers.length, "supplier")} on file`} />
        <Figure
          label="Potential savings"
          hint={EXPLAIN.potentialTotal}
          value={t.potentialSavings > 0 ? f.moneyApprox(t.potentialSavings) : "—"}
          unit={t.potentialSavings > 0 ? "/year" : undefined}
          note={
            t.potentialSavings > 0 ? (
              <>
                <span className="num font-medium text-ink-2">{f.moneyApprox(t.highConfidenceSavings)}</span> high-confidence <Hint text={EXPLAIN.highConfidence} /> · price only
              </>
            ) : (
              "needs comparable quotes"
            )
          }
        />
        <Figure
          label="Products to review"
          hint={EXPLAIN.decisionStatus}
          value={String(t.productsToReview)}
          note={`${t.byStatus.action} action · ${t.byStatus.review} review · ${t.byStatus.data_needed} need data`}
        />
      </section>

      {/* The page in a paragraph, and the first three things to do */}
      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Executive summary">
          <div className="max-w-[72ch] space-y-2 text-[14.5px] leading-relaxed text-ink-2">
            {ov.executiveSummary.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </Section>
        <Section title="What should I check first?" description="Suggestions from your data — the decision stays yours">
          {ov.checkFirst.length === 0 ? (
            <p className="text-[13.5px] text-ink-3">Nothing needs your attention right now.</p>
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
        <Section title="Top opportunities" description="Largest yearly impact, one per product" flush>
          {ov.topOpportunities.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-ink-3">None yet. They appear when a comparable quote is below what you pay, or a price rises sharply.</p>
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
                        {f.moneyApprox(op.amount)}/yr
                      </div>
                      <div className="text-[11.5px] text-ink-3">{op.isSaving ? "potential saving" : "extra cost"}</div>
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
              Supply risks <Hint text={EXPLAIN.supplyRisk} />
            </>
          }
          description={
            ov.supplyRisks.length
              ? `${plural(ov.supplyRisks.length, "high-spend product")} ${ov.supplyRisks.length === 1 ? "has" : "have"} only one supplier`
              : "No high-spend product depends on a single supplier"
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
                        {r.supplierName ?? "One supplier"} · {r.alternativesQuoted ? `${r.alternativesQuoted} other on file` : "no other on file"}
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
              <Line label={`Top ${ov.concentration.topN} products`} value={`${f.number(ov.concentration.topProductsShare * 100, 0)}% of spend`} />
            )}
            {ov.concentration.topSupplier && <Line label={`Top supplier · ${ov.concentration.topSupplier.name}`} value={`${f.number(ov.concentration.topSupplier.share * 100, 0)}% of spend`} />}
            <Line label={`Single-source spend · ${plural(ov.concentration.singleSourceProducts, "product")}`} value={f.money(Math.round(ov.concentration.singleSourceSpend))} />
          </dl>
        </Section>

        <Section
          title={
            <>
              What changed recently <Hint text={EXPLAIN.recentChanges} />
            </>
          }
          flush
        >
          {ov.recentChanges.length === 0 ? (
            <p className="px-5 pb-5 text-[13px] text-ink-3">No price changes or new quotes in the last weeks.</p>
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
                      {c.pct != null ? <Delta value={c.pct} className="justify-end text-[13px]" /> : <Basis>Quote</Basis>}
                      <span className="num block text-[11.5px] text-ink-4">{c.daysAgo === 0 ? "today" : `${c.daysAgo} ${c.daysAgo === 1 ? "day" : "days"} ago`}</span>
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
          Product by product <Hint text={EXPLAIN.priorityOrder} label="How products are ordered" />
        </h2>
        <span className="text-[12.5px] text-ink-3">Where to look first comes first</span>
      </div>

      <nav aria-label="Status" className="mb-3 flex flex-wrap gap-1.5 print:hidden">
        {[null, ...STATUSES].map((s) => {
          const on = status === s;
          const count = s ? t.byStatus[s] : t.productsTotal;
          return (
            <Link
              key={s ?? "all"}
              href={href({ status: s, all: null })}
              aria-pressed={on}
              scroll={false}
              title={s ? DECISION_STATUS[s].meaning : undefined}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
                on ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-2 hover:border-ink/30 hover:bg-wash",
                count === 0 && !on && "opacity-50",
              )}
            >
              {s ? DECISION_STATUS[s].label : "All"}
              <span className={cx("num text-[12px]", on ? "text-white/60" : "text-ink-4")}>{count}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mb-5">
        <Suspense>
          <ProductFilters suppliers={l.supplierOptions} categories={l.categories} sorts={OVERVIEW_SORTS} defaultSort="priority" placeholder="Search product…" />
        </Suspense>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-rule">
          <Empty
            title="No products match these filters"
            action={
              filtered ? (
                <Link href={detail ? "/overview?view=detail" : "/overview"} className="text-[13px] font-medium text-ledger hover:underline">
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-5">
          {shown.map((d) => (
            <ProductCard key={d.productId} d={d} detail={detail} products={l.productOptions} suppliers={l.supplierOptions} />
          ))}
        </div>
      )}
      {visible.length > shown.length && (
        <div className="mt-5 text-center print:hidden">
          <ButtonLink href={href({ all: "1" })} scroll={false}>
            Show all {visible.length} products
          </ButtonLink>
        </div>
      )}

      {/* From estimate to money in the bank */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          title={
            <>
              From potential to realised <Hint text={EXPLAIN.funnel} />
            </>
          }
          description="An estimate is not a saving until it is checked and then seen on invoices"
        >
          <ol className="space-y-3">
            <Step label="Potential" note="Calculated from prices" amount={t.potentialSavings} of={t.potentialSavings} />
            <Step label="High-confidence" note="Comparable on every check" amount={t.highConfidenceSavings} of={t.potentialSavings} />
            <Step label="Validated by you" note="Quote and specifications checked" amount={t.validatedSavings} of={t.potentialSavings} href="/opportunities?view=validated" />
            <Step label="Realised" note="Seen on invoices after a change" amount={null} of={t.potentialSavings} />
          </ol>
        </Section>

        <Section title="How to read this page">
          <dl className="space-y-2.5 text-[13px]">
            {STATUSES.map((s) => (
              <div key={s} className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3">
                <dt>
                  <DecisionStatusPill status={s} />
                </dt>
                <dd className="text-ink-2">{DECISION_STATUS[s].meaning}</dd>
              </div>
            ))}
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3 border-t border-rule pt-2.5">
              <dt>
                <Basis>Actual</Basis>
              </dt>
              <dd className="text-ink-2">A price you paid, from an invoice or purchase.</dd>
            </div>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3">
              <dt>
                <Basis>Quote</Basis>
              </dt>
              <dd className="text-ink-2">A price a supplier offered. Not yet paid.</dd>
            </div>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3">
              <dt>
                <Basis>Estimate</Basis>
              </dt>
              <dd className="text-ink-2">Calculated by the system. A figure to check, not a fact.</dd>
            </div>
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3">
              <dt>
                <Basis tone="muted">Benchmark</Basis>
              </dt>
              <dd className="text-ink-3">External market and trade data. Not connected yet.</dd>
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
function Step({ label, note, amount, of, href }: { label: string; note: string; amount: number | null; of: number; href?: string }) {
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
        <span className={cx("num shrink-0 font-semibold", amount == null && "font-normal text-ink-3")}>{amount == null ? "Not tracked yet" : `${f.moneyApprox(amount)}/yr`}</span>
      </div>
      <div className={cx("mt-1.5 h-1.5 overflow-hidden rounded-full", amount == null ? "border border-dashed border-rule-strong" : "bg-wash")}>
        <div className="h-full rounded-full bg-ledger/75" style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}
