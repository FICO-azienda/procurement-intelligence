import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, Handshake } from "lucide-react";
import { ProductDialog, PurchaseDialog, QuoteDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { SourceTag, sourceLabel } from "@/components/import/labels";
import { AlertBadge, ConfidenceBadge, OpportunityStatusBadge, QualityBadge, SourcingBadge, TrendTag } from "@/components/intel/badges";
import { OutlierActions, RestorePriceButton } from "@/components/intel/controls";
import { PriceOnlyNotice, SupplierComparison } from "@/components/intel/supplier-comparison";
import { PriceChart } from "@/components/price-chart";
import { Basis, ButtonLink, Delta, Empty, ExportLink, Label, PageHeader, Section, Sku, StatusBadge, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { basePrice, isPriced, normalizePurchases } from "@/lib/analytics";
import { getDataset, getIntel, getLearning } from "@/lib/data";
import * as f from "@/lib/format";
import { EXPLAIN } from "@/lib/intel/explain";
import { OPPORTUNITY_LABEL } from "@/lib/intel/opportunities";
import { comparableObservations, type WindowChange } from "@/lib/intel/price-metrics";
import { lookups, plural } from "@/lib/lookups";

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const { id } = await params;
  const data = await getDataset();
  return { title: data.products.find((p) => p.id === id)?.name ?? "Product" };
}

const TIMELINE_MAX = 10;

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const [data, learning, intel] = await Promise.all([getDataset(), getLearning(), getIntel()]);
  const pi = intel.products.find((p) => p.product.id === id);
  if (!pi) notFound();
  const { product, metrics: m, price } = pi;

  const l = lookups(data);
  const history = data.purchases.filter((p) => p.productId === product.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const productQuotes = data.quotes.filter((q) => q.productId === product.id);
  const { comparable } = normalizePurchases(product, history);
  const observations = comparableObservations(comparable);
  const currentPurchase = history.find((p) => p.id === price.current?.purchaseId);
  const best = pi.bestSaving;
  const bestRow = best ? pi.comparison.find((r) => r.supplier.id === best.alternativeSupplierId) : null;
  const alternatives = pi.comparison.filter((r) => !r.isCurrent);
  // The representative saving favours confidence; say so when a bigger, weaker one exists.
  const larger = best
    ? pi.opportunities.filter((o) => o.potentialSaving != null && o.key !== best.key && o.potentialSaving > best.potentialSaving!).sort((a, b) => b.potentialSaving! - a.potentialSaving!)[0]
    : undefined;
  const negotiation = pi.opportunities.find((o) => o.negotiation && !["rejected", "closed"].includes(o.status));
  const excluded = history.filter((p) => p.priceReview === "excluded");
  const aliases = learning.productAliases.filter((a) => a.productId === product.id);
  const codes = learning.supplierProducts.filter((sp) => sp.productId === product.id && (sp.supplierSku || sp.supplierProductName));

  // Where the numbers on this page come from.
  const sourceCounts = new Map<string, number>();
  for (const r of [...history, ...productQuotes]) sourceCounts.set(r.source, (sourceCounts.get(r.source) ?? 0) + 1);
  const docs = new Map<string, { filename: string; documentId: string | null; sessionId: string }>();
  for (const r of [...history, ...productQuotes]) if (r.sourceDoc && !docs.has(r.sourceDoc.sessionId)) docs.set(r.sourceDoc.sessionId, r.sourceDoc);

  const common = { products: l.productOptions, suppliers: l.supplierOptions };
  const m12 = price.changes.m12;
  const timeline = price.timeline.slice(-TIMELINE_MAX);
  const impact12m = m12.pct != null && m12.referencePrice != null && price.current && m.annualQuantity > 0 ? m.annualQuantity * (price.current.price - m12.referencePrice) : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/products" className="hover:text-ink">
            Products
          </Link>
        }
        title={product.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span>
              SKU <Sku>{product.sku}</Sku>
            </span>
            <span>
              Category: <span className="text-ink-2">{product.category ?? "—"}</span>
            </span>
            <span>
              Unit: <span className="text-ink-2">{product.unit}</span>
            </span>
            {pi.alert ? <AlertBadge level={pi.alert} /> : <StatusBadge status={m.status} title={m.statusReason} />}
            {pi.concentration.sourcing !== "none" && <SourcingBadge sourcing={pi.concentration.sourcing} />}
          </span>
        }
        actions={
          <>
            <ProductDialog
              product={product}
              suppliers={l.supplierOptions}
              categories={l.categories}
              deleteNote={`Also deletes ${plural(history.length, "purchase")} and ${plural(productQuotes.length, "quote")}.`}
              trigger={{ label: "Edit" }}
            />
            <QuoteDialog {...common} defaultProductId={product.id} trigger={{ label: "Add quote" }} />
            <PurchaseDialog {...common} defaultProductId={product.id} trigger={{ label: "Add purchase", variant: "primary" }} />
          </>
        }
      />

      {/* Rule-based summary: the page in four sentences */}
      <section aria-label="Summary" className="mb-6 max-w-3xl text-[15px] leading-relaxed text-ink-2">
        {pi.summary.map((s, i) => (
          <span key={i}>{s} </span>
        ))}
      </section>

      {negotiation && bestRow && (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-rule-strong px-4 py-3">
          <Handshake size={17} className="text-ledger" />
          <div className="min-w-0 flex-1 text-[13.5px]">
            <span className="font-semibold">Negotiation opportunity.</span>{" "}
            Current supplier increased price {f.pct(m12.pct)}. {bestRow.supplier.name} quoted {f.pct(-negotiation.priceDifferencePct!).replace("−", "")} less. Potential price gap:{" "}
            <span className="num font-medium">
              {f.price(negotiation.priceDifference)}/{product.unit}
            </span>
            . <span className="text-ink-3">The decision is yours — nothing here says to switch supplier.</span>
          </div>
          <ButtonLink href={`/opportunities/${negotiation.key}`} size="sm">
            Details <ArrowRight size={13} />
          </ButtonLink>
        </div>
      )}

      {/* Four key figures */}
      <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Current price" hint={EXPLAIN.currentPrice}>
          <Big>
            {f.price(price.current?.price)}
            {price.current && <span className="text-[15px] font-medium text-ink-3">/{product.unit}</span>}
          </Big>
          <Note>
            {price.current ? (
              <>
                <Basis>Paid</Basis> {f.date(price.current.date)} · {l.supplierName(price.current.supplierId)}
              </>
            ) : (
              "No comparable purchases yet"
            )}
          </Note>
          {currentPurchase && (
            <div className="mt-1 truncate text-[12px] text-ink-3">
              Source: {sourceLabel(currentPurchase.source)}
              {currentPurchase.invoiceReference ? ` ${currentPurchase.invoiceReference}` : ""}
              {currentPurchase.sourceDoc?.documentId && (
                <>
                  {" · "}
                  <a href={`/documents/${currentPurchase.sourceDoc.documentId}`} target="_blank" className="font-medium text-ledger hover:underline">
                    View source
                  </a>
                </>
              )}
            </div>
          )}
        </Figure>

        <Figure label="12M change" hint={EXPLAIN.change}>
          <Delta value={m12.pct} className="text-[28px] leading-none font-semibold tracking-[-0.02em] [&_svg]:size-5" />
          <Note>
            {m12.referencePrice != null ? (
              <span className="num">
                from {f.price(m12.referencePrice)} · {f.month(m12.referenceDate)}
                {m12.partial && " (start of history)"}
              </span>
            ) : (
              "Needs at least two purchases"
            )}
          </Note>
          {impact12m != null && Math.abs(impact12m) >= 1 && (
            <div className="num mt-1 text-[12px] text-ink-3">
              {impact12m > 0 ? "+" : ""}
              {f.money(impact12m)}/yr if annual volume stays unchanged <Hint text={EXPLAIN.annualImpact} />
            </div>
          )}
        </Figure>

        <Figure label="Annual spend" hint={EXPLAIN.annualSpend}>
          <Big>{f.money(m.annualSpend)}</Big>
          <Note>
            <span className="num">
              {m.annualQuantity > 0 ? `${f.quantity(m.annualQuantity, product.unit)} in 12 months` : "No purchases in the last 12 months"}
              {pi.spendShare > 0 && ` · ${f.number(pi.spendShare * 100, 1)}% of total spend`}
            </span>
          </Note>
          <div className="num mt-1 text-[12px] text-ink-3">
            YTD {f.money(m.ytdSpend)}
            {m.unpricedCount > 0 && <span className="text-caution"> · {m.unpricedCount} in other currencies not included</span>}
          </div>
        </Figure>

        <Figure label="Potential price gap" hint={EXPLAIN.priceGap}>
          {best && bestRow ? (
            <>
              <Big>
                {f.price(best.priceDifference)}
                <span className="text-[15px] font-medium text-ink-3">/{product.unit}</span>
              </Big>
              <Note>
                <span>
                  {bestRow.supplier.name} {bestRow.kind === "quote" ? "quoted" : "charged"} <span className="num">{f.price(bestRow.priceEUR)}</span> ({f.pct(-best.priceDifferencePct!)})
                </span>
              </Note>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                <span className="num">
                  Potential nominal saving <span className="font-semibold">{f.money(best.potentialSaving)}/yr</span>
                </span>
                <ConfidenceBadge level={best.confidence} suffix=" confidence" />
              </div>
              {larger && (
                <div className="mt-1.5 text-[12px] text-ink-3">
                  Larger gap, less comparable: {l.supplierName(larger.alternativeSupplierId)} {f.pct(-larger.priceDifferencePct!)} ({larger.confidence} confidence)
                </div>
              )}
              <div className="mt-1.5 text-[12px] text-ink-3">
                Missing before decision: {best.missing.some((x) => /^freight unknown/i.test(x)) ? "freight + landed cost" : "landed cost"} ·{" "}
                <Link href={`/opportunities/${best.key}`} className="font-medium text-ledger hover:underline">
                  Details
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="text-[17px] leading-tight font-medium text-ink-3">Not enough comparison data</div>
              <Note>
                {!price.current
                  ? "No current price to compare with"
                  : alternatives.length === 0
                    ? "No alternative quotes or suppliers on file"
                    : pi.dismissedSavings > 0
                      ? `${pi.dismissedSavings} lower offer${pi.dismissedSavings > 1 ? "s" : ""} rejected or closed by you`
                      : alternatives.every((r) => r.comparability === "not")
                        ? "The alternatives on file can't be compared yet"
                        : "No comparable alternative is priced below the current supplier"}
              </Note>
            </>
          )}
        </Figure>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <Section
          title="Price history"
          description={`Unit price paid per ${product.unit}, every comparable purchase`}
          actions={
            <ExportLink href={`/export/price-history?product=${product.id}`}>CSV</ExportLink>
          }
        >
          <PriceChart
            asOf={intel.asOf}
            points={observations.map((p) => ({
              id: p.id,
              date: p.date,
              price: basePrice(p),
              supplierId: p.supplierId,
              supplier: l.supplierName(p.supplierId),
              quantity: p.quantity,
              unit: product.unit,
              source: `${sourceLabel(p.source)}${p.invoiceReference ? ` ${p.invoiceReference}` : ""}`,
            }))}
          />
        </Section>

        <Section title="Price metrics">
          <dl className="divide-y divide-rule text-[13px]">
            <Metric label="Previous price" hint={EXPLAIN.previousPrice}>
              {price.previous ? (
                <span className="num">
                  {f.price(price.previous.price)} <span className="text-ink-3">· {f.date(price.previous.date)}</span>
                </span>
              ) : (
                "—"
              )}
            </Metric>
            <Metric label="3M change" hint={EXPLAIN.change}>
              <Change c={price.changes.m3} />
            </Metric>
            <Metric label="6M change">
              <Change c={price.changes.m6} />
            </Metric>
            <Metric label="12M change">
              <Change c={price.changes.m12} />
            </Metric>
            <Metric label="All-time change">
              <Change c={price.changes.all} />
            </Metric>
            <Metric label="Weighted average" hint={EXPLAIN.weightedAverage}>
              <span className="num font-medium">{f.price(price.weightedAveragePrice)}</span>
            </Metric>
            <Metric label="Average price" hint={EXPLAIN.average}>
              <span className="num">{f.price(price.averagePrice)}</span>
            </Metric>
            <Metric label="Current vs average" hint={EXPLAIN.premium}>
              <Delta value={price.premiumVsAveragePct} />
            </Metric>
            <Metric label="Historical low" hint={EXPLAIN.lowHigh}>
              {price.low ? (
                <span className="num">
                  {f.price(price.low.price)} <span className="text-ink-3">· {f.month(price.low.date)}</span>
                </span>
              ) : (
                "—"
              )}
            </Metric>
            <Metric label="Historical high">
              {price.high ? (
                <span className="num">
                  {f.price(price.high.price)} <span className="text-ink-3">· {f.month(price.high.date)}</span>
                </span>
              ) : (
                "—"
              )}
            </Metric>
            <Metric label="Trend" hint={EXPLAIN.trend}>
              <TrendTag trend={price.trend} />
            </Metric>
          </dl>
        </Section>
      </div>

      {/* Price change timeline */}
      {price.timeline.length > 1 && (
        <Section
          className="mt-6"
          title="Price change timeline"
          description={price.timeline.length > TIMELINE_MAX ? `Last ${TIMELINE_MAX} of ${price.timeline.length} price changes` : "Each time the price paid changed"}
          actions={
            <span className="text-[12.5px] text-ink-3">
              Total <Delta value={price.totalChangePct} />
            </span>
          }
        >
          <ol className="flex flex-wrap gap-x-2 gap-y-4">
            {timeline.map((e, i) => (
              <li key={e.purchaseId} className="flex items-center gap-2">
                {i > 0 && <span className="text-ink-4" aria-hidden>→</span>}
                <div className="rounded-md border border-rule px-3 py-2">
                  <div className="text-[12px] text-ink-3">{f.month(e.date)}</div>
                  <div className="num text-[15px] font-semibold">{f.price(e.price)}</div>
                  <div className="h-[18px] text-[12px]">{e.pct != null ? <Delta value={e.pct} /> : <span className="text-ink-4">first price</span>}</div>
                  {pi.concentration.shares.length > 1 && <div className="max-w-[120px] truncate text-[11.5px] text-ink-3">{l.supplierName(e.supplierId)}</div>}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Supplier comparison */}
      <Section
        className="mt-6"
        title="Supplier comparison"
        description="The latest price from every supplier on file, on the same unit and currency basis"
        flush
        actions={
          <>
            <ExportLink href={`/export/comparison?product=${product.id}`}>CSV</ExportLink>
            <QuoteDialog {...common} defaultProductId={product.id} trigger={{ label: "Add quote", size: "sm" }} />
          </>
        }
      >
        <div className="px-5 pb-4">
          <PriceOnlyNotice />
        </div>
        <div className="border-t border-rule">
          <SupplierComparison intel={pi} quotes={productQuotes} products={l.productOptions} suppliers={l.supplierOptions} />
        </div>
        {alternatives.length === 0 && pi.comparison.length > 0 && (
          <p className="border-t border-rule px-5 py-3 text-[12.5px] text-ink-3">No alternatives on file. Add quotes from other suppliers to see how the current price compares.</p>
        )}
      </Section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Supplier concentration */}
        <Section
          title={
            <>
              Supplier concentration <Hint text={EXPLAIN.concentration} />
            </>
          }
          description={pi.concentration.lastTwelveMonths ? "Share of the last 12 months' spend" : "No purchases in the last 12 months — whole history shown"}
          actions={pi.concentration.sourcing !== "none" ? <SourcingBadge sourcing={pi.concentration.sourcing} /> : undefined}
        >
          {pi.concentration.shares.length === 0 ? (
            <p className="text-[13px] text-ink-3">No purchases yet.</p>
          ) : (
            <>
              <div className="flex h-2 overflow-hidden rounded-full bg-wash" role="img" aria-label="Spend share by supplier">
                {pi.concentration.shares.map((s, i) => (
                  <div key={s.supplierId} className="h-full border-r-2 border-canvas last:border-r-0" style={{ width: `${s.share * 100}%`, background: `rgb(17 17 19 / ${Math.max(0.2, 0.75 - i * 0.2)})` }} />
                ))}
              </div>
              <ul className="mt-3 space-y-1.5 text-[13px]">
                {pi.concentration.shares.map((s) => (
                  <li key={s.supplierId} className="flex items-baseline justify-between gap-4">
                    <Link href={`/suppliers/${s.supplierId}`} className="hover:text-ledger">
                      {l.supplierName(s.supplierId)}
                    </Link>
                    <span className="num text-ink-2">
                      <span className="font-medium text-ink">{f.number(s.share * 100, 0)}%</span> · {f.money(s.spend)}
                    </span>
                  </li>
                ))}
              </ul>
              {pi.highSpend && (
                <p className="mt-3 text-[12.5px] text-ink-3">
                  High-spend product (#{pi.rank} by spend) <Hint text={EXPLAIN.highSpend} />
                </p>
              )}
            </>
          )}
        </Section>

        {/* Data quality */}
        <Section
          title={
            <>
              Data quality <Hint text={EXPLAIN.dataQuality} />
            </>
          }
          description="How much trust the figures on this page deserve"
          actions={<QualityBadge level={pi.quality.level} />}
        >
          <ul className="space-y-1.5 text-[13px]">
            {pi.quality.factors.map((q) => (
              <li key={q.label} className="flex items-baseline justify-between gap-4">
                <span className="text-ink-3">{q.label}</span>
                <span className={cx("text-right", q.state === "poor" ? "font-medium text-caution" : q.state === "caution" ? "text-caution" : "text-ink-2")}>{q.detail}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* Possible data anomalies */}
      {(price.outliers.length > 0 || excluded.length > 0) && (
        <Section
          className="mt-6"
          title={
            <>
              Possible data anomalies <Hint text={EXPLAIN.outlier} />
            </>
          }
          description="Prices far from the usual level. Nothing is removed automatically."
          flush
        >
          <ul className="border-t border-rule">
            {price.outliers.map((o) => {
              const p = history.find((x) => x.id === o.purchaseId)!;
              return (
                <li key={o.purchaseId} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-5 py-3 last:border-b-0">
                  <AlertTriangle size={15} className="text-caution" />
                  <div className="min-w-[240px] flex-1 text-[13px]">
                    <span className="num font-medium">{f.price(o.price)}</span> on {f.date(o.date)} from {l.supplierName(o.supplierId)} —{" "}
                    <span className="num">{f.pct(o.deviationPct, 0)}</span> vs the usual <span className="num">{f.price(o.median)}</span>
                  </div>
                  <OutlierActions purchaseId={o.purchaseId} />
                  <PurchaseDialog {...common} purchase={p} trigger={{ label: "Correct value", variant: "ghost", size: "sm" }} />
                </li>
              );
            })}
            {excluded.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-5 py-3 text-[13px] text-ink-3 last:border-b-0">
                <span className="num">
                  {f.price(p.unitPrice, p.currency)} on {f.date(p.date)}
                </span>
                excluded from price analysis by you
                <RestorePriceButton purchaseId={p.id} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Price distribution */}
      {price.distribution && price.current && (
        <Section
          className="mt-6"
          title={
            <>
              Price distribution <Hint text={EXPLAIN.distribution} />
            </>
          }
          description={`${price.observations} purchases`}
        >
          <Distribution d={price.distribution} current={price.current.price} />
        </Section>
      )}

      {/* Opportunities for this product */}
      {pi.opportunities.length > 0 && (
        <Section className="mt-6" title="Opportunities" description="What the data suggests looking at — before landed cost" flush>
          <ul className="border-t border-rule">
            {pi.opportunities.map((o) => (
              <li key={o.key} className="relative border-b border-rule last:border-b-0 hover:bg-well">
                <Link href={`/opportunities/${o.key}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <div className="min-w-[220px] flex-1">
                    <div className="text-[13.5px] font-medium">
                      {OPPORTUNITY_LABEL[o.type]}
                      {o.alternativeSupplierId && <span className="font-normal text-ink-2"> · {l.supplierName(o.alternativeSupplierId)}</span>}
                    </div>
                    <div className="text-[12.5px] text-ink-3">{o.reason}</div>
                  </div>
                  {o.impact != null && (
                    <span className="num text-right text-[13px]">
                      <span className="font-semibold">{f.money(o.impact)}/yr</span>
                      <span className="block text-[11.5px] text-ink-3">{o.potentialSaving != null ? "potential saving" : "price impact"}</span>
                    </span>
                  )}
                  {o.confidence && <ConfidenceBadge level={o.confidence} />}
                  <OpportunityStatusBadge status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        className="mt-6"
        title="Purchase history"
        description={plural(history.length, "purchase")}
        flush
        actions={
          <Link href={`/purchases?product=${product.id}`} className="text-[13px] font-medium text-ledger hover:underline">
            Open in Purchases
          </Link>
        }
      >
        {history.length === 0 ? (
          <Empty title="No purchases yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Supplier</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Unit price</Th>
                <Th align="right">Freight</Th>
                <Th align="right">Total</Th>
                <Th>Currency</Th>
                <Th>Invoice</Th>
                <Th>Source</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((p) => (
                <tr key={p.id} className={rowClass()}>
                  <Td className="num">{f.date(p.date)}</Td>
                  <Td>{l.supplierName(p.supplierId)}</Td>
                  <Td align="right">{f.quantity(p.quantity, p.unit)}</Td>
                  <Td align="right" className="font-medium">
                    {f.price(p.unitPrice, p.currency)}
                    {p.priceReview === "excluded" && <span className="ml-1.5 text-[11.5px] font-normal text-ink-3">excluded</span>}
                    {!isPriced(p) && <span className="ml-1.5 text-[11.5px] font-normal text-caution">no FX rate</span>}
                  </Td>
                  <Td align="right" muted>{p.freightCost ? f.money(p.freightCost, p.currency) : "—"}</Td>
                  <Td align="right">{f.money(p.totalAmount, p.currency)}</Td>
                  <Td muted>{p.currency}</Td>
                  <Td muted>{p.invoiceReference ?? "—"}</Td>
                  <Td>
                    <SourceTag source={p.source} doc={p.sourceDoc} />
                  </Td>
                  <Td>
                    <PurchaseDialog {...common} purchase={p} trigger={{ label: "Edit purchase", iconOnly: true }} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section className="mt-6" title="Data sources" description="Where the purchases and quotes of this product come from, and the names it is recognised by">
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <Label>Records by source</Label>
            {sourceCounts.size === 0 ? (
              <p className="mt-1 text-[13px] text-ink-3">No purchases or quotes yet.</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {[...sourceCounts.entries()].map(([src, n]) => (
                  <li key={src} className="flex justify-between gap-4">
                    <span className="text-ink-2">{sourceLabel(src)}</span>
                    <span className="num text-ink-3">{n}</span>
                  </li>
                ))}
              </ul>
            )}
            {docs.size > 0 && (
              <>
                <div className="mt-4">
                  <Label>Documents</Label>
                </div>
                <ul className="mt-1.5 space-y-1 text-[13px]">
                  {[...docs.values()].map((d) => (
                    <li key={d.sessionId} className="flex items-center justify-between gap-3">
                      <Link href={`/import/${d.sessionId}`} className="min-w-0 truncate hover:text-ledger" title={d.filename}>
                        {d.filename}
                      </Link>
                      {d.documentId && (
                        <a href={`/documents/${d.documentId}`} target="_blank" className="shrink-0 text-[12px] font-medium text-ledger hover:underline">
                          View
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <Label>Also known as</Label>
            {aliases.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-3">Names confirmed during imports appear here and are recognised automatically next time.</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {aliases.map((a) => (
                  <li key={a.id} className="rounded-md bg-wash px-2 py-0.5 text-[12.5px] text-ink-2">
                    {a.alias}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <Label>Supplier codes</Label>
            {codes.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-3">How each supplier codes this product, learned from their documents.</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {codes.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3">
                    <span className="text-ink-2">{l.supplierName(c.supplierId)}</span>
                    <span className="truncate font-mono text-[12px] text-ink-3" title={c.supplierProductName ?? undefined}>
                      {c.supplierSku ?? c.supplierProductName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      {(product.description || product.technicalSpecifications || product.specs) && (
        <Section className="mt-6" title="Specifications">
          <div className="grid gap-6 sm:grid-cols-2">
            {product.specs && (
              <div>
                <Label>Specifications</Label>
                <dl className="mt-1.5 space-y-1 text-[13px]">
                  {Object.entries(product.specs).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="text-ink-2">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {product.description && (
              <div>
                <Label>Description</Label>
                <p className="mt-1 text-[13.5px] text-ink-2">{product.description}</p>
              </div>
            )}
            {product.technicalSpecifications && (
              <div>
                <Label>Technical notes</Label>
                <p className="mt-1 text-[13.5px] whitespace-pre-line text-ink-2">{product.technicalSpecifications}</p>
              </div>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function Figure({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-canvas p-5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[12px] font-medium tracking-[0.02em] text-ink-3 uppercase">
        {label} {hint && <Hint text={hint} />}
      </div>
      {children}
    </div>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return <div className="num text-[28px] leading-none font-semibold tracking-[-0.02em]">{children}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-ink-3">{children}</div>;
}

function Metric({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="flex items-center gap-1.5 text-ink-3">
        {label} {hint && <Hint text={hint} />}
      </dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

function Change({ c }: { c: WindowChange }) {
  if (c.pct == null) return <span className="text-ink-4">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      {c.partial && <span className="text-[11.5px] text-ink-4">since {f.month(c.referenceDate)}</span>}
      <Delta value={c.pct} />
    </span>
  );
}

/** Where the current price sits among all prices paid. */
function Distribution({ d, current }: { d: { min: number; p25: number; median: number; p75: number; max: number }; current: number }) {
  const span = d.max - d.min || 1;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - d.min) / span) * 100))}%`;
  const stats: [string, number][] = [
    ["Minimum", d.min],
    ["25th percentile", d.p25],
    ["Median", d.median],
    ["75th percentile", d.p75],
    ["Maximum", d.max],
    ["Current", current],
  ];
  return (
    <div>
      <div className="relative mx-1 h-8" role="img" aria-label="Price distribution">
        <div className="absolute top-1/2 right-0 left-0 h-px bg-rule-strong" />
        <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-ink/15" style={{ left: at(d.p25), width: `calc(${at(d.p75)} - ${at(d.p25)})` }} />
        <div className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-ink-2" style={{ left: at(d.median) }} />
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-ledger" style={{ left: at(current) }} title="Current price" />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, v]) => (
          <div key={label}>
            <dt className="text-[12px] text-ink-3">{label}</dt>
            <dd className={cx("num", label === "Current" ? "font-semibold text-ledger" : "font-medium")}>{f.price(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
