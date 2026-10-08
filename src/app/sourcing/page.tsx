import Link from "next/link";
import type { Metadata } from "next";
import { ResearchImport, ResearchPriority } from "@/components/sourcing/research";
import { SupplierRfqBoard, type SupplierVM } from "@/components/sourcing/rfq";
import { PilotToggle, ReadinessPill } from "@/components/sourcing/spec";
import { PriceTypeTag, ResearchStatusPill } from "@/components/sourcing/tags";
import { ButtonLink, Disclosure, Empty, PageHeader, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDb } from "@/db";
import { todayISO } from "@/lib/analytics";
import { countryName, flagOf } from "@/lib/countries";
import { getIntel, getSettings, getT } from "@/lib/data";
import { perUnit } from "@/lib/sourcing/market";
import { OPPORTUNITY_LEVEL } from "@/lib/sourcing/true-cost";
import { companyKey } from "@/lib/import/normalize/text";
import { contactHistory } from "@/lib/sourcing/screening";
import * as f from "@/lib/format";
import { CONFIDENCE_WORD } from "@/lib/intel/summary";
import { limitsFrom } from "@/lib/research/budget";
import { RESEARCH_STATUSES, byActionability, researchStatus, type ResearchStatus } from "@/lib/research/status";
import { rangeText } from "@/lib/sourcing/market";
import { PROVIDER_KINDS } from "@/lib/sourcing/providers";
import { COMPANY_TYPE_LABEL, POSITION_LABEL, PRICE_TYPE_LABEL } from "@/lib/sourcing/types";
import { sourceStates, type SourceState } from "@/server/providers";
import { getResearch, readUsage } from "@/server/research";
import { getMarketViews, readProductCosts, readRfqLines } from "@/server/sourcing";
import type { Msg } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Market and alternative suppliers") };
}

const STATE_LABEL: Record<SourceState, Msg> = { connected: "Connected", needs_key: "Needs an API key", not_available: "Not available yet", off: "Switched off" };

/**
 * Priority sourcing review: the few products that make up most of the spend,
 * each with what is paid, what the evidence on file says, who else could
 * supply it, where the quotes stand and the next step — what weighs most and
 * can be acted on first.
 */
export default async function SourcingPage() {
  const [{ review, opportunities, requests, views, pilot }, research, settings, intel, t] = await Promise.all([getMarketViews(), getResearch(), getSettings(), getIntel(), getT()]);
  if (review.products.length === 0) {
    return (
      <>
        <PageHeader title={t("Market and alternative suppliers")} />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty title={t("No purchases to start from yet")} body={t("Import your invoices first: the products that make up most of your spend will appear here.")} action={<ButtonLink href="/import" variant="primary">{t("Import invoices")}</ButtonLink>} />
        </div>
      </>
    );
  }
  const limits = limitsFrom(process.env);
  const now = new Date();
  const rows = review.products
    .map((view) => {
      const run = research.runs.find((r) => r.productId === view.productId) ?? null;
      return { view, run, status: researchStatus(view, run, now, limits.staleRunMinutes) };
    })
    .sort(byActionability);
  const byStatus = new Map<ResearchStatus, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  // The first round: the few products that weigh most, and the suppliers recommended for them — one request each.
  const db = await getDb();
  // The live pilot: the products the user chose — or, until they choose, the few that weigh most.
  const pilotViews = [...views.values()].filter((v) => v.materiality === "focus").sort((a, b) => b.history.annualSpend - a.history.annualSpend);
  const lineOf = await readRfqLines(db, [...new Set([...review.products, ...pilotViews].map((v) => v.productId))], t);
  const costs = await readProductCosts(db, intel, views, t);
  const asked = ["contacted", "quote_requested", "quote_received"];
  const firstRound = review.products.filter((v) => v.materiality === "focus");
  const suppliers: SupplierVM[] = opportunities
    .filter((o) => o.recommended)
    .map((o) => {
      const answered = o.lines.some((l) => l.status === "quote_received");
      const h = contactHistory(requests, companyKey(o.name), answered, todayISO());
      return {
        key: o.key,
        name: o.name,
        about: [o.country ? `${flagOf(o.country) ?? ""} ${countryName(o.country, t.locale)}`.trim() : null, t(COMPANY_TYPE_LABEL[o.companyType ?? "unknown"])].filter(Boolean).join(" · "),
        email: o.email,
        website: o.website,
        recommended: o.recommended,
        combinedSpend: f.moneyApprox(o.combinedSpend),
        missing: o.missing,
        lines: o.lines.filter((l) => lineOf.has(l.productId)).map((l) => ({ candidateId: l.candidateId, productId: l.productId, productName: l.productName, spend: f.moneyApprox(l.annualSpend), shortlisted: l.shortlisted, firstRound: l.materiality === "focus", asked: asked.includes(l.status), ready: lineOf.get(l.productId)!.spec.readiness !== "not_ready", line: lineOf.get(l.productId)! })),
        history: { times: h.times, last: h.last ? f.date(h.last) : null, lastISO: h.last, days: h.daysSinceLast, recent: h.recent, followUpDue: h.followUpDue, products: h.productIds.length },
        answered,
      };
    });
  const pairs = suppliers.reduce((n, sup) => n + sup.lines.filter((l) => l.shortlisted && l.firstRound).length, 0);
  const found = review.products.reduce((n, v) => n + v.screening.counts.found, 0);
  const sources = sourceStates();
  const on = sources.filter((s) => s.state === "connected");
  const usage = await readUsage(db, now);
  const gap = review.opportunity;
  const researched = rows.filter((r) => r.run).length;

  return (
    <>
      <PageHeader
        title={t("Market and alternative suppliers")}
        meta={t("Are you buying well? For the products that weigh the most: what you pay, what the evidence says, who else could supply them, and what to do next.")}
        actions={
          <>
            <ButtonLink href="/strategy" variant="primary">
              {t("Optimize sourcing mix")}
            </ButtonLink>
            <ButtonLink href="/products/data">{t("Product data")}</ButtonLink>
          </>
        }
      />

      <div className="mb-4 grid gap-x-8 gap-y-4 rounded-xl border border-rule px-5 py-5 sm:px-6 @3xl:grid-cols-4">
        <div>
          <div className="num text-[22px] leading-none font-semibold tracking-[-0.02em]">{review.products.length}</div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">{t("priority products: {pct}% of your product spend", { pct: Math.round(review.share * 100) })}</div>
        </div>
        <div>
          <div className="num text-[22px] leading-none font-semibold tracking-[-0.02em]">
            {researched}
            <span className="text-[15px] font-normal text-ink-3"> / {review.products.length}</span>
          </div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">{t("researched so far")}</div>
        </div>
        <div>
          <div className="num text-[22px] leading-none font-semibold tracking-[-0.02em]">
            {suppliers.length}
            <span className="text-[15px] font-normal text-ink-3"> / {found}</span>
          </div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">{t("suppliers recommended for a request, of the candidates found")}</div>
        </div>
        <div>
          <div className="num text-[22px] leading-none font-semibold tracking-[-0.02em]">{gap.products ? (gap.low > 0 ? `${f.moneyApprox(gap.low)}–${f.moneyApprox(gap.high)}` : t("up to {amount}", { amount: f.moneyApprox(gap.high) })) : "—"}</div>
          <div className="mt-1.5 text-[12.5px] text-ink-3">
            {gap.products ? t.n(gap.products, "theoretical opportunity a year, on {n} product: to validate", "theoretical opportunity a year, on {n} products: to validate") : t("theoretical opportunity: no comparable evidence yet")}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <ResearchPriority count={review.products.length} />
      </div>

      <section className="mb-5 rounded-xl border border-ledger/25">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 bg-ledger-wash/40 px-5 py-4 sm:px-6">
          <div className="min-w-[240px] flex-1">
            <h2 className="text-[15.5px] font-semibold">{t("Live pilot")}</h2>
            <p className="mt-0.5 max-w-[78ch] text-[13px] text-ink-2">
              {pilot.length
                ? t("The products of your first real test, from the request to a validated opportunity. Keep it to a few: one to five products, three suppliers each.")
                : t("You have not chosen the products of the pilot yet: the {n} that weigh most stand in. Start with a few — one to five products, three suppliers each — not with all {total}.", { n: pilotViews.length, total: review.products.length })}
            </p>
          </div>
          {!pilot.length && pilotViews.length > 0 && <PilotToggle productIds={pilotViews.map((v) => v.productId)} on={false} label={t("Start the pilot with these {n}", { n: pilotViews.length })} />}
        </div>
        <Table>
          <thead>
            <tr>
              <Th>{t("Product")}</Th>
              <Th className="hidden @2xl:table-cell" align="right">{t("Current spend")}</Th>
              <Th>{t("RFQ readiness")}</Th>
              <Th className="hidden @3xl:table-cell" align="right">{t("Recommended suppliers")}</Th>
              <Th className="hidden @2xl:table-cell" align="right">{t("RFQs sent")}</Th>
              <Th className="hidden @2xl:table-cell" align="right">{t("Responses")}</Th>
              <Th className="hidden @4xl:table-cell" align="right">{t("Comparable quotes")}</Th>
              <Th className="hidden @3xl:table-cell" align="right">{t("Best true cost")}</Th>
              <Th className="hidden @3xl:table-cell">{t("Opportunity")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {pilotViews.map((v) => {
              const c = costs.get(v.productId);
              const live = c?.quotes.filter((q) => !q.expired && q.comparability !== "not") ?? [];
              const bestCost = live.filter((q) => q.cost.perUnit != null).sort((a, b) => a.cost.perUnit! - b.cost.perUnit!)[0];
              const o = c?.best?.opportunity;
              return (
                <tr key={v.productId} className={rowClass(true)}>
                  <Td className="max-w-[280px] whitespace-normal!">
                    <Link href={`/sourcing/${v.productId}`} className="stretched font-medium">
                      {v.name}
                    </Link>
                  </Td>
                  <Td align="right" className="hidden @2xl:table-cell">{f.moneyApprox(v.history.annualSpend)}</Td>
                  <Td>
                    <ReadinessPill readiness={lineOf.get(v.productId)!.spec.readiness} />
                  </Td>
                  <Td align="right" className="hidden @3xl:table-cell">{v.screening.counts.recommended}</Td>
                  <Td align="right" className="hidden @2xl:table-cell">{requests.filter((r) => r.kind !== "follow_up" && r.productIds.includes(v.productId)).length}</Td>
                  <Td align="right" className="hidden @2xl:table-cell">{c?.quotes.length ?? 0}</Td>
                  <Td align="right" className="hidden @4xl:table-cell">{live.length}</Td>
                  <Td align="right" className="hidden @3xl:table-cell">{bestCost ? perUnit(bestCost.cost.perUnit!, v.unit) : <span className="text-ink-4">—</span>}</Td>
                  <Td className="hidden whitespace-normal! text-[12.5px] @3xl:table-cell">
                    {o ? `${t(OPPORTUNITY_LEVEL[o.level].label)}${o.annual != null ? `: ${f.moneyApprox(o.annual)}` : ""}` : <span className="text-ink-4">—</span>}
                  </Td>
                  <Td className="relative z-10">{pilot.includes(v.productId) && <PilotToggle productIds={[v.productId]} on />}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="border-t border-rule px-5 py-2.5 text-[12.5px] text-ink-3 sm:px-6">{t("Add a product from its market page. A product enters the comparison when a supplier's answer is recorded as a quote.")}</p>
      </section>

      <section className="mb-5 rounded-xl border border-rule px-5 py-5 sm:px-6">
        <h2 className="text-[15.5px] font-semibold">{t("Requests by supplier")}</h2>
        <p className="mt-1 mb-4 max-w-[80ch] text-[13px] text-ink-2">
          {suppliers.length
            ? t("First round: the {products} products that weigh most. For them {suppliers} suppliers are recommended — {pairs} product requests in {suppliers} emails, because a supplier that covers several products gets one request. Nothing is sent from here.", { products: firstRound.length, suppliers: suppliers.length, pairs })
            : t("First round: the {products} products that weigh most. No supplier is recommended for them yet.", { products: firstRound.length })}
        </p>
        <SupplierRfqBoard suppliers={suppliers} context={{ deliveryCountry: settings.country, companyName: settings.companyName, userName: settings.userName }} language={t.locale} />
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {RESEARCH_STATUSES.filter((s) => byStatus.get(s)).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <ResearchStatusPill status={s} /> <span className="num text-[12.5px] text-ink-3">{byStatus.get(s)}</span>
          </span>
        ))}
      </div>

      <div className="rounded-lg border border-rule">
        <Table>
          <thead>
            <tr>
              <Th className="border-t-0">{t("Product")}</Th>
              <Th className="hidden border-t-0 @3xl:table-cell" align="right">{t("Spend")}</Th>
              <Th className="border-t-0" align="right">{t("Current price")}</Th>
              <Th className="hidden border-t-0 @5xl:table-cell">{t("Supplier")}</Th>
              <Th className="border-t-0">{t("Market signal")}</Th>
              <Th className="hidden border-t-0 @2xl:table-cell">{t("Supplier candidates")}</Th>
              <Th className="hidden border-t-0 @4xl:table-cell">{t("Quote status")}</Th>
              <Th className="hidden border-t-0 @4xl:table-cell" align="right">{t("Potential opportunity")}</Th>
              <Th className="hidden border-t-0 @6xl:table-cell">{t("Confidence")}</Th>
              <Th className="hidden border-t-0 @5xl:table-cell">{t("Next action")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ view: v, status }) => {
              const states = v.candidates.map((r) => r.candidate.status);
              const sent = states.filter((s) => s === "quote_requested" || s === "contacted").length;
              const received = states.filter((s) => s === "quote_received").length + v.observations.filter((o) => o.type === "quote").length;
              return (
                <tr key={v.productId} className={rowClass(true)}>
                  <Td className="max-w-[300px] py-2.5 whitespace-normal!">
                    <Link href={`/sourcing/${v.productId}`} className="stretched font-medium">
                      {v.name}
                    </Link>
                    <div className="truncate text-[12px] text-ink-3 @5xl:hidden">{v.currentSupplier?.name ?? "—"}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ResearchStatusPill status={status} />
                      {v.materiality === "focus" && <span className="text-[11.5px] font-medium text-ledger">{t("first round")}</span>}
                    </div>
                  </Td>
                  <Td align="right" className="hidden font-medium @3xl:table-cell">
                    {f.money(Math.round(v.history.annualSpend))}
                  </Td>
                  <Td align="right">
                    {v.currentPrice != null ? (
                      <span className="inline-flex flex-col items-end gap-0.5">
                        <span className="font-medium">
                          {f.priceShort(v.currentPrice)}
                          <span className="font-normal text-ink-3">/{v.unit}</span>
                        </span>
                        <PriceTypeTag type="actual" />
                        {v.history.observations >= 2 && v.history.weightedAverage != null && <span className="text-[12px] text-ink-3">{t("{price} on average", { price: f.priceShort(v.history.weightedAverage) })}</span>}
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </Td>
                  <Td className="hidden max-w-[160px] truncate text-ink-2 @5xl:table-cell">{v.currentSupplier?.name ?? "—"}</Td>
                  <Td className="whitespace-normal!">
                    {v.range ? (
                      <>
                        <div className="num font-medium">{rangeText(v.range.low, v.range.high, v.unit)}</div>
                        <div className="text-[12px] text-ink-3">
                          {v.range.reliable
                            ? t(POSITION_LABEL[v.position])
                            : `${v.range.sources.map((s) => t(PRICE_TYPE_LABEL[s.type])).join(", ")}${v.gapPct && v.gapPct.high > 0.5 ? ` · ${t("you pay about {pct}% more", { pct: Math.round(v.gapPct.high) })}` : ""}`}
                        </div>
                        {!v.range.reliable && <div className="text-[12px] text-ink-3">{t("not a market range")}</div>}
                      </>
                    ) : (
                      <span className="text-ink-3">{t("No reliable evidence")}</span>
                    )}
                  </Td>
                  <Td className="hidden whitespace-normal! @2xl:table-cell">
                    {v.screening.counts.found > 0 ? (
                      <>
                        <span className="num font-medium">{v.screening.counts.recommended}</span> <span className="text-[12px]">{t("recommended")}</span>
                        <div className="text-[12px] text-ink-3">{t("{found} found · {strong} strong", { found: v.screening.counts.found, strong: v.screening.counts.strong })}</div>
                      </>
                    ) : (
                      <span className="text-ink-3">{t("None yet|suppliers")}</span>
                    )}
                  </Td>
                  <Td className="hidden whitespace-normal! text-[12.5px] @4xl:table-cell">
                    {received > 0 ? (
                      <span className="font-medium">{t.n(received, "{n} quote received", "{n} quotes received")}</span>
                    ) : sent > 0 ? (
                      t.n(sent, "{n} request sent", "{n} requests sent")
                    ) : (
                      <span className="text-ink-3">{v.counts.active > 0 ? t("None requested yet") : "—"}</span>
                    )}
                  </Td>
                  <Td align="right" className="hidden @4xl:table-cell">
                    {v.opportunity && v.opportunity.high > 0 ? (
                      <span className="font-medium">{v.opportunity.low > 0 && f.moneyApprox(v.opportunity.low) !== f.moneyApprox(v.opportunity.high) ? `${f.moneyApprox(v.opportunity.low)}–${f.moneyApprox(v.opportunity.high)}` : t("up to {amount}", { amount: f.moneyApprox(v.opportunity.high) })}</span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </Td>
                  <Td className="hidden text-[12.5px] @6xl:table-cell">{v.range ? t(CONFIDENCE_WORD[v.range.confidence]) : <span className="text-ink-4">—</span>}</Td>
                  <Td className="hidden max-w-[240px] whitespace-normal! text-[12.5px] text-ink-2 @5xl:table-cell">{v.next.label}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <p className="mt-3 text-[12px] text-ink-4">
        {t("A potential opportunity compares prices only, at your annual volume: it is theoretical until a comparable quote confirms it. Transport, duties and payment terms are not included.")}
      </p>

      <Disclosure className="mt-5" title={t("Load research done outside the app")} description={t("Suppliers and price references you already found, with their sources")}>
        <ResearchImport />
      </Disclosure>

      <Disclosure
        className="mt-3"
        title={t("External sources")}
        description={`${t("{n} of {total} connected", { n: on.length, total: sources.length })} · ${sources.some((s) => s.kind === "webSearch" && s.state === "connected") ? t("web search on") : t("web search not configured")}`}
      >
        <p className="max-w-[76ch] text-[13px] text-ink-2">
          {t("A research uses only the sources connected here. Free public sources work without any key. Searching the web for new suppliers needs a search provider's API key, set in the environment of the server — never in the code. Premium data providers are optional and have a place kept for them.")}
        </p>
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {sources.map((s) => (
            <li key={s.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={cx("inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase", s.state === "connected" ? "bg-down-wash text-down" : "border border-dashed border-rule-strong text-ink-3")}>{t(STATE_LABEL[s.state])}</span>
              <span className="font-medium">{s.name}</span>
              <span className="text-ink-3">
                — {t(PROVIDER_KINDS.find((k) => k.key === s.kind)!.label)}
                {s.access === "free" ? ` · ${t("free, public")}` : s.access === "premium" ? ` · ${t("optional, paid subscription")}` : ""}
                {s.state === "needs_key" && s.env ? ` · ${t("set {name} to switch it on", { name: s.env })}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-rule pt-3 text-[12.5px] text-ink-3">
          {t("Limits: up to {searches} searches and {pages} pages per product.", { searches: limits.maxSearchesPerProduct, pages: limits.maxPagesPerProduct })}{" "}
          {limits.dailyCostLimit != null ? t("Daily spending limit: {amount}.", { amount: f.money(limits.dailyCostLimit) }) : t("No daily spending limit is set.")}{" "}
          {t("So far: {calls} calls to external sources, {cached} answered from what was already on file.", { calls: usage.total.calls, cached: usage.total.cached })}{" "}
          {usage.total.cost == null ? t("Cost not known: the price per search is not set.") : t("Estimated cost: {amount}.", { amount: f.money(usage.total.cost) })}
        </p>
      </Disclosure>
    </>
  );
}
