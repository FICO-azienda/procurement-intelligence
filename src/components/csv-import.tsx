"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, FileUp } from "lucide-react";
import { commitPurchaseImport, previewPurchaseImport, type ImportPreview } from "@/app/import/actions";
import { clearAllData, loadDemoData } from "@/app/actions";
import * as f from "@/lib/format";
import { DeleteButton } from "./form-kit";
import { Basis, buttonClass, cx } from "./ui";

export function CsvImport() {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; error?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setFileName(null);
    setCsv(null);
    setPreview(null);
    if (input.current) input.current.value = "";
  }

  async function onFile(file: File) {
    setResult(null);
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    startTransition(async () => setPreview(await previewPurchaseImport(text)));
  }

  return (
    <div>
      {result && (
        <div
          role="status"
          className={cx(
            "mb-4 flex items-center gap-2 rounded-md px-3.5 py-2.5 text-[13px]",
            result.error ? "bg-up-wash text-up" : "bg-down-wash text-down",
          )}
        >
          {result.error ? (
            result.error
          ) : (
            <>
              <Check size={15} /> Imported {result.imported} purchases
              {result.skipped > 0 && ` · ${result.skipped} rows skipped`}.{" "}
              <Link href="/purchases" className="font-medium underline">
                View purchases
              </Link>
            </>
          )}
        </div>
      )}

      {!preview && (
        <label
          className={cx(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-rule-strong bg-well px-6 py-10 text-center transition-colors hover:border-ledger/50 hover:bg-ledger-wash/40",
            pending && "opacity-60",
          )}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
          }}
        >
          <FileUp size={20} className="text-ink-3" />
          <span className="mt-2 text-[13.5px] font-medium">{pending ? "Reading file…" : "Choose a CSV file or drop it here"}</span>
          <span className="mt-0.5 text-[12.5px] text-ink-3">
            Comma or semicolon separated · Italian or English headers · 1,58 or 1.58
          </span>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>
      )}

      {preview && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px]">
              <span className="font-medium">{fileName}</span>
              {!preview.fatal && (
                <span className="text-ink-3">
                  {" "}
                  · {preview.total} rows · <span className="text-down">{preview.valid} ready</span>
                  {preview.invalid > 0 && <span className="text-up"> · {preview.invalid} with errors (skipped)</span>}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={reset} className={buttonClass("ghost")}>
                Cancel
              </button>
              {!preview.fatal && preview.valid > 0 && (
                <button
                  type="button"
                  disabled={pending}
                  className={buttonClass("primary")}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await commitPurchaseImport(csv!);
                      setResult(r);
                      if (!r.error) reset();
                    })
                  }
                >
                  {pending ? "Importing…" : `Import ${preview.valid} purchases`}
                </button>
              )}
            </div>
          </div>

          {preview.fatal ? (
            <div className="rounded-md bg-up-wash px-3.5 py-2.5 text-[13px] text-up">{preview.fatal}</div>
          ) : (
            <>
              {(preview.newSuppliers.length > 0 || preview.newProducts.length > 0) && (
                <div className="mb-3 rounded-md bg-ledger-wash px-3.5 py-2.5 text-[13px] text-ink-2">
                  Will also create
                  {preview.newSuppliers.length > 0 && (
                    <> {preview.newSuppliers.length} new supplier{preview.newSuppliers.length > 1 && "s"} ({preview.newSuppliers.slice(0, 4).join(", ")}{preview.newSuppliers.length > 4 && "…"})</>
                  )}
                  {preview.newSuppliers.length > 0 && preview.newProducts.length > 0 && " and"}
                  {preview.newProducts.length > 0 && (
                    <> {preview.newProducts.length} new product{preview.newProducts.length > 1 && "s"} ({preview.newProducts.slice(0, 4).map((p) => p.name).join(", ")}{preview.newProducts.length > 4 && "…"})</>
                  )}
                  .
                </div>
              )}
              <div className="max-h-[420px] overflow-auto rounded-md border border-rule">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-well">
                    <tr className="text-left text-ink-3">
                      {["Line", "Check", "Date", "Supplier", "Product", "Qty", "Unit price", "Total"].map((h) => (
                        <th key={h} className="border-b border-rule px-3 py-2 font-medium whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.line} className={cx("border-b border-rule last:border-b-0", r.errors.length > 0 && "bg-up-wash/60")}>
                        <td className="num px-3 py-2 text-ink-4">{r.line}</td>
                        <td className="min-w-[180px] px-3 py-2">
                          {r.errors.length ? (
                            <span className="text-up">{r.errors.join(" · ")}</span>
                          ) : (
                            <Check size={14} className="text-down" aria-label="OK" />
                          )}
                        </td>
                        <td className="num px-3 py-2 whitespace-nowrap">{f.date(r.date)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.supplier || "—"} {r.newSupplier && r.errors.length === 0 && <Basis>New</Basis>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.product || "—"} <span className="font-mono text-[11px] text-ink-4">{r.sku}</span>{" "}
                          {r.newProduct && r.errors.length === 0 && <Basis>New</Basis>}
                        </td>
                        <td className="num px-3 py-2 text-right whitespace-nowrap">{f.quantity(r.quantity, r.unit)}</td>
                        <td className="num px-3 py-2 text-right whitespace-nowrap">{f.price(r.unitPrice, r.currency)}</td>
                        <td className="num px-3 py-2 text-right whitespace-nowrap">{f.money(r.total, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.truncated && (
                <p className="mt-2 text-[12px] text-ink-3">Showing the first 300 rows; all valid rows will be imported.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function DataControls({ counts }: { counts: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <DeleteButton
        label="Clear all data"
        note={`Deletes ${counts}. Cannot be undone.`}
        onConfirm={async () => {
          await clearAllData();
          setMessage("All data cleared. The app is empty and ready for real data.");
        }}
      />
      <button
        type="button"
        disabled={pending}
        className={buttonClass("secondary")}
        onClick={() =>
          startTransition(async () => {
            await loadDemoData();
            setMessage("Demo data reloaded.");
          })
        }
      >
        {pending ? "Loading…" : "Reload demo data"}
      </button>
      {message && <span className="text-[12.5px] text-down">{message}</span>}
    </div>
  );
}
