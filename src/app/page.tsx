import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PurchaseDialog } from "@/components/dialogs";
import { Basis, ButtonLink, Delta, Empty, PageHeader, Section, cx } from "@/components/ui";
import { overview, recentPriceChanges, RECENT_CHANGE_DAYS, todayISO } from "@/lib/analytics";
import { getDataset } from "@/lib/data";
import { getDb } from "@/db";
import { attentionCount, listSessions } from "@/server/imports";
import * as f from "@/lib/format";
import { lookups, plural } from "@/lib/lookups";

interface ChangeRow {
  productId: string;
  name: string;
  supplier: string;
  from: number | null;
  to: number | null;
  pct: number | null;
  when: string;
  impact: number | null;
}

export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const { changes: view } = await searchParams;
  const mode = view === "12m" ? "12m" : "recent";
  const data = await getDataset();
  const db = await getDb();
  const [sessions, reviewCount] = await Promise.all([listSessions(db, 200), attentionCount(db)]);
  const asOf = todayISO();
  const o = overview(data, asOf);
  const l = lookups(data);

  const recent = recentPriceChanges(data, asOf);
  const rows: ChangeRow[] =
    mode === "recent"
      ? recent.map((c) => ({
          productId: c.product.id,
          name: c.product.name,
          supplier: l.supplierName(c.product.currentSupplierId),
          from: c.previousPrice,
          to: c.currentPrice,
          pct: c.pct,
          when: `changed ${f.date(c.changedOn)}`,
          impact: c.annualImpact,
        }))
      : o.products
          .filter((p) => p.metrics.changePct != null && Math.abs(p.metrics.changePct) >= 0.05)
          .sort((a, b) => b.metrics.changePct! - a.metrics.changePct!)
          .map(({ product, metrics: m }) => ({
            productId: product.id,
            name: product.name,
            supplier: l.supplierName(product.currentSupplierId ?? m.lastSupplierId),
            from: m.referencePrice,
            to: m.currentPrice,
            pct: m.changePct,
            when: `since ${f.month(m.referenceDate)}`,
            impact: m.changeImpact,
          }));
  const impact =
    mode === "recent" ? recent.filter((c) => c.annualImpact > 0).reduce((s, c) => s + c.annualImpact, 0) : o.increaseImpact;

  // Latest imports: today, or the most recent day with imports.
  const day = (d: Date) => d.toLocaleDateString("sv-SE");
  const completed = sessions.filter((s) => s.completedAt && s.recordsImported > 0);
  const lastDay = completed[0]?.completedAt ? day(completed[0].completedAt) : null;
  const ofDay = lastDay ? completed.filter((s) => day(s.completedAt!) === lastDay) : [];
  const isToday = lastDay === day(new Date());

  const bySpend = o.products
    .filter((p) => p.metrics.annualSpend > 0)
    .sort((a, b) => b.metrics.annualSpend - a.metrics.annualSpend);
  const topSpend = bySpend[0]?.metrics.annualSpend ?? 0;

  return (
    <>
      <PageHeader
        title="Today"
        meta={`Last 12 months · ${f.date(o.windowStart)} – ${f.date(asOf)}`}
        actions={
          <PurchaseDialog
            products={l.productOptions}
            suppliers={l.supplierOptions}
            trigger={{ label: "Add purchase", variant: "primary" }}
          />
        }
      />

      {data.products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title="Start with what you buy"
            body="Add your first product and supplier, or import purchases from a CSV exported from your accounting software."
            action={
              <div className="flex gap-2">
                <ButtonLink href="/products" variant="primary">
                  Add products
                </ButtonLink>
                <ButtonLink href="/import">Import CSV</ButtonLink>
              </div>
            }
          />
        </div>
      ) : (
        <>
          {/* Hero: the one number an owner looks for first */}
          <section aria-label="Annual purchasing spend" className="mb-6">
            <div className="text-[12.5px] font-medium text-ink-3">Annual purchasing spend</div>
            <div className="num mt-1 text-[44px] leading-none font-semibold tracking-[-0.035em] sm:text-[52px]">
              {f.money(o.totalAnnualSpend)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <Basis>Paid</Basis> {plural(o.purchaseCountInWindow, "purchase")} in the last 12 months
              </span>
              <span aria-hidden className="hidden text-ink-4 sm:inline">·</span>
              <span>
                Same volumes at today&apos;s prices:{" "}
                <span className="num font-medium text-ink-2">{f.money(o.totalAtCurrentPrices)}</span>
              </span>
            </div>
          </section>

          {/* Stat strip */}
          <section
            aria-label="Key figures"
            className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule lg:grid-cols-4"
          >
            <Stat label="Products tracked" value={o.productsTracked} href="/products" />
            <Stat
              label="Suppliers"
              value={o.activeSuppliers}
              note={o.otherSuppliers > 0 ? `active · +${o.otherSuppliers} quoting or inactive` : "active"}
              href="/suppliers"
            />
            <Stat
              label="Price increases detected"
              value={o.priceIncreases}
              note={`above +5% in 12 months`}
              tone={o.priceIncreases > 0 ? "up" : undefined}
              href="/products?status=increase"
            />
            <div className="bg-canvas p-4 sm:p-5">
              <div className="text-[12.5px] font-medium text-ink-3">Potential savings</div>
              <div className="mt-2 text-[15px] font-medium text-ink-3">Not calculated yet</div>
              <div className="mt-1.5">
                <Basis tone="muted">Needs benchmarks</Basis>
              </div>
            </div>
          </section>

          <LatestImports
            count={ofDay.length}
            lines={ofDay.reduce((s, x) => s + x.recordsImported, 0)}
            review={reviewCount}
            day={lastDay}
            isToday={isToday}
            invoices={ofDay.filter((x) => x.sourceType === "invoice").length}
          />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Section
              title="Price changes"
              description={
                mode === "recent"
                  ? `Latest price vs. the price paid before, changes in the last ${RECENT_CHANGE_DAYS} days`
                  : "Last price paid vs. the price paid 12 months ago"
              }
              actions={
                <nav className="inline-flex rounded-md border border-rule-strong p-0.5 text-[12.5px]" aria-label="Price change period">
                  {(
                    [
                      ["recent", "Recent", "/"],
                      ["12m", "12 months", "/?changes=12m"],
                    ] as const
                  ).map(([key, label, href]) => (
                    <Link
                      key={key}
                      href={href}
                      scroll={false}
                      aria-current={mode === key ? "page" : undefined}
                      className={cx("rounded-[5px] px-2.5 py-1 transition-colors", mode === key ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-wash")}
                    >
                      {label}
                    </Link>
                  ))}
                </nav>
              }
              flush
            >
              {rows.length === 0 ? (
                <Empty
                  title={mode === "recent" ? "No recent price changes" : "No price changes yet"}
                  body={mode === "recent" ? `No product changed price in the last ${RECENT_CHANGE_DAYS} days.` : "Changes appear once a product has at least two purchases."}
                />
              ) : (
                <>
                  {impact > 0 && (
                    <div className="mx-5 mb-3 rounded-md bg-up-wash px-3.5 py-2.5 text-[13px] text-ink-2">
                      <div className="text-[11px] font-semibold tracking-[0.06em] text-up uppercase">Annual cost impact</div>
                      {mode === "recent" ? "Recent supplier price increases would increase annual purchasing cost by " : "At current volumes these increases add "}
                      <span className="num font-semibold text-up">+{f.money(impact)}</span>
                      {mode === "recent" ? "." : " a year."}
                    </div>
                  )}
                  <ul className="border-t border-rule">
                    {rows.map((r) => (
                      <li key={r.productId} className="relative border-b border-rule last:border-b-0 hover:bg-well">
                        <Link
                          href={`/products/${r.productId}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_76px_96px]"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{r.name}</div>
                            <div className="truncate text-[12.5px] text-ink-3">
                              {r.supplier} · {r.when}
                            </div>
                          </div>
                          <div className="num text-right text-[13.5px] whitespace-nowrap">
                            <span className="text-ink-3">{f.price(r.from)}</span>
                            <span className="mx-1.5 text-ink-4">→</span>
                            <span className="font-medium">{f.price(r.to)}</span>
                          </div>
                          <Delta value={r.pct} className="justify-end text-[13.5px]" />
                          <div className="num hidden text-right text-[12.5px] text-ink-3 sm:block">
                            {r.impact != null && Math.abs(r.impact) >= 1 ? `${r.impact > 0 ? "+" : ""}${f.money(r.impact)}/yr` : "—"}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <Section title="Largest annual spend" description="Share of the last 12 months' purchasing" flush>
              {bySpend.length === 0 ? (
                <Empty title="No purchases in the last 12 months" />
              ) : (
                <ol className="border-t border-rule">
                  {bySpend.map(({ product, metrics: m }, i) => {
                    const share = o.totalAnnualSpend > 0 ? (m.annualSpend / o.totalAnnualSpend) * 100 : 0;
                    return (
                      <li key={product.id} className="border-b border-rule last:border-b-0 hover:bg-well">
                        <Link href={`/products/${product.id}`} className="block px-5 py-3">
                          <div className="flex items-baseline gap-3">
                            <span className="num w-4 shrink-0 text-[12px] text-ink-4">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate font-medium">{product.name}</span>
                            <span className="num font-medium">{f.money(m.annualSpend)}</span>
                          </div>
                          <div className="mt-2 flex items-center gap-3 pl-7">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-wash">
                              <div
                                className="h-full rounded-full bg-ledger/75"
                                style={{ width: `${topSpend > 0 ? (m.annualSpend / topSpend) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="num w-10 text-right text-[12px] text-ink-3">
                              {f.number(share, 0)}%
                            </span>
                          </div>
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
          </div>
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
  href,
}: {
  label: string;
  value: number;
  note?: string;
  tone?: "up";
  href: string;
}) {
  return (
    <Link
      href={href}
      className="bg-canvas p-4 transition-colors hover:bg-well sm:p-5"
    >
      <div className="text-[12.5px] font-medium text-ink-3">{label}</div>
      <div className={cx("num mt-1.5 text-[28px] leading-none font-semibold tracking-[-0.02em]", tone === "up" && "text-up")}>
        {value}
      </div>
      {note && <div className="mt-2 text-[12px] text-ink-3">{note}</div>}
    </Link>
  );
}

function LatestImports({
  count,
  lines,
  review,
  day,
  isToday,
  invoices,
}: {
  count: number;
  lines: number;
  review: number;
  day: string | null;
  isToday: boolean;
  invoices: number;
}) {
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
