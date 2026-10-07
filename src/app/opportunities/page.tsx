import Link from "next/link";
import type { Metadata } from "next";
import { Handshake } from "lucide-react";
import { Hint } from "@/components/hint";
import { ConfidenceBadge, OpportunityStatusBadge } from "@/components/intel/badges";
import { OpportunityStatusSelect } from "@/components/intel/controls";
import { QuoteDialog } from "@/components/dialogs";
import { NegotiationOpportunities } from "@/components/negotiation/opportunities";
import { ButtonLink, Empty, ExportLink, PageHeader, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDataset, getIntel, getOpportunityStates, getT } from "@/lib/data";
import * as f from "@/lib/format";
import type { Msg } from "@/lib/i18n";
import type { TrackedOpportunity } from "@/lib/intel/engine";
import { explain } from "@/lib/intel/explain";
import { OPPORTUNITY_LABEL, type ImpactBasis, type OpportunityType } from "@/lib/intel/opportunities";
import { lookups } from "@/lib/lookups";
import { getAllNegotiations } from "@/server/negotiation";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Opportunities") };
}

const VIEWS = [
  { key: "active", label: "Active|plural", statuses: ["open", "reviewing", "negotiating"] },
  { key: "validated", label: "Validated|plural", statuses: ["validated"] },
  { key: "dismissed", label: "Rejected / closed", statuses: ["rejected", "closed"] },
  { key: "all", label: "All|feminine", statuses: null },
] as const satisfies readonly { key: string; label: Msg; statuses: readonly string[] | null }[];

const BASIS_LABEL: Record<ImpactBasis, Msg> = { alternative_quote: "potential saving", historical_average: "gap to average", price_increase: "increase impact" };

interface Snapshot {
  type?: string;
  productName?: string | null;
  alternativeName?: string | null;
  currentPrice?: number | null;
  comparePrice?: number | null;
  potentialSaving?: number | null;
  impact?: number | null;
  reason?: string;
  at?: string;
}

export default async function OpportunitiesPage({ searchParams }: PageProps<"/opportunities">) {
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === sp.view) ?? VIEWS[0];
  const type = typeof sp.type === "string" && sp.type in OPPORTUNITY_LABEL ? (sp.type as OpportunityType) : null;
  const [data, intel, states, negotiations, t] = await Promise.all([getDataset(), getIntel(), getOpportunityStates(), getAllNegotiations(), getT()]);
  const EXPLAIN = explain(t);
  const l = lookups(data);

  const inView = (o: TrackedOpportunity) => (!view.statuses || (view.statuses as readonly string[]).includes(o.status)) && (!type || o.type === type);
  const rows = intel.opportunities
    .filter(inView)
    .sort((a, b) => (b.potentialSaving ?? -1) - (a.potentialSaving ?? -1) || (b.impact ?? -1) - (a.impact ?? -1));
  const count = (v: (typeof VIEWS)[number]) => intel.opportunities.filter((o) => !v.statuses || (v.statuses as readonly string[]).includes(o.status)).length;
  const types = [...new Set(intel.opportunities.map((o) => o.type))];

  // Decisions taken on opportunities the engine no longer detects (quote expired, price changed…).
  const live = new Set(intel.opportunities.map((o) => o.key));
  const past = states.filter((s) => !live.has(s.key) && s.status !== "open");
  const href = (params: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { view: view.key === "active" ? null : view.key, type, ...params };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/opportunities?${s}` : "/opportunities";
  };

  const header = (
    <PageHeader
      title={t("Opportunities")}
      meta={
        <span className="inline-flex items-center gap-1.5">
          {t("Situations worth a closer look, found in your own purchases and quotes. Estimates compare prices only")} <Hint text={EXPLAIN.trueCost} label={t("What is not included")} />
        </span>
      }
      actions={intel.opportunities.length > 0 ? <ExportLink href="/export/opportunities" /> : undefined}
    />
  );

  // Nothing found: say what makes opportunities appear, instead of a row of zeros.
  if (intel.opportunities.length === 0 && past.length === 0) {
    return (
      <>
        {header}
        <NegotiationOpportunities items={negotiations} t={t} className="mb-5" />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title={t("No opportunities yet")}
            body={
              data.products.length === 0
                ? t("Import your invoices first. Opportunities appear when another supplier offers less than you pay, when a price rises sharply, or when a product that matters depends on one supplier.")
                : t("They appear when another supplier offers less than you pay, when a price rises sharply, or when a product that matters depends on one supplier. Adding quotes from other suppliers is what makes them show up.")
            }
            action={
              data.products.length === 0 ? (
                <ButtonLink href="/import" variant="primary">
                  {t("Import invoices")}
                </ButtonLink>
              ) : (
                <QuoteDialog trigger={{ label: t("Add a quote"), variant: "primary" }} />
              )
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      {header}

      {intel.totals.potentialSavings > 0 && (
        <div className="mb-6">
          <div className="num text-[34px] leading-none font-semibold tracking-[-0.03em]">
            {f.moneyApprox(intel.totals.potentialSavings)}
            <span className="text-[16px] font-medium text-ink-3">{t("/year")}</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
            {t("Potential savings")} <Hint text={EXPLAIN.potentialTotal} />
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">
            {t.n(
              intel.totals.potentialSavingsProducts,
              "on {n} product where another supplier offers less · an estimate, not money saved yet",
              "on {n} products where another supplier offers less · an estimate, not money saved yet",
            )}
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("Status")} className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={href({ view: v.key === "active" ? null : v.key })}
              aria-current={v.key === view.key ? "page" : undefined}
              className={cx("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors", v.key === view.key ? "bg-ink text-white" : "text-ink-2 hover:bg-wash")}
            >
              {t(v.label)}
              <span className={cx("num text-[12px]", v.key === view.key ? "text-white/60" : "text-ink-4")}>{count(v)}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label={t("Type")} className="flex flex-wrap gap-1 text-[12.5px]">
          <Link href={href({ type: null })} className={cx("rounded-md px-2 py-1", !type ? "bg-wash font-medium text-ink" : "text-ink-3 hover:bg-wash")}>
            {t("All types")}
          </Link>
          {types.map((kind) => (
            <Link key={kind} href={href({ type: kind })} className={cx("rounded-md px-2 py-1", type === kind ? "bg-wash font-medium text-ink" : "text-ink-3 hover:bg-wash")}>
              {t(OPPORTUNITY_LABEL[kind])}
            </Link>
          ))}
        </nav>
      </div>

      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty title={t("Nothing in this view")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Product")}</Th>
                <Th className="hidden border-t-0 @3xl:table-cell">{t("What we found")}</Th>
                <Th className="border-t-0" align="right">
                  {t("Worth")} <Hint text={EXPLAIN.opportunityImpact} />
                </Th>
                <Th className="hidden border-t-0 @2xl:table-cell">
                  {t("Confidence")} <Hint text={EXPLAIN.confidence} />
                </Th>
                <Th className="border-t-0">{t("Status")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const product = l.product(o.productId);
                return (
                  <tr key={o.key} className={rowClass(true)}>
                    <Td className="max-w-[260px] py-2.5 whitespace-normal!">
                      <Link href={`/opportunities/${o.key}`} className="stretched font-medium">
                        {product?.name}
                      </Link>
                      <div className="text-[12px] text-ink-3">
                        {t(OPPORTUNITY_LABEL[o.type])}
                        {o.alternativeSupplierId && ` · ${l.supplierName(o.alternativeSupplierId)}`}
                      </div>
                    </Td>
                    <Td className="hidden max-w-[360px] whitespace-normal! text-ink-2 @3xl:table-cell">
                      {o.negotiation && <Handshake size={13} className="mr-1.5 inline text-ledger" aria-label={t("Worth raising with your supplier")} />}
                      {o.reason}
                      {o.currentPrice != null && o.comparePrice != null && (
                        <span className="num block text-[12px] text-ink-3">
                          {product
                            ? t("{current} today vs {compared} per {unit}", { current: f.priceShort(o.currentPrice), compared: f.priceShort(o.comparePrice), unit: product.unit })
                            : t("{current} today vs {compared}", { current: f.priceShort(o.currentPrice), compared: f.priceShort(o.comparePrice) })}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      {o.potentialSaving != null ? (
                        <span className="font-semibold">{t("{amount}/yr", { amount: f.moneyApprox(o.potentialSaving) })}</span>
                      ) : o.impact != null ? (
                        <span className="text-ink-3">
                          {t("{amount}/yr", { amount: f.moneyApprox(o.impact) })}
                          <span className="block text-[11.5px]">{t("{~basis}, not a saving", { basis: BASIS_LABEL[o.impactBasis!] })}</span>
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </Td>
                    <Td className="hidden @2xl:table-cell">
                      <ConfidenceBadge level={o.confidence} />
                    </Td>
                    <Td>
                      <OpportunityStatusSelect opportunityKey={o.key} status={o.status} size="sm" />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-[14px] font-semibold">{t("Past decisions")}</h2>
          <p className="mb-3 text-[12.5px] text-ink-3">{t("Opportunities you acted on that the data no longer shows (the quote changed, the price moved, or the record was removed). Figures are as they were when you set the status.")}</p>
          <ul className="rounded-lg border border-rule">
            {past.map((s) => {
              const snap = (s.snapshot ?? {}) as Snapshot;
              return (
                <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-5 py-3 text-[13px] last:border-b-0">
                  <div className="min-w-[220px] flex-1">
                    <span className="font-medium">{snap.productName ?? t("Product")}</span>
                    {snap.alternativeName && <span className="text-ink-2"> · {snap.alternativeName}</span>}
                    <div className="text-[12.5px] text-ink-3">{snap.reason}</div>
                  </div>
                  {snap.potentialSaving != null && <span className="num text-ink-2">{t("{amount}/yr", { amount: f.money(snap.potentialSaving) })}</span>}
                  <span className="num text-[12px] text-ink-3">{f.date(s.updatedAt.slice(0, 10))}</span>
                  <OpportunityStatusBadge status={s.status} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <NegotiationOpportunities items={negotiations} t={t} className="mt-8" />
    </>
  );
}
