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
  MatchGroupsPanel,
  type LineVM,
} from "@/components/import/review";
import { ButtonLink, Delta, PageHeader, cx } from "@/components/ui";
import { getDataset } from "@/lib/data";
import * as f from "@/lib/format";
import type { ColumnMapping } from "@/lib/import/fields";
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
  return { title: s?.filename ?? "Import" };
}

const when = (d: Date) => d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ImportSessionPage({ params }: PageProps<"/import/[id]">) {
  const { id } = await params;
  await connection();
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await getSession(db, id);
  if (!session) notFound();
  const [items, data] = await Promise.all([getSessionItems(db, id), getDataset()]);
  const previous = session.duplicateOfSessionId ? await getSession(db, session.duplicateOfSessionId) : null;
  const isPdf = session.fileType === "pdf";
  const recordType = session.recordType as RecordType;
  const noun = recordType === "quote" ? "quote" : "purchase";

  const header = (
    <PageHeader
      eyebrow={
        <Link href="/import" className="hover:text-ink">
          Import
        </Link>
      }
      title={<span className="break-all">{session.filename}</span>}
      meta={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{fileKindLabel(session.fileType, session.sourceType)}</span>
          <span>Uploaded {when(session.uploadedAt)}</span>
          <ImportStatusBadge status={session.status} attention={session.recordsReview} />
        </span>
      }
      actions={
        session.documentId && (
          <ButtonLink href={`/documents/${session.documentId}`} target="_blank">
            <FileText size={14} /> View original
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
          <div className="font-semibold text-up">We couldn&apos;t import this file</div>
          <p className="mt-1 text-[13.5px] text-ink-2">{session.errorMessage}</p>
        </div>
        <div className="mt-4">
          <ButtonLink href="/import" variant="primary">
            Upload another file
          </ButtonLink>
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
            initial={{ columns: mapping.columns as ColumnMapping, recordType: mapping.recordType, defaultCurrency: mapping.defaultCurrency }}
          />
        ) : (
          <p className="text-ink-3">Reading the file…</p>
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

  const ex = isPdf ? (session.extraction as PdfSessionExtraction | null) : null;
  const first = items[0]?.data as CurrentData | undefined;

  return (
    <>
      {header}

      {previous && open > 0 && (
        <DuplicateBanner sessionId={id} mode="file" previousHref={`/import/${previous.id}`} previousDate={when(previous.uploadedAt)} isPdf={isPdf} />
      )}
      {!previous && duplicates > 0 && duplicates === attention.length && open === attention.length && (
        <DuplicateBanner sessionId={id} mode="lines" isPdf={isPdf} />
      )}

      {summary && summary.imported > 0 && <SummaryCard summary={summary} recordType={recordType} open={open} />}

      {open > 0 && (
        <div className="mb-6">
          <div className="text-[22px] font-semibold tracking-[-0.02em]">
            We found {items.length} {items.length === 1 ? noun : `${noun}s`}.{" "}
            {count("attention") > 0 ? (
              <span className="text-caution">
                {count("attention")} {count("attention") === 1 ? "needs" : "need"} your attention.
              </span>
            ) : (
              <span className="text-down">All ready to import.</span>
            )}
          </div>
          <p className="mt-1 text-[13.5px] text-ink-3">
            Check the suppliers and products we recognised, fix anything flagged, then import. Nothing is saved until you do.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {ex && first && (
          <DocumentDetails
            sessionId={id}
            kind={ex.kind}
            fields={[
              { label: "Supplier", value: first.supplierName, confidence: ex.fields.supplierName?.confidence ?? null },
              { label: "VAT number", value: first.supplierVat, confidence: ex.fields.supplierVat?.confidence ?? null },
              { label: ex.kind === "quote" ? "Quote number" : "Invoice number", value: first.invoiceReference, confidence: ex.fields.number?.confidence ?? null },
              { label: "Date", value: first.date ? f.date(first.date) : null, confidence: ex.fields.date?.confidence ?? null },
              { label: "Currency", value: first.currency, confidence: ex.fields.currency?.confidence ?? null },
              { label: "Payment terms", value: first.paymentTermsDays != null ? f.paymentTerms(first.paymentTermsDays) : null, confidence: ex.fields.paymentTermsDays?.confidence ?? null },
              ...(ex.kind === "quote"
                ? [
                    { label: "Valid until", value: first.validUntil ? f.date(first.validUntil) : null, confidence: ex.fields.validUntil?.confidence ?? null },
                    { label: "MOQ", value: first.moq != null ? f.number(first.moq) : null, confidence: ex.fields.moq?.confidence ?? null },
                    { label: "Lead time", value: first.leadTimeDays != null ? f.days(first.leadTimeDays) : null, confidence: ex.fields.leadTimeDays?.confidence ?? null },
                    { label: "Incoterm", value: first.incoterm, confidence: ex.fields.incoterm?.confidence ?? null },
                  ]
                : [{ label: "Freight", value: ex.fields.freight?.value != null ? f.money(Number(ex.fields.freight.value)) : null, confidence: ex.fields.freight?.confidence ?? null }]),
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

        {open > 0 && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <MatchGroupsPanel sessionId={id} kind="supplier" groups={groups.suppliers} options={data.suppliers.map(({ id, name }) => ({ id, name }))} />
            <MatchGroupsPanel sessionId={id} kind="product" groups={groups.products} options={data.products.map(({ id, name, sku }) => ({ id, name: `${name} · ${sku}` }))} />
          </div>
        )}

        <LinesPanel lines={lines} />
      </div>

      <ApproveBar sessionId={id} recordType={recordType} ready={count("ready")} attention={count("attention")} flaggedOnly={flaggedOnly} duplicates={duplicates} />
    </>
  );
}

function SummaryCard({ summary: s, recordType, open }: { summary: ImportSummary; recordType: RecordType; open: number }) {
  const noun = recordType === "quote" ? "quote" : "purchase line";
  const increases = s.priceChanges.filter((c) => c.pct > 0);
  const stats: [string, number, string?][] = [
    [`${noun}s detected`, s.detected],
    ["imported", s.imported, "text-down"],
    ["need review", s.needReview, s.needReview ? "text-caution" : undefined],
    ["duplicates skipped", s.duplicatesSkipped],
    ["new products", s.newProducts],
    ["new suppliers", s.newSuppliers],
  ];
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-rule">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-down-wash/60 px-5 py-4">
        <div>
          <div className="text-[18px] font-semibold tracking-[-0.015em]">{open > 0 ? "Partly imported" : "Import complete"}</div>
          <div className="text-[13px] text-ink-2">Your dashboard, prices and history are already updated.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.needReview > 0 && (
            <ButtonLink href="/review" variant="secondary">
              Review issues
            </ButtonLink>
          )}
          <ButtonLink href="/purchases">View purchases</ButtonLink>
          <ButtonLink href="/" variant="primary">
            Return to dashboard <ArrowRight size={14} />
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
            <div className="text-[13px] font-semibold">
              {increases.length} price increase{increases.length === 1 ? "" : "s"} detected
            </div>
            {s.increaseImpact > 0 && (
              <div className="text-[13px] text-ink-2">
                Estimated annual impact <span className="num font-semibold text-up">+{f.money(s.increaseImpact)}</span>
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
                  {f.money(c.annualImpact)}/yr
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
