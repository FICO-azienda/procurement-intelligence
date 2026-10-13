import type { Metadata } from "next";
import { CompanyForm, ConditionsAccept, EmailVerify, PortalPassword, UserForm, UserToggle } from "@/components/orders/portal";
import { Disclosure, Section } from "@/components/ui";
import * as f from "@/lib/format";
import { ORG_REQUIREMENTS, ORG_REQUIREMENT_LABEL } from "@/lib/orders/ready";
import { ORDER_CONDITIONS } from "@/lib/orders/conditions";
import { PERMISSION_LABEL, ROLE_LABEL } from "@/lib/orders/types";
import { mailerFromEnv } from "@/server/mail";
import { readOrg } from "@/server/orgs";
import { portal } from "@/server/portal-page";
import { getOutsideT } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getOutsideT())("Company") };
}

export default async function PortalCompany() {
  const { who, db, t } = await portal();
  const org = (await readOrg(db, who.orgId))!;
  const me = org.users.find((u) => u.id === who.userId);
  const canManage = who.permissions.includes("company.manage");
  const mailOn = mailerFromEnv() != null;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t("Company")}</h1>
        <p className="mt-1 max-w-[720px] text-[13.5px] text-ink-3">{t("What every order needs to know about your company. It is asked once, and holds for every article.")}</p>
      </header>

      <div className="rounded-lg border border-rule bg-canvas px-5 py-4">
        <div className="mb-2 text-[13px] font-semibold">{org.gaps.length === 0 ? t("Everything needed to receive orders is in place.") : t("To receive orders, {n} of 5 are in place:", { n: 5 - org.gaps.length })}</div>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {ORG_REQUIREMENTS.map((r) => {
            const ok = !org.gaps.includes(r);
            return (
              <li key={r} className="flex items-center gap-2">
                <span aria-hidden className={ok ? "grid size-4 place-items-center rounded-full bg-down-wash text-[10px] font-bold text-down" : "grid size-4 place-items-center rounded-full border border-rule-strong text-[10px] text-ink-4"}>
                  {ok ? "✓" : ""}
                </span>
                <span className={ok ? "text-ink-2" : "font-medium"}>{t(ORG_REQUIREMENT_LABEL[r])}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <Section title={t("Company data")} description={t("As on your invoices, and where you work from")}>
        {canManage ? <CompanyForm org={org} /> : <p className="text-[13.5px] text-ink-2">{[org.name, org.vatNumber, org.address, org.city, org.country].filter(Boolean).join(" · ")}</p>}
      </Section>

      <Section title={t("Your email address")} description={me ? me.email : undefined}>
        {me?.emailVerified ? (
          <p className="text-[13.5px] text-down">{t("Verified.")}</p>
        ) : (
          <>
            {!mailOn && <p className="mb-3 rounded-md bg-caution-wash px-3 py-2 text-[13px] text-caution">{t("Sending email is not switched on in this installation: a verification code cannot be delivered yet.")}</p>}
            {me && <EmailVerify email={me.email} />}
          </>
        )}
      </Section>

      <Section title={t("Conditions of the order service")} description={org.conditionsAccepted ? t("Accepted by {name} on {date} (version {version})", { name: org.conditionsAccepted.by ?? "—", date: f.date(org.conditionsAccepted.at.slice(0, 10)), version: org.conditionsAccepted.version }) : t("To be read and accepted once, by a person who can act for the company")}>
        {!org.gaps.includes("conditions") ? (
          <Disclosure title={t("Read them again")}>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] text-ink-2">
              {ORDER_CONDITIONS.map((line) => (
                <li key={line}>{t(line)}</li>
              ))}
            </ol>
          </Disclosure>
        ) : canManage ? (
          <ConditionsAccept />
        ) : (
          <p className="text-[13.5px] text-ink-3">{t("An admin of your company has to accept them.")}</p>
        )}
      </Section>

      <Section title={t("People")} description={t("Who can sign in for your company, and what each may do")}>
        <ul className="flex flex-col divide-y divide-rule text-[13px]">
          {org.users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              <span className="min-w-0 flex-1 basis-[220px]">
                <span className="font-medium">{u.name}</span> <span className="text-ink-3">· {u.email}{u.emailVerified ? "" : ` · ${t("address not verified")}`}</span>
                <span className="block text-[12.5px] text-ink-3">{t(ROLE_LABEL.supplier[u.role])}{u.role === "member" ? ` — ${u.permissions.map((p) => t(PERMISSION_LABEL[p])).join("; ") || t("can only read")}` : ""}</span>
              </span>
              {u.disabled && <span className="rounded-full bg-wash px-2 text-[12px] text-ink-3">{t("switched off")}</span>}
              {canManage && u.id !== who.userId && <UserToggle userId={u.id} disabled={u.disabled} />}
            </li>
          ))}
        </ul>
        {canManage && (
          <Disclosure title={t("Add a person")} className="mt-3">
            <UserForm />
          </Disclosure>
        )}
        <Disclosure title={t("Change your password")} className="mt-3">
          <PortalPassword />
        </Disclosure>
      </Section>
    </div>
  );
}
