"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowRight, ClipboardPaste, UploadCloud } from "lucide-react";
import { interpretPurchase } from "@/app/actions";
import { uploadFiles } from "@/app/import/actions";
import { leftOutNotes, openArchive, type LeftOut } from "@/lib/import/archive";
import { ACCEPT, isArchive } from "@/lib/import/files";
import { useT } from "@/lib/i18n/client";
import { track } from "@/lib/track";
import { useEntry } from "../entry/context";
import { buttonClass, cx } from "../ui";

/** A file waiting its turn: one that was dropped, or one still packed inside a zip. */
interface Queued {
  name: string;
  file: () => Promise<File>;
}

const TONE = { error: "bg-up-wash text-up", ok: "bg-down-wash text-down", note: "bg-caution-wash text-caution" };

/**
 * One place to drop anything: invoices, quotes, spreadsheets, or a zip full
 * of them. The file says what it is — nobody has to sort files into boxes
 * first. A zip is opened here, in the browser, and what it holds is read like
 * any other file. Files go one at a time, so the progress shown is the real one.
 */
export function ImportUploader() {
  const router = useRouter();
  const t = useT();
  const { open } = useEntry();
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  /** `total: 0` while a zip is being opened: how many files there are is not known yet. */
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [message, setMessage] = useState<{ tone: keyof typeof TONE; lines: string[] } | null>(null);

  async function send(dropped: File[]) {
    if (!dropped.length || progress) return;
    setMessage(null);
    const queue: Queued[] = [];
    const leftOut: LeftOut[] = [];
    const notes: string[] = [];
    let zips = 0;
    for (const file of dropped) {
      if (!isArchive(file.name)) {
        queue.push({ name: file.name, file: async () => file });
        continue;
      }
      zips++;
      setProgress({ done: 0, total: 0, name: file.name });
      try {
        const zip = await openArchive(file);
        leftOut.push(...zip.leftOut);
        if (!zip.files.length && !zip.leftOut.length) notes.push(t("{name} has nothing the import can read inside.", { name: file.name }));
        for (const inside of zip.files) queue.push({ name: inside.name, file: async () => new File([await inside.read()], inside.name) });
      } catch {
        notes.push(t("We couldn't open {name}. It may be damaged, or it is not a zip file.", { name: file.name }));
      }
    }

    track("upload_started", { files: queue.length, zips });
    const sessionIds: string[] = [];
    let failed = 0;
    for (const [i, item] of queue.entries()) {
      setProgress({ done: i, total: queue.length, name: item.name });
      let file: File;
      try {
        file = await item.file();
      } catch {
        // The zip is damaged at this file: the others still go through.
        leftOut.push({ name: item.name, path: item.name, reason: "unreadable" });
        continue;
      }
      const fd = new FormData();
      fd.set("kind", "auto");
      fd.append("files", file);
      try {
        const res = await uploadFiles(fd);
        sessionIds.push(...res.sessionIds);
        if (res.error) failed++;
      } catch {
        // Usually a file over the size limit: the others still go through.
        failed++;
      }
    }
    setProgress(null);
    track("upload_finished", { files: queue.length, failed, zips, leftOut: leftOut.length });

    notes.push(...leftOutNotes(leftOut, t));
    if (failed) notes.push(t.n(failed, "{n} file couldn't be uploaded. Files must be PDF, XML, Excel or CSV, and smaller than 20 MB.", "{n} files couldn't be uploaded. Files must be PDF, XML, Excel or CSV, and smaller than 20 MB."));
    // One file and nothing to say: go straight to what was found in it. Otherwise the summary is right below.
    if (sessionIds.length === 1 && !notes.length) return router.push(`/import/${sessionIds[0]}`);
    const read = sessionIds.length ? [t.n(sessionIds.length, "{n} file read. Here is what we found.", "{n} files read. Here is what we found.")] : [];
    if (read.length || notes.length) setMessage({ tone: !notes.length ? "ok" : read.length ? "note" : "error", lines: [...read, ...notes] });
    if (sessionIds.length) router.refresh();
  }

  const busy = !!progress;
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
        void send([...e.dataTransfer.files]);
      }}
      className={cx(
        "rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors duration-150",
        dragging ? "border-ledger bg-ledger-wash/60" : "border-rule-strong bg-well",
      )}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        aria-label={t("Choose files to import")}
        onChange={(e) => {
          void send([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {busy ? (
        <div className="mx-auto max-w-[420px]" role="status" aria-live="polite">
          <div className="text-[16px] font-semibold">
            {progress.total === 0
              ? t("Opening {name}…", { name: progress.name })
              : progress.total === 1
                ? t("Reading your file…")
                : t("Reading {done} of {total} files…", { done: progress.done + 1, total: progress.total })}
          </div>
          {progress.total > 0 && <div className="mt-1 truncate text-[13px] text-ink-3">{progress.name}</div>}
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-wash">
            <div className="h-full rounded-full bg-ledger transition-[width] duration-300" style={{ width: `${progress.total ? ((progress.done + 0.5) / progress.total) * 100 : 4}%` }} />
          </div>
          <div className="mt-2 text-[12px] text-ink-4">{progress.total === 0 ? t("Looking at what is inside") : t("Finding suppliers, products, quantities and prices")}</div>
        </div>
      ) : (
        <>
          <UploadCloud size={28} strokeWidth={1.5} className="mx-auto text-ink-3" />
          <div className="mt-3 text-[17px] font-semibold tracking-[-0.01em]">{t("Drop invoices, quotes or spreadsheets here")}</div>
          <p className="mt-1 text-[13.5px] text-ink-3">{t("PDF, XML invoices, Excel or CSV, or a zip with them inside — several at once is fine. We work out what each file is.")}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => input.current?.click()} className={buttonClass("primary")}>
              {t("Choose files")}
            </button>
            <button type="button" onClick={() => open({ kind: "paste" })} className={buttonClass("secondary")}>
              <ClipboardPaste size={14} /> {t("Paste from Excel")}
            </button>
          </div>
        </>
      )}
      {message && (
        <div role="status" className={cx("mx-auto mt-5 max-w-[560px] space-y-1 rounded-md px-3 py-2 text-[13px]", message.lines.length > 1 && "text-left", TONE[message.tone])}>
          {message.lines.map((line) => (
            <p key={line} className="break-words">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Or write it in words": one purchase, typed as you would say it. It opens
 * the normal form filled in, to check before saving.
 */
export function WriteInWords() {
  const { open } = useEntry();
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function read() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await interpretPurchase(text);
      track("quick_add_read", { matchedSupplier: !!p.supplierId, matchedProduct: !!p.productId });
      open({
        kind: "purchase",
        supplierId: p.supplierId ?? undefined,
        productId: p.productId ?? undefined,
        prefill: { quantity: p.quantity, unitPrice: p.unitPrice, currency: p.currency, date: p.date, supplierText: p.supplierText, productText: p.productText, notes: p.notes },
      });
      setText("");
    } catch {
      setError(t("We couldn't read that. Try again, or use + Add."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="mx-auto mt-4 max-w-[640px]"
      onSubmit={(e) => {
        e.preventDefault();
        void read();
      }}
    >
      <label htmlFor="in-words" className="mb-1.5 block text-center text-[12.5px] text-ink-3">
        {t("Or write a purchase in your own words")}
      </label>
      <div className="flex gap-2">
        <input
          id="in-words"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("Bought 2000 kg of paraffin from ABC at 1.58 €/kg on 28 September")}
          className="h-10 min-w-0 flex-1 rounded-md border border-rule-strong bg-canvas px-3 text-[13.5px] placeholder:text-ink-4 hover:border-ink/25 focus:border-ledger focus:ring-3 focus:ring-ledger/15 focus:outline-none"
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label={t("Read it")} className={cx(buttonClass("primary"), "h-10 w-10 px-0")}>
          {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <ArrowRight size={16} />}
        </button>
      </div>
      {error && <div className="mt-1.5 text-center text-[12.5px] text-up">{error}</div>}
    </form>
  );
}
