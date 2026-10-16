"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setupCompanyAction } from "@/app/actions";
import { countryChoices } from "@/lib/countries";
import { LOCALES, type Locale } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import type { SetupErrors, SetupField } from "@/lib/setup";
import { Field, FormError, Input } from "./form-kit";
import { buttonClass, cx } from "./ui";

const LANGUAGE_NAME: Record<Locale, string> = { en: "English", it: "Italiano" };

/**
 * The first start: who the company is. Asked once, before the first import —
 * the name and VAT number keep the company's own name on an invoice from
 * being taken for a supplier, the country decides what can be compared.
 * Everything can be changed later in Settings.
 */
export function CompanySetupForm({ initial, then, askDelivery = true }: { initial: Partial<Record<SetupField, string | null>>; then?: string; askDelivery?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState<Record<SetupField, string>>({
    companyName: initial.companyName ?? "",
    country: initial.country ?? "",
    vatNumber: initial.vatNumber ?? "",
    userName: initial.userName ?? "",
    deliveryCity: initial.deliveryCity ?? "",
    deliveryProvince: initial.deliveryProvince ?? "",
    language: initial.language ?? t.locale,
  });
  const [errors, setErrors] = useState<SetupErrors>({});
  const [error, setError] = useState<string>();
  const set = (k: SetupField) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(undefined);
      const res = await setupCompanyAction(v);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setError(res.error);
        return;
      }
      setErrors({});
      if (then) router.push(then);
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("Company name")} required error={errors.companyName} className="sm:col-span-2">
          <Input value={v.companyName} onChange={set("companyName")} autoComplete="organization" aria-invalid={!!errors.companyName} autoFocus />
        </Field>
        <Field label={t("Country")} required error={errors.country} hint={t("Where your company receives its goods.")}>
          <Input value={v.country} onChange={set("country")} list="setup-countries" autoComplete="country-name" aria-invalid={!!errors.country} />
          <datalist id="setup-countries">
            {countryChoices(t.locale).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label={t("VAT number")} error={errors.vatNumber} hint={t("On invoices it tells us which company is you")}>
          <Input value={v.vatNumber} onChange={set("vatNumber")} aria-invalid={!!errors.vatNumber} />
        </Field>
        {askDelivery && (
          <>
            <Field label={t("Town of delivery")} hint={t("Named in your requests for quotation. You confirm the full address later, in Settings.")}>
              <Input value={v.deliveryCity} onChange={set("deliveryCity")} autoComplete="address-level2" />
            </Field>
            <Field label={t("Province")}>
              <Input value={v.deliveryProvince} onChange={set("deliveryProvince")} className="max-w-[120px]" />
            </Field>
          </>
        )}
        <Field label={t("Your name")} hint={t("Only used to say good morning")}>
          <Input value={v.userName} onChange={set("userName")} autoComplete="name" />
        </Field>
        <fieldset>
          <legend className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{t("Language")}</legend>
          <div role="radiogroup" className="inline-flex rounded-md bg-wash p-0.5">
            {LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={v.language === l}
                onClick={() => setV((p) => ({ ...p, language: l }))}
                className={cx("rounded-[5px] px-3 py-1.5 text-[13px]", v.language === l ? "bg-canvas font-medium shadow-sm" : "text-ink-3")}
              >
                {LANGUAGE_NAME[l]}
              </button>
            ))}
          </div>
          {errors.language && <span className="mt-1 block text-[12px] text-up">{errors.language}</span>}
        </fieldset>
      </div>
      <div>
        <button type="submit" className={buttonClass("primary")} disabled={pending}>
          {pending ? t("Saving…") : t("Save and continue")}
        </button>
      </div>
    </form>
  );
}
