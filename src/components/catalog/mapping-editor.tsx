"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveMappingAction } from "@/app/actions";
import { KIND_LABEL, PRODUCT_KINDS, type ProductKind } from "@/lib/catalog/kinds";
import { useT } from "@/lib/i18n/client";
import { Field, Grid, Input, Select } from "../form-kit";
import { buttonClass } from "../ui";

export interface MappingValues {
  name: string;
  kind: ProductKind;
  category: string;
  subcategory: string;
  family: string;
  variant: string;
}

/**
 * How a product is called and filed — name, category, family, variant —
 * written by the user. Saving marks the product as confirmed; the name it had
 * stays linked to it, and nothing about its purchases changes.
 */
export function MappingEditor({ productId, values, categories, subcategories, families }: { productId: string; values: MappingValues; categories: string[]; subcategories: string[]; families: string[] }) {
  const router = useRouter();
  const t = useT();
  const [v, setV] = useState(values);
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; saved?: boolean }>({});
  const set = (key: keyof MappingValues) => (e: { target: { value: string } }) => {
    setState({});
    setV((x) => ({ ...x, [key]: e.target.value }));
  };
  const text = (key: Exclude<keyof MappingValues, "kind">, label: string, list?: string, placeholder?: string) => (
    <Field label={label}>
      <Input value={v[key]} onChange={set(key)} list={list} placeholder={placeholder} />
    </Field>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveMappingAction(productId, { ...v, category: v.category || null, subcategory: v.subcategory || null, family: v.family || null, variant: v.variant || null });
          if (!res.ok) setState({ error: res.error ?? t("Something went wrong.") });
          else {
            setState({ saved: true });
            router.refresh();
          }
        });
      }}
    >
      <Grid>
        {text("name", t("Name"))}
        <Field label={t("What it is")}>
          <Select value={v.kind} onChange={set("kind")}>
            {PRODUCT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(KIND_LABEL[k])}
              </option>
            ))}
          </Select>
        </Field>
        {text("category", t("Category"), "mapping-categories")}
        {text("subcategory", t("Subcategory"), "mapping-subcategories")}
        {text("family", t("Family"), "mapping-families", t("The product in all its sizes"))}
        {text("variant", t("Variant"), undefined, t("What tells this one apart"))}
      </Grid>
      <datalist id="mapping-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="mapping-subcategories">{subcategories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="mapping-families">{families.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !v.name.trim()} className={buttonClass("primary")}>
          {pending ? t("Saving…") : t("Save")}
        </button>
        {state.saved && <span className="text-[12.5px] text-down">{t("Saved.")}</span>}
        {state.error && <span className="text-[12.5px] text-up">{state.error}</span>}
      </div>
    </form>
  );
}
