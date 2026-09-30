import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PurchaseDialog } from "@/components/dialogs";
import { Basis, ButtonLink, Delta, Empty, PageHeader, Section, cx } from "@/components/ui";
import { overview, todayISO } from "@/lib/analytics";
import { getDataset } from "@/lib/data";
import * as f from "@/lib/format";
import { lookups, plural } from "@/lib/lookups";

export default async function TodayPage() {
  const data = await getDataset();
  const asOf = todayISO();
  const o = overview(data, asOf);
  const l = lookups(data);

  const changes = o.products
    .filter((p) => p.metrics.changePct != null && Math.abs(p.metrics.changePct) >= 0.05)
    .sort((a, b) => b.metrics.changePct! - a.metrics.changePct!);

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

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Section
              title="Price changes"
              description="Last price paid vs. the price paid 12 months ago"
              flush
            >
              {changes.length === 0 ? (
                <Empty title="No price changes yet" body="Changes appear once a product has at least two purchases." />
              ) : (
                <>
                  {o.increaseImpact > 0 && (
                    <div className="mx-5 mb-3 rounded-md bg-up-wash px-3.5 py-2.5 text-[13px] text-ink-2">
                      At current volumes these increases add{" "}
                      <span className="num font-semibold text-up">{f.money(o.increaseImpact)}</span> a year.
                    </div>
                  )}
                  <ul className="border-t border-rule">
                    {changes.map(({ product, metrics: m }) => (
                      <li key={product.id} className="relative border-b border-rule last:border-b-0 hover:bg-well">
                        <Link
                          href={`/products/${product.id}`}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_76px_96px]"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{product.name}</div>
                            <div className="truncate text-[12.5px] text-ink-3">
                              {l.supplierName(product.currentSupplierId ?? m.lastSupplierId)} · since {f.month(m.referenceDate)}
                            </div>
                          </div>
                          <div className="num text-right text-[13.5px] whitespace-nowrap">
                            <span className="text-ink-3">{f.price(m.referencePrice)}</span>
                            <span className="mx-1.5 text-ink-4">→</span>
                            <span className="font-medium">{f.price(m.currentPrice)}</span>
                          </div>
                          <Delta value={m.changePct} className="justify-end text-[13.5px]" />
                          <div className="num hidden text-right text-[12.5px] text-ink-3 sm:block">
                            {m.changeImpact != null && Math.abs(m.changeImpact) >= 1
                              ? `${m.changeImpact > 0 ? "+" : ""}${f.money(m.changeImpact)}/yr`
                              : "—"}
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
