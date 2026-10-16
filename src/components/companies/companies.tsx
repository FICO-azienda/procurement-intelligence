"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCompanyContactAction, relateCompaniesAction, removeCompanyContactAction, undoCompanyRelationAction, type SimpleResult } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import type { Msg } from "@/lib/i18n";
import type { CompanyRelation } from "@/lib/companies/plan";
import { Combo, Field, Input } from "../form-kit";
import { buttonClass } from "../ui";

export const RELATION_LABEL: Record<CompanyRelation, Msg> = {
  same_company: "The same company",
  same_group: "Of one group",
  subsidiary_of: "Controlled by",
  distributor_of: "Distributes",
  different: "Two different companies",
};

function useRun() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<SimpleResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      after?.();
      router.refresh();
    });
  const problem = error ? (
    <span role="alert" className="text-[12.5px] text-up">
      {error}
    </span>
  ) : null;
  return { pending, run, problem, t };
}

/** Two companies that may be one: a person says the same, one group, or two companies. Nothing is merged without it. */
export function CompanyPairDecision({ a, b }: { a: string; b: string }) {
  const { pending, run, problem, t } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass("primary", "sm")} disabled={pending} onClick={() => run(() => relateCompaniesAction(a, b, "same_company", null))}>
        {t("The same company")}
      </button>
      <button type="button" className={buttonClass("secondary", "sm")} disabled={pending} onClick={() => run(() => relateCompaniesAction(a, b, "same_group", null))}>
        {t("Of one group")}
      </button>
      <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => run(() => relateCompaniesAction(a, b, "different", null))}>
        {t("Two different companies")}
      </button>
      {problem}
    </div>
  );
}

export function UndoRelation({ id, label }: { id: string; label?: string }) {
  const { pending, run, problem, t } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-[12.5px] font-medium text-ledger hover:underline disabled:opacity-50" disabled={pending} onClick={() => run(() => undoCompanyRelationAction(id))}>
        {label ?? t("Take back")}
      </button>
      {problem}
    </span>
  );
}

/** What this company is to another one, said by a person with a note. */
export function RelateCompanyForm({ companyId, others }: { companyId: string; others: { id: string; name: string; hint?: string }[] }) {
  const { pending, run, problem, t } = useRun();
  const [other, setOther] = useState("");
  const [relation, setRelation] = useState<CompanyRelation>("same_group");
  const [note, setNote] = useState("");
  return (
    <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] @2xl:items-end">
      <Field label={t("Another company")}>
        <Combo name="other" value={other} onChange={setOther} options={others.map((o) => ({ id: o.id, label: o.name, hint: o.hint }))} placeholder={t("Type a name")} />
      </Field>
      <Field label={t("What it is to this one")}>
        <select className="h-9 w-full rounded-md border border-rule-strong bg-canvas px-2 text-[13.5px]" value={relation} onChange={(e) => setRelation(e.target.value as CompanyRelation)}>
          {(Object.keys(RELATION_LABEL) as CompanyRelation[]).map((r) => (
            <option key={r} value={r}>
              {t(RELATION_LABEL[r])}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Why")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button type="button" className={buttonClass("secondary")} disabled={pending || !other} onClick={() => run(() => relateCompaniesAction(companyId, other, relation, note || null), () => { setOther(""); setNote(""); })}>
        {t("Save")}
      </button>
      {problem}
    </div>
  );
}

export function ContactForm({ companyId }: { companyId: string }) {
  const { pending, run, problem, t } = useRun();
  const empty = { name: "", role: "", email: "", phone: "" };
  const [v, setV] = useState(empty);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 @3xl:grid-cols-4">
        <Field label={t("Name")}>
          <Input value={v.name} onChange={set("name")} />
        </Field>
        <Field label={t("Role")}>
          <Input value={v.role} onChange={set("role")} />
        </Field>
        <Field label={t("Email")}>
          <Input type="email" value={v.email} onChange={set("email")} />
        </Field>
        <Field label={t("Phone")}>
          <Input value={v.phone} onChange={set("phone")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("secondary")} disabled={pending || !(v.name || v.email || v.phone)} onClick={() => run(() => addCompanyContactAction(companyId, v), () => setV(empty))}>
          {t("Add contact")}
        </button>
        {problem}
      </div>
    </div>
  );
}

export function RemoveContact({ id }: { id: string }) {
  const { pending, run, problem, t } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-[12.5px] text-ink-3 hover:text-up disabled:opacity-50" disabled={pending} onClick={() => run(() => removeCompanyContactAction(id))}>
        {t("Remove")}
      </button>
      {problem}
    </span>
  );
}
