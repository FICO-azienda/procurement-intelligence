"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { saveMapping } from "@/app/import/actions";
import { useT } from "@/lib/i18n/client";
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
  headerless = false,
  initial,
  suggested,
}: {
  sessionId: string;
  headers: string[];
  sample: string[][];
  rowCount: number;
  /** The file had no header row: the proposal comes from the values. */
  headerless?: boolean;
  initial: { columns: ColumnMapping; recordType: RecordType; defaultCurrency: string | null };
  /**
   * What the importer would propose today, when that differs from the columns
   * chosen earlier (the importer has learned new columns since): offered, not applied.
   */
  suggested?: ColumnMapping;
}) {
  const router = useRouter();
  const t = useT();
  const [columns, setColumns] = useState<ColumnMapping>(initial.columns);
  const [recordType, setRecordType] = useState<RecordType>(initial.recordType);
  const [currency, setCurrency] = useState<string>(initial.defaultCurrency ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const missing = missingRequired(columns, recordType);
  const differs = suggested ? headers.filter((h) => (suggested[h] ?? null) !== (columns[h] ?? null)) : [];
  // A file without headers names its columns "Column 1, 2…": say that in the reader's language.
  const columnName = (h: string) => h.replace(/^Column (\d+)/, (_, n: string) => t("Column {n}", { n }));
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
          <h2 className="text-[18px] font-semibold tracking-[-0.015em]">
            {t.n(rowCount, "We found {n} row. Check what each column is.", "We found {n} rows. Check what each column is.")}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {headerless
              ? t("There were no column names, so we looked at the values. Correct anything we got wrong — a number could be a quantity or a price.")
              : t("We filled in the columns we recognised. Correct anything we got wrong; columns you don't need can stay out.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md border border-rule-strong p-0.5" role="radiogroup" aria-label={t("Rows are")}>
            {(["purchase", "quote"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={recordType === kind}
                onClick={() => setRecordType(kind)}
                className={cx(
                  "h-7 rounded-[5px] px-3 text-[13px] transition-colors",
                  recordType === kind ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-wash",
                )}
              >
                {kind === "purchase" ? t("Purchases") : t("Quotes")}
              </button>
            ))}
          </div>
          {!hasCurrencyColumn && (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              {t("Currency")}
              <div className="w-[150px]">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="">{t("Not in the file")}</option>
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </div>
            </label>
          )}
        </div>
      </div>

      {suggested && differs.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-ledger/25 bg-ledger-wash/50 px-5 py-3">
          <div className="min-w-[240px] flex-1 text-[13.5px]">
            <div className="font-semibold">{t.n(differs.length, "We would now read {n} column differently", "We would now read {n} columns differently")}</div>
            <div className="truncate text-ink-3" title={differs.map(columnName).join(", ")}>
              {differs.map(columnName).join(", ")}
            </div>
          </div>
          <button type="button" className={buttonClass("primary", "sm")} onClick={() => setColumns(suggested)}>
            {t("Use the suggested columns")}
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-rule">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-well text-left text-[12px] text-ink-3">
              <th className="h-9 border-b border-rule px-5 font-medium">{headerless ? t("Column") : t("Column in your file")}</th>
              <th className="h-9 border-b border-rule px-3 font-medium">{t("First values")}</th>
              <th className="h-9 w-[240px] border-b border-rule px-5 font-medium">{t("This is the…")}</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h, i) => {
              const values = sample.map((r) => r[i]).filter(Boolean).slice(0, 3);
              const field = columns[h];
              return (
                <tr key={h} className="border-b border-rule last:border-b-0">
                  <td className="px-5 py-2.5 font-medium whitespace-nowrap">{columnName(h)}</td>
                  <td className="max-w-[360px] px-3 py-2.5 text-ink-3">
                    <span className="block truncate">{values.length ? values.join(" · ") : "—"}</span>
                  </td>
                  <td className="px-5 py-2">
                    <Select
                      value={field ?? ""}
                      onChange={(e) => assign(h, (e.target.value || null) as FieldKey | null)}
                      className={field ? "" : "text-ink-3"}
                      aria-label={t("Field for column {name}", { name: columnName(h) })}
                    >
                      <option value="">{t("Leave out")}</option>
                      {FIELDS.filter((f) => recordType === "quote" || !f.quoteOnly).map((f) => (
                        <option key={f.key} value={f.key}>
                          {t(f.label)}
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
            <span className="text-caution">{t("Still needed: {fields}", { fields: missing.map((m) => t(m)).join(", ") })}</span>
          ) : !hasCurrencyColumn && !currency ? (
            <span className="text-ink-3">{t("No currency: every line will ask you to choose one.")}</span>
          ) : (
            <span className="text-ink-3">
              {hasCurrencyColumn ? t("Currency read from the file.") : t("Amounts in {currency}.", { currency })} {t("Nothing is saved until you approve.")}
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
              if (!res.ok) setError(res.error ?? t("Something went wrong."));
              else router.refresh();
            })
          }
        >
          {pending ? t("Reading rows…") : t("Looks right — continue")} {!pending && <ArrowRight size={14} />}
        </button>
      </div>
    </div>
  );
}
