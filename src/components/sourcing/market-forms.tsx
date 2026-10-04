"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { addBenchmarkAction, deleteBenchmarkAction } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { COMPARABILITY_LABEL, PRICE_TYPE_LABEL, SOURCE_LEVEL_LABEL } from "@/lib/sourcing/types";
import { Field, Grid, Input, Select } from "../form-kit";
import { buttonClass } from "../ui";

const EMPTY = { type: "direct_benchmark", label: "", low: "", high: "", changePct: "", period: "", sourceName: "", sourceUrl: "", sourceDate: "", sourceLevel: "external", comparability: "partial", notes: "" };

/** A market reference the user has: a figure from a report, a public index, trade statistics — with who published it and when. */
export function BenchmarkForm({ productId, unit }: { productId: string; unit: string }) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => {
    setState({});
    setV((x) => ({ ...x, [key]: e.target.value }));
  };
  const field = (key: keyof typeof EMPTY, label: string, opts: { placeholder?: string; required?: boolean; type?: string } = {}) => (
    <Field label={label} error={errors[key]} required={opts.required}>
      <Input value={v[key]} onChange={set(key)} placeholder={opts.placeholder} type={opts.type} />
    </Field>
  );
  const driver = v.type === "cost_driver";
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addBenchmarkAction(productId, unit, v);
          setErrors(res.errors ?? {});
          if (res.ok) {
            setV(EMPTY);
            setState({ saved: true });
            router.refresh();
          } else if (!res.errors) setState({ error: res.error ?? t("Something went wrong.") });
        });
      }}
    >
      <Grid>
        <Field label={t("Kind of reference")}>
          <Select value={v.type} onChange={set("type")}>
            {(["direct_benchmark", "trade_benchmark", "cost_driver"] as const).map((x) => (
              <option key={x} value={x}>
                {t(PRICE_TYPE_LABEL[x])}
              </option>
            ))}
          </Select>
        </Field>
        {field("label", t("What it refers to"), { required: true, placeholder: t("As the source calls it") })}
        {driver ? field("changePct", t("Change, in %"), { required: true, placeholder: "+4,5" }) : field("low", t("Price per {unit}, from", { unit }), { required: true })}
        {driver ? field("period", t("Over which period"), { placeholder: t("e.g. last 3 months") }) : field("high", t("to"))}
        {field("sourceName", t("Source"), { required: true, placeholder: t("Who published it") })}
        {field("sourceDate", t("Date"), { required: true, type: "date" })}
        {field("sourceUrl", t("Page"), { placeholder: "https://…" })}
        <Field label={t("Kind of source")}>
          <Select value={v.sourceLevel} onChange={set("sourceLevel")}>
            {(["official_data", "licensed_data", "external"] as const).map((l) => (
              <option key={l} value={l}>
                {t(SOURCE_LEVEL_LABEL[l])}
              </option>
            ))}
          </Select>
        </Field>
        {!driver && (
          <Field label={t("How close to your product")}>
            <Select value={v.comparability} onChange={set("comparability")}>
              {(["comparable", "partial", "not"] as const).map((c) => (
                <option key={c} value={c}>
                  {t(COMPARABILITY_LABEL[c])}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {field("notes", t("Note"))}
      </Grid>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? t("Saving…") : t("Add reference")}
        </button>
        {state.saved && <span className="text-[12.5px] text-down">{t("Saved.")}</span>}
        {state.error && <span className="text-[12.5px] text-up">{state.error}</span>}
      </div>
    </form>
  );
}

export function DeleteBenchmarkButton({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={t("Remove")}
      className="inline-flex items-center text-ink-4 hover:text-up"
      onClick={() =>
        start(async () => {
          const res = await deleteBenchmarkAction(id);
          if (res.ok) router.refresh();
        })
      }
    >
      <Trash2 size={13} />
    </button>
  );
}
