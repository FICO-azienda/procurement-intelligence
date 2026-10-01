import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getDb } from "@/db";
import { PurchaseDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { AlertBadge, ConfidenceBadge } from "@/components/intel/badges";
import { Basis, ButtonLink, Delta, Empty, PageHeader, Section, cx } from "@/components/ui";
import { overview, todayISO } from "@/lib/analytics";
import { getDataset, getIntel } from "@/lib/data";
import * as f from "@/lib/format";
import { topOpportunities, type ProductIntel } from "@/lib/intel/engine";
import { EXPLAIN } from "@/lib/intel/explain";
import { OPPORTUNITY_LABEL } from "@/lib/intel/opportunities";
import type { SpendSlice } from "@/lib/intel/portfolio";
import { lookups, plural } from "@/lib/lookups";
import { attentionCount, listSessions } from "@/server/imports";

const MOVEMENTS_MAX = 6;
const PARETO_ROWS = 8;

export default async function TodayPage() {
  const [data, intel] = await Promise.all([getDataset(), getIntel()]);
  const db = await getDb();
  const [sessions, reviewCount] = await Promise.all([listSessions(db, 200), attentionCount(db)]);
  const asOf = todayISO();
  const o = overview(data, asOf);
  const l = lookups(data);
  const cfg = intel.config;
  const byId = new Map(intel.products.map((p) => [p.product.id, p]));

  const moved = intel.products.filter((p) => p.price.changes.m12.pct != null && Math.abs(p.price.changes.m12.pct) >= 0.05);
  const increases = moved.filter((p) => p.price.changes.m12.pct! > 0).sort((a, b) => b.price.changes.m12.pct! - a.price.changes.m12.pct!);
  const decreases = moved.filter((p) => p.price.changes.m12.pct! < 0).sort((a, b) => a.price.changes.m12.pct! - b.price.changes.m12.pct!);
  const impactOf = (p: ProductIntel) => {
    const c = p.price.changes.m12;
    return p.price.current && c.referencePrice != null ? p.metrics.annualQuantity * (p.price.current.price - c.referencePrice) : 0;
  };
  // An increase resting on a price flagged as a possible data error is not added up.
  const increaseImpact = increases.filter((p) => !p.currentPriceFlagged).reduce((s, p) => s + Math.max(0, impactOf(p)), 0);
  const top = topOpportunities(intel, 5);

  // Latest imports: today, or the most recent day with imports.
  const day = (d: Date) => d.toLocaleDateString("sv-SE");
  const completed = sessions.filter((s) => s.completedAt && s.recordsImported > 0);
  const lastDay = completed[0]?.completedAt ? day(completed[0].completedAt) : null;
  const ofDay = lastDay ? completed.filter((s) => day(s.completedAt!) === lastDay) : [];

  return (
    <>
      <PageHeader
        title="Today"
        meta={`Last 12 months · ${f.date(o.windowStart)} – ${f.date(asOf)}`}
        actions={<PurchaseDialog products={l.productOptions} suppliers={l.supplierOptions} trigger={{ label: "Add purchase", variant: "primary" }} />}
      />

      {data.products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title="Start with what you buy"
            body="Import invoices, quotes or spreadsheets — or add your first product and supplier by hand."
            action={
              <div className="flex gap-2">
                <ButtonLink href="/import" variant="primary">
                  Import data
                </ButtonLink>
                <ButtonLink href="/products">Add products</ButtonLink>
              </div>
            }
          />
        </div>
      ) : (
        <>
          {/* Hero: the one number an owner looks for first */}
          <section aria-label="Annual purchasing spend" className="mb-6">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
              Annual purchasing spend <Hint text={EXPLAIN.annualSpend} />
            </div>
            <div className="num mt-1 text-[44px] leading-none font-semibold tracking-[-0.035em] sm:text-[52px]">{f.money(intel.totals.annualSpend)}</div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <Basis>Paid</Basis> {plural(o.purchaseCountInWindow, "purchase")} · {plural(o.productsTracked, "product")} · {plural(o.activeSuppliers, "active supplier")}
              </span>
              <span aria-hidden className="hidden text-ink-4 sm:inline">·</span>
              <span>
                Same volumes at today&apos;s prices: <span className="num font-medium text-ink-2">{f.money(o.totalAtCurrentPrices)}</span>
              </span>
            </div>
          </section>

          {/* Key figures */}
          <section aria-label="Key figures" className="mb-8 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-3">
            <div className="relative bg-canvas p-4 transition-colors hover:bg-well sm:p-5">
              <Link href="/opportunities" className="absolute inset-0" aria-label="Open opportunities" />
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
                Potential price opportunities <Hint text={EXPLAIN.potentialTotal} />
              </div>
              {intel.totals.potentialSavings > 0 ? (
                <>
                  <div className="num mt-1.5 text-[28px] leading-none font-semibold tracking-[-0.02em]">
                    {f.money(intel.totals.potentialSavings)}
                    <span className="text-[14px] font-medium text-ink-3">/year</span>
                  </div>
                  <div className="mt-2 text-[12px] text-ink-3">
                    identified on {plural(intel.totals.potentialSavingsProducts, "product")} · price only, before landed cost
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-2 text-[15px] font-medium text-ink-3">None identified yet</div>
                  <div className="mt-1.5 text-[12px] text-ink-3">Needs comparable alternative quotes</div>
                </>
              )}
            </div>
            <div className="relative bg-canvas p-4 transition-colors hover:bg-well sm:p-5">
              <Link href="/products?f=up-moderate" className="absolute inset-0" aria-label="Show products with a price increase" />
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
                Products with &gt;{cfg.alerts.moderate}% price increase <Hint text={EXPLAIN.alert} />
              </div>
              <div className={cx("num mt-1.5 text-[28px] leading-none font-semibold tracking-[-0.02em]", intel.totals.productsWithIncrease > 0 && "text-up")}>{intel.totals.productsWithIncrease}</div>
              <div className="mt-2 text-[12px] text-ink-3">in the last 12 months</div>
            </div>
            <div className="relative bg-canvas p-4 transition-colors hover:bg-well sm:p-5">
              <Link href="/products?f=single-source,high-spend" className="absolute inset-0" aria-label="Show single-source high-spend products" />
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
                Single-source high-spend products <Hint text={EXPLAIN.highSpend} />
              </div>
              <div className="num mt-1.5 text-[28px] leading-none font-semibold tracking-[-0.02em]">{intel.totals.singleSourceHighSpend}</div>
              <div className="mt-2 text-[12px] text-ink-3">bought from one supplier only</div>
            </div>
          </section>

          <LatestImports
            count={ofDay.length}
            lines={ofDay.reduce((s, x) => s + x.recordsImported, 0)}
            review={reviewCount}
            day={lastDay}
            isToday={lastDay === day(new Date())}
            invoices={ofDay.filter((x) => x.sourceType === "invoice").length}
          />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Section
              title="Top opportunities"
              description="Largest potential impact per product — price only"
              flush
              actions={
                <Link href="/opportunities" className="inline-flex items-center gap-1 text-[13px] font-medium text-ledger hover:underline">
                  All <ArrowRight size={13} />
                </Link>
              }
            >
              {top.length === 0 ? (
                <Empty title="No opportunities yet" body="They appear when a comparable quote is below what you pay, or a price rises sharply." />
              ) : (
                <ol className="border-t border-rule">
                  {top.map((op, i) => {
                    const p = byId.get(op.productId)!;
                    return (
                      <li key={op.key} className="border-b border-rule last:border-b-0 hover:bg-well">
                        <Link href={`/opportunities/${op.key}`} className="flex items-center gap-3 px-5 py-3">
                          <span className="num w-4 shrink-0 text-[12px] text-ink-4">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{p.product.name}</div>
                            <div className="truncate text-[12.5px] text-ink-3">
                              {OPPORTUNITY_LABEL[op.type]}
                              {op.alternativeSupplierId && ` · ${l.supplierName(op.alternativeSupplierId)}`}
                            </div>
                          </div>
                          {op.confidence && <ConfidenceBadge level={op.confidence} />}
                          <div className="num text-right">
                            <div className="font-semibold">{f.money(op.impact)}/yr</div>
                            <div className="text-[11.5px] text-ink-3">{op.potentialSaving != null ? "potential saving" : "price impact"}</div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Section>

            <Section title="Recent price movements" description="Price paid today vs 12 months ago" flush>
              {moved.length === 0 ? (
                <Empty title="No price changes yet" body="Changes appear once a product has at least two purchases." />
              ) : (
                <>
                  {increaseImpact > 0 && (
                    <div className="mx-5 mb-3 rounded-md bg-up-wash px-3.5 py-2.5 text-[13px] text-ink-2">
                      Price increases add <span className="num font-semibold text-up">+{f.money(increaseImpact)}</span> a year if annual volumes remain unchanged. <Hint text={EXPLAIN.annualImpact} />
                    </div>
                  )}
                  <Movements title="Price increases" items={increases} total={increases.length} supplierName={l.supplierName} />
                  <Movements title="Price decreases" items={decreases} total={decreases.length} supplierName={l.supplierName} />
                </>
              )}
            </Section>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Section title="Annual spend by supplier" description="Last 12 months">
              <Bars slices={intel.spendBySupplier} href={(s) => `/suppliers/${s.key}`} />
            </Section>
            <Section title="Annual spend by category" description="Where sourcing effort pays off most">
              <Bars slices={intel.spendByCategory} href={(s) => `/products?category=${encodeURIComponent(s.label)}`} />
            </Section>
          </div>

          <Section
            className="mt-6"
            title={
              <>
                Top products by spend <Hint text={EXPLAIN.pareto} />
              </>
            }
            description={
              intel.pareto.items.length
                ? `Top ${intel.pareto.topN} ${intel.pareto.topN === 1 ? "product represents" : "products represent"} ${f.number(intel.pareto.topNShare * 100, 0)}% of purchasing spend · ${intel.pareto.itemsForShare} make up the first ${Math.round(cfg.paretoShare * 100)}%`
                : "No purchases in the last 12 months"
            }
            flush
          >
            {intel.pareto.items.length > 0 && (
              <ol className="border-t border-rule">
                {intel.pareto.items.slice(0, PARETO_ROWS).map((x) => {
                  const p = byId.get(x.key)!;
                  return (
                    <li key={x.key} className="border-b border-rule last:border-b-0 hover:bg-well">
                      <Link href={`/products/${x.key}`} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-2.5 sm:grid-cols-[20px_minmax(0,2fr)_minmax(0,3fr)_90px_70px]">
                        <span className="num text-[12px] text-ink-4">{x.rank}</span>
                        <span className="truncate font-medium">{p.product.name}</span>
                        <div className="hidden h-1 overflow-hidden rounded-full bg-wash sm:block">
                          <div className="h-full rounded-full bg-ledger/75" style={{ width: `${(x.spend / intel.pareto.items[0].spend) * 100}%` }} />
                        </div>
                        <span className="num text-right font-medium">{f.money(x.spend)}</span>
                        <span className="num hidden text-right text-[12px] text-ink-3 sm:block" title="Cumulative share of spend">
                          {f.number(x.cumulativeShare * 100, 0)}% cum.
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="border-t border-rule px-5 py-3">
              <Link href="/products" className="inline-flex items-center gap-1 text-[13px] font-medium text-ledger hover:underline">
                All products <ArrowRight size={13} />
              </Link>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

function Movements({ title, items, total, supplierName }: { title: string; items: ProductIntel[]; total: number; supplierName: (id: string | null | undefined) => string }) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="border-t border-rule bg-well px-5 py-1.5 text-[12px] font-medium text-ink-3">
        {title} <span className="num font-normal text-ink-4">{total}</span>
      </div>
      <ul>
        {items.slice(0, MOVEMENTS_MAX).map((p) => {
          const c = p.price.changes.m12;
          return (
            <li key={p.product.id} className="border-t border-rule hover:bg-well">
              <Link href={`/products/${p.product.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_72px_84px]">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.product.name}</div>
                  <div className="truncate text-[12.5px] text-ink-3">
                    {supplierName(p.price.current?.supplierId)} · since {f.month(c.referenceDate)}
                  </div>
                </div>
                <div className="num hidden text-right text-[13.5px] whitespace-nowrap sm:block">
                  <span className="text-ink-3">{f.price(c.referencePrice)}</span>
                  <span className="mx-1.5 text-ink-4">→</span>
                  <span className="font-medium">{f.price(p.price.current?.price)}</span>
                </div>
                <Delta value={c.pct} className="justify-end text-[13.5px]" />
                <div className="hidden justify-end sm:flex">
                  {p.currentPriceFlagged ? (
                    <span className="inline-flex h-[22px] items-center rounded-full bg-caution-wash px-2 text-[12px] font-medium whitespace-nowrap text-caution" title="The current price may be a data error">
                      Check data
                    </span>
                  ) : p.alert ? (
                    <AlertBadge level={p.alert} short />
                  ) : (
                    <span className="text-[12px] text-ink-4">—</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {total > MOVEMENTS_MAX && (
        <div className="border-t border-rule px-5 py-2 text-[12.5px]">
          <Link href={title.includes("increase") ? "/products?sort=change" : "/products?f=down"} className="font-medium text-ledger hover:underline">
            {total - MOVEMENTS_MAX} more
          </Link>
        </div>
      )}
    </>
  );
}

/** Horizontal bars: share of spend, largest first. */
function Bars({ slices, href, max = 8 }: { slices: SpendSlice[]; href: (s: SpendSlice) => string; max?: number }) {
  if (slices.length === 0) return <p className="text-[13px] text-ink-3">No purchases in the last 12 months.</p>;
  const shown = slices.slice(0, max);
  const rest = slices.slice(max);
  const top = slices[0].spend;
  return (
    <ul className="space-y-3">
      {shown.map((s) => (
        <li key={s.key}>
          <Link href={href(s)} className="group block">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate font-medium group-hover:text-ledger">{s.label}</span>
              <span className="num shrink-0 text-ink-2">
                <span className="font-medium text-ink">{f.money(s.spend)}</span> · {f.number(s.share * 100, 0)}%
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-wash">
              <div className="h-full rounded-full bg-ledger/75" style={{ width: `${(s.spend / top) * 100}%` }} />
            </div>
          </Link>
        </li>
      ))}
      {rest.length > 0 && (
        <li className="text-[12.5px] text-ink-3">
          {rest.length} more · {f.money(rest.reduce((a, s) => a + s.spend, 0))} ({f.number(rest.reduce((a, s) => a + s.share, 0) * 100, 0)}%)
        </li>
      )}
    </ul>
  );
}

function LatestImports({ count, lines, review, day, isToday, invoices }: { count: number; lines: number; review: number; day: string | null; isToday: boolean; invoices: number }) {
  const when = isToday ? "today" : day ? `on ${f.date(day)}` : "";
  return (
    <section aria-label="Latest imports" className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-rule px-5 py-4">
      <div className="text-[12px] font-medium tracking-[0.02em] text-ink-3 uppercase">Latest imports</div>
      {day ? (
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-[13.5px]">
          <span>
            <span className="num font-semibold">{count}</span> {invoices === count ? (count === 1 ? "invoice" : "invoices") : count === 1 ? "file" : "files"} imported {when}
          </span>
          <span>
            <span className="num font-semibold">{lines}</span> {lines === 1 ? "line" : "lines"} added
          </span>
        </div>
      ) : (
        <span className="text-[13.5px] text-ink-3">No files imported yet — upload invoices or spreadsheets to replace manual entry.</span>
      )}
      <div className="ml-auto flex items-center gap-3">
        {review > 0 && (
          <Link href="/review" className="inline-flex items-center gap-1.5 rounded-full bg-caution-wash px-2.5 py-1 text-[12.5px] font-medium text-caution hover:bg-caution-wash/70">
            {review} {review === 1 ? "item needs" : "items need"} review
          </Link>
        )}
        <Link href="/import" className="inline-flex items-center gap-1 text-[13px] font-medium text-ledger hover:underline">
          Import <ArrowRight size={13} />
        </Link>
      </div>
    </section>
  );
}
