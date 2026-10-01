"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { saveMapping } from "@/app/import/actions";
import { FIELDS, missingRequired, type ColumnMapping, type FieldKey } from "@/lib/import/fields";
import { SUPPORTED_CURRENCIES } from "@/lib/import/normalize/currency";
import type { RecordType } from "@/lib/import/types";
import { Select } from "../form-kit";
import { buttonClass, cx } from "../ui";

export function MappingForm({
  sessionId,
  headers,
  sample,
  rowCount,
  initial,
}: {
  sessionId: string;
  headers: string[];
  sample: string[][];
  rowCount: number;
  initial: { columns: ColumnMapping; recordType: RecordType; defaultCurrency: string | null };
}) {
  const router = useRouter();
  const [columns, setColumns] = useState<ColumnMapping>(initial.columns);
  const [recordType, setRecordType] = useState<RecordType>(initial.recordType);
  const [currency, setCurrency] = useState<string>(initial.defaultCurrency ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const missing = missingRequired(columns, recordType);
  const hasCurrencyColumn = Object.values(columns).includes("currency");

  function assign(header: string, field: FieldKey | null) {
    setColumns((prev) => {
      const next = { ...prev };
      // A field belongs to one column: moving it frees the previous one.
      if (field) for (const h of Object.keys(next)) if (next[h] === field) next[h] = null;
      next[header] = field;
      return next;
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Map your columns</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            We found {rowCount.toLocaleString("it-IT")} rows. We&apos;ve matched the columns we recognised — check and correct them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md border border-rule-strong p-0.5" role="radiogroup" aria-label="Rows are">
            {(["purchase", "quote"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={recordType === t}
                onClick={() => setRecordType(t)}
                className={cx(
                  "h-7 rounded-[5px] px-3 text-[13px] transition-colors",
                  recordType === t ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-wash",
                )}
              >
                {t === "purchase" ? "Purchases" : "Quotes"}
              </button>
            ))}
          </div>
          {!hasCurrencyColumn && (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Currency
              <div className="w-[150px]">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="">Not in the file</option>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </div>
            </label>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-rule">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-well text-left text-[12px] text-ink-3">
              <th className="h-9 border-b border-rule px-5 font-medium">Column in your file</th>
              <th className="h-9 border-b border-rule px-3 font-medium">First values</th>
              <th className="h-9 w-[240px] border-b border-rule px-5 font-medium">Goes to</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h, i) => {
              const values = sample.map((r) => r[i]).filter(Boolean).slice(0, 3);
              const field = columns[h];
              return (
                <tr key={h} className="border-b border-rule last:border-b-0">
                  <td className="px-5 py-2.5 font-medium whitespace-nowrap">{h}</td>
                  <td className="max-w-[360px] px-3 py-2.5 text-ink-3">
                    <span className="block truncate">{values.length ? values.join(" · ") : "—"}</span>
                  </td>
                  <td className="px-5 py-2">
                    <Select
                      value={field ?? ""}
                      onChange={(e) => assign(h, (e.target.value || null) as FieldKey | null)}
                      className={field ? "" : "text-ink-3"}
                      aria-label={`Field for column ${h}`}
                    >
                      <option value="">Don&apos;t import</option>
                      {FIELDS.filter((f) => recordType === "quote" || !f.quoteOnly).map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px]">
          {missing.length ? (
            <span className="text-caution">Still needed: {missing.join(", ")}</span>
          ) : !hasCurrencyColumn && !currency ? (
            <span className="text-ink-3">No currency: every line will ask you to choose one.</span>
          ) : (
            <span className="text-ink-3">
              {hasCurrencyColumn ? "Currency read from the file." : `Amounts in ${currency}.`} Nothing is saved until you approve.
            </span>
          )}
          {error && <div className="mt-1 text-up">{error}</div>}
        </div>
        <button
          type="button"
          disabled={pending || missing.length > 0}
          className={buttonClass("primary")}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await saveMapping(sessionId, { columns, recordType, defaultCurrency: currency || null });
              if (!res.ok) setError(res.error ?? "Something went wrong.");
              else router.refresh();
            })
          }
        >
          {pending ? "Reading rows…" : "Continue"} {!pending && <ArrowRight size={14} />}
        </button>
      </div>
    </div>
  );
}
