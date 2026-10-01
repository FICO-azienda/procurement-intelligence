import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Download } from "lucide-react";
import { getDb } from "@/db";
import { DataControls } from "@/components/data-controls";
import { ImportStatusBadge, fileKindLabel } from "@/components/import/labels";
import { ImportUploader } from "@/components/import/uploader";
import { Empty, PageHeader, Section, Table, Td, Th, rowClass } from "@/components/ui";
import { getDataset } from "@/lib/data";
import { plural } from "@/lib/lookups";
import { listSessions } from "@/server/imports";

export const metadata: Metadata = { title: "Import" };

function when(d: Date) {
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function ImportPage() {
  await connection();
  const db = await getDb();
  const [sessions, data] = await Promise.all([listSessions(db), getDataset()]);
  const demoPurchases = data.purchases.filter((p) => p.source === "demo").length;
  const counts = [
    plural(data.products.length, "product"),
    plural(data.suppliers.length, "supplier"),
    plural(data.purchases.length, "purchase"),
    plural(data.quotes.length, "quote"),
  ].join(", ");

  return (
    <>
      <PageHeader
        title="Import purchasing data"
        meta={
          <span className="block max-w-2xl text-[14px] leading-relaxed">
            Upload invoices, supplier quotes or spreadsheets. We&apos;ll extract and structure your purchasing data before
            adding anything to your database.
          </span>
        }
      />

      <ImportUploader />

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
        <span>Nothing is saved until you approve it.</span>
        <span>Every record keeps a link to its original file.</span>
        <a href="/templates/purchases-template.csv" download className="inline-flex items-center gap-1 font-medium text-ledger hover:underline">
          <Download size={13} /> CSV template
        </a>
      </div>

      <Section className="mt-10" title="Recent imports" flush>
        {sessions.length === 0 ? (
          <Empty title="No imports yet" body="Uploaded files appear here with their status." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Type</Th>
                <Th>Uploaded</Th>
                <Th>Status</Th>
                <Th align="right">Found</Th>
                <Th align="right">Imported</Th>
                <Th align="right">To review</Th>
                <Th align="right">Skipped</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className={rowClass(true)}>
                  <Td className="max-w-[320px] truncate font-medium">
                    <Link href={`/import/${s.id}`} className="stretched">
                      {s.filename}
                    </Link>
                  </Td>
                  <Td muted>{fileKindLabel(s.fileType, s.sourceType)}</Td>
                  <Td muted className="num">{when(s.uploadedAt)}</Td>
                  <Td>
                    <ImportStatusBadge status={s.status} attention={s.recordsReview} />
                  </Td>
                  <Td align="right" muted>{s.recordsDetected || "—"}</Td>
                  <Td align="right">{s.recordsImported || "—"}</Td>
                  <Td align="right" className={s.recordsReview ? "font-medium text-caution" : "text-ink-3"}>
                    {s.recordsReview || "—"}
                  </Td>
                  <Td align="right" muted>{s.recordsRejected || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section
        className="mt-10"
        title="Data"
        description={
          demoPurchases > 0
            ? `You are looking at demo data (${plural(demoPurchases, "demo purchase")}). Clear it before loading your company's real data.`
            : `Currently stored: ${counts}.`
        }
      >
        <DataControls counts={counts} />
      </Section>
    </>
  );
}
