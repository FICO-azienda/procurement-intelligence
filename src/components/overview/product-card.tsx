import Link from "next/link";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { QuoteDialog, type ProductOption, type SupplierOption } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { ConfidenceBadge, OpportunityStatusBadge, QualityBadge } from "@/components/intel/badges";
import { Basis, ButtonLink, Delta, cx } from "@/components/ui";
import * as f from "@/lib/format";
import { DECISION_STATUS, REFERENCE_LABEL, type DecisionAlternative, type DecisionStatus, type NextAction, type ProductDecision } from "@/lib/intel/decision";
import { EXPLAIN } from "@/lib/intel/explain";
import { PriceBar } from "./price-bar";

const pill = "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium whitespace-nowrap";

const STATUS_CLASS: Record<DecisionStatus, string> = {
  action: "bg-ledger text-white",
  review: "bg-caution-wash text-caution",
  data_needed: "border border-dashed border-rule-strong text-ink-3",
  good: "bg-down-wash text-down",
};

export function DecisionStatusPill({ status }: { status: DecisionStatus }) {
  return (
    <span className={cx(pill, "tracking-[0.02em] uppercase", STATUS_CLASS[status])} title={DECISION_STATUS[status].meaning}>
      {DECISION_STATUS[status].label}
    </span>
  );
}

/** The facts behind a suggestion, on request. Native disclosure: works without JavaScript and on paper stays closed. */
export function Why({ action }: { action: NextAction }) {
  return (
    <details className="group mt-1">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12.5px] font-medium text-ledger select-none hover:underline [&::-webkit-details-marker]:hidden">
        Why?
      </summary>
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 rounded-md bg-well px-3 py-2 text-[12.5px]">
        {action.why.map((w) => (
          <div key={w.label} className="contents">
            <dt className="text-ink-3">{w.label}</dt>
            <dd className="num text-ink-2">{w.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5 text-[11.5px] font-medium tracking-[0.04em] text-ink-3 uppercase">{children}</div>;
}

export function ProductCard({
  d,
  detail,
  products,
  suppliers,
}: {
  d: ProductDecision;
  detail: boolean;
  products: ProductOption[];
  suppliers: SupplierOption[];
}) {
  const unit = d.unit;
  const showSaving = d.savingMaterial && d.potentialSaving != null;

  return (
    <article id={`p-${d.productId}`} className="scroll-mt-4 rounded-lg border border-rule bg-canvas">
      {/* What it is, how it stands, how much is at stake */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4 pb-3 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <DecisionStatusPill status={d.status} />
            <h3 className="text-[17px] leading-snug font-semibold tracking-[-0.012em]">
              <Link href={`/products/${d.productId}`} className="hover:underline">
                {d.name}
              </Link>
            </h3>
          </div>
          <p className="mt-1.5 text-[13px] text-ink-3">
            {d.statusReason}
            {d.category && <span className="text-ink-4"> · {d.category}</span>}
          </p>
        </div>
        <div className="sm:text-right">
          {showSaving ? (
            <>
              <div className="num text-[26px] leading-none font-semibold tracking-[-0.025em]">
                {f.moneyApprox(d.potentialSaving)}
                <span className="text-[14px] font-medium text-ink-3">/year</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3 sm:justify-end">
                potential saving
                <ConfidenceBadge level={d.savingConfidence} suffix=" confidence" />
                {d.opportunityStatus && d.opportunityStatus !== "open" && <OpportunityStatusBadge status={d.opportunityStatus} />}
              </div>
            </>
          ) : d.priceIncreaseCost != null ? (
            <>
              <div className="num text-[26px] leading-none font-semibold tracking-[-0.025em] text-up">
                +{f.moneyApprox(d.priceIncreaseCost)}
                <span className="text-[14px] font-medium text-ink-3">/year</span>
              </div>
              <div className="mt-1.5 text-[12px] text-ink-3">cost of the price increase at your volume</div>
            </>
          ) : d.potentialSaving != null ? (
            <div className="text-[13px] text-ink-3">
              Potential saving: <span className="font-medium text-ink-2">not material</span>
            </div>
          ) : (
            <div className="text-[13px] text-ink-3">No saving identified</div>
          )}
        </div>
      </header>

      {/* The explanation an owner can read without opening anything else */}
      <p className="max-w-[78ch] px-5 pb-4 text-[14.5px] leading-relaxed text-ink-2 sm:px-6">{d.summary.join(" ")}</p>

      {/* You pay · compared with · in money */}
      <div className="grid grid-cols-1 gap-px border-y border-rule bg-rule lg:grid-cols-3">
        <div className="bg-canvas px-5 py-4 sm:px-6">
          <Label>
            You pay <Basis>Actual</Basis>
          </Label>
          {d.currentPrice == null ? (
            <div className="mt-2 text-[15px] font-medium text-ink-3">No price yet</div>
          ) : (
            <>
              <div className="num mt-1.5 text-[26px] leading-none font-semibold tracking-[-0.025em]">
                {f.priceShort(d.currentPrice)}
                <span className="text-[14px] font-medium text-ink-3">/{unit}</span>
              </div>
              {d.currentSupplier && (
                <div className="mt-2 text-[13.5px]">
                  <Link href={`/suppliers/${d.currentSupplier.id}`} className="font-medium hover:underline">
                    {d.currentSupplier.name}
                  </Link>
                  {d.currentSupplier.country && <span className="text-ink-3"> — {d.currentSupplier.country}</span>}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px]">
                {d.priceTrend.pct == null ? (
                  <span className="text-ink-3">No price history yet</span>
                ) : (
                  <>
                    <Delta value={d.priceTrend.pct} />
                    <span className="text-ink-3">{d.priceTrend.partial ? `since ${f.month(d.priceTrend.referenceDate)}` : "vs 12 months ago"}</span>
                  </>
                )}
              </div>
              <div className="mt-2.5 text-[12.5px] text-ink-3">
                Annual spend <span className="num font-medium text-ink-2">{f.money(Math.round(d.annualSpend))}</span>
                {d.annualQuantity > 0 && <span className="num"> · {f.quantity(d.annualQuantity, unit)}</span>}
              </div>
            </>
          )}
        </div>

        <div className="bg-canvas px-5 py-4 sm:px-6">
          <Label>
            Compared with <Hint text={EXPLAIN.quotesOnFile} label="What the price is compared with" />
          </Label>
          {d.market.type === "not_available" ? (
            <>
              <div className="mt-2 text-[15px] font-medium text-ink-3">Not available</div>
              <p className="mt-1.5 text-[12.5px] text-ink-3">
                {d.alternativesTotal ? "The offers on file can't be compared yet." : "No quote from another supplier on file."} External market benchmarks are not connected.
              </p>
            </>
          ) : (
            <>
              <div className="num mt-1.5 text-[20px] leading-tight font-semibold tracking-[-0.02em]">
                {f.priceShort(d.market.low)}
                {f.priceShort(d.market.low) !== f.priceShort(d.market.high) && <> – {f.priceShort(d.market.high)}</>}
                <span className="text-[13px] font-medium text-ink-3">/{unit}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
                <Basis>Quote</Basis>
                {REFERENCE_LABEL[d.market.type]} · {d.market.count} {d.market.count === 1 ? "supplier" : "suppliers"}
              </div>
              {d.currentPrice != null && <PriceBar current={d.currentPrice} low={d.market.low!} high={d.market.high!} best={d.best} unit={unit} />}
              {detail && (
                <p className="mt-2 text-[12px] text-ink-3">
                  From your own quotes, not a market price. {d.market.recent} of {d.market.count} still recent · latest {f.month(d.market.latestDate)} ·{" "}
                  {d.market.confidence === "medium" ? "a fair comparison" : "a limited comparison"}.
                </p>
              )}
            </>
          )}
        </div>

        <div className="bg-canvas px-5 py-4 sm:px-6">
          <Label>
            In money {d.money && <Basis>Estimate</Basis>} <Hint text={EXPLAIN.moneyView} />
          </Label>
          {d.money && d.best ? (
            <dl className="mt-2 space-y-1.5 text-[13.5px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-3">A year at today&apos;s price</dt>
                <dd className="num font-medium">{f.money(Math.round(d.money.currentAnnualCost))}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-3">At {d.best.supplierName}&apos;s quoted price</dt>
                <dd className="num font-medium">{f.money(Math.round(d.money.alternativeAnnualCost))}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-rule pt-1.5">
                <dt className="font-medium">Potential difference</dt>
                <dd className="num text-[15px] font-semibold whitespace-nowrap">{f.moneyApprox(d.money.difference)}/yr</dd>
              </div>
              <p className="pt-1 text-[12px] text-ink-3">
                Price only. Transport, duties, stock and quality are not included yet <Hint text={EXPLAIN.trueCost} label="What true cost means" />
              </p>
            </dl>
          ) : (
            <>
              <div className="mt-2 text-[15px] font-medium text-ink-3">{d.status === "good" ? "No gap to close" : "Nothing to quantify yet"}</div>
              {d.priceIncreaseCost != null && (
                <p className="mt-1.5 text-[12.5px] text-ink-3">
                  The price increase costs about <span className="num font-medium text-up">{f.moneyApprox(d.priceIncreaseCost)}</span> a year at your current volume{" "}
                  <Hint text={EXPLAIN.annualImpact} />
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Alternatives: best comparable first, never by quoted price alone */}
      {d.alternatives.length > 0 && (
        <div className="px-5 pt-4 pb-1 sm:px-6">
          <Label>
            Alternatives on file
            {d.alternativesTotal > d.alternatives.length && (
              <span className="tracking-normal normal-case">
                · top {d.alternatives.length} of {d.alternativesTotal}
              </span>
            )}
          </Label>
          <ol className="mt-1 divide-y divide-rule">
            {d.alternatives.map((a, i) => (
              <Alternative key={a.supplierId} a={a} rank={i + 1} unit={unit} detail={detail} />
            ))}
          </ol>
          {d.cheapestNotFirst && (
            <div className="mt-1 mb-3 rounded-md bg-wash px-3.5 py-3 text-[13px]">
              <div className="font-medium">Why isn&apos;t the cheapest quote first?</div>
              <p className="mt-0.5 text-ink-2">{d.cheapestNotFirst.explanation}</p>
            </div>
          )}
        </div>
      )}

      {/* What to check · supply */}
      <div className={cx("grid grid-cols-1 gap-x-10 gap-y-4 px-5 pt-3 pb-4 sm:px-6 lg:grid-cols-2", d.alternatives.length > 0 && "border-t border-rule")}>
        <div>
          <Label>What to check</Label>
          {d.nextActions.length === 0 ? (
            <p className="mt-1.5 text-[13.5px] text-ink-3">Nothing to do right now.</p>
          ) : (
            <ol className="mt-1.5 space-y-2.5">
              {d.nextActions.map((x, i) => (
                <li key={x.kind + i} className="grid grid-cols-[18px_minmax(0,1fr)] text-[13.5px]">
                  <span className="num text-ink-4">{i + 1}</span>
                  <div>
                    <div className="font-medium">{x.label}</div>
                    <Why action={x} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="space-y-3.5">
          <div>
            <Label>
              Supply risk <Hint text={EXPLAIN.supplyRisk} />
            </Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
              <span className={cx(pill, d.supplyRisk.level === "high" ? "bg-caution-wash text-caution" : "bg-wash text-ink-2")}>{d.supplyRisk.label}</span>
              <span className="text-ink-3">{d.supplyRisk.detail}</span>
            </div>
          </div>
          {d.currentSupplier && (
            <div>
              <Label>Current supplier</Label>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-ink-3">
                {d.currentSupplier.paymentTermsDays != null && (
                  <span>
                    Payment <span className="num font-medium text-ink-2">{f.paymentTerms(d.currentSupplier.paymentTermsDays)}</span>
                  </span>
                )}
                {d.currentSupplier.leadTimeDays != null && (
                  <span>
                    Lead time <span className="num font-medium text-ink-2">{f.days(d.currentSupplier.leadTimeDays)}</span>
                  </span>
                )}
                {d.currentSupplier.since && (
                  <span>
                    Buying since <span className="font-medium text-ink-2">{f.month(d.currentSupplier.since)}</span>
                  </span>
                )}
                {d.currentSupplier.orders12m > 0 && (
                  <span>
                    <span className="num font-medium text-ink-2">{d.currentSupplier.orders12m}</span> {d.currentSupplier.orders12m === 1 ? "order" : "orders"} in 12 months
                  </span>
                )}
              </div>
              {detail && <p className="mt-1 text-[12px] text-ink-4">On-time delivery and defect rate are not tracked yet.</p>}
            </div>
          )}
        </div>
      </div>

      {detail && (
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 border-t border-rule px-5 py-4 sm:px-6 lg:grid-cols-2">
          <div>
            <Label>Still unknown</Label>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {d.missingData.map((m) => (
                <li key={m} className="rounded-[5px] border border-dashed border-rule-strong px-2 py-0.5 text-[12px] text-ink-3">
                  {m}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Label>
              Data confidence <Hint text={EXPLAIN.dataQuality} />
            </Label>
            <p className="mt-1.5 text-[12.5px] text-ink-3">
              {d.dataConfidenceReasons.length ? d.dataConfidenceReasons.join(" · ") : "Enough recent, consistent purchases to rely on the price history."}
            </p>
          </div>
        </div>
      )}

      {/* Where to go next, and how fresh the data is */}
      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-rule px-5 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <ButtonLink href={`/products/${d.productId}`} size="sm" variant="primary">
            View analysis <ArrowRight size={13} />
          </ButtonLink>
          <ButtonLink href={`/compare?product=${d.productId}`} size="sm">
            Compare suppliers
          </ButtonLink>
          {d.opportunityKey && (
            <ButtonLink href={`/opportunities/${d.opportunityKey}`} size="sm">
              Open opportunity
            </ButtonLink>
          )}
          <QuoteDialog products={products} suppliers={suppliers} defaultProductId={d.productId} trigger={{ label: "Add quote", size: "sm", variant: "ghost" }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            Data confidence <QualityBadge level={d.dataConfidence} />
          </span>
          {d.lastUpdated.purchases && <span>Last purchase {f.month(d.lastUpdated.purchases)}</span>}
          {d.lastUpdated.quotes && <span>Last quote {f.month(d.lastUpdated.quotes)}</span>}
        </div>
      </footer>
    </article>
  );
}

function Alternative({ a, rank, unit, detail }: { a: DecisionAlternative; rank: number; unit: string; detail: boolean }) {
  const warns = a.flags.filter((x) => x.tone === "warn");
  const oks = a.flags.filter((x) => x.tone === "ok");
  const flags = detail ? [...warns, ...oks] : [...warns.slice(0, 3), ...oks.slice(0, 2)];
  const foreign = a.currency !== "EUR";
  return (
    <li className="grid grid-cols-[18px_minmax(0,1fr)] gap-y-1 py-3">
      <span className="num pt-px text-[13px] text-ink-4">{rank}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div className="text-[14px]">
            <Link href={`/suppliers/${a.supplierId}`} className="font-semibold hover:underline">
              {a.supplierName}
            </Link>
            {a.country && <span className="text-ink-3"> — {a.country}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]">
            <span className="inline-flex items-center gap-1.5">
              <Basis>{a.kind === "quote" ? "Quote" : "Actual"}</Basis>
              <span className="num font-semibold">
                {a.priceEUR != null ? f.priceShort(a.priceEUR) : f.price(a.quotedPrice, a.currency)}
                <span className="font-normal text-ink-3">/{unit}</span>
              </span>
              {foreign && a.priceEUR != null && <span className="num text-[12px] text-ink-3">({f.price(a.quotedPrice, a.currency)})</span>}
              {a.differencePct != null && <Delta value={a.differencePct} className="text-[13px]" />}
            </span>
            {a.potentialSaving != null && !a.setAside && (
              <span className="num">
                <span className="font-semibold">{f.moneyApprox(a.potentialSaving)}</span>
                <span className="text-ink-3">/yr</span>
              </span>
            )}
            {a.confidence && <ConfidenceBadge level={a.confidence} />}
          </div>
        </div>

        {a.notComparableReason ? (
          <p className="mt-1 text-[12.5px] text-caution">Can&apos;t be compared yet — {a.notComparableReason}</p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                True cost <Basis tone="muted">Not estimated yet</Basis>
              </span>
              {a.leadTimeDays != null && (
                <span>
                  Lead time <span className="num text-ink-2">{f.days(a.leadTimeDays)}</span>
                </span>
              )}
              {a.moq != null && (
                <span>
                  MOQ <span className="num text-ink-2">{f.quantity(a.moq, unit)}</span>
                </span>
              )}
              {detail && a.paymentTermsDays != null && (
                <span>
                  Payment <span className="num text-ink-2">{f.paymentTerms(a.paymentTermsDays)}</span>
                </span>
              )}
              {detail && a.incoterm && (
                <span>
                  Incoterm <span className="text-ink-2">{a.incoterm}</span>
                </span>
              )}
              {detail && a.date && (
                <span>
                  {a.kind === "quote" ? "Quoted" : "Paid"} <span className="num text-ink-2">{f.date(a.date)}</span>
                </span>
              )}
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px]">
              {flags.map((x) => (
                <li key={x.key} className={cx("inline-flex items-center gap-1", x.tone === "warn" ? "text-caution" : "text-ink-3")}>
                  {x.tone === "warn" ? <AlertTriangle size={12} strokeWidth={2} aria-hidden /> : <Check size={12} strokeWidth={2.25} className="text-down" aria-hidden />}
                  {x.label}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </li>
  );
}
