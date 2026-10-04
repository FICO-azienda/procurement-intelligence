"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { removeProductDocumentAction, saveRfqSpecAction, saveTrueCostInputsAction, setBenchmarkMonthAction, setPilotAction, uploadProductDocumentAction, type SourcingResult } from "@/app/actions";
import type { Msg } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import type { Readiness } from "@/lib/sourcing/rfq-spec";
import { Field, Grid, Input, Select, Textarea } from "../form-kit";
import { buttonClass, cx } from "../ui";

export const READINESS_LABEL: Record<Readiness, Msg> = { ready: "RFQ ready", partial: "Partially ready", not_ready: "Not ready" };
const READINESS_TONE: Record<Readiness, string> = { ready: "bg-down-wash text-down", partial: "bg-caution-wash text-caution", not_ready: "bg-up-wash text-up" };

/** Whether a supplier who is not the current one could understand what to quote. */
export function ReadinessPill({ readiness }: { readiness: Readiness }) {
  const t = useT();
  return <span className={cx("inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap", READINESS_TONE[readiness])}>{t(READINESS_LABEL[readiness])}</span>;
}

function useAction() {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; saved?: boolean; errors?: Record<string, string> }>({});
  const run = (fn: () => Promise<SourcingResult>, then?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setState({ error: res.errors ? undefined : (res.error ?? t("Something went wrong.")), errors: res.errors });
      setState({ saved: true });
      router.refresh();
      then?.();
    });
  return { pending, state, run, t, reset: () => setState({}) };
}

export interface SpecVM {
  originalName: string;
  supplierCodes: string[];
  rfqName: string | null;
  suggestedName: string | null;
  technical: string | null;
  application: string | null;
  attributes: string[];
  quantities: string;
  readiness: Readiness;
  missing: string[];
  documents: { id: string; documentId: string; filename: string }[];
}

/**
 * The product as it is described to a supplier who has never sold it to the
 * company: a neutral name, its specification, what it is for, its data sheet.
 * The invoice name and the current supplier's code stay here, on the left of
 * the form — they are never what goes out.
 */
export function RfqSpecForm({ productId, spec }: { productId: string; spec: SpecVM }) {
  const { pending, state, run, t, reset } = useAction();
  const [v, setV] = useState({ rfqName: spec.rfqName ?? "", technical: spec.technical ?? "", application: spec.application ?? "" });
  const file = useRef<HTMLInputElement>(null);
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => {
    reset();
    setV((x) => ({ ...x, [key]: e.target.value }));
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ReadinessPill readiness={spec.readiness} />
        <span className="text-[13px] text-ink-2">
          {spec.readiness === "ready"
            ? t("A supplier who has never sold you this has what it needs to quote it.")
            : spec.readiness === "partial"
              ? t("A request can be prepared, but something is missing.")
              : t("Specification incomplete: a request can't be prepared until the product is described in neutral words.")}
        </span>
      </div>
      {spec.missing.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
          {spec.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <dl className="grid gap-x-8 gap-y-2 text-[13px] @2xl:grid-cols-2">
        <div>
          <dt className="text-[12px] text-ink-3">{t("Name on your documents (never sent)")}</dt>
          <dd className="font-medium">{spec.originalName}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">{t("Current supplier's code (never sent)")}</dt>
          <dd>{spec.supplierCodes.length ? spec.supplierCodes.join(", ") : <span className="text-ink-4">—</span>}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">{t("Read from the name")}</dt>
          <dd>{spec.attributes.length ? spec.attributes.join(" · ") : <span className="text-ink-3">{t("Nothing: the name states no measure or grade")}</span>}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">{t("Unit and quantities")}</dt>
          <dd>{spec.quantities}</dd>
        </div>
      </dl>
      <Grid>
        <Field label={t("Neutral name")} hint={t("What a supplier who does not know your codes would call it.")}>
          <Input value={v.rfqName} onChange={set("rfqName")} placeholder={spec.suggestedName ?? t("e.g. Fully refined paraffin wax 52/54, in slabs")} />
        </Field>
        <Field label={t("Application")} hint={t("What you use it for.")}>
          <Input value={v.application} onChange={set("application")} />
        </Field>
      </Grid>
      <Field label={t("Technical specification")} hint={t("Only what you know: composition, grade, measures, tolerances, standards. Nothing is filled in for you.")}>
        <Textarea value={v.technical} onChange={set("technical")} rows={3} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("primary")} disabled={pending} onClick={() => run(() => saveRfqSpecAction(productId, v))}>
          {pending ? t("Saving…") : t("Save the description")}
        </button>
        {state.saved && <span className="text-[12.5px] text-down">{t("Saved.")}</span>}
        {state.error && <span className="text-[12.5px] text-up">{state.error}</span>}
      </div>
      <div className="border-t border-rule pt-3">
        <div className="text-[12px] text-ink-3">{t("Technical data sheet")}</div>
        <ul className="mt-1.5 space-y-1 text-[13px]">
          {spec.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <FileText size={13} className="text-ink-3" />
              <a href={`/documents/${d.documentId}`} target="_blank" rel="noreferrer" className="text-ledger hover:underline">
                {d.filename}
              </a>
              <button type="button" disabled={pending} aria-label={t("Remove")} className="text-ink-3 hover:text-up" onClick={() => run(() => removeProductDocumentAction(d.id))}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
          {spec.documents.length === 0 && <li className="text-ink-3">{t("None attached. A data sheet says more than any description: attach it, and send it with the request.")}</li>}
        </ul>
        <input
          ref={file}
          type="file"
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (!picked) return;
            const data = new FormData();
            data.set("file", picked);
            run(() => uploadProductDocumentAction(productId, data));
            e.target.value = "";
          }}
        />
        <button type="button" className={cx(buttonClass("secondary", "sm"), "mt-2")} disabled={pending} onClick={() => file.current?.click()}>
          <Paperclip size={13} /> {t("Attach a data sheet")}
        </button>
      </div>
    </div>
  );
}

/** Puts a product in the live pilot, or takes it out. */
export function PilotToggle({ productIds, on, label }: { productIds: string[]; on: boolean; label?: string }) {
  const { pending, run, t } = useAction();
  return (
    <button type="button" disabled={pending} className={buttonClass(on ? "ghost" : "secondary", "sm")} onClick={() => run(() => setPilotAction(productIds, !on))}>
      {label ?? (on ? t("Remove from the pilot") : t("Add to the pilot"))}
    </button>
  );
}

/**
 * What a quote does not say and its true cost needs: transport, duty, other
 * import costs. Empty means "not known" — the true cost is then incomplete,
 * not approximated.
 */
export function TrueCostForm({ quoteId, unit, inputs, needs }: { quoteId: string; unit: string; inputs: { freightPerUnit: number | null; freightBasis: string | null; dutyRatePct: number | null; customsPerUnit: number | null; otherPerUnit: number | null }; needs: { freight: boolean; customs: boolean } }) {
  const { pending, state, run, t, reset } = useAction();
  const text = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));
  const [v, setV] = useState({ freightPerUnit: text(inputs.freightPerUnit), freightBasis: inputs.freightBasis ?? "manual", dutyRatePct: text(inputs.dutyRatePct), customsPerUnit: text(inputs.customsPerUnit), otherPerUnit: text(inputs.otherPerUnit) });
  const set = (key: keyof typeof v) => (e: { target: { value: string } }) => {
    reset();
    setV((x) => ({ ...x, [key]: e.target.value }));
  };
  const e = state.errors ?? {};
  return (
    <div className="space-y-2.5">
      <Grid>
        {needs.freight && (
          <>
            <Field label={t("Freight, € per {unit}", { unit })} error={e.freightPerUnit}>
              <Input value={v.freightPerUnit} onChange={set("freightPerUnit")} inputMode="decimal" placeholder={t("not known")} />
            </Field>
            <Field label={t("The freight figure is")}>
              <Select value={v.freightBasis} onChange={set("freightBasis")}>
                <option value="manual">{t("A figure you have")}</option>
                <option value="estimate">{t("Your estimate")}</option>
                <option value="quote">{t("From the supplier's quote")}</option>
              </Select>
            </Field>
          </>
        )}
        {needs.customs && (
          <>
            <Field label={t("Duty, %")} error={e.dutyRatePct}>
              <Input value={v.dutyRatePct} onChange={set("dutyRatePct")} inputMode="decimal" placeholder={t("not known")} />
            </Field>
            <Field label={t("Other import costs, € per {unit}", { unit })} error={e.customsPerUnit}>
              <Input value={v.customsPerUnit} onChange={set("customsPerUnit")} inputMode="decimal" placeholder={t("not known")} />
            </Field>
          </>
        )}
        <Field label={t("Other costs, € per {unit}", { unit })} error={e.otherPerUnit}>
          <Input value={v.otherPerUnit} onChange={set("otherPerUnit")} inputMode="decimal" placeholder="0" />
        </Field>
      </Grid>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("secondary", "sm")} disabled={pending} onClick={() => run(() => saveTrueCostInputsAction(quoteId, v))}>
          {pending ? t("Saving…") : t("Save and recalculate")}
        </button>
        <span className="text-[12px] text-ink-3">{t("Leave empty what you do not know: the true cost stays incomplete rather than wrong.")}</span>
        {state.error && <span className="text-[12.5px] text-up">{state.error}</span>}
      </div>
    </div>
  );
}

/** The month a published reference is about: its exchange rate is then that month's average, not one day's. */
export function BenchmarkMonth({ id, month }: { id: string; month: string | null }) {
  const { pending, state, run, t } = useAction();
  const [value, setValue] = useState(month ?? "");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
      {t("Reference month")}
      <input type="month" value={value} onChange={(e) => setValue(e.target.value)} className="h-6 rounded border border-rule-strong bg-canvas px-1 text-[11.5px] text-ink" aria-label={t("Reference month")} />
      {value !== (month ?? "") && (
        <button type="button" disabled={pending} className="font-medium text-ledger hover:underline" onClick={() => run(() => setBenchmarkMonthAction(id, value))}>
          {t("Save")}
        </button>
      )}
      {state.error && <span className="text-up">{state.error}</span>}
    </span>
  );
}
