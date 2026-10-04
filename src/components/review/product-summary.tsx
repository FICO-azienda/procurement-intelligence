import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { QuoteDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { ConfidenceBadge, DecisionStatusPill, OpportunityStatusBadge, QualityBadge } from "@/components/intel/badges";
import { Basis, ButtonLink, Delta, cx } from "@/components/ui";
import { countryName, flagOf } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { lowerFirst } from "@/lib/i18n";
import type { CompareColumn, ProductDecision } from "@/lib/intel/decision";
import { explain } from "@/lib/intel/explain";
import { KIND_LABEL } from "@/lib/intel/labels";
import { Why } from "./product-card";

const chip = "inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap";

/**
 * The top of a product's page: the answer before the charts. What you pay
 * and what is at stake, the explanation in plain words, what to do next, and
 * every supplier with a price on one line each.
 */
export async function ProductSummary({ d, columns }: { d: ProductDecision; columns: CompareColumn[] }) {
  const t = await getT();
  const EXPLAIN = explain(t);
  const unit = d.unit;
  const showSaving = d.savingMaterial && d.potentialSaving != null;
  return (
    <section aria-label={t("Summary")} className="rounded-lg border border-rule bg-canvas">
      {/* The numbers that matter, and the way to the comparison */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4 sm:px-6">
        <div className="min-w-[200px] flex-1">
          <DecisionStatusPill status={d.status} />
          <div className="mt-1.5 text-[14px] font-medium">{d.statusReason}</div>
        </div>
        <Stat label={t("You pay")} basis={t("Actual")}>
          {d.currentPrice != null ? (
            <>
              {f.priceShort(d.currentPrice)}
              <span className="text-[13px] font-medium text-ink-3">/{unit}</span>
            </>
          ) : (
            <span className="text-ink-4">—</span>
          )}
          {d.priceTrend.pct != null && <Delta value={d.priceTrend.pct} className="ml-2 text-[13px]" />}
        </Stat>
        <Stat label={t("Annual spend")}>{d.annualSpend > 0 ? f.money(Math.round(d.annualSpend)) : <span className="text-ink-4">—</span>}</Stat>
        <Stat label={showSaving ? t("Potential saving") : d.priceIncreaseCost != null ? t("Cost of the increase") : t("Potential saving")} hint={showSaving ? EXPLAIN.potentialSaving : d.priceIncreaseCost != null ? EXPLAIN.annualImpact : undefined}>
          {showSaving ? (
            <>
              {f.moneyApprox(d.potentialSaving)}
              <span className="text-[13px] font-medium text-ink-3">{t("/yr")}</span>
              <span className="ml-2 inline-flex gap-1 align-middle">
                <ConfidenceBadge level={d.savingConfidence} />
                {d.opportunityStatus && d.opportunityStatus !== "open" && <OpportunityStatusBadge status={d.opportunityStatus} />}
              </span>
            </>
          ) : d.priceIncreaseCost != null ? (
            <span className="text-up">
              +{f.moneyApprox(d.priceIncreaseCost)}
              <span className="text-[13px] font-medium text-ink-3">{t("/yr")}</span>
            </span>
          ) : (
            <span className="text-[15px] font-medium text-ink-3">{d.potentialSaving != null ? t("Not material") : t("None identified")}</span>
          )}
        </Stat>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <ButtonLink href={`/compare?product=${d.productId}`} variant="primary">
            <ArrowLeftRight size={14} /> {t("Compare suppliers")}
          </ButtonLink>
          <QuoteDialog defaultProductId={d.productId} trigger={{ label: t("Add quote") }} />
        </div>
      </div>

      {/* In plain words · what to do next */}
      <div className="grid grid-cols-1 gap-px border-y border-rule bg-rule @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="bg-canvas px-5 py-4 sm:px-6">
          <h2 className="text-[13px] font-semibold">{t("In plain words")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-[14.5px] leading-relaxed text-ink-2">{d.summary.join(" ")}</p>
          {d.cheapestNotFirst && (
            <div className="mt-3 rounded-md bg-wash px-3.5 py-3 text-[13px]">
              <div className="font-medium">{t("Why isn't the cheapest quote first?")}</div>
              <p className="mt-0.5 text-ink-2">{d.cheapestNotFirst.explanation}</p>
            </div>
          )}
        </div>
        <div className="bg-canvas px-5 py-4 sm:px-6">
          <h2 className="text-[13px] font-semibold">{t("Next steps")}</h2>
          {d.nextActions.length === 0 ? (
            <p className="mt-1.5 text-[13.5px] text-ink-3">{t("Nothing to do right now.")}</p>
          ) : (
            <ol className="mt-2 space-y-2.5">
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
      </div>

      {/* Every supplier with a price, one line each */}
      <div className="px-5 pt-4 pb-2 sm:px-6">
        <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
          {t("Prices and suppliers")} <Hint text={EXPLAIN.quotesOnFile} />
        </h2>
      </div>
      {columns.length === 0 ? (
        <p className="px-5 pb-5 text-[13.5px] text-ink-3 sm:px-6">{t("No prices on record yet. Add a purchase or a quote to start.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="h-8 border-y border-rule bg-well pr-3 pl-5 font-medium sm:pl-6">{t("Supplier")}</th>
                <th className="h-8 border-y border-rule bg-well px-3 text-right font-medium">{t("Price")}</th>
                <th className="h-8 border-y border-rule bg-well px-3 text-right font-medium">{t("vs you")}</th>
                <th className="hidden h-8 border-y border-rule bg-well px-3 text-right font-medium @4xl:table-cell">
                  {t("Est. total cost")} <Hint text={EXPLAIN.trueCost} />
                </th>
                <th className="hidden h-8 border-y border-rule bg-well px-3 text-right font-medium @2xl:table-cell">{t("Minimum order")}</th>
                <th className="hidden h-8 border-y border-rule bg-well px-3 text-right font-medium @2xl:table-cell">{t("Lead time")}</th>
                <th className="hidden h-8 border-y border-rule bg-well px-3 font-medium @3xl:table-cell">{t("Payment")}</th>
                <th className="h-8 border-y border-rule bg-well pr-5 pl-3 font-medium sm:pr-6">{t("Notes")}</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => {
                const warn = c.flags.find((x) => x.tone === "warn" && x.key !== "quality");
                return (
                  <tr key={c.supplierId} className={cx("[&>td]:border-b [&>td]:border-rule", c.isCurrent && "bg-well")}>
                    <td className="h-11 pr-3 pl-5 whitespace-nowrap sm:pl-6">
                      {flagOf(c.country) && (
                        <span aria-hidden className="mr-1.5">
                          {flagOf(c.country)}
                        </span>
                      )}
                      <Link href={`/suppliers/${c.supplierId}`} className="font-medium hover:underline">
                        {c.supplierName}
                      </Link>
                      {c.country && <span className="ml-1.5 text-[12px] text-ink-3">{countryName(c.country, t.locale)}</span>}
                    </td>
                    <td className="num px-3 text-right font-semibold whitespace-nowrap">
                      {c.priceEUR != null ? f.priceShort(c.priceEUR) : f.price(c.quotedPrice, c.currency)}
                      <span className="ml-1.5 align-middle font-normal">
                        <Basis>{t(KIND_LABEL[c.kind])}</Basis>
                      </span>
                    </td>
                    <td className="num px-3 text-right whitespace-nowrap">{c.isCurrent ? <span className="text-ink-4">—</span> : <Delta value={c.differencePct} className="justify-end" />}</td>
                    <td className="hidden px-3 text-right whitespace-nowrap text-ink-4 @4xl:table-cell">{t("Not estimated yet")}</td>
                    <td className="num hidden px-3 text-right whitespace-nowrap text-ink-2 @2xl:table-cell">{c.moq != null ? f.quantity(c.moq, unit) : "—"}</td>
                    <td className="num hidden px-3 text-right whitespace-nowrap text-ink-2 @2xl:table-cell">{c.leadTimeDays != null ? f.days(c.leadTimeDays, t) : "—"}</td>
                    <td className="num hidden px-3 whitespace-nowrap text-ink-2 @3xl:table-cell">{c.paymentTermsDays != null ? f.paymentTerms(c.paymentTermsDays, t) : "—"}</td>
                    <td className="py-1.5 pr-5 pl-3 sm:pr-6">
                      <span className="flex flex-wrap gap-1">
                        {c.isCurrent && <span className={cx(chip, "bg-ink text-white")}>{t("Current supplier")}</span>}
                        {c.highlights.map((h) => (
                          <span key={h} className={cx(chip, "bg-ledger-wash text-ledger")}>
                            {h}
                          </span>
                        ))}
                        {c.notComparableReason ? (
                          <span className={cx(chip, "bg-caution-wash text-caution")} title={c.notComparableReason}>
                            {t("Can't be compared yet")}
                          </span>
                        ) : (
                          warn && (
                            <span className={cx(chip, "bg-caution-wash text-caution")} title={c.flags.filter((x) => x.tone === "warn").map((x) => x.label).join(" · ")}>
                              {t("Check: {what}", { what: lowerFirst(warn.label) })}
                            </span>
                          )
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="h-10 pr-3 pl-5 text-ink-3 sm:pl-6">{t("Market average")}</td>
                <td colSpan={7} className="px-3 text-ink-4">
                  {t("Not available — external market data is not connected yet")}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-rule px-5 py-3 text-[12.5px] text-ink-3 sm:px-6">
        <span className="inline-flex items-center gap-1.5">
          {t("Supply risk")} <Hint text={EXPLAIN.supplyRisk} />
          <span className={cx(chip, d.supplyRisk.level === "high" ? "bg-caution-wash text-caution" : "bg-wash text-ink-2")} title={d.supplyRisk.detail}>
            {d.supplyRisk.label}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          {t("Data confidence")} <QualityBadge level={d.dataConfidence} />
        </span>
        {d.lastUpdated.purchases && <span>{t("Last purchase {date}", { date: f.date(d.lastUpdated.purchases) })}</span>}
        {d.lastUpdated.quotes && <span>{t("Last quote {date}", { date: f.date(d.lastUpdated.quotes) })}</span>}
      </footer>
    </section>
  );
}

function Stat({ label, basis, hint, children }: { label: string; basis?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="num text-[22px] leading-none font-semibold tracking-[-0.02em] whitespace-nowrap">{children}</div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-3">
        {label} {basis && <Basis>{basis}</Basis>} {hint && <Hint text={hint} />}
      </div>
    </div>
  );
}
