import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Check, CircleDashed, Handshake } from "lucide-react";
import { Hint } from "@/components/hint";
import { AgeTag, ComparabilityBadge, ConfidenceBadge, OpportunityStatusBadge } from "@/components/intel/badges";
import { OpportunityNote, OpportunityStatusSelect } from "@/components/intel/controls";
import { PriceOnlyNotice } from "@/components/intel/supplier-comparison";
import { ButtonLink, PageHeader, Section, cx } from "@/components/ui";
import { countryName } from "@/lib/countries";
import { getIntel, getOpportunityStates, getT } from "@/lib/data";
import * as f from "@/lib/format";
import { rich } from "@/lib/i18n/rich";
import { explain } from "@/lib/intel/explain";
import { OPPORTUNITY_LABEL } from "@/lib/intel/opportunities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Opportunity") };
}

export default async function OpportunityPage({ params }: PageProps<"/opportunities/[key]">) {
  const key = decodeURIComponent((await params).key);
  const [intel, states, t] = await Promise.all([getIntel(), getOpportunityStates(), getT()]);
  const EXPLAIN = explain(t);
  const o = intel.opportunities.find((x) => x.key === key);
  const state = states.find((s) => s.key === key);

  // Decided in the past, no longer detected: show the snapshot.
  if (!o) {
    if (!state) notFound();
    const snap = (state.snapshot ?? {}) as Record<string, string | number | null>;
    return (
      <>
        <PageHeader
          eyebrow={
            <Link href="/opportunities" className="hover:text-ink">
              {t("Opportunities")}
            </Link>
          }
          title={String(snap.productName ?? t("Opportunity"))}
          meta={
            <span className="flex flex-wrap items-center gap-3">
              <OpportunityStatusBadge status={state.status} /> {t("No longer detected in the current data")}
            </span>
          }
        />
        <Section title={t("As it was when you set the status")} description={state.updatedAt.slice(0, 10).split("-").reverse().join("/")}>
          <dl className="max-w-md divide-y divide-rule text-[13px]">
            <Row label={t("Reason")}>{String(snap.reason ?? "—")}</Row>
            <Row label={t("Alternative")}>{String(snap.alternativeName ?? "—")}</Row>
            <Row label={t("Current price")}>{f.price(snap.currentPrice as number | null)}</Row>
            <Row label={t("Compared with")}>{f.price(snap.comparePrice as number | null)}</Row>
            <Row label={t("Potential saving")}>{snap.potentialSaving != null ? t("{amount}/yr", { amount: f.money(snap.potentialSaving as number) }) : "—"}</Row>
          </dl>
          {state.note && <p className="mt-4 text-[13px] text-ink-2">{state.note}</p>}
        </Section>
      </>
    );
  }

  const pi = intel.products.find((p) => p.product.id === o.productId)!;
  const { product } = pi;
  const current = pi.comparison.find((r) => r.isCurrent) ?? null;
  const alt = o.alternativeSupplierId ? (pi.comparison.find((r) => r.supplier.id === o.alternativeSupplierId) ?? null) : null;
  const unit = product.unit;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/opportunities" className="hover:text-ink">
            {t("Opportunities")}
          </Link>
        }
        title={product.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-ink-2">{t(OPPORTUNITY_LABEL[o.type])}</span>
            <span>{o.reason}</span>
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/products/${product.id}`}>{t("Open product")}</ButtonLink>
            <OpportunityStatusSelect opportunityKey={o.key} status={o.status} />
          </>
        }
      />

      {o.negotiation && alt && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-rule-strong px-4 py-3 text-[13.5px]">
          <Handshake size={17} className="shrink-0 text-ledger" />
          <div>
            <span className="font-semibold">{t("Negotiation opportunity.")}</span>{" "}
            {rich(
              t("Current supplier increased price {increase}. {supplier} quoted {less} less. Potential price gap: {gap}.", {
                increase: f.pct(pi.price.changes.m12.pct),
                supplier: alt.supplier.name,
                less: f.pct(-o.priceDifferencePct!).replace("−", ""),
              }),
              {
                gap: (
                  <span className="num font-medium">
                    {f.price(o.priceDifference)}/{unit}
                  </span>
                ),
              },
            )}{" "}
            <span className="text-ink-3">{t("Whether to renegotiate, change supplier or stay is your decision.")}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title={t("Current situation")}>
          <dl className="divide-y divide-rule text-[13px]">
            <Row label={t("Current supplier")}>
              {current ? (
                <Link href={`/suppliers/${current.supplier.id}`} className="font-medium hover:text-ledger">
                  {current.supplier.name}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label={t("Current price")} hint={EXPLAIN.currentPrice}>
              <span className="num font-medium">{o.currentPrice != null ? `${f.price(o.currentPrice)}/${unit}` : "—"}</span>
            </Row>
            <Row label={t("Change in 12 months")}>{f.pct(pi.price.changes.m12.pct)}</Row>
            <Row label={t("Annual volume")} hint={EXPLAIN.annualQuantity}>
              <span className="num">{o.annualQuantity > 0 ? f.quantity(o.annualQuantity, unit) : t("No purchases in 12 months")}</span>
            </Row>
            <Row label={t("Annual spend")} hint={EXPLAIN.annualSpend}>
              <span className="num">{f.money(o.annualSpend)}</span>
            </Row>
            <Row label={t("Share of total spend")}>
              <span className="num">{f.number(pi.spendShare * 100, 1)}%</span>
            </Row>
          </dl>
        </Section>

        <Section title={o.type === "lower_quote" ? t("Alternative") : t("Compared with")}>
          {alt ? (
            <dl className="divide-y divide-rule text-[13px]">
              <Row label={t("Supplier")}>
                <Link href={`/suppliers/${alt.supplier.id}`} className="font-medium hover:text-ledger">
                  {alt.supplier.name}
                </Link>
                {alt.supplier.country && <span className="text-ink-3"> · {countryName(alt.supplier.country, t.locale)}</span>}
              </Row>
              <Row label={alt.kind === "quote" ? t("Quoted price") : t("Last price paid")}>
                <span className="num font-medium">
                  {f.price(alt.priceEUR)}/{unit}
                </span>
                {alt.currency !== "EUR" && <span className="num text-ink-3"> ({f.price(alt.price, alt.currency ?? "EUR")})</span>}
              </Row>
              <Row label={t("Minimum order")}>
                <span className="num">{alt.moq != null ? f.quantity(alt.moq, unit) : t("Unknown")}</span>
              </Row>
              <Row label={t("Lead time")}>{alt.leadTimeDays != null ? f.days(alt.leadTimeDays, t) : t("Unknown")}</Row>
              <Row label={t("Payment terms")}>{alt.paymentTermsDays != null ? f.paymentTerms(alt.paymentTermsDays, t) : t("Unknown")}</Row>
              <Row label={alt.kind === "quote" ? t("Quote date") : t("Purchase date")} hint={EXPLAIN.quoteAge}>
                <span className="num">{f.date(alt.date)}</span> · <AgeTag age={alt.age} days={alt.ageDays} expired={alt.expired} />
              </Row>
              <Row label={t("Comparability")} hint={EXPLAIN.comparability}>
                <ComparabilityBadge level={alt.comparability} />
              </Row>
            </dl>
          ) : o.comparePrice != null ? (
            <dl className="divide-y divide-rule text-[13px]">
              <Row label={o.type === "above_average" ? t("Your historical weighted average") : t("Price 12 months ago")} hint={o.type === "above_average" ? EXPLAIN.weightedAverage : EXPLAIN.change}>
                <span className="num font-medium">
                  {f.price(o.comparePrice)}/{unit}
                </span>
              </Row>
              <Row label={t("Gap")}>
                <span className="num">
                  {f.price(o.priceDifference)}/{unit} ({f.pct(o.priceDifferencePct)})
                </span>
              </Row>
            </dl>
          ) : (
            <p className="text-[13px] text-ink-3">{t("No price to compare with: this is a signal about how the product is sourced, not about a price.")}</p>
          )}
          {alt && alt.comparabilityReasons.length > 0 && (
            <ul className="mt-3 space-y-1 text-[12.5px] text-ink-3">
              {alt.comparabilityReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        className="mt-6"
        title={t("Calculation")}
        description={
          o.impactBasis === "alternative_quote"
            ? t("(current price − alternative price) × annual volume")
            : o.impactBasis
              ? t("annual volume × price difference — a price signal, not a potential saving")
              : t("No monetary figure for this opportunity")
        }
      >
        {o.impact != null && o.priceDifference != null ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-4 text-[13px]">
            <Term label={t("Price difference")} value={`${f.price(o.priceDifference)}/${unit}`} />
            <span className="text-ink-4">×</span>
            <Term label={t("Annual quantity")} value={f.quantity(o.annualQuantity, unit)} />
            <span className="text-ink-4">=</span>
            <Term label={o.potentialSaving != null ? t("Potential saving") : t("Annual price impact")} value={t("{amount}/year", { amount: f.money(o.impact) })} strong />
            {o.confidence && (
              <span className="ml-2 inline-flex items-center gap-1.5">
                <ConfidenceBadge level={o.confidence} long /> <Hint text={EXPLAIN.confidence} />
              </span>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">{o.annualQuantity > 0 ? t("Nothing to calculate: there is no alternative price to compare with.") : t("No annual volume in the last 12 months to multiply by.")}</p>
        )}
        <p className="mt-4 text-[12.5px] text-ink-3">
          {o.potentialSaving != null ? EXPLAIN.potentialSaving : EXPLAIN.annualImpact}
        </p>
      </Section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {o.factors.length > 0 && (
          <Section title={t("Why this confidence")} description={t("Rules, not a model: each line is a check on the data")}>
            <ul className="space-y-2 text-[13px]">
              {o.factors.map((x) => (
                <li key={x.key} className="flex items-start gap-2.5">
                  <span className="mt-0.5">
                    {x.state === "ok" ? <Check size={14} className="text-ink-3" /> : x.state === "caution" ? <AlertTriangle size={14} className="text-caution" /> : <CircleDashed size={14} className="text-up" />}
                  </span>
                  <span>
                    <span className="font-medium">{x.label}.</span> <span className={cx(x.state === "ok" ? "text-ink-2" : "text-ink")}>{x.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title={t("Missing information")} description={t("What is not known yet, before deciding")}>
          {o.missing.length ? (
            <ul className="space-y-1.5 text-[13px]">
              {o.missing.map((x) => (
                <li key={x} className="flex items-start gap-2.5">
                  <CircleDashed size={14} className="mt-0.5 shrink-0 text-ink-4" />
                  {x}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">{t("Nothing specific flagged.")}</p>
          )}
        </Section>
      </div>

      {o.type === "lower_quote" && <PriceOnlyNotice className="mt-6" />}

      <Section className="mt-6" title={t("Notes")} description={t("Kept with the status of this opportunity")}>
        <OpportunityNote opportunityKey={o.key} status={o.status} note={o.note ?? ""} />
      </Section>
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="flex items-center gap-1.5 text-ink-3">
        {label} {hint && <Hint text={hint} />}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function Term({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx("rounded-md border px-3 py-2", strong ? "border-ink/20 bg-well" : "border-rule")}>
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={cx("num", strong ? "text-[17px] font-semibold" : "text-[15px] font-medium")}>{value}</div>
    </div>
  );
}
