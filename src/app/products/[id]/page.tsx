import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { KindSelect } from "@/components/catalog/kind-select";
import { MappingEditor } from "@/components/catalog/mapping-editor";
import { ProductDialog, PurchaseDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { SourceTag, sourceLabel } from "@/components/import/labels";
import { ConfidenceBadge, OpportunityStatusBadge, QualityBadge, SourcingBadge, TrendTag } from "@/components/intel/badges";
import { OutlierActions, RestorePriceButton } from "@/components/intel/controls";
import { PriceChart } from "@/components/price-chart";
import { ProductSummary } from "@/components/review/product-summary";
import { Remember } from "@/components/shell/recent";
import { DeepResearchButton } from "@/components/sourcing/research";
import { NegotiationCard } from "@/components/negotiation/card";
import { FieldStatusTag, FieldProvenance, ProductDataPanel } from "@/components/dataset/product-data";
import { FIELDS, FIELD_KEYS, SECTION_LABEL, type Section as DataSection } from "@/lib/dataset/fields";
import type { ProductProfile } from "@/lib/dataset/profile";
import { getDb } from "@/db";
import { mergedInto } from "@/server/mapper";
import { documentsOnFile, getPriorityDataset, getProfiles, linkedProductDocuments } from "@/server/product-data";
import { ButtonLink, Crumbs, Delta, Disclosure, Empty, ExportLink, Label, PageHeader, Section, Sku, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { basePrice, baseTotal, isPriced, normalizePurchases, type Dataset, type ProductData } from "@/lib/analytics";
import { ATTRIBUTE_LABEL, attributesOf } from "@/lib/catalog/attributes";
import { KIND_LABEL, isProductKind, type ProductKind } from "@/lib/catalog/kinds";
import { mappingOf } from "@/lib/catalog/mapper";
import { TAXONOMY } from "@/lib/catalog/taxonomy";
import type { Learning } from "@/lib/data";
import { getDataset, getFamilies, getIntel, getLearning, getMapAnalysis, getT } from "@/lib/data";
import * as f from "@/lib/format";
import type { T } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
import { compareColumns, decisionFor } from "@/lib/intel/decision";
import { explain } from "@/lib/intel/explain";
import { OPPORTUNITY_LABEL } from "@/lib/intel/opportunities";
import { comparableObservations, type WindowChange } from "@/lib/intel/price-metrics";
import { CONFIDENCE_WORD } from "@/lib/intel/summary";
import { lookups } from "@/lib/lookups";
import { getNegotiations, keepEstimateHistory, readEstimateHistory } from "@/server/negotiation";
import { getResearch } from "@/server/research";

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [data, t] = await Promise.all([getDataset(), getT()]);
  return { title: data.products.find((p) => p.id === id)?.name ?? t("Product") };
}

const TIMELINE_MAX = 10;

export default async function ProductPage({ params, searchParams }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const [data, learning, intel, families, mapped, t] = await Promise.all([getDataset(), getLearning(), getIntel(), getFamilies(), getMapAnalysis(), getT()]);
  const EXPLAIN = explain(t);
  const pi = intel.products.find((p) => p.product.id === id);
  const lastResearch = pi?.highSpend ? ((await getResearch()).runs.find((r) => r.productId === id) ?? null) : null;
  if (!pi) {
    // Not in the catalogue: an item of spend (transport, a service, a utility…), shown for what it is.
    const item = data.products.find((p) => p.id === id);
    if (!item) {
      // Merged into another product: its page is the page of the one it is read as.
      const into = await mergedInto(await getDb(), id);
      if (into) redirect(`/products/${into}`);
      notFound();
    }
    return <SpendItem product={item} data={data} learning={learning} t={t} />;
  }
  const { product, price } = pi;
  const profile = (await getProfiles([product.id])).get(product.id)!;
  const db = await getDb();
  const [onFile, linkedDocs, priority, negotiations, estimates] = await Promise.all([
    documentsOnFile(db, product.id),
    linkedProductDocuments(db, product.id),
    query.review ? getPriorityDataset() : Promise.resolve(null),
    getNegotiations([product.id]),
    readEstimateHistory(db, product.id),
  ]);
  const negotiation = negotiations.get(product.id) ?? null;
  // What is shown now joins the history once the page is out, if it differs from the last estimate kept.
  keepEstimateHistory([product.id]);
  // Reviewing the Top 5: the next of them that still has something missing or to confirm.
  const top = priority?.rows.filter((r) => r.top) ?? [];
  const after = top.slice(top.findIndex((r) => r.intel.product.id === product.id) + 1).find((r) => r.profile.missing.length || r.profile.toConfirm.length);

  const l = lookups(data);
  const history = data.purchases.filter((p) => p.productId === product.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const productQuotes = data.quotes.filter((q) => q.productId === product.id);
  const { comparable } = normalizePurchases(product, history);
  const observations = comparableObservations(comparable);
  const d = decisionFor(intel, product.id, t)!;
  const excluded = history.filter((p) => p.priceReview === "excluded");
  const aliases = learning.productAliases.filter((a) => a.productId === product.id);
  const codes = learning.supplierProducts.filter((sp) => sp.productId === product.id && (sp.supplierSku || sp.supplierProductName));

  // Where the numbers on this page come from.
  const sourceCounts = new Map<string, number>();
  for (const r of [...history, ...productQuotes]) sourceCounts.set(r.source, (sourceCounts.get(r.source) ?? 0) + 1);
  const docs = new Map<string, { filename: string; documentId: string | null; sessionId: string }>();
  for (const r of [...history, ...productQuotes]) if (r.sourceDoc && !docs.has(r.sourceDoc.sessionId)) docs.set(r.sourceDoc.sessionId, r.sourceDoc);

  const timeline = price.timeline.slice(-TIMELINE_MAX);

  // What the product is: its place in the catalogue, its family, and what its name says about it.
  const family = product.familyId ? (families.get(product.familyId) ?? null) : null;
  const siblings = family ? intel.products.filter((x) => x.product.familyId === family.id && x.product.id !== product.id).sort((a, b) => b.metrics.annualSpend - a.metrics.annualSpend) : [];
  const attributes = attributesOf([product.name, ...aliases.map((a) => a.alias)].join(" · "));
  const proposal = product.mapped === false ? mappingOf(mapped, product.id) : null;

  return (
    <>
      <Remember kind="product" id={product.id} title={product.name} />
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/products", label: t("Products") }]} />}
        title={product.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Sku>{product.sku}</Sku>
            {product.category && <span>{[product.category, product.subcategory].filter(Boolean).join(" › ")}</span>}
            {family && (
              <span>
                {t("Family")}{" "}
                <Link href={`/products?show=all&q=${encodeURIComponent(family.name)}`} className="font-medium text-ink-2 hover:underline">
                  {family.name}
                </Link>
                {product.variant && ` · ${product.variant}`}
              </span>
            )}
            <span>{t("bought per {unit}", { unit: product.unit })}</span>
            <KindSelect productId={product.id} kind={kindOf(product)} />
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/sourcing/${product.id}`}>{t("Market and alternative suppliers")}</ButtonLink>
            <ProductDialog
              product={product}
              deleteNote={t("Also deletes {purchases} and {quotes}.", { purchases: t.n(history.length, "{n} purchase", "{n} purchases"), quotes: t.n(productQuotes.length, "{n} quote", "{n} quotes") })}
              trigger={{ label: t("Edit"), variant: "ghost" }}
            />
            <PurchaseDialog defaultProductId={product.id} trigger={{ label: t("Add purchase") }} />
          </>
        }
      />

      {pi?.highSpend && (
        <section className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-ledger/25 bg-ledger-wash/30 px-5 py-4">
          <div className="min-w-[240px] flex-1">
            <div className="text-[14.5px] font-semibold">{t("Are you buying this well?")}</div>
            <p className="mt-0.5 max-w-[70ch] text-[13px] text-ink-2">
              {lastResearch
                ? t("Last researched on {date}. Open the market page for the suppliers found, the evidence and the next step.", { date: f.date(lastResearch.startedAt.slice(0, 10)) })
                : t("One of the products that weigh most on your spend. A research looks for who else could supply it and what price evidence exists — and says so when there is none.")}
            </p>
          </div>
          <DeepResearchButton productId={product.id} researched={!!lastResearch} goTo={`/sourcing/${product.id}`} />
        </section>
      )}

      {/* The answer first: where this product stands, what is at stake, what to check. */}
      <ProductSummary d={d} columns={compareColumns(pi, intel.config, t)} />

      {/* Not only what is paid: what could realistically be paid, and why. */}
      {negotiation && <NegotiationCard n={negotiation} history={estimates} t={t} className="mt-5" />}

      <ProductDataPanel
        profile={profile}
        documents={{ linked: linkedDocs, onFile: onFile.filter((x) => !linkedDocs.some((l) => l.documentId === x.documentId)) }}
        open={query.complete === "1"}
        next={after ? { href: `/products/${after.intel.product.id}?complete=1&review=1#product-data`, name: after.intel.product.name } : query.review ? { href: "/products/data", name: t("back to the Top 5") } : null}
      />
      <AllProductData profile={profile} t={t} />

      <Disclosure
        className="mt-6"
        title={t("What this product is")}
        description={
          product.mapped === false
            ? t("Not confirmed yet: its name and category still come from the invoice.")
            : [product.category, product.subcategory, family?.name].filter(Boolean).join(" › ") || t("Name, category, family and variant.")
        }
        defaultOpen={product.mapped === false}
      >
        <div className="space-y-4">
          {proposal && (
            <p className="text-[13px] text-ink-2">
              {proposal.category
                ? t("We read it as “{name}”, in {category}.", { name: proposal.name, category: [proposal.category, proposal.subcategory].filter(Boolean).join(" › ") })
                : t("Nothing in the name says what this is.")}{" "}
              <Link href="/products/review" className="font-medium text-ledger hover:underline">
                {t("Open the Product Mapper")}
              </Link>
            </p>
          )}
          {attributes.length > 0 && (
            <div>
              <Label>{t("Read from the name")}</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {attributes.map((a) => (
                  <span key={a.key} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-wash px-2.5 text-[12px] text-ink-2">
                    {t(ATTRIBUTE_LABEL[a.key])} <span className="font-medium text-ink">{a.value}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {siblings.length > 0 && (
            <div>
              <Label>{t.n(siblings.length, "{n} other variant of {family}", "{n} other variants of {family}", { family: family!.name })}</Label>
              <ul className="mt-1.5 flex flex-wrap gap-1.5 text-[12.5px]">
                {siblings.slice(0, 12).map((x) => (
                  <li key={x.product.id}>
                    <Link href={`/products/${x.product.id}`} className="inline-flex h-6 items-center rounded-full border border-rule-strong px-2.5 text-ink-2 hover:bg-wash">
                      {x.product.variant || x.product.name}
                    </Link>
                  </li>
                ))}
                {siblings.length > 12 && <li className="self-center text-ink-3">{t("and {n} more", { n: siblings.length - 12 })}</li>}
              </ul>
            </div>
          )}
          <MappingEditor
            productId={product.id}
            values={{ name: product.name, kind: kindOf(product), category: product.category ?? "", subcategory: product.subcategory ?? "", family: family?.name ?? "", variant: product.variant ?? "" }}
            categories={[...new Set([...TAXONOMY.map((c) => t(c.label)), ...l.categories])]}
            subcategories={TAXONOMY.flatMap((c) => c.subs.map((s) => t(s.label)))}
            families={[...families.values()].map((x) => x.name)}
          />
        </div>
      </Disclosure>

      {/* Prices that look wrong need a decision before anything else is trusted. */}
      {(price.outliers.length > 0 || excluded.length > 0) && (
        <Section
          className="mt-6"
          title={
            <>
              {t("Prices to double-check")} <Hint text={EXPLAIN.outlier} />
            </>
          }
          description={t("Far from your usual level. Nothing is removed unless you say so.")}
          flush
        >
          <ul className="border-t border-rule">
            {price.outliers.map((o) => {
              const p = history.find((x) => x.id === o.purchaseId)!;
              return (
                <li key={o.purchaseId} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-5 py-3 last:border-b-0">
                  <AlertTriangle size={15} className="text-caution" />
                  <div className="min-w-[240px] flex-1 text-[13px]">
                    {rich(t("{price} on {date} from {supplier} — {pct} vs the usual {median}", { date: f.date(o.date), supplier: l.supplierName(o.supplierId) }), {
                      price: <span className="num font-medium">{f.price(o.price)}</span>,
                      pct: <span className="num">{f.pct(o.deviationPct, 0)}</span>,
                      median: <span className="num">{f.price(o.median)}</span>,
                    })}
                  </div>
                  <OutlierActions purchaseId={o.purchaseId} />
                  <PurchaseDialog purchase={p} trigger={{ label: t("Correct value"), variant: "ghost", size: "sm", plain: true }} />
                </li>
              );
            })}
            {excluded.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-5 py-3 text-[13px] text-ink-3 last:border-b-0">
                <span className="num">{t("{price} on {date}", { price: f.price(p.unitPrice, p.currency), date: f.date(p.date) })}</span>
                {t("left out of the price analysis by you")}
                <RestorePriceButton purchaseId={p.id} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mt-6 space-y-3">
        <Section title={t("Price history")} description={t("What you paid per {unit}, purchase by purchase", { unit: product.unit })} actions={<ExportLink href={`/export/price-history?product=${product.id}`} />}>
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
              source: `${sourceLabel(p.source, t)}${p.invoiceReference ? ` ${p.invoiceReference}` : ""}`,
            }))}
          />
        </Section>

        <Disclosure title={t("Price figures")} description={t("Changes over 3, 6 and 12 months, averages, lowest and highest")}>
          <dl className="grid grid-cols-1 gap-x-10 text-[13px] sm:grid-cols-2">
            <Metric label={t("Previous price")} hint={EXPLAIN.previousPrice}>
              {price.previous ? (
                <span className="num">
                  {f.price(price.previous.price)} <span className="text-ink-3">· {f.date(price.previous.date)}</span>
                </span>
              ) : (
                "—"
              )}
            </Metric>
            <Metric label={t("Trend")} hint={EXPLAIN.trend}>
              <TrendTag trend={price.trend} />
            </Metric>
            <Metric label={t("3 months")} hint={EXPLAIN.change}>
              <Change c={price.changes.m3} t={t} />
            </Metric>
            <Metric label={t("6 months")}>
              <Change c={price.changes.m6} t={t} />
            </Metric>
            <Metric label={t("12 months")}>
              <Change c={price.changes.m12} t={t} />
            </Metric>
            <Metric label={t("Since the first purchase")}>
              <Change c={price.changes.all} t={t} />
            </Metric>
            <Metric label={t("Average price paid")} hint={EXPLAIN.weightedAverage}>
              <span className="num font-medium">{f.price(price.weightedAveragePrice)}</span>
            </Metric>
            <Metric label={t("Today vs your average")} hint={EXPLAIN.premium}>
              <Delta value={price.premiumVsAveragePct} />
            </Metric>
            <Metric label={t("Lowest paid")} hint={EXPLAIN.lowHigh}>
              {price.low ? (
                <span className="num">
                  {f.price(price.low.price)} <span className="text-ink-3">· {f.month(price.low.date, t)}</span>
                </span>
              ) : (
                "—"
              )}
            </Metric>
            <Metric label={t("Highest paid")}>
              {price.high ? (
                <span className="num">
                  {f.price(price.high.price)} <span className="text-ink-3">· {f.month(price.high.date, t)}</span>
                </span>
              ) : (
                "—"
              )}
            </Metric>
          </dl>
          {price.distribution && price.current && (
            <div className="mt-5 border-t border-rule pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
                {t("Where today's price sits among all prices paid")} <Hint text={EXPLAIN.distribution} />
              </div>
              <Distribution d={price.distribution} current={price.current.price} t={t} />
            </div>
          )}
        </Disclosure>

        {price.timeline.length > 1 && (
          <Disclosure
            title={t("Price changes over time")}
            description={price.timeline.length > TIMELINE_MAX ? t("Last {n} of {total} changes", { n: TIMELINE_MAX, total: price.timeline.length }) : t.n(price.timeline.length - 1, "{n} change", "{n} changes")}
          >
            <ol className="flex flex-wrap gap-x-2 gap-y-4">
              {timeline.map((e, i) => (
                <li key={e.purchaseId} className="flex items-center gap-2">
                  {i > 0 && <span className="text-ink-4" aria-hidden>→</span>}
                  <div className="rounded-md border border-rule px-3 py-2">
                    <div className="text-[12px] text-ink-3">{f.month(e.date, t)}</div>
                    <div className="num text-[15px] font-semibold">{f.price(e.price)}</div>
                    <div className="h-[18px] text-[12px]">{e.pct != null ? <Delta value={e.pct} /> : <span className="text-ink-4">{t("first price")}</span>}</div>
                    {pi.concentration.shares.length > 1 && <div className="max-w-[120px] truncate text-[11.5px] text-ink-3">{l.supplierName(e.supplierId)}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Disclosure>
        )}

        {pi.opportunities.length > 0 && (
          <Disclosure title={t("Opportunities")} description={t("{n} found for this product", { n: pi.opportunities.length })} flush>
            <ul>
              {pi.opportunities.map((o) => (
                <li key={o.key} className="relative border-b border-rule last:border-b-0 hover:bg-well">
                  <Link href={`/opportunities/${o.key}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <div className="min-w-[220px] flex-1">
                      <div className="text-[13.5px] font-medium">
                        {t(OPPORTUNITY_LABEL[o.type])}
                        {o.alternativeSupplierId && <span className="font-normal text-ink-2"> · {l.supplierName(o.alternativeSupplierId)}</span>}
                      </div>
                      <div className="text-[12.5px] text-ink-3">{o.reason}</div>
                    </div>
                    {o.impact != null && (
                      <span className="num text-right text-[13px]">
                        <span className="font-semibold">{t("{amount}/yr", { amount: f.moneyApprox(o.impact) })}</span>
                        <span className="block text-[11.5px] text-ink-3">{o.potentialSaving != null ? t("potential saving") : t("price impact")}</span>
                      </span>
                    )}
                    {o.confidence && <ConfidenceBadge level={o.confidence} />}
                    <OpportunityStatusBadge status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        <Disclosure title={t("Purchase history")} description={t.n(history.length, "{n} purchase", "{n} purchases")} flush>
          {history.length === 0 ? (
            <Empty title={t("No purchases yet")} body={t("Add the first one, or import your invoices.")} action={<PurchaseDialog defaultProductId={product.id} trigger={{ label: t("Add purchase"), variant: "primary" }} />} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th className="border-t-0">{t("Date")}</Th>
                    <Th className="border-t-0">{t("Supplier")}</Th>
                    <Th className="border-t-0" align="right">{t("Quantity")}</Th>
                    <Th className="border-t-0" align="right">{t("Unit price")}</Th>
                    <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Total")}</Th>
                    <Th className="hidden border-t-0 @4xl:table-cell">{t("Source")}</Th>
                    <Th className="w-10 border-t-0" />
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
                        {p.priceReview === "excluded" && <span className="ml-1.5 text-[11.5px] font-normal text-ink-3">{t("left out")}</span>}
                        {!isPriced(p) && <span className="ml-1.5 text-[11.5px] font-normal text-caution">{t("no exchange rate")}</span>}
                      </Td>
                      <Td align="right" className="hidden @2xl:table-cell">
                        {f.money(p.totalAmount, p.currency)}
                      </Td>
                      <Td className="hidden @4xl:table-cell">
                        <SourceTag source={p.source} doc={p.sourceDoc} />
                        {p.invoiceReference && <span className="ml-1.5 text-[12px] text-ink-3">{p.invoiceReference}</span>}
                      </Td>
                      <Td>
                        <PurchaseDialog purchase={p} trigger={{ label: t("Edit purchase"), iconOnly: true }} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="border-t border-rule px-5 py-2.5">
                <Link href={`/purchases?product=${product.id}`} className="text-[13px] font-medium text-ledger hover:underline">
                  {t("Open in Purchases")}
                </Link>
              </div>
            </>
          )}
        </Disclosure>

        <Disclosure
          title={t("Suppliers and data quality")}
          description={
            pi.concentration.shares.length === 0
              ? t("No suppliers used · data confidence {~level}", { level: CONFIDENCE_WORD[pi.quality.level] })
              : t.n(pi.concentration.shares.length, "{n} supplier used · data confidence {~level}", "{n} suppliers used · data confidence {~level}", { level: CONFIDENCE_WORD[pi.quality.level] })
          }
        >
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
                {t("Who you buy it from")} <Hint text={EXPLAIN.concentration} />
                {pi.concentration.sourcing !== "none" && <SourcingBadge sourcing={pi.concentration.sourcing} />}
              </div>
              {pi.concentration.shares.length === 0 ? (
                <p className="text-[13px] text-ink-3">{t("No purchases yet.")}</p>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {pi.concentration.shares.map((s) => (
                    <li key={s.supplierId} className="flex items-baseline justify-between gap-4">
                      <Link href={`/suppliers/${s.supplierId}`} className="hover:text-ledger">
                        {l.supplierName(s.supplierId)}
                      </Link>
                      <span className="num text-ink-2">
                        <span className="font-medium text-ink">{f.number(s.share * 100, 0)}%</span> · {f.money(Math.round(s.spend))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
                {t("How far to trust these figures")} <Hint text={EXPLAIN.dataQuality} /> <QualityBadge level={pi.quality.level} />
              </div>
              <ul className="space-y-1.5 text-[13px]">
                {pi.quality.factors.map((q) => (
                  <li key={q.label} className="flex items-baseline justify-between gap-4">
                    <span className="text-ink-3">{q.label}</span>
                    <span className={cx("text-right", q.state === "ok" ? "text-ink-2" : "text-caution")}>{q.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Disclosure>

        <Disclosure title={t("Where the data comes from")} description={t("Documents, and the names this product is recognised by")}>
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <Label>{t("Records by source")}</Label>
            {sourceCounts.size === 0 ? (
              <p className="mt-1 text-[13px] text-ink-3">{t("No purchases or quotes yet.")}</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {[...sourceCounts.entries()].map(([src, n]) => (
                  <li key={src} className="flex justify-between gap-4">
                    <span className="text-ink-2">{sourceLabel(src, t)}</span>
                    <span className="num text-ink-3">{n}</span>
                  </li>
                ))}
              </ul>
            )}
            {docs.size > 0 && (
              <>
                <div className="mt-4">
                  <Label>{t("Documents")}</Label>
                </div>
                <ul className="mt-1.5 space-y-1 text-[13px]">
                  {[...docs.values()].map((d) => (
                    <li key={d.sessionId} className="flex items-center justify-between gap-3">
                      <Link href={`/import/${d.sessionId}`} className="min-w-0 truncate hover:text-ledger" title={d.filename}>
                        {d.filename}
                      </Link>
                      {d.documentId && (
                        <a href={`/documents/${d.documentId}`} target="_blank" className="shrink-0 text-[12px] font-medium text-ledger hover:underline">
                          {t("View")}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <Label>{t("Written on the invoices as")}</Label>
            {aliases.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-3">{t("Names confirmed during imports appear here and are recognised automatically next time.")}</p>
            ) : (
              <Aliases aliases={aliases} supplierName={l.supplierName} t={t} />
            )}
          </div>
          <div>
            <Label>{t("Supplier codes")}</Label>
            {codes.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-3">{t("How each supplier codes this product, learned from their documents.")}</p>
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
        </Disclosure>

      {(product.description || product.technicalSpecifications || product.specs) && (
        <Disclosure title={t("Specifications")}>
          <div className="grid gap-6 sm:grid-cols-2">
            {product.specs && (
              <div>
                <Label>{t("Specifications")}</Label>
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
                <Label>{t("Description")}</Label>
                <p className="mt-1 text-[13.5px] text-ink-2">{product.description}</p>
              </div>
            )}
            {product.technicalSpecifications && (
              <div>
                <Label>{t("Technical notes")}</Label>
                <p className="mt-1 text-[13.5px] whitespace-pre-line text-ink-2">{product.technicalSpecifications}</p>
              </div>
            )}
          </div>
        </Disclosure>
      )}
      </div>
    </>
  );
}

/** Every field of the product's data, with its status, its source and — for estimates — the method: the dataset as it is stored and computed. */
function AllProductData({ profile, t }: { profile: ProductProfile; t: T }) {
  const sections: DataSection[] = ["identity", "technical", "purchasing", "commercial", "quality"];
  return (
    <Disclosure className="mt-3" title={t("All product data")} description={t("Every field with its status and source")} flush>
      {sections.map((s) => (
        <div key={s} className="border-b border-rule px-5 py-3 last:border-b-0">
          <div className="mb-1.5 text-[12px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{t(SECTION_LABEL[s])}</div>
          <dl className="divide-y divide-rule text-[13px]">
            {FIELD_KEYS.filter((k) => FIELDS[k].section === s).map((k) => {
              const x = profile.fields[k];
              return (
                <div key={k} className="grid gap-x-4 gap-y-0.5 py-2 @2xl:grid-cols-[200px_1fr]">
                  <dt className="text-ink-3">{t(FIELDS[k].label)}</dt>
                  <dd className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FieldStatusTag status={x.status} />
                      <span className={cx("break-words", x.display ? "" : "text-ink-4")}>{x.display ?? "—"}</span>
                    </div>
                    <FieldProvenance field={x} />
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </Disclosure>
  );
}

function Metric({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-rule py-2">
      <dt className="flex items-center gap-1.5 text-ink-3">
        {label} {hint && <Hint text={hint} />}
      </dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

function Change({ c, t }: { c: WindowChange; t: T }) {
  if (c.pct == null) return <span className="text-ink-4">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      {c.partial && <span className="text-[11.5px] text-ink-4">{t("since {month}", { month: f.month(c.referenceDate, t) })}</span>}
      <Delta value={c.pct} />
    </span>
  );
}

/** Where the current price sits among all prices paid. */
function Distribution({ d, current, t }: { d: { min: number; p25: number; median: number; p75: number; max: number }; current: number; t: T }) {
  const span = d.max - d.min || 1;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - d.min) / span) * 100))}%`;
  const stats: [label: string, value: number, now?: boolean][] = [
    [t("Minimum"), d.min],
    [t("25th percentile"), d.p25],
    [t("Median"), d.median],
    [t("75th percentile"), d.p75],
    [t("Maximum"), d.max],
    [t("Current"), current, true],
  ];
  return (
    <div>
      <div className="relative mx-1 h-8" role="img" aria-label={t("Price distribution")}>
        <div className="absolute top-1/2 right-0 left-0 h-px bg-rule-strong" />
        <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-ink/15" style={{ left: at(d.p25), width: `calc(${at(d.p75)} - ${at(d.p25)})` }} />
        <div className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-ink-2" style={{ left: at(d.median) }} />
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-canvas bg-ledger" style={{ left: at(current) }} title={t("Current price")} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, v, now]) => (
          <div key={label}>
            <dt className="text-[12px] text-ink-3">{label}</dt>
            <dd className={cx("num", now ? "font-semibold text-ledger" : "font-medium")}>{f.price(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const kindOf = (p: ProductData): ProductKind => (isProductKind(p.kind) ? p.kind : "needs_review");

/** Every way a supplier writes the product, as on the documents, with the supplier's own code. */
function Aliases({ aliases, supplierName, t, max = 24 }: { aliases: Learning["productAliases"]; supplierName: (id: string) => string; t: T; max?: number }) {
  return (
    <ul className="mt-1.5 space-y-1 text-[12.5px]">
      {aliases.slice(0, max).map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-wash px-2 py-1">
          <span className="min-w-0 break-words text-ink-2">{a.alias}</span>
          <span className="text-[11.5px] text-ink-4">
            {[a.supplierId ? supplierName(a.supplierId) : null, a.supplierSku ? t("Supplier code {code}", { code: a.supplierSku }) : null, a.ean ? `EAN ${a.ean}` : null].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
      {aliases.length > max && <li className="text-ink-3">{t("and {n} more", { n: aliases.length - max })}</li>}
    </ul>
  );
}

/**
 * An item of spend that is not a product to compare: what was spent, with
 * whom, and every invoice line behind it. No price analysis here — a
 * transport line's "price" says nothing about the next one.
 */
function SpendItem({ product, data, learning, t }: { product: ProductData; data: Dataset; learning: Learning; t: T }) {
  const l = lookups(data);
  const lines = data.purchases.filter((p) => p.productId === product.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = lines.filter(isPriced).reduce((s, p) => s + baseTotal(p), 0);
  const suppliers = [...new Set(lines.map((p) => p.supplierId))];
  const aliases = learning.productAliases.filter((a) => a.productId === product.id);
  const kind = kindOf(product);
  const MAX = 200;
  return (
    <>
      <Remember kind="product" id={product.id} title={product.name} />
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/products", label: t("Products") }]} />}
        title={product.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t("Other company spend")}</span>
            <KindSelect productId={product.id} kind={kind} />
          </span>
        }
        actions={<ProductDialog product={product} deleteNote={t("Also deletes {purchases} and {quotes}.", { purchases: t.n(lines.length, "{n} purchase", "{n} purchases"), quotes: t.n(0, "{n} quote", "{n} quotes") })} trigger={{ label: t("Edit"), variant: "ghost" }} />}
      />
      <div className="mb-6 rounded-xl border border-rule px-5 py-4 sm:px-6">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <div className="num text-[24px] leading-none font-semibold tracking-[-0.02em]">{f.money(Math.round(total))}</div>
            <div className="mt-1.5 text-[12.5px] text-ink-3">{t("spent in total")}</div>
          </div>
          <div>
            <div className="num text-[24px] leading-none font-semibold tracking-[-0.02em]">{lines.length}</div>
            <div className="mt-1.5 text-[12.5px] text-ink-3">{t("invoice lines")}</div>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] leading-[24px] font-medium">{suppliers.map((sid) => l.supplierName(sid)).join(", ") || "—"}</div>
            <div className="mt-1.5 text-[12.5px] text-ink-3">{t("Supplier")}</div>
          </div>
        </div>
        <p className="mt-4 max-w-[72ch] text-[13px] text-ink-3">
          {t("{~kind}: it counts in the company's spend, but is not compared and negotiated as a product. If it is a material, a component or packaging, change what it is above and it moves to the catalogue.", { kind: KIND_LABEL[kind] })}
        </p>
      </div>

      <Section title={t("Invoice lines")}>
        <Table>
          <thead>
            <tr>
              <Th>{t("Date")}</Th>
              <Th>{t("Written on the invoice as")}</Th>
              <Th className="hidden @3xl:table-cell">{t("Supplier")}</Th>
              <Th className="hidden @2xl:table-cell" align="right">{t("Quantity")}</Th>
              <Th align="right">{t("Total")}</Th>
              <Th className="hidden @4xl:table-cell">{t("Source")}</Th>
            </tr>
          </thead>
          <tbody>
            {lines.slice(0, MAX).map((p) => (
              <tr key={p.id} className={rowClass(false)}>
                <Td className="num whitespace-nowrap">{f.date(p.date)}</Td>
                <Td className="max-w-[420px] whitespace-normal!">{p.originalDescription ?? "—"}</Td>
                <Td muted className="hidden @3xl:table-cell">
                  {l.supplierName(p.supplierId)}
                </Td>
                <Td align="right" muted className="num hidden @2xl:table-cell">
                  {f.number(p.quantity)} {p.unit}
                </Td>
                <Td align="right" className="num font-medium">
                  {f.money(p.totalAmount, p.currency)}
                </Td>
                <Td className="hidden @4xl:table-cell">
                  <SourceTag source={p.source} doc={p.sourceDoc} />
                  {p.invoiceReference && <span className="ml-1.5 text-[12px] text-ink-3">{p.invoiceReference}</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {lines.length > MAX && <p className="px-5 py-3 text-[12.5px] text-ink-3">{t("Showing the latest {shown} of {total} lines. All of them are under Purchases.", { shown: MAX, total: lines.length })}</p>}
      </Section>

      {aliases.length > 0 && (
        <Disclosure title={t("Written on the invoices as")} description={t.n(aliases.length, "{n} description", "{n} descriptions")}>
          <Aliases aliases={aliases} supplierName={l.supplierName} t={t} max={60} />
        </Disclosure>
      )}
    </>
  );
}
