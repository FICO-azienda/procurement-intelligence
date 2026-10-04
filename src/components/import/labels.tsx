import type { ImportStatus } from "@/db/schema";
import { en, type Msg, type T } from "@/lib/i18n";
import { Tx } from "@/lib/i18n/client";
import { SOURCE_LABEL, sourceLabel } from "@/lib/source-labels";
import { cx } from "../ui";

const STATUS: Record<ImportStatus, { label: Msg; className: string }> = {
  uploaded: { label: "Map columns", className: "bg-ledger-wash text-ledger" },
  processing: { label: "Processing", className: "bg-wash text-ink-2" },
  needs_review: { label: "Needs review", className: "bg-caution-wash text-caution" },
  completed: { label: "Completed", className: "bg-down-wash text-down" },
  failed: { label: "Failed", className: "bg-up-wash text-up" },
};
const READY: { label: Msg; className: string } = { label: "Ready to import", className: "bg-ledger-wash text-ledger" };

export function ImportStatusBadge({ status, attention }: { status: ImportStatus; attention?: number }) {
  const s = status === "needs_review" && attention === 0 ? READY : STATUS[status];
  return (
    <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap", s.className)}>
      <Tx msg={s.label} />
    </span>
  );
}

export function fileKindLabel(fileType: string, sourceType: string, t: T = en) {
  if (fileType === "unknown") return t("Unsupported file");
  if (fileType === "pdf") return sourceType === "quote" ? t("Quote · PDF") : t("Invoice · PDF");
  if (fileType === "xml") return t("E-invoice · XML");
  if (fileType === "p7m") return t("Signed file");
  if (fileType === "csv") return "CSV";
  return "Excel";
}

export { sourceLabel };

/** "Invoice · View" — where a purchase/quote came from, with a link to the original file. */
export function SourceTag({ source, doc }: { source: string; doc: { documentId: string | null; filename: string } | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cx("text-[12px]", source === "demo" ? "text-ink-4" : "text-ink-2")}>{source in SOURCE_LABEL ? <Tx msg={SOURCE_LABEL[source]} /> : source}</span>
      {doc?.documentId && (
        <a
          href={`/documents/${doc.documentId}`}
          target="_blank"
          title={doc.filename}
          className="relative z-10 text-[12px] font-medium text-ledger hover:underline"
        >
          <Tx msg="View source" />
        </a>
      )}
    </span>
  );
}
