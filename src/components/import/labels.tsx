import type { ImportStatus } from "@/db/schema";
import { cx } from "../ui";

const STATUS: Record<ImportStatus, { label: string; className: string }> = {
  uploaded: { label: "Map columns", className: "bg-ledger-wash text-ledger" },
  processing: { label: "Processing", className: "bg-wash text-ink-2" },
  needs_review: { label: "Needs review", className: "bg-caution-wash text-caution" },
  completed: { label: "Completed", className: "bg-down-wash text-down" },
  failed: { label: "Failed", className: "bg-up-wash text-up" },
};

export function ImportStatusBadge({ status, attention }: { status: ImportStatus; attention?: number }) {
  const s = status === "needs_review" && attention === 0 ? { label: "Ready to import", className: "bg-ledger-wash text-ledger" } : STATUS[status];
  return (
    <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap", s.className)}>
      {s.label}
    </span>
  );
}

export function fileKindLabel(fileType: string, sourceType: string) {
  if (fileType === "unknown") return "Unsupported file";
  if (fileType === "pdf") return sourceType === "quote" ? "Quote · PDF" : "Invoice · PDF";
  if (fileType === "csv") return "CSV";
  return "Excel";
}

export function sourceLabel(source: string) {
  return (
    {
      manual: "Manual",
      csv: "CSV import",
      excel: "Excel import",
      invoice: "Invoice",
      quote: "Quote",
      email: "Email",
      erp: "ERP",
      demo: "Demo data",
    } as Record<string, string>
  )[source] ?? source;
}

/** "Invoice · View" — where a purchase/quote came from, with a link to the original file. */
export function SourceTag({ source, doc }: { source: string; doc: { documentId: string | null; filename: string } | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cx("text-[12px]", source === "demo" ? "text-ink-4" : "text-ink-2")}>{sourceLabel(source)}</span>
      {doc?.documentId && (
        <a
          href={`/documents/${doc.documentId}`}
          target="_blank"
          title={doc.filename}
          className="relative z-10 text-[12px] font-medium text-ledger hover:underline"
        >
          View source
        </a>
      )}
    </span>
  );
}
