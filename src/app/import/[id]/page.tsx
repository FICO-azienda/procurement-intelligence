import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ArrowRight, FileText } from "lucide-react";
import { getDb } from "@/db";
import { ImportStatusBadge, fileKindLabel } from "@/components/import/labels";
import { MappingForm } from "@/components/import/mapping-form";
import {
  ApproveBar,
  DocumentDetails,
  DuplicateBanner,
  LinesPanel,
  MatchDecisions,
  MatchGroupsPanel,
  ReclassifyButton,
  ReopenColumnsButton,
  type LineVM,
} from "@/components/import/review";
import { ButtonLink, Crumbs, Delta, Disclosure, PageHeader, cx } from "@/components/ui";
import { ProductAnalysis, type AnalysisVM, type DraftVM } from "@/components/import/analysis";
import { getDataset, getIntel, getT } from "@/lib/data";
import type { Draft } from "@/lib/catalog/propose";
import { analyzeSession } from "@/server/catalog";
import * as f from "@/lib/format";
import { said, type T } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
import { FIELD_LABEL, proposeMapping, type ColumnMapping } from "@/lib/import/fields";
import { buildGroups } from "@/lib/import/groups";
import type { MatchResult } from "@/lib/import/match";
import type { CurrentData, ExtractedData, Issue, RecordType } from "@/lib/import/types";
import {
  getSession,
  getSessionItems,
  type ImportSummary,
  type MappingInfo,
  type PdfSessionExtraction,
  type SpreadsheetExtraction,
} from "@/server/imports";

export async function generateMetadata({ params }: PageProps<"/import/[id]">): Promise<Metadata> {
  const { id } = await params;
  await connection();
  const s = await getSession(await getDb(), id).catch(() => null);
  return { title: s?.filename ?? (await getT())("Import|nav") };
}

const when = (d: Date) => d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ImportSessionPage({ params }: PageProps<"/import/[id]">) {
  const { id } = await params;
  await connection();
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await getSession(db, id);
  if (!session) notFound();
  const [items, data, t] = await Promise.all([getSessionItems(db, id), getDataset(), getT()]);
  const num = (n: number, tone: string) => <span className={cx("num font-semibold", tone)}>{n}</span>;
  const previous = session.duplicateOfSessionId ? await getSession(db, session.duplicateOfSessionId) : null;
  const isPdf = session.fileType === "pdf";
  /** One document with a header (a PDF, an electronic invoice), as opposed to a table of rows. */
  const isDocument = isPdf || session.fileType === "xml";
  const recordType = session.recordType as RecordType;

  const header = (
    <PageHeader
      eyebrow={<Crumbs items={[{ href: "/import", label: t("Import|nav") }]} />}
      title={<span className="break-all">{session.filename}</span>}
      meta={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{fileKindLabel(session.fileType, session.sourceType, t)}</span>
          <span>{t("Uploaded {date}", { date: when(session.uploadedAt) })}</span>
          <ImportStatusBadge status={session.status} attention={session.recordsReview} />
        </span>
      }
      actions={
        session.documentId && (
          <ButtonLink href={`/documents/${session.documentId}`} target="_blank">
            <FileText size={14} /> {t("View original")}
          </ButtonLink>
        )
      }
    />
  );

  // ---------- Failed ----------
  if (session.status === "failed") {
    return (
      <>
        {header}
        <div className="rounded-lg border border-up/20 bg-up-wash px-5 py-4">
          <div className="font-semibold text-up">{t("We couldn't import this file")}</div>
          <p className="mt-1 text-[13.5px] text-ink-2">{session.errorMessage ? t.any(session.errorMessage) : null}</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ButtonLink href="/import" variant="primary">
            {t("Upload another file")}
          </ButtonLink>
          {isPdf && (
            <span className="text-[13px] text-ink-3">
              {t("Wrong kind of document?")} <ReclassifyButton sessionId={id} to={recordType === "quote" ? "invoice" : "quote"} />
            </span>
          )}
        </div>
      </>
    );
  }

  // ---------- Column mapping ----------
  if (session.status === "uploaded" || session.status === "processing") {
    const ex = session.extraction as SpreadsheetExtraction | null;
    const mapping = session.mapping as MappingInfo | null;
    return (
      <>
        {header}
        {previous && (
          <DuplicateBanner sessionId={id} mode="file" previousHref={`/import/${previous.id}`} previousDate={when(previous.uploadedAt)} isPdf={false} />
        )}
        {ex && mapping ? (
          <MappingForm
            sessionId={id}
            headers={ex.headers}
            sample={ex.sample}
            rowCount={ex.rowCount}
            headerless={ex.headerless}
            initial={{ columns: mapping.columns as ColumnMapping, recordType: mapping.recordType, defaultCurrency: mapping.defaultCurrency }}
            suggested={ex.headerless ? undefined : proposeMapping(ex.headers)}
          />
        ) : (
          <p className="text-ink-3">{t("Reading the file…")}</p>
        )}
      </>
    );
  }

  // ---------- Review / completed ----------
  const supplierName = (sid: string | null) => data.suppliers.find((s) => s.id === sid)?.name ?? null;
  const productName = (pid: string | null) => data.products.find((p) => p.id === pid)?.name ?? null;
  const groups = buildGroups(
    items.map((i) => ({
      data: i.data as CurrentData,
      status: i.status,
      supplierId: i.supplierId,
      supplierMatch: i.supplierMatch as MatchResult | null,
      supplierResolution: i.supplierResolution,
      productId: i.productId,
      productMatch: i.productMatch as MatchResult | null,
      productResolution: i.productResolution,
    })),
    data,
    t,
  );
  const lines: LineVM[] = items.map((i) => {
    const d = i.data as CurrentData;
    return {
      id: i.id,
      line: i.line,
      status: i.status,
      recordType: i.recordType as RecordType,
      data: d,
      extracted: i.extracted as ExtractedData,
      raw: i.raw as Record<string, string>,
      supplierLabel: supplierName(i.supplierId) ?? d.supplierName ?? "—",
      productLabel: d.productName ?? d.description ?? d.supplierSku ?? d.sku ?? "—",
      productMatched: productName(i.productId),
      issues: i.issues as Issue[],
      acknowledged: i.acknowledged,
    };
  });
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const attention = items.filter((i) => i.status === "attention");
  const flaggedOnly = attention.filter((i) => !(i.issues as Issue[]).some((x) => x.severity === "blocking")).length;
  const duplicates = attention.filter((i) => (i.issues as Issue[]).some((x) => x.code === "duplicate")).length;
  const summary = session.summary as ImportSummary | null;
  const open = count("ready") + count("attention");
  const reviewOnly = attention.length - duplicates;
  const recognised = [...groups.suppliers, ...groups.products].filter((g) => g.state === "matched").length;
  const supplierOptions = data.suppliers.map(({ id, name }) => ({ id, name }));
  const productOptions = data.products.map(({ id, name, sku }) => ({ id, name: `${name} · ${sku}` }));
  const mappingInfo = isDocument ? null : (session.mapping as MappingInfo | null);
  // In the file's own column order (stored JSON does not keep it).
  const fileHeaders = (session.extraction as SpreadsheetExtraction | null)?.headers ?? [];
  const mapped = mappingInfo
    ? fileHeaders
        .map((h) => mappingInfo.columns[h])
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((k) => t(FIELD_LABEL[k]))
        .slice(0, 7)
    : [];
  // The first useful thing an import says: how the prices of what was just loaded have moved.
  const loaded = new Set(items.filter((i) => i.status === "imported" && i.productId).map((i) => i.productId!));
  const movers =
    recordType === "purchase" && loaded.size > 0
      ? (await getIntel()).products
          .filter((p) => loaded.has(p.product.id) && p.price.changes.m12.pct != null && Math.abs(p.price.changes.m12.pct) >= 0.05)
          .sort((a, b) => Math.abs(b.price.changes.m12.pct!) - Math.abs(a.price.changes.m12.pct!))
          .slice(0, 3)
      : [];

  const ex = isDocument ? (session.extraction as PdfSessionExtraction | null) : null;
  const first = items[0]?.data as CurrentData | undefined;

  // Lines without a product: what they are, what can be confirmed together, what needs a person.
  const proposal = open > 0 ? await analyzeSession(db, id, t) : null;
  const draftVM = (d: Draft): DraftVM => ({
    key: d.key,
    name: d.name,
    kind: d.kind,
    strategic: d.strategic,
    unit: d.unit,
    reason: d.reason ? t(d.reason) : null,
    descriptions: d.mentions.flatMap((m) => m.texts).slice(0, 12),
    descriptionCount: d.descriptions,
    lines: d.lines,
    amount: d.amount,
    suppliers: d.supplierIds.map((sid) => supplierName(sid) ?? "").filter(Boolean),
    canSplit: d.strategic && d.mentions.length > 1,
  });
  const analysis: AnalysisVM | null =
    proposal && proposal.confident.length + proposal.questions.length > 0
      ? {
          descriptions: proposal.descriptions,
          grouped: proposal.grouped,
          products: proposal.products,
          otherSpend: proposal.otherSpend,
          confident: proposal.confident.map(draftVM),
          confidentLines: proposal.confident.reduce((n, d) => n + d.lines, 0),
          confidentAmount: proposal.confident.reduce((n, d) => n + d.amount, 0),
          questions: proposal.questions.map((q) => ({
            key: q.key,
            type: q.type,
            reason: t(q.reason, q.params),
            suggestion: q.suggestion,
            mergedName: q.mergedName,
            drafts: q.drafts.map(draftVM),
            lines: q.lines,
            amount: q.amount,
            suppliers: q.supplierIds.map((sid) => supplierName(sid) ?? "").filter(Boolean),
          })),
        }
      : null;
  // Lines set aside because they are not purchases, with the reason of each.
  const setAside = new Map<string, number>();
  for (const i of items) {
    if (i.status !== "skipped") continue;
    const why = (i.issues as Issue[]).find((x) => x.excludes);
    if (why) setAside.set(said(t, why), (setAside.get(said(t, why)) ?? 0) + 1);
  }

  return (
    <>
      {header}

      {previous && open > 0 && (
        <DuplicateBanner sessionId={id} mode="file" previousHref={`/import/${previous.id}`} previousDate={when(previous.uploadedAt)} isPdf={isDocument} />
      )}
      {!previous && duplicates > 0 && duplicates === attention.length && open === attention.length && (
        <DuplicateBanner sessionId={id} mode="lines" isPdf={isDocument} />
      )}

      {summary && summary.imported > 0 && <SummaryCard summary={summary} recordType={recordType} open={open} t={t} />}

      {summary && summary.imported > 0 && summary.priceChanges.length === 0 && movers.length > 0 && (
        <section aria-label={t("What your data already says")} className="mb-6 rounded-lg border border-rule px-5 py-4">
          <h2 className="text-[14px] font-semibold">{t("What your data already says")}</h2>
          <ul className="mt-2 divide-y divide-rule">
            {movers.map((p) => {
              const c = p.price.changes.m12;
              return (
                <li key={p.product.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[13.5px]">
                  <Link href={`/products/${p.product.id}`} className="min-w-[180px] flex-1 font-medium hover:text-ledger">
                    {p.product.name}
                  </Link>
                  <span className="text-ink-3">
                    {t(c.pct! > 0 ? "up since {month}:" : "down since {month}:", { month: f.month(c.referenceDate, t) })} <span className="num">{f.priceShort(c.referencePrice)}</span> → <span className="num font-medium text-ink">{f.priceShort(p.price.current?.price)}</span>/{p.product.unit}
                  </span>
                  <Delta value={c.pct} className="w-16 justify-end" />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {open > 0 && (
        <div className="mb-6">
          <div className="text-[22px] font-semibold tracking-[-0.02em]">
            {recordType === "quote" ? t.n(items.length, "{n} quote line found", "{n} quote lines found") : t.n(items.length, "{n} purchase line found", "{n} purchase lines found")}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
            <span>{rich(t("{n} ready"), { n: num(count("ready"), "text-down") })}</span>
            {reviewOnly > 0 && <span>{rich(t(reviewOnly === 1 ? "{n} needs review" : "{n} need review"), { n: num(reviewOnly, "text-caution") })}</span>}
            {duplicates > 0 && <span>{rich(t(duplicates === 1 ? "{n} duplicate" : "{n} duplicates"), { n: num(duplicates, "text-ink-2") })}</span>}
            {count("imported") > 0 && <span className="text-ink-3">{t("{n} already imported", { n: count("imported") })}</span>}
            {count("skipped") > 0 && <span className="text-ink-3">{t.n(count("skipped"), "{n} set aside", "{n} set aside")}</span>}
          </div>
          {setAside.size > 0 && (
            <p className="mt-1.5 text-[12.5px] text-ink-3">
              {t("Set aside because they are not purchases:")} {[...setAside.entries()].map(([why, n]) => `${n} × ${why}`).join(" · ")}. {t("They are listed under Skipped, and can be brought back.")}
            </p>
          )}
          <p className="mt-2 text-[13px] text-ink-3">
            {count("attention") > 0 ? t("Answer the questions below; the ready lines can be imported right away.") : t("Nothing to check: import them when you are ready.")} {t("Nothing is saved until you do.")}
            {mappingInfo && count("imported") === 0 && (
              <>
                {" "}
                {mappingInfo.auto && t("Columns recognised by their names ({names}).", { names: mapped.join(", ") })} <ReopenColumnsButton sessionId={id} />
              </>
            )}
            {isPdf && (
              <>
                {" "}
                {recordType === "quote" ? t("Read as a quote.") : t("Read as an invoice.")} <ReclassifyButton sessionId={id} to={recordType === "quote" ? "invoice" : "quote"} />
              </>
            )}
            {session.fileType === "xml" && <> {t("Electronic invoice: every value comes from the file's own fields.")}</>}
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* The questions: one per supplier or product we are not sure about */}
        {open > 0 && (
          <>
            <MatchDecisions sessionId={id} kind="supplier" groups={groups.suppliers} options={supplierOptions} />
            {/* Products nobody knows yet are analysed together below; here only the suggestions to confirm. */}
            <MatchDecisions sessionId={id} kind="product" groups={groups.products.filter((g) => g.state !== "unknown")} options={productOptions} />
            {analysis && <ProductAnalysis sessionId={id} analysis={analysis} />}
          </>
        )}

        {ex && first && (
          <DocumentDetails
            sessionId={id}
            kind={ex.kind}
            fields={[
              { label: t("Supplier"), value: first.supplierName, confidence: ex.fields.supplierName?.confidence ?? null },
              { label: t("VAT number"), value: first.supplierVat, confidence: ex.fields.supplierVat?.confidence ?? null },
              { label: ex.kind === "quote" ? t("Quote number") : t("Invoice number"), value: first.invoiceReference, confidence: ex.fields.number?.confidence ?? null },
              { label: t("Date"), value: first.date ? f.date(first.date) : null, confidence: ex.fields.date?.confidence ?? null },
              { label: t("Currency"), value: first.currency, confidence: ex.fields.currency?.confidence ?? null },
              { label: t("Payment terms"), value: first.paymentTermsDays != null ? f.paymentTerms(first.paymentTermsDays, t) : null, confidence: ex.fields.paymentTermsDays?.confidence ?? null },
              ...(ex.kind === "quote"
                ? [
                    { label: t("Valid until"), value: first.validUntil ? f.date(first.validUntil) : null, confidence: ex.fields.validUntil?.confidence ?? null },
                    { label: t("Minimum order"), value: first.moq != null ? f.number(first.moq) : null, confidence: ex.fields.moq?.confidence ?? null },
                    { label: t("Lead time"), value: first.leadTimeDays != null ? f.days(first.leadTimeDays, t) : null, confidence: ex.fields.leadTimeDays?.confidence ?? null },
                    { label: "Incoterm", value: first.incoterm, confidence: ex.fields.incoterm?.confidence ?? null },
                  ]
                : [{ label: t("Freight"), value: ex.fields.freight?.value != null ? f.money(Number(ex.fields.freight.value)) : null, confidence: ex.fields.freight?.confidence ?? null }]),
            ]}
            editableValues={{
              supplierName: first.supplierName ?? "",
              invoiceReference: first.invoiceReference ?? "",
              date: first.date ?? "",
              currency: first.currency ?? "",
              paymentTermsDays: first.paymentTermsDays != null ? String(first.paymentTermsDays) : "",
              validUntil: first.validUntil ?? "",
            }}
          />
        )}

        {open > 0 && recognised > 0 && (
          <Disclosure title={t("Recognised by themselves")} description={t.n(recognised, "{n} supplier or product — nothing to do", "{n} suppliers and products — nothing to do")} flush>
            <MatchGroupsPanel sessionId={id} kind="supplier" groups={groups.suppliers.filter((g) => g.state === "matched")} options={supplierOptions} />
            <div className="border-t border-rule" />
            <MatchGroupsPanel sessionId={id} kind="product" groups={groups.products.filter((g) => g.state === "matched")} options={productOptions} />
          </Disclosure>
        )}

        <LinesPanel lines={lines} />
      </div>

      <ApproveBar sessionId={id} recordType={recordType} ready={count("ready")} attention={count("attention")} flaggedOnly={flaggedOnly} duplicates={duplicates} />
    </>
  );
}

function SummaryCard({ summary: s, recordType, open, t }: { summary: ImportSummary; recordType: RecordType; open: number; t: T }) {
  const increases = s.priceChanges.filter((c) => c.pct > 0);
  const stats: [string, number, string?][] = [
    [recordType === "quote" ? t("quotes detected") : t("purchase lines detected"), s.detected],
    [t("imported"), s.imported, "text-down"],
    [t("need review"), s.needReview, s.needReview ? "text-caution" : undefined],
    [t("duplicates skipped"), s.duplicatesSkipped],
    [t("new products"), s.newProducts],
    [t("new suppliers"), s.newSuppliers],
  ];
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-rule">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-down-wash/60 px-5 py-4">
        <div>
          <div className="text-[18px] font-semibold tracking-[-0.015em]">{open > 0 ? t("Partly imported") : t("Import complete")}</div>
          <div className="text-[13px] text-ink-2">{t("Prices, spend and history are already up to date.")}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.needReview > 0 && (
            <ButtonLink href="/review" variant="secondary">
              {t("Review issues")}
            </ButtonLink>
          )}
          <ButtonLink href="/import">{t("Import more")}</ButtonLink>
          <ButtonLink href="/" variant="primary">
            {t("See your overview")} <ArrowRight size={14} />
          </ButtonLink>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px border-t border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value, cls]) => (
          <div key={label} className="bg-canvas px-5 py-3">
            <dd className={cx("num text-[22px] leading-none font-semibold", value === 0 ? "text-ink-4" : cls)}>{value}</dd>
            <dt className="mt-1 text-[12px] text-ink-3">{label}</dt>
          </div>
        ))}
      </dl>
      {s.priceChanges.length > 0 && (
        <div className="border-t border-rule px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[13px] font-semibold">{t.n(increases.length, "{n} price increase detected", "{n} price increases detected")}</div>
            {s.increaseImpact > 0 && (
              <div className="text-[13px] text-ink-2">
                {t("Estimated annual impact")} <span className="num font-semibold text-up">+{f.money(s.increaseImpact)}</span>
              </div>
            )}
          </div>
          <ul className="mt-2 divide-y divide-rule">
            {s.priceChanges.map((c) => (
              <li key={c.productId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[13px]">
                <Link href={`/products/${c.productId}`} className="min-w-[180px] flex-1 font-medium hover:text-ledger">
                  {c.productName}
                </Link>
                <span className="num text-ink-3">
                  {f.price(c.previousPrice)} → <span className="font-medium text-ink">{f.price(c.newPrice)}</span>/{c.unit}
                </span>
                <Delta value={c.pct} className="w-16 justify-end" />
                <span className="num w-28 text-right text-ink-3">
                  {c.annualImpact >= 0 ? "+" : ""}
                  {t("{amount}/yr", { amount: f.money(c.annualImpact) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
