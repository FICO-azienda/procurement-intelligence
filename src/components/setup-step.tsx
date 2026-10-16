import type { CompanySettings } from "@/lib/data";
import type { T } from "@/lib/i18n";
import { DataControls } from "./data-controls";
import { CompanySetupForm } from "./setup";
import { Card } from "./ui";

/**
 * The first start, wherever it is met first (the home page, the import page, /setup): one form, the reason in one
 * line. While the database is empty, the demo is offered for whoever only wants to look around — it names no company.
 */
export function SetupStep({ t, settings, hasDestination, empty, then }: { t: T; settings: CompanySettings; hasDestination: boolean; empty: boolean; then?: string }) {
  return (
    <div className="mx-auto max-w-[680px] py-6">
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">{t("First, who is your company?")}</h1>
      <p className="mt-2 mb-6 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">
        {t("Before the first import: with your name and VAT number, your own company on an invoice is never taken for a supplier, and your country decides which offers can be set against the prices you pay. One minute; everything can be changed later in Settings.")}
      </p>
      <Card className="p-5">
        <CompanySetupForm
          initial={{ companyName: settings.companyName, country: settings.country, vatNumber: settings.vatNumber, userName: settings.userName, language: settings.language }}
          askDelivery={!hasDestination}
          then={then}
        />
      </Card>
      {empty && (
        <div className="mt-6 border-t border-rule pt-5">
          <p className="mb-2.5 text-[13px] text-ink-3">{t("Only looking around? The demo has example figures of no real company.")}</p>
          <DataControls counts="" state="empty" />
        </div>
      )}
    </div>
  );
}
