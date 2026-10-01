import Link from "next/link";
import type { Metadata } from "next";
import { Handshake } from "lucide-react";
import { Hint } from "@/components/hint";
import { ConfidenceBadge, OpportunityStatusBadge } from "@/components/intel/badges";
import { OpportunityStatusSelect } from "@/components/intel/controls";
import { Empty, ExportLink, PageHeader, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDataset, getIntel, getOpportunityStates } from "@/lib/data";
import * as f from "@/lib/format";
import type { TrackedOpportunity } from "@/lib/intel/engine";
import { EXPLAIN } from "@/lib/intel/explain";
import { OPPORTUNITY_LABEL, type OpportunityType } from "@/lib/intel/opportunities";
import { lookups } from "@/lib/lookups";

export const metadata: Metadata = { title: "Opportunities" };

const VIEWS = [
  { key: "active", label: "Active", statuses: ["open", "reviewing", "negotiating"] },
  { key: "validated", label: "Validated", statuses: ["validated"] },
  { key: "dismissed", label: "Rejected / closed", statuses: ["rejected", "closed"] },
  { key: "all", label: "All", statuses: null },
] as const;

const BASIS_LABEL = { alternative_quote: "potential saving", historical_average: "gap to average", price_increase: "increase impact" } as const;

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
  const [data, intel, states] = await Promise.all([getDataset(), getIntel(), getOpportunityStates()]);
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

  return (
    <>
      <PageHeader
        title="Opportunities"
        meta="Situations worth a closer look, found in your own purchases and quotes. Figures are price-only estimates, before freight, duties, quality, inventory and commercial conditions."
        actions={
          <ExportLink href="/export/opportunities" />
        }
      />

      <div className="mb-6 flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
            Potential price opportunities <Hint text={EXPLAIN.potentialTotal} />
          </div>
          <div className="num mt-1 text-[34px] leading-none font-semibold tracking-[-0.03em]">
            {f.money(intel.totals.potentialSavings)}
            <span className="text-[16px] font-medium text-ink-3">/year</span>
          </div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">
            {intel.totals.potentialSavingsProducts} product{intel.totals.potentialSavingsProducts === 1 ? "" : "s"} with a comparable lower price · estimate, not a realised saving
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Status" className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={href({ view: v.key === "active" ? null : v.key })}
              aria-current={v.key === view.key ? "page" : undefined}
              className={cx("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors", v.key === view.key ? "bg-ink text-white" : "text-ink-2 hover:bg-wash")}
            >
              {v.label}
              <span className={cx("num text-[12px]", v.key === view.key ? "text-white/60" : "text-ink-4")}>{count(v)}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label="Type" className="flex flex-wrap gap-1 text-[12.5px]">
          <Link href={href({ type: null })} className={cx("rounded-md px-2 py-1", !type ? "bg-wash font-medium text-ink" : "text-ink-3 hover:bg-wash")}>
            All types
          </Link>
          {types.map((t) => (
            <Link key={t} href={href({ type: t })} className={cx("rounded-md px-2 py-1", type === t ? "bg-wash font-medium text-ink" : "text-ink-3 hover:bg-wash")}>
              {OPPORTUNITY_LABEL[t]}
            </Link>
          ))}
        </nav>
      </div>

      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty
            title={intel.opportunities.length === 0 ? "No opportunities found yet" : "Nothing in this view"}
            body={
              intel.opportunities.length === 0
                ? "Opportunities appear when a comparable quote is below what you pay, a price rises sharply, or a high-spend product depends on one supplier. Add quotes from alternative suppliers to get started."
                : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">Product</Th>
                <Th className="border-t-0">Current supplier</Th>
                <Th className="border-t-0" align="right">Current price</Th>
                <Th className="border-t-0">Alternative</Th>
                <Th className="border-t-0" align="right">Alternative price</Th>
                <Th className="border-t-0" align="right">
                  Potential saving <Hint text={EXPLAIN.opportunityImpact} />
                </Th>
                <Th className="border-t-0">
                  Confidence <Hint text={EXPLAIN.confidence} />
                </Th>
                <Th className="border-t-0">Reason</Th>
                <Th className="border-t-0">Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const product = l.product(o.productId);
                return (
                  <tr key={o.key} className={rowClass(true)}>
                    <Td className="font-medium">
                      <Link href={`/opportunities/${o.key}`} className="stretched">
                        {product?.name}
                      </Link>
                      <div className="text-[12px] font-normal text-ink-3">{OPPORTUNITY_LABEL[o.type]}</div>
                    </Td>
                    <Td>{l.supplierName(o.currentSupplierId)}</Td>
                    <Td align="right">{o.currentPrice != null ? `${f.price(o.currentPrice)}/${product?.unit}` : "—"}</Td>
                    <Td>
                      {o.type === "lower_quote" ? (
                        l.supplierName(o.alternativeSupplierId)
                      ) : o.type === "above_average" ? (
                        <span className="text-ink-3">Your historical average</span>
                      ) : o.type === "price_increase" ? (
                        <span className="text-ink-3">Price 12 months ago</span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </Td>
                    <Td align="right">{o.comparePrice != null ? f.price(o.comparePrice) : <span className="text-ink-4">—</span>}</Td>
                    <Td align="right">
                      {o.potentialSaving != null ? (
                        <span className="font-semibold">{f.money(o.potentialSaving)}/yr</span>
                      ) : o.impact != null ? (
                        <span className="text-ink-3">
                          {f.money(o.impact)}/yr
                          <span className="block text-[11.5px]">{BASIS_LABEL[o.impactBasis!]}, not a saving</span>
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </Td>
                    <Td>
                      <ConfidenceBadge level={o.confidence} />
                    </Td>
                    <Td className="max-w-[300px] whitespace-normal! text-ink-2">
                      {o.negotiation && <Handshake size={13} className="mr-1.5 inline text-ledger" aria-label="Negotiation opportunity" />}
                      {o.reason}
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
          <h2 className="mb-2 text-[14px] font-semibold">Past decisions</h2>
          <p className="mb-3 text-[12.5px] text-ink-3">Opportunities you acted on that the data no longer shows (the quote changed, the price moved, or the record was removed). Figures are as they were when you set the status.</p>
          <ul className="rounded-lg border border-rule">
            {past.map((s) => {
              const snap = (s.snapshot ?? {}) as Snapshot;
              return (
                <li key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-5 py-3 text-[13px] last:border-b-0">
                  <div className="min-w-[220px] flex-1">
                    <span className="font-medium">{snap.productName ?? "Product"}</span>
                    {snap.alternativeName && <span className="text-ink-2"> · {snap.alternativeName}</span>}
                    <div className="text-[12.5px] text-ink-3">{snap.reason}</div>
                  </div>
                  {snap.potentialSaving != null && <span className="num text-ink-2">{f.money(snap.potentialSaving)}/yr</span>}
                  <span className="num text-[12px] text-ink-3">{f.date(s.updatedAt.slice(0, 10))}</span>
                  <OpportunityStatusBadge status={s.status} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
