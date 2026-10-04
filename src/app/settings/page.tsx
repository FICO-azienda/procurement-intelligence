import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings-form";
import { LanguageChoice } from "@/components/shell/language";
import { ButtonLink, PageHeader, Section } from "@/components/ui";
import { BASE_CURRENCY } from "@/lib/config";
import { getDataset, getSettings, getT } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Settings") };
}

export default async function SettingsPage() {
  const [s, data, t] = await Promise.all([getSettings(), getDataset(), getT()]);
  const demo = data.purchases.some((p) => p.source === "demo");
  const counts = [
    t.n(data.products.length, "{n} product", "{n} products"),
    t.n(data.suppliers.length, "{n} supplier", "{n} suppliers"),
    t.n(data.purchases.length, "{n} purchase", "{n} purchases"),
    t.n(data.quotes.length, "{n} quote", "{n} quotes"),
  ].join(", ");
  return (
    <>
      <PageHeader title={t("Settings")} meta={t("Who you are. Everything else the app works out from your purchases.")} />
      <div className="grid max-w-[880px] grid-cols-1 gap-6">
        <Section title={t("Your company")} description={s.configured ? undefined : t("Tell us the name on your invoices: it keeps the app from mistaking you for a supplier.")}>
          <SettingsForm settings={s} />
        </Section>

        <Section title={t("Language")} description={t("The language of the app. Numbers and dates stay in the Italian format (1.234,56 · 15/09/2026).")}>
          <LanguageChoice />
        </Section>

        <Section title={t("Currency")} description={t("All figures are shown in one currency.")}>
          <p className="text-[13.5px] text-ink-2">
            <span className="font-medium">{BASE_CURRENCY}</span> {t("— purchases in other currencies are converted with the exchange rate you record on each one. Other base currencies are not available yet.")}
          </p>
        </Section>

        <Section title={t("Your data")} description={demo ? t("The app is showing demo data.") : `${counts}.`}>
          <ButtonLink href="/import#data">{demo ? t("Clear the demo data and start with yours") : t("Manage data")}</ButtonLink>
        </Section>
      </div>
    </>
  );
}
