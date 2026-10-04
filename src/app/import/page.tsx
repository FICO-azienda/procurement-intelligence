import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ArrowRight, Download } from "lucide-react";
import { getDb } from "@/db";
import { DataControls } from "@/components/data-controls";
import { ImportStatusBadge, fileKindLabel } from "@/components/import/labels";
import { ImportAllButton } from "@/components/import/review";
import { ImportUploader, WriteInWords } from "@/components/import/uploader";
import { ButtonLink, Disclosure, PageHeader, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDataset, getT } from "@/lib/data";
import { rich } from "@/lib/i18n/rich";
import { inbox, listSessions } from "@/server/imports";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Import|nav") };
}

const when = (d: Date) => d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function ImportPage() {
  await connection();
  const db = await getDb();
  const [sessions, data, box, t] = await Promise.all([listSessions(db), getDataset(), inbox(db), getT()]);
  const demoPurchases = data.purchases.filter((p) => p.source === "demo").length;
  const counts = [
    t.n(data.products.length, "{n} product", "{n} products"),
    t.n(data.suppliers.length, "{n} supplier", "{n} suppliers"),
    t.n(data.purchases.length, "{n} purchase", "{n} purchases"),
    t.n(data.quotes.length, "{n} quote", "{n} quotes"),
  ].join(", ");
  const files = (n: number) => t.n(n, "{n} file", "{n} files");
  const num = (n: number, tone: string) => <span className={cx("num font-semibold", tone)}>{n}</span>;
  const done = sessions.filter((s) => s.status === "completed" || s.status === "failed");
  const decisions = box.review + box.duplicates;

  return (
    <>
      <PageHeader title={t("Import|nav")} meta={t("Bring in what you already have: invoices, quotes, spreadsheets. Nothing is saved until you confirm it.")} />

      <ImportUploader />
      <WriteInWords />

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
        <span>{t("Every record keeps a link to the file it came from.")}</span>
        <a href="/templates/purchases-template.csv" download className="inline-flex items-center gap-1 font-medium text-ledger hover:underline">
          <Download size={13} /> {t("Spreadsheet template")}
        </a>
      </div>

      {/* What is waiting: the numbers, then one button */}
      {box.files.length > 0 && (
        <section aria-labelledby="waiting" className="mt-8 overflow-hidden rounded-xl border border-rule">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-5 py-5 sm:px-6">
            <div>
              <h2 id="waiting" className="text-[20px] font-semibold tracking-[-0.02em]">
                {box.lines > 0
                  ? t("{lines} found in {files}", { lines: t.n(box.lines, "{n} line", "{n} lines"), files: files(box.files.length) })
                  : t.n(box.files.length, "{n} file waiting for you", "{n} files waiting for you")}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
                {box.lines > 0 && <span>{rich(t("{n} ready"), { n: num(box.ready, "text-down") })}</span>}
                {box.review > 0 && <span>{rich(t(box.review === 1 ? "{n} needs review" : "{n} need review"), { n: num(box.review, "text-caution") })}</span>}
                {box.duplicates > 0 && <span>{rich(t(box.duplicates === 1 ? "{n} duplicate" : "{n} duplicates"), { n: num(box.duplicates, "text-ink-2") })}</span>}
                {box.sameFiles > 0 && <span>{rich(t(box.sameFiles === 1 ? "{n} file was already uploaded" : "{n} files were already uploaded"), { n: num(box.sameFiles, "text-ink-2") })}</span>}
                {box.needColumns > 0 && (
                  <span>{rich(t(box.needColumns === 1 ? "{n} file needs its columns checked" : "{n} files need their columns checked"), { n: num(box.needColumns, "text-ledger") })}</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {decisions > 0 && (
                <ButtonLink href="/review" variant="primary">
                  {t.n(decisions, "Review {n} issue", "Review {n} issues")} <ArrowRight size={14} />
                </ButtonLink>
              )}
              {box.ready > 0 && <ImportAllButton ready={box.ready} primary={decisions === 0} />}
            </div>
          </div>
          <ul className="border-t border-rule">
            {box.files.map((file) => (
              <li key={file.session.id} className="border-b border-rule last:border-b-0 hover:bg-well">
                <Link href={`/import/${file.session.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px] sm:px-6">
                  <span className="min-w-0 flex-1 truncate font-medium">{file.session.filename}</span>
                  <span className="text-ink-3">{fileKindLabel(file.session.fileType, file.session.sourceType, t)}</span>
                  <span className={cx("num w-[170px] text-right", file.sameFile ? "text-ink-3" : file.needsColumns ? "text-ledger" : file.review + file.duplicates > 0 ? "text-caution" : "text-down")}>
                    {file.sameFile
                      ? t("Same file as before")
                      : file.needsColumns
                        ? t("Check the columns")
                        : file.review + file.duplicates > 0
                          ? `${t("{n} to review", { n: file.review + file.duplicates })} · ${t("{n} ready", { n: file.ready })}`
                          : t("{n} ready", { n: file.ready })}
                  </span>
                  <ArrowRight size={13} className="text-ink-4" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 space-y-3">
        <Disclosure title={t("Past imports")} description={done.length ? files(done.length) : t("None yet")} flush defaultOpen={done.length > 0 && done.length <= 8}>
          {done.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-ink-3">{t("Files you have imported will be listed here, each with a link to the original.")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="border-t-0">{t("File")}</Th>
                  <Th className="hidden border-t-0 @2xl:table-cell">{t("Type")}</Th>
                  <Th className="hidden border-t-0 @3xl:table-cell">{t("Uploaded")}</Th>
                  <Th className="border-t-0" align="right">{t("Imported")}</Th>
                  <Th className="border-t-0">{t("Status")}</Th>
                </tr>
              </thead>
              <tbody>
                {done.map((s) => (
                  <tr key={s.id} className={rowClass(true)}>
                    <Td className="max-w-[320px] truncate font-medium">
                      <Link href={`/import/${s.id}`} className="stretched">
                        {s.filename}
                      </Link>
                    </Td>
                    <Td muted className="hidden @2xl:table-cell">
                      {fileKindLabel(s.fileType, s.sourceType, t)}
                    </Td>
                    <Td muted className="num hidden @3xl:table-cell">
                      {when(s.uploadedAt)}
                    </Td>
                    <Td align="right">
                      {s.recordsImported || "—"}
                      {s.recordsRejected > 0 && <span className="ml-1.5 text-[12px] text-ink-3">· {t("{n} skipped", { n: s.recordsRejected })}</span>}
                    </Td>
                    <Td>
                      <ImportStatusBadge status={s.status} attention={s.recordsReview} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Disclosure>

        <div id="data" className="scroll-mt-20">
          <Disclosure
            title={demoPurchases > 0 ? t("Demo data") : t("Your data")}
            description={demoPurchases > 0 ? t("You are looking at example figures") : counts}
            defaultOpen={demoPurchases > 0 || data.products.length === 0}
          >
            <p className="mb-3 max-w-[64ch] text-[13.5px] text-ink-2">
              {demoPurchases > 0
                ? t("The app is showing demo data ({counts}). Clear it before loading your company's files, so that real and example figures never mix.", { counts })
                : data.products.length === 0
                  ? t("The app is empty. Upload your files above — or load the demo data to look around first.")
                  : t("Stored now: {counts}.", { counts })}
            </p>
            <DataControls counts={counts} />
          </Disclosure>
        </div>
      </div>
    </>
  );
}
