import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings-form";
import { LanguageChoice } from "@/components/shell/language";
import { DestinationForm } from "@/components/replies/offer-controls";
import { ButtonLink, Disclosure, PageHeader, Section } from "@/components/ui";
import { getDb } from "@/db";
import { placeOf, readDestinations } from "@/server/destinations";
import { BASE_CURRENCY } from "@/lib/config";
import { getDataset, getSettings, getT } from "@/lib/data";
import { DirectOrderSwitch, WorkspaceUserForm, WorkspaceUserToggle } from "@/components/orders/buyer";
import { workspaceAccess } from "@/lib/auth/cookie";
import { PERMISSION_LABEL, ROLE_LABEL } from "@/lib/orders/types";
import { readOrg } from "@/server/orgs";
import { directOrderOn, workspacePrincipal } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Settings") };
}

export default async function SettingsPage() {
  const [s, data, t] = await Promise.all([getSettings(), getDataset(), getT()]);
  const destinations = await readDestinations(await getDb());
  const demo = data.purchases.some((p) => p.source === "demo");
  const signIn = workspaceAccess() === "login";
  const ordersOn = await directOrderOn();
  const who = await workspacePrincipal();
  const org = who ? await readOrg(await getDb(), who.orgId) : null;
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

        <Section title={t("Delivery destinations")} description={t("Where goods are delivered: what a request names as the destination, and what a cost to your plant is worked out to")}>
          {destinations.length === 0 && <p className="mb-4 text-[13.5px] text-ink-3">{t("No destination yet. A town is enough to start: the address can be added and confirmed later, and none is ever taken from an offer.")}</p>}
          <div className="flex flex-col gap-3">
            {destinations.map((d) => (
              <Disclosure
                key={d.id}
                title={placeOf(d)}
                description={[d.isDefault ? t("default") : null, d.confirmedAt ? t("address confirmed") : t("to confirm: the address is not complete or nobody confirmed it")].filter(Boolean).join(" · ")}
              >
                <DestinationForm destination={d} />
              </Disclosure>
            ))}
            <Disclosure title={t("Add a destination")} defaultOpen={destinations.length === 0}>
              <DestinationForm destination={null} />
            </Disclosure>
          </div>
        </Section>

        <Section title={t("Direct Order")} description={t("A private channel for orders with the suppliers you invite: they confirm their conditions, you send order requests, they accept, propose changes or decline. A pilot: free for suppliers, and nothing is sent outside the app.")}>
          <DirectOrderSwitch on={ordersOn} />
          {ordersOn && (
            <p className="mt-3 text-[13px] text-ink-3">
              {t("Invite a supplier from its own page. Its people sign in at /portal — which other companies can reach only when this app runs on a server, with sign-in switched on for your workspace.")}
            </p>
          )}
        </Section>

        {org && (
          <Section
            title={t("People of your company")}
            description={signIn ? t("This workspace asks for a sign-in: only these people can open it.") : t("On this computer the workspace opens without a sign-in. These accounts are for when it runs on a server (WORKSPACE_ACCESS=login): create at least one admin before then.")}
          >
            {org.users.length === 0 ? (
              <p className="mb-4 text-[13.5px] text-ink-3">{t("Nobody yet.")}</p>
            ) : (
              <ul className="mb-4 flex flex-col divide-y divide-rule text-[13px]">
                {org.users.map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                    <span className="min-w-0 flex-1 basis-[220px]">
                      <span className="font-medium">{u.name}</span> <span className="text-ink-3">· {u.email}</span>
                      <span className="block text-[12.5px] text-ink-3">{t(ROLE_LABEL.buyer[u.role])}{u.role === "member" ? ` — ${u.permissions.map((p) => t(PERMISSION_LABEL[p])).join("; ") || t("can only read")}` : ""}</span>
                    </span>
                    {u.disabled && <span className="rounded-full bg-wash px-2 text-[12px] text-ink-3">{t("switched off")}</span>}
                    {u.id !== who?.userId && <WorkspaceUserToggle userId={u.id} disabled={u.disabled} />}
                  </li>
                ))}
              </ul>
            )}
            <Disclosure title={t("Add a person")}>
              <WorkspaceUserForm />
            </Disclosure>
          </Section>
        )}

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
