"use client";

import { useActionState } from "react";
import { saveSettings, type FormState } from "@/app/actions";
import type { CompanySettings } from "@/lib/data";
import { useT } from "@/lib/i18n/client";
import { Field, FormError, Grid, Input, SubmitButton } from "./form-kit";

const initial: FormState = { ok: false };

export function SettingsForm({ settings }: { settings: CompanySettings }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveSettings, initial);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} noValidate>
      <FormError message={state.error} />
      <Grid>
        <Field label={t("Company name")} required error={e.companyName}>
          <Input name="companyName" defaultValue={settings.configured ? settings.companyName : ""} placeholder={settings.companyName} aria-invalid={!!e.companyName} />
        </Field>
        <Field label={t("Country")}>
          <Input name="country" defaultValue={settings.country ?? ""} placeholder={t("Italy")} />
        </Field>
        <Field label={t("VAT number")} hint={t("On invoices it tells us which company is you")}>
          <Input name="vatNumber" defaultValue={settings.vatNumber ?? ""} placeholder="IT01234567890" />
        </Field>
        <Field label={t("Your name")} hint={t("Only used to say good morning")}>
          <Input name="userName" defaultValue={settings.userName ?? ""} />
        </Field>
      </Grid>
      <div className="mt-5 flex items-center gap-3">
        <SubmitButton pending={pending}>{t("Save")}</SubmitButton>
        {state.ok && <span className="text-[13px] text-down">{t("Saved.")}</span>}
      </div>
    </form>
  );
}
