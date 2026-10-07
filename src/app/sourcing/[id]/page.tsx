import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { QuoteDialog } from "@/components/dialogs";
import { CandidateBoard, type CandidateVM } from "@/components/sourcing/candidates";
import { BenchmarkForm, DeleteBenchmarkButton } from "@/components/sourcing/market-forms";
import { CustomsCodeForm, DeepResearchButton, ResearchClassSelect } from "@/components/sourcing/research";
import { BenchmarkMonth, PilotToggle, RfqSpecForm } from "@/components/sourcing/spec";
import { NegotiationLine } from "@/components/negotiation/card";
import { QuoteOpportunityBlock, TrueCostTable } from "@/components/sourcing/true-cost-table";
import { ComparabilityText, PriceTypeTag, ResearchStatusPill } from "@/components/sourcing/tags";
import { Crumbs, Delta, Disclosure, Label, PageHeader, Section, Table, Td, Th, cx } from "@/components/ui";
import { getDb } from "@/db";
import { products as productsTable } from "@/db/schema";
import { categorize } from "@/lib/catalog/taxonomy";
import { countryName, flagOf } from "@/lib/countries";
import { getDataset, getIntel, getSettings, getT } from "@/lib/data";
import * as f from "@/lib/format";
import { said } from "@/lib/i18n";
import { companyKey } from "@/lib/import/normalize/text";
import { limitsFrom } from "@/lib/research/budget";
import { researchSummary } from "@/lib/research/conclusions";
import { researchStatus } from "@/lib/research/status";
import { EVIDENCE_TYPE_LABEL, RUN_STATUS_LABEL, STEP_LABEL, STEP_STATUS_LABEL, isEvidenceType } from "@/lib/research/steps";
import { CLASS_LABEL, STRATEGY, classifyProduct } from "@/lib/research/strategy";
import { CONFIDENCE_WORD } from "@/lib/intel/summary";
import { hostOf, searchQueries } from "@/lib/sourcing/discovery";
import { perUnit, rangeText } from "@/lib/sourcing/market";
import { REGION_LABEL, crossesCustoms } from "@/lib/sourcing/regions";
import { ROLE_LABEL, contactHistory } from "@/lib/sourcing/screening";
import { POSITION_LABEL, SOURCE_LEVEL_LABEL } from "@/lib/sourcing/types";
import { connectedProviders } from "@/server/providers";
import { getNegotiations } from "@/server/negotiation";
import { WEB_RESEARCH, getResearch } from "@/server/research";
import { discoveryRequest, getMarketViews, readProductCosts, readRfqLines, readSourcing } from "@/server/sourcing";

export async function generateMetadata({ params }: PageProps<"/sourcing/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [data, t] = await Promise.all([getDataset(), getT()]);
  return { title: data.products.find((p) => p.id === id)?.name ?? t("Product") };
}

/**
 * One product's market page: what is paid and has been paid, the evidence on
 * file with its kind and source, the suppliers that could be asked, and the
 * step that would settle the question. Nothing here is estimated to fill a gap.
 */
export default async function ProductSourcingPage({ params }: PageProps<"/sourcing/[id]">) {
  const { id } = await params;
  const [{ views, requests }, data, settings, research, intel, t] = await Promise.all([getMarketViews(), getDataset(), getSettings(), getResearch(), getIntel(), getT()]);
  const v = views.get(id);
  const product = data.products.find((p) => p.id === id);
  if (!v || !product) notFound();
  const db = await getDb();
  const built = await discoveryRequest(db, id, t);
  const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  const providers = connectedProviders();
  const limits = limitsFrom(process.env);
  const runs = research.runs.filter((r) => r.productId === id);
  const latest = runs[0] ?? null;
  const evidence = research.evidence.filter((e) => e.productId === id);
  const status = researchStatus(v, latest, new Date(), limits.staleRunMinutes);
  const classInput = { name: product.name, kind: row?.kind ?? "needs_review", unit: v.unit, specifications: built?.request.specifications ?? {}, companyName: settings.companyName };
  const cls = classifyProduct({ ...classInput, override: row?.researchClass });
  const auto = classifyProduct(classInput);
  const strategy = STRATEGY[cls.productClass];
  const summary = researchSummary(v);
  const queries = built ? searchQueries({ ...built.query, productClass: cls.productClass }, t).slice(0, limits.maxSearchesPerProduct) : [];
  const suggestedCode = categorize(product.name)?.sub.customs ?? null;
  const h = v.history;
  const unit = v.unit;
  const home = settings.country;

  const asked = [...new Set(requests.flatMap((r) => r.productIds))];
  const lines = await readRfqLines(db, [...new Set([id, ...asked])], t);
  const line = lines.get(id)!;
  const spec = line.spec;
  const costs = (await readProductCosts(db, intel, views, t)).get(id) ?? null;
  const negotiation = (await getNegotiations([id])).get(id) ?? null;
  const ranked = new Map(v.candidates.map((r) => [r.candidate.id, r]));
  const candidates: CandidateVM[] = v.screening.all.map((x) => {
    const c = x.candidate;
    const r = ranked.get(c.id)!;
    const seen = v.observations.find((o) => o.key === `candidate:${c.id}`);
    const history = contactHistory(requests, companyKey(c.name), c.status === "quote_received", intel.asOf);
    return {
      id: c.id,
      name: c.name,
      country: c.country ? countryName(c.country, t.locale) : null,
      flag: flagOf(c.country),
      website: c.website,
      regionLabel: r.region === "home" && home ? countryName(home, t.locale) : t(REGION_LABEL[r.region]),
      strength: r.strength,
      comparability: r.comparability,
      reasons: r.reasons,
      productMatched: c.productMatched,
      matchReason: c.matchReason,
      technicalCompatibility: c.technicalCompatibility,
      price: c.priceLow != null ? { text: seen?.low != null ? rangeText(seen.low, seen.high!, unit) : (seen?.asWritten ?? `${c.currency ?? ""} ${f.number(c.priceLow)}/${c.unit ?? "?"}`), type: c.priceType ?? "indicative", sourceUrl: c.priceSourceUrl ?? c.sourceUrl } : null,
      terms: [c.leadTimeDays != null ? t("lead time {n} days", { n: c.leadTimeDays }) : null, c.paymentTerms, c.incoterm, c.certifications].filter((y): y is string => !!y),
      sourceUrl: c.sourceUrl,
      sourceHost: hostOf(c.sourceUrl),
      sourceDate: c.sourceDate ? f.date(c.sourceDate) : null,
      sourceLevel: c.sourceLevel,
      foundBy: c.source === "manual" || c.source === WEB_RESEARCH ? null : (providers.discovery.find((y) => y.key === c.source)?.name ?? c.source),
      researched: c.source === WEB_RESEARCH,
      discoveredAt: c.discoveredAt ? f.date(c.discoveredAt) : null,
      companyType: c.companyType,
      specCheck: c.specCheck ? { stated: c.specCheck.product.length > 0, confirmed: c.specCheck.confirmed, missing: c.specCheck.missing, checkedAt: f.date(c.specCheck.checkedAt) } : null,
      minimumOrder: c.moq != null ? t("minimum order {quantity}", { quantity: `${f.number(c.moq, 0)} ${c.unit ?? unit}` }) : null,
      supplierId: c.supplierId,
      notes: c.notes,
      status: c.status,
      top: x.shortlisted,
      customs: crossesCustoms(c.country ?? c.shippingOrigin, home) === true,
      stage: x.stage,
      stageReason: x.reason,
      fit: x.fit,
      evidence: x.evidence,
      logistics: x.logistics,
      mainStrength: x.strength,
      mainUnknown: x.unknown,
      shortlisted: x.shortlisted,
      why: x.why,
      contactValue: x.contactValue,
      role: x.role,
      inProgress: x.inProgress,
      email: c.specCheck?.email ?? null,
      history: { times: history.times, last: history.last ? f.date(history.last) : null, lastISO: history.last, days: history.daysSinceLast, recent: history.recent, followUpDue: history.followUpDue },
      // The other products this company was asked about in the same request: an answer may quote them all.
      replyOthers: [...new Set(requests.filter((r) => r.supplierKey === companyKey(c.name)).flatMap((r) => r.productIds))].filter((pid) => pid !== id && lines.get(pid)?.productName).map((pid) => ({ id: pid, name: lines.get(pid)!.productName })),
    };
  });
  const figure = (label: string, value: React.ReactNode, note?: React.ReactNode) => (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">{value}</div>
      {note && <div className="mt-0.5 text-[12.5px] text-ink-3">{note}</div>}
    </div>
  );
  const months = new Map((await readSourcing(db)).benchmarks.map((b) => [b.id, b.periodMonth]));
  const benchmarkIds = new Map(v.observations.filter((o) => o.key.startsWith("benchmark:")).map((o) => [o.key, o.key.slice("benchmark:".length)]));

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/sourcing", label: t("Market and alternative suppliers") }]} />}
        title={v.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ResearchStatusPill status={status} />
            <Link href={`/products/${id}`} className="font-medium text-ledger hover:underline">
              {t("Open the product")}
            </Link>
          </span>
        }
        actions={
          <>
            <PilotToggle productIds={[id]} on={row?.inPilot ?? false} />
            <QuoteDialog defaultProductId={id} trigger={{ label: t("Add quote") }} />
          </>
        }
      />

      {/* The answer first, in plain words. */}
      <section className="rounded-xl border border-rule px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-[260px] flex-1">
            <Label>{t("Market research, in plain words")}</Label>
            <div className="mt-2 max-w-[78ch] space-y-1.5 text-[14px] leading-relaxed text-ink-2">
              {summary.map((line) => (
                <p key={line.message}>{said(t, line)}</p>
              ))}
            </div>
          </div>
          <DeepResearchButton productId={id} researched={!!latest} />
        </div>
        <p className="mt-3 border-t border-rule pt-3 text-[12.5px] text-ink-3">
          {latest
            ? `${t("Last researched: {date}", { date: f.date(latest.startedAt.slice(0, 10)) })} · ${latest.depth === "imported" ? t("research done outside the app, loaded with its sources") : t.n(latest.sourcesChecked, "{n} source checked", "{n} sources checked")} · ${t(RUN_STATUS_LABEL[latest.status] ?? "Completed|run").toLowerCase()}. ${t("It is not run again by itself: refresh it when you want newer evidence.")}`
            : t("Not researched yet: what you read here comes from your invoices and from what is on file.")}
        </p>
      </section>

      <Section className="mt-5" title={t("Current situation")} description={t("From your invoices: the starting point of every comparison.")}>
        <div className="grid gap-x-8 gap-y-5 @2xl:grid-cols-2 @4xl:grid-cols-4">
          {figure(
            t("Current price"),
            v.currentPrice != null ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="num">{perUnit(v.currentPrice, unit)}</span>
                <PriceTypeTag type="actual" />
              </span>
            ) : (
              "—"
            ),
            h.latest ? `${h.latest.supplierName ?? ""} · ${f.date(h.latest.date)}` : t("No purchase price on record yet."),
          )}
          {figure(t("Annual spend"), <span className="num">{f.money(Math.round(h.annualSpend))}</span>, h.annualQuantity > 0 ? `${f.number(h.annualQuantity, 0)} ${unit} ${t("in 12 months")}` : null)}
          {figure(
            t("Price history"),
            h.low && h.high ? <span className="num">{rangeText(h.low.price, h.high.price, unit)}</span> : "—",
            h.weightedAverage != null ? `${t("{price} on average", { price: f.priceShort(h.weightedAverage) })} · ${t.n(h.observations, "{n} purchase", "{n} purchases")}` : null,
          )}
          {figure(
            t("Recent movement"),
            h.movement.pct != null ? <Delta value={h.movement.pct} /> : "—",
            h.movement.pct != null && h.movement.since ? (h.movement.partial ? t("since your first purchase on record, {date}", { date: f.date(h.movement.since) }) : t("in 12 months")) : t("One price on record: no movement to show yet."),
          )}
        </div>
        {h.suppliers.length > 0 && (
          <p className="mt-4 border-t border-rule pt-3 text-[13px] text-ink-2">
            {t("Bought from:")} {h.suppliers.map((s) => `${s.name} (${Math.round(s.share * 100)}%)`).join(", ")}
          </p>
        )}
      </Section>

      <Section className="mt-5" title={t("Market signal")} description={t("Only evidence on file, each with its kind and source. There is no single “market price”.")} flush>
        <div className="grid gap-x-8 gap-y-4 px-5 pb-4 @3xl:grid-cols-3">
          {figure(
            t("Market quote range"),
            v.range?.kind === "quotes" ? <span className="num">{rangeText(v.range.low, v.range.high, unit)}</span> : <span className="text-[15px] font-medium text-ink-3">{v.range?.kind === "single_quote" ? t("Insufficient data") : t("Not available")}</span>,
            v.range?.kind === "quotes"
              ? t.n(v.range.observations, "from {n} comparable quote", "from {n} comparable quotes")
              : v.range?.kind === "single_quote"
                ? t("1 comparable quote received: {price}. One quote is not a market.", { price: rangeText(v.range.low, v.range.high, unit) })
                : t("No comparable quote on file yet. Benchmarks are shown below, on their own."),
          )}
          {figure(
            t("Your price against it"),
            <span className="text-[15px]">{v.range?.reliable ? t(POSITION_LABEL[v.position]) : t(POSITION_LABEL.insufficient)}</span>,
            v.range?.reliable
              ? v.gapPct && (v.position === "slightly_above" || v.position === "materially_above")
                ? Math.round(v.gapPct.low) === Math.round(v.gapPct.high)
                  ? t("about {pct}% above the range", { pct: Math.round(v.gapPct.low) })
                  : t("{low}% to {high}% above the range", { low: Math.round(v.gapPct.low), high: Math.round(v.gapPct.high) })
                : null
              : t("A position needs a range of quotes. Each piece of evidence below says how far your price is from it."),
          )}
          {figure(
            t("Confidence"),
            <span className="text-[15px]">{v.range?.reliable ? t(CONFIDENCE_WORD[v.range.confidence]) : "—"}</span>,
            v.range?.reliable ? t.n(v.range.comparable, "{n} highly comparable observation of {total}", "{n} highly comparable observations of {total}", { total: v.range.observations }) : v.range ? t("No range of quotes yet: what is on file is an indication.") : null,
          )}
        </div>
        <Table>
          <thead>
            <tr>
              <Th>{t("Kind")}</Th>
              <Th>{t("From")}</Th>
              <Th align="right">{t("Price")}</Th>
              <Th className="hidden @2xl:table-cell">{t("Date")}</Th>
              <Th className="hidden @3xl:table-cell">{t("Comparability")}</Th>
              <Th className="hidden @4xl:table-cell">{t("Source")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {v.observations.map((o) => (
              <tr key={o.key}>
                <Td>
                  <PriceTypeTag type={o.type} />
                </Td>
                <Td className="max-w-[260px] whitespace-normal!">
                  <span className="font-medium">{o.label}</span>
                  {o.detail && <div className="text-[12px] text-ink-3">{o.detail}</div>}
                  {(o.key.startsWith("benchmark:") || o.key.startsWith("candidate:")) && (
                    <div className="mt-0.5 text-[11.5px] text-ink-3">
                      {o.key.startsWith("benchmark:") ? `${t(ROLE_LABEL.market_signal)}: ${t("a price to know about, not a company to contact")}` : t(ROLE_LABEL[candidates.find((c) => `candidate:${c.id}` === o.key)?.role ?? "supplier_candidate"])}
                    </div>
                  )}
                </Td>
                <Td align="right" className="font-medium">
                  {o.low != null ? rangeText(o.low, o.high!, unit) : (o.asWritten ?? "—")}
                  {o.key !== "current" && o.gapPct != null && (
                    <div className="text-[11.5px] font-normal text-ink-3">
                      {Math.abs(o.gapPct) < 0.5 ? t("same as your price") : o.gapPct > 0 ? t("you pay {pct}% more", { pct: Math.round(o.gapPct) }) : t("you pay {pct}% less", { pct: Math.round(-o.gapPct) })}
                      {o.used && ` · ${t("in the range")}`}
                    </div>
                  )}
                </Td>
                <Td muted className="num hidden @2xl:table-cell">
                  {o.date ? f.date(o.date) : "—"}
                  {!o.recent && <div className="text-[11.5px] text-caution">{t("old")}</div>}
                </Td>
                <Td className="hidden @3xl:table-cell">{o.key === "current" || o.type === "cost_driver" ? <span className="text-ink-4">—</span> : <ComparabilityText level={o.comparability} />}</Td>
                <Td muted className="hidden max-w-[220px] whitespace-normal! text-[12px] @4xl:table-cell">
                  {t(SOURCE_LEVEL_LABEL[o.sourceLevel])}
                  {o.sourceName && ` · ${o.sourceName}`}
                  {o.sourceUrl && (
                    <>
                      {" "}
                      <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-ledger hover:underline">
                        {hostOf(o.sourceUrl)} <ExternalLink size={10} />
                      </a>
                    </>
                  )}
                </Td>
                <Td className="whitespace-normal!">
                  {benchmarkIds.has(o.key) && (
                    <span className="flex flex-col items-end gap-1">
                      <DeleteBenchmarkButton id={benchmarkIds.get(o.key)!} />
                      {o.type === "direct_benchmark" && <BenchmarkMonth id={benchmarkIds.get(o.key)!} month={months.get(benchmarkIds.get(o.key)!) ?? null} />}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="space-y-2.5 px-5 py-3 text-[12.5px] text-ink-3">
          {(strategy.trade || row?.customsCode) && <CustomsCodeForm productId={id} code={row?.customsCode ?? null} confirmed={row?.customsCodeConfirmed ?? false} suggested={suggestedCode} />}
          <p>
            {providers.benchmark.length === 0 && t("No benchmark provider is connected: published references are on file only if you added them or loaded them from research.")}{" "}
            {providers.trade.length > 0 ? t("Trade statistics come from {source}, for products bought by weight that have a customs code.", { source: providers.trade[0].name }) : t("Trade statistics are not connected.")}
          </p>
        </div>
      </Section>

      <Disclosure className="mt-3" title={t("Add a market reference")} description={t("A benchmark, trade data or a cost driver you can point to")}>
        <BenchmarkForm productId={id} unit={unit} />
      </Disclosure>

      <section id="specification" className="mt-5 scroll-mt-20 rounded-xl border border-rule px-5 py-5 sm:px-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15.5px] font-semibold">{t("The product, for a request for quotation")}</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{t("How it is described to a supplier who has never sold it to you. Your supplier's name and codes are never sent.")}</p>
          </div>
        </div>
        <RfqSpecForm
          productId={id}
          spec={{
            originalName: spec.originalName,
            supplierCodes: spec.supplierCodes,
            rfqName: row?.rfqName ?? null,
            suggestedName: spec.suggestedName,
            technical: row?.technicalSpecifications ?? null,
            application: spec.application,
            attributes: [...spec.attributes.map((a) => `${t.any(a.label)}: ${a.value}`), ...spec.figures.filter((x) => !spec.attributes.some((a) => a.value.replace(/\s/g, "").includes(x)))],
            quantities: [unit, spec.annualQuantity ? t("about {quantity} a year", { quantity: `${f.number(spec.annualQuantity, 0)} ${unit}` }) : null, spec.typicalOrderQuantity ? t("usual order about {quantity}", { quantity: `${f.number(spec.typicalOrderQuantity, 0)} ${unit}` }) : null].filter(Boolean).join(" · "),
            readiness: spec.readiness,
            missing: spec.missing,
            documents: line.documents,
          }}
        />
      </section>

      <Section
        className="mt-5"
        title={t("Alternative suppliers")}
        description={
          v.screening.counts.found
            ? `${t.n(v.screening.counts.found, "{n} candidate found", "{n} candidates found")} · ${t.n(v.screening.counts.strong, "{n} strong match", "{n} strong matches")} · ${t("{n} recommended for a request", { n: v.screening.counts.recommended })}`
            : t("Companies that could sell you a comparable product. Each one says where it was found.")
        }
      >
        <div className="space-y-4">
          <p className="max-w-[78ch] text-[13px] text-ink-2">
            {t("These are candidates: found through research, not validated, and not among your suppliers. They are screened for you: only a few are recommended for a request, the others stay on file with why they were put aside.")}{" "}
            {providers.webSearch.length === 0 && <span className="text-ink-3">{t("Web search is not configured: Deep Research checks the candidates on file and does not look for new ones.")}</span>}
          </p>
          <CandidateBoard
            productId={id}
            unit={unit}
            candidates={candidates}
            counts={v.screening.counts}
            line={line}
            context={{ deliveryCountry: home, companyName: settings.companyName, userName: settings.userName }}
            language={t.locale}
            firstRound={v.materiality === "focus"}
            readiness={spec.readiness}
            anchor={v.currentPrice}
          />
        </div>
      </Section>

      {costs && (
        <Section className="mt-5" title={t("Quotes and true cost")} description={t("What you pay today next to each quote, once transport, duty, stock and payment terms are counted. Every figure says where it comes from.")} flush>
          <TrueCostTable productId={id} unit={unit} currentSupplier={v.currentSupplier?.name ?? null} costs={costs} t={t} />
        </Section>
      )}

      <Section className="mt-5" title={t("Opportunity")} description={t("Theoretical while it rests on a benchmark; validated only with a real comparable quote, its true cost and the specification confirmed. A saving is what an invoice proves.")}>
        {costs?.best?.opportunity ? (
          <QuoteOpportunityBlock unit={unit} costs={costs} annualQuantity={h.annualQuantity} t={t} />
        ) : v.opportunity && v.opportunity.high > 0 ? (
          <>
            <div className="mb-1 text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{t("Theoretical opportunity")}</div>
            <div className="num text-[22px] font-semibold tracking-[-0.02em]">
              {v.opportunity.low > 0 && f.moneyApprox(v.opportunity.low) !== f.moneyApprox(v.opportunity.high) ? `${f.moneyApprox(v.opportunity.low)}–${f.moneyApprox(v.opportunity.high)}` : t("up to {amount}", { amount: f.moneyApprox(v.opportunity.high) })}
              <span className="text-[14px] font-normal text-ink-3"> {t("a year")}</span>
            </div>
            <p className="mt-1.5 text-[13px] text-ink-2">{t("Nominal prices of the quotes against yours, times {quantity} bought in 12 months. It becomes a validated opportunity when the true cost of a quote is complete.", { quantity: `${f.number(h.annualQuantity, 0)} ${unit}` })}</p>
          </>
        ) : (
          <p className="text-[13.5px] text-ink-2">
            <span className="font-medium">{t("Not estimated.")}</span> {costs ? (costs.quotes.some((q) => !q.cost.complete) ? t("The true cost of a quote on file is incomplete: add what is missing above to see what the difference is worth.") : t("No quote on file has a true cost below what you pay today.")) : v.opportunityNote}
          </p>
        )}
        {/* Apart from what the quotes prove: what the software estimates could be negotiated. */}
        {negotiation && (
          <div className="mt-4 border-t border-rule pt-3">
            <NegotiationLine n={negotiation} t={t} />
          </div>
        )}
      </Section>

      <Section className="mt-5" title={t("Next step")}>
        <p className="text-[14px] font-medium">{v.next.label}</p>
        <div className="mt-3">
          <Label>{t("What is still missing")}</Label>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
            {v.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </Section>

      <Disclosure className="mt-5" title={t("How this research was done")} description={`${t(CLASS_LABEL[cls.productClass])} · ${t(strategy.plan)}`}>
        <div className="space-y-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-ink-3">{t("Kind of product")}</span>
            <ResearchClassSelect productId={id} value={cls.productClass} auto={auto.productClass} chosen={cls.chosen} />
            <span className="text-[12.5px] text-ink-3">{t(cls.reason)}</span>
          </div>
          {latest && latest.steps.length > 0 && (
            <div>
              <Label>{t("Steps of the last research")}</Label>
              <ul className="mt-1.5 space-y-1">
                {latest.steps.map((step) => (
                  <li key={step.key} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{t(STEP_LABEL[step.key])}</span>
                    <span className={cx("text-[12px]", step.status === "done" ? "text-down" : step.status === "failed" ? "text-up" : "text-caution")}>{t(STEP_STATUS_LABEL[step.status])}</span>
                    {step.count != null && <span className="num text-[12px] text-ink-3">{step.count}</span>}
                    {step.note && <span className="text-[12.5px] text-ink-3">— {said(t, step.note)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <Label>{providers.webSearch.length ? t("Searches") : t("Searches worth running yourself")}</Label>
            {providers.webSearch.length === 0 && <p className="mt-1 text-[12.5px] text-ink-3">{t("No web search provider is configured, so the app runs none. Open them yourself, then add what you find with the page where you found it.")}</p>}
            <ul className="mt-1.5 space-y-1">
              {(latest?.queries.length ? latest.queries.map((q) => q.query) : queries).map((q) => {
                const done = latest?.queries.find((x) => x.query === q);
                return (
                  <li key={q} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-wash px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 break-words font-mono text-[12.5px] text-ink-2">{q}</span>
                    {done && <span className="text-[12px] text-ink-3">{`${t.n(done.results, "{n} result", "{n} results")}${done.cached ? ` · ${t("reused")}` : ""}`}</span>}
                    <a href={`https://duckduckgo.com/?q=${encodeURIComponent(q)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-ledger hover:underline">
                      {t("Search the web")} <ExternalLink size={11} />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
          {latest && latest.errors.length > 0 && (
            <div>
              <Label>{t("What did not answer")}</Label>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-2">
                {latest.errors.map((e) => (
                  <li key={`${e.step}:${e.message}`}>{e.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Disclosure>

      <Disclosure className="mt-3" title={t("Evidence")} description={evidence.length ? t.n(evidence.length, "{n} finding, each with its source", "{n} findings, each with their source") : t("Nothing collected yet")}>
        {evidence.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t("A research saves here what it finds: the page, when it was read, and what it says.")}</p>
        ) : (
          <ul className="divide-y divide-rule text-[13px]">
            {evidence.map((e) => (
              <li key={e.id} className="py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="inline-flex h-[18px] items-center rounded-[4px] border border-rule-strong px-1.5 text-[10.5px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{t(EVIDENCE_TYPE_LABEL[isEvidenceType(e.type) ? e.type : "other"])}</span>
                  <span>{said(t, e.finding)}</span>
                </div>
                {e.excerpt && <p className="mt-1 border-l-2 border-rule pl-2.5 text-[12.5px] text-ink-3">“{e.excerpt}”</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-3">
                  <span>{e.sourceName}</span>
                  <span>{t(SOURCE_LEVEL_LABEL[e.reliability] ?? "Other external source")}</span>
                  <span>{t("read on {date}", { date: f.date(e.retrievedAt.slice(0, 10)) })}</span>
                  {e.publishedAt && <span>{t("published {date}", { date: f.date(e.publishedAt) })}</span>}
                  {e.confidence && <span>{t("{confidence} confidence", { confidence: t(CONFIDENCE_WORD[e.confidence as keyof typeof CONFIDENCE_WORD] ?? CONFIDENCE_WORD.low) })}</span>}
                  {e.sourceUrl && (
                    <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ledger hover:underline">
                      {t("View source")} <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>

      {runs.length > 0 && (
        <Disclosure className="mt-3" title={t("Research history")} description={t.n(runs.length, "{n} research on file", "{n} researches on file")}>
          <ul className="divide-y divide-rule text-[13px]">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                <span className="num font-medium">{f.date(r.startedAt.slice(0, 10))}</span>
                <span>{r.depth === "imported" ? t("Loaded from outside") : t("Deep Research")}</span>
                <span className={cx("text-[12.5px]", r.status === "completed" ? "text-down" : r.status === "failed" ? "text-up" : "text-caution")}>{t(RUN_STATUS_LABEL[r.status] ?? "Completed|run")}</span>
                <span className="text-[12.5px] text-ink-3">
                  {t.n(r.sourcesChecked, "{n} source checked", "{n} sources checked")} · {t.n(r.resultsFound, "{n} result", "{n} results")}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </>
  );
}
