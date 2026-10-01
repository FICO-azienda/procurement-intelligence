"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FileSpreadsheet, FileText, ReceiptText, Sheet, UploadCloud, type LucideIcon } from "lucide-react";
import { uploadFiles } from "@/app/import/actions";
import { cx } from "../ui";

type Kind = "spreadsheet" | "invoice" | "quote";

const OPTIONS: { kind: Kind; title: string; body: string; accept: string; icon: LucideIcon }[] = [
  { kind: "spreadsheet", title: "Upload CSV", body: "Purchase lines exported from your accounting or ERP", accept: ".csv,.txt,text/csv", icon: Sheet },
  { kind: "spreadsheet", title: "Upload Excel", body: ".xlsx, .xls or .ods spreadsheets", accept: ".xlsx,.xls,.ods", icon: FileSpreadsheet },
  { kind: "invoice", title: "Upload invoice", body: "Supplier invoices as PDF", accept: ".pdf,application/pdf", icon: ReceiptText },
  { kind: "quote", title: "Upload quote", body: "Quotes and price lists as PDF", accept: ".pdf,application/pdf", icon: FileText },
];

export function ImportUploader() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const depth = useRef(0);

  function send(files: File[], kind: Kind) {
    if (!files.length) return;
    setMessage(null);
    setBusyLabel(files.length === 1 ? `Reading ${files[0].name}…` : `Reading ${files.length} files…`);
    const fd = new FormData();
    fd.set("kind", kind);
    for (const f of files) fd.append("files", f);
    startTransition(async () => {
      try {
        const res = await uploadFiles(fd);
        if (res.error) setMessage({ tone: "error", text: res.error });
        if (res.sessionIds.length === 1 && !res.error) router.push(`/import/${res.sessionIds[0]}`);
        else if (res.sessionIds.length > 1) {
          setMessage({ tone: "ok", text: `${res.sessionIds.length} files uploaded. Open each one below to review it.` });
          router.refresh();
        }
      } catch {
        setMessage({ tone: "error", text: "Upload failed. Files must be smaller than 20 MB." });
      }
    });
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        depth.current--;
        if (depth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        send([...e.dataTransfer.files], "spreadsheet");
      }}
      className={cx(
        "relative rounded-xl border border-dashed p-3 transition-colors duration-150",
        dragging ? "border-ledger bg-ledger-wash/50" : "border-rule-strong bg-well",
      )}
    >
      <div className={cx("grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4", pending && "pointer-events-none opacity-50")}>
        {OPTIONS.map(({ kind, title, body, accept, icon: Icon }) => (
          <label
            key={title}
            className="group flex cursor-pointer flex-col rounded-lg border border-rule bg-canvas p-4 transition-[border-color,box-shadow] duration-150 hover:border-ledger/40 hover:shadow-[0_1px_3px_rgba(17,17,19,.06)] focus-within:outline-2 focus-within:outline-ledger"
          >
            <Icon size={18} strokeWidth={1.75} className="text-ink-3 transition-colors group-hover:text-ledger" />
            <span className="mt-3 text-[14px] font-semibold">{title}</span>
            <span className="mt-0.5 text-[12.5px] text-ink-3">{body}</span>
            <input
              type="file"
              multiple
              accept={accept}
              className="sr-only"
              onChange={(e) => {
                send([...(e.target.files ?? [])], kind);
                e.target.value = "";
              }}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 px-4 pt-4 pb-2 text-[13px] text-ink-3">
        {pending ? (
          <>
            <span className="size-3.5 animate-spin rounded-full border-2 border-ledger/25 border-t-ledger" />
            <span className="text-ink-2">{busyLabel}</span>
          </>
        ) : (
          <>
            <UploadCloud size={15} /> Or drop files here — several at once is fine
          </>
        )}
      </div>
      {message && (
        <div className={cx("mx-1 mt-2 rounded-md px-3 py-2 text-[13px]", message.tone === "error" ? "bg-up-wash text-up" : "bg-down-wash text-down")}>
          {message.text}
        </div>
      )}
    </div>
  );
}
