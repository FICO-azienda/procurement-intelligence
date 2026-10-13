"use client";

/**
 * What a supplier's person does in the portal. Everything written goes
 * through one entry (`/portal/api`), which establishes who is asking from the
 * portal's own cookie and answers only about that company: a button here is a
 * convenience, never what decides.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import * as f from "@/lib/format";
import { LOCALES, LOCALE_NAME, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { parseNumber } from "@/lib/import/normalize/numbers";
import { ORDER_CONDITIONS } from "@/lib/orders/conditions";
import { TERMS_SOURCE_LABEL, missingTerms, type TermsProposal } from "@/lib/orders/ready";
import {
  DELIVERY_LABEL, DELIVERY_TERMS, EMPTY_TERMS, INCOTERMS_VERSIONS, LEAD_TIMES, LEAD_TIME_LABEL, NAMES_A_PLACE, PAYMENT_LABEL, PAYMENT_TERMS, PERMISSIONS, PERMISSION_LABEL, ROLES, ROLE_LABEL, TERM_FIELD_LABEL, TERM_FIELD_MISSING,
  type DeliveryTerm, type LeadTime, type PaymentTerm, type Permission, type Role, type Terms,
} from "@/lib/orders/types";
import { list } from "@/lib/i18n";
import type { CatalogProposal, PortalProduct, TermsView } from "@/server/order-catalog";
import type { OrderView } from "@/server/orders";
import type { InviteView, OrgView } from "@/server/orgs";
import { Field, FormError, Input, Select, Sheet, Textarea, toInput, useSheet } from "../form-kit";
import { buttonClass, cx } from "../ui";
import { OrderFacts, TermsFacts } from "./shared";

type Called<R> = ({ ok: true } & R) | { ok: false; error: string };

export async function portalCall<R = object>(op: string, args: object = {}): Promise<Called<R>> {
  try {
    const res = await fetch("/portal/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, args }) });
    return (await res.json()) as Called<R>;
  } catch {
    return { ok: false, error: "" };
  }
}

function useCall() {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const call = <R,>(op: string, args: object, after?: (res: { ok: true } & R) => void) =>
    start(async () => {
      setError(null);
      const res = await portalCall<R>(op, args);
      if (!res.ok) return setError(res.error || t("Something went wrong."));
      after?.(res);
      router.refresh();
    });
  const problem = error ? (
    <span role="alert" className="text-[12.5px] text-up">
      {error}
    </span>
  ) : null;
  return { busy, call, error, problem, setError };
}

const num = (v: string) => parseNumber(v, "comma").value;

// ---------------- The frame ----------------

const NAV = [
  { href: "/portal", label: "Orders" },
  { href: "/portal/products", label: "Catalogue and conditions" },
  { href: "/portal/customers", label: "Customers" },
  { href: "/portal/company", label: "Company" },
] as const;

export function PortalNav({ company, user, pending, companies }: { company: string; user: string; pending: number; companies: { orgId: string; orgName: string }[] }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { call } = useCall();
  const active = (href: string) => (href === "/portal" ? pathname === "/portal" || pathname.startsWith("/portal/orders") : pathname.startsWith(href));
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <nav aria-label={t("Main")} className="flex flex-wrap gap-1">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={cx("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13.5px]", active(n.href) ? "bg-ledger font-medium text-white" : "text-white/75 hover:bg-night-2 hover:text-white")}>
            {t(n.label)}
            {n.href === "/portal" && pending > 0 && (
              <span className="num rounded-full bg-white px-1.5 text-[11.5px] font-semibold text-caution" aria-label={t("{n} to handle", { n: pending })}>
                {pending}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-[12.5px] text-white/70">
        <span className="hidden min-w-0 truncate sm:block">
          {user} · {company}
        </span>
        {companies.length > 1 && <span className="hidden text-white/45 lg:block">{t.n(companies.length, "{n} company", "{n} companies")}</span>}
        <button type="button" className="rounded-md px-2 py-1 hover:bg-night-2 hover:text-white" onClick={() => call("signOut", {}, () => router.replace("/portal/login"))}>
          {t("Sign out")}
        </button>
      </div>
    </div>
  );
}

export function PortalLanguage() {
  const locale = useLocale();
  const { call } = useCall();
  return (
    <span className="flex gap-1 text-[12px]">
      {LOCALES.map((l: Locale) => (
        <button key={l} type="button" aria-pressed={l === locale} className={cx("rounded px-1.5 py-0.5", l === locale ? "bg-white/15 text-white" : "text-white/55 hover:text-white")} onClick={() => call("language", { locale: l })}>
          {LOCALE_NAME[l]}
        </button>
      ))}
    </span>
  );
}

// ---------------- Signing in, registering ----------------

export function SignInForm({ side }: { side: "supplier" | "buyer" }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ email: "", password: "" });
  const submit = () =>
    start(async () => {
      setError(null);
      const res = side === "supplier" ? await portalCall("signIn", v) : ((await (await fetch("/login/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) })).json().catch(() => ({ ok: false, error: "" }))) as Called<object>);
      if (!res.ok) return setError(res.error || t("Something went wrong."));
      // The page it leads to is read again from the server, now that the session exists.
      router.replace(side === "supplier" ? "/portal" : "/");
      router.refresh();
    });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormError message={error ?? undefined} />
      <Field label={t("Email")}>
        <Input type="email" autoComplete="username" autoFocus value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      </Field>
      <Field label={t("Password")}>
        <Input type="password" autoComplete="current-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
      </Field>
      <button type="submit" className={buttonClass("primary")} disabled={busy || !v.email || !v.password}>
        {busy ? t("Signing in…") : t("Sign in")}
      </button>
    </form>
  );
}

type RegisterKey = "companyName" | "vatNumber" | "taxCode" | "address" | "postalCode" | "city" | "province" | "country" | "userName" | "email" | "password";

/** Accepting an invitation: the company's data, asked once, and the first person's account. */
export function RegisterForm({ token, invite }: { token: string; invite: InviteView }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState<Record<RegisterKey, string>>({ companyName: invite.companyName, vatNumber: "", taxCode: "", address: "", postalCode: "", city: "", province: "", country: "", userName: "", email: invite.email, password: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const submit = () =>
    start(async () => {
      setError(null);
      const res = await portalCall("acceptInvite", { token, register: v });
      if (!res.ok) return setError(res.error || t("Something went wrong."));
      router.replace("/portal/company");
      router.refresh();
    });
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormError message={error ?? undefined} />
      <div>
        <div className="mb-2 text-[12.5px] font-semibold text-ink-2">{t("Your company")}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Company name")} required className="sm:col-span-2">
            <Input value={v.companyName} onChange={set("companyName")} />
          </Field>
          <Field label={t("VAT number")} hint={t("Or the tax code, if the company has no VAT number.")}>
            <Input value={v.vatNumber} onChange={set("vatNumber")} />
          </Field>
          <Field label={t("Tax code")}>
            <Input value={v.taxCode} onChange={set("taxCode")} />
          </Field>
          <Field label={t("Street and number")} className="sm:col-span-2">
            <Input value={v.address} onChange={set("address")} />
          </Field>
          <Field label={t("Postal code")}>
            <Input value={v.postalCode} onChange={set("postalCode")} />
          </Field>
          <Field label={t("Town")}>
            <Input value={v.city} onChange={set("city")} />
          </Field>
          <Field label={t("Province")}>
            <Input value={v.province} onChange={set("province")} />
          </Field>
          <Field label={t("Country")}>
            <Input value={v.country} onChange={set("country")} />
          </Field>
        </div>
      </div>
      <div>
        <div className="mb-2 text-[12.5px] font-semibold text-ink-2">{t("You")}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Your name")} required>
            <Input autoComplete="name" value={v.userName} onChange={set("userName")} />
          </Field>
          <Field label={t("Your work email")} required hint={t("It will be verified with a code sent to it.")}>
            <Input type="email" autoComplete="username" value={v.email} onChange={set("email")} />
          </Field>
          <Field label={t("Choose a password")} required hint={t("At least 10 characters. It is kept only as a hash.")} className="sm:col-span-2">
            <Input type="password" autoComplete="new-password" value={v.password} onChange={set("password")} />
          </Field>
        </div>
      </div>
      <button type="submit" className={buttonClass("primary")} disabled={busy || !v.companyName || !v.userName || !v.email || !v.password}>
        {busy ? t("Saving…") : t("Accept the invitation and register")}
      </button>
    </form>
  );
}

/** A person already signed in for their company accepts another customer's invitation: only the channel is added. */
export function JoinButton({ token, company }: { token: string; company: string }) {
  const t = useT();
  const router = useRouter();
  const { busy, call, problem } = useCall();
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className={buttonClass("primary")} disabled={busy} onClick={() => call("acceptInvite", { token }, () => router.replace("/portal/customers"))}>
        {t("Accept for {company}", { company })}
      </button>
      {problem}
    </div>
  );
}

// ---------------- The company ----------------

export function CompanyForm({ org }: { org: OrgView }) {
  const t = useT();
  const { busy, call, problem } = useCall();
  const [v, setV] = useState({ name: org.name, vatNumber: org.vatNumber ?? "", taxCode: org.taxCode ?? "", address: org.address ?? "", postalCode: org.postalCode ?? "", city: org.city ?? "", province: org.province ?? "", country: org.country ?? "" });
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => (setDone(false), setV({ ...v, [k]: e.target.value }));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Company name")} className="sm:col-span-2">
          <Input value={v.name} onChange={set("name")} />
        </Field>
        <Field label={t("VAT number")}>
          <Input value={v.vatNumber} onChange={set("vatNumber")} />
        </Field>
        <Field label={t("Tax code")}>
          <Input value={v.taxCode} onChange={set("taxCode")} />
        </Field>
        <Field label={t("Street and number")} className="sm:col-span-2">
          <Input value={v.address} onChange={set("address")} />
        </Field>
        <Field label={t("Postal code")}>
          <Input value={v.postalCode} onChange={set("postalCode")} />
        </Field>
        <Field label={t("Town")}>
          <Input value={v.city} onChange={set("city")} />
        </Field>
        <Field label={t("Province")}>
          <Input value={v.province} onChange={set("province")} />
        </Field>
        <Field label={t("Country")}>
          <Input value={v.country} onChange={set("country")} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("primary")} disabled={busy} onClick={() => call("saveCompany", v, () => setDone(true))}>
          {t("Save")}
        </button>
        {done && <span className="text-[12.5px] text-down">{t("Saved.")}</span>}
        {problem}
      </div>
    </div>
  );
}

/** Verifying the signed-in person's address: a code is sent to it, and typed back here. */
export function EmailVerify({ email }: { email: string }) {
  const t = useT();
  const { busy, call, problem } = useCall();
  const [state, setState] = useState<"idle" | "sent" | "off">("idle");
  const [code, setCode] = useState("");
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {state === "off" && <p className="rounded-md bg-caution-wash px-3 py-2 text-caution">{t("Sending email is not switched on in this installation, so the code cannot be delivered and the address stays unverified. Tell whoever runs the platform.")}</p>}
      {state === "sent" && <p className="text-ink-2">{t("A code was sent to {email}. Type it here: it holds for 30 minutes.", { email })}</p>}
      <div className="flex flex-wrap items-end gap-2">
        {state === "sent" && (
          <Field label={t("Code")} className="w-[140px]">
            <Input inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        {state === "sent" && (
          <button type="button" className={buttonClass("primary")} disabled={busy || code.trim().length < 6} onClick={() => call("verifyEmail", { code })}>
            {t("Verify")}
          </button>
        )}
        <button type="button" className={buttonClass(state === "sent" ? "ghost" : "secondary")} disabled={busy} onClick={() => call<{ sent: boolean; to: string | null }>("sendEmailCode", {}, (res) => setState(res.sent ? "sent" : res.to ? "idle" : "off"))}>
          {state === "sent" ? t("Send a new code") : t("Send me the code")}
        </button>
        {problem}
      </div>
    </div>
  );
}

export function ConditionsAccept() {
  const t = useT();
  const { busy, call, problem } = useCall();
  const [read, setRead] = useState(false);
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-ink-2">
        {ORDER_CONDITIONS.map((line) => (
          <li key={line}>{t(line)}</li>
        ))}
      </ol>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-0.5" checked={read} onChange={(e) => setRead(e.target.checked)} />
        <span>{t("I have read these conditions and accept them for my company.")}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("primary")} disabled={busy || !read} onClick={() => call("acceptConditions", {})}>
          {t("Accept the conditions")}
        </button>
        {problem}
      </div>
    </div>
  );
}

const SUPPLIER_PERMISSIONS = PERMISSIONS.supplier as readonly Permission[];

export function UserForm() {
  const t = useT();
  const { busy, call, problem } = useCall();
  const [v, setV] = useState({ name: "", email: "", password: "" });
  const [role, setRole] = useState<Role>("member");
  const [permissions, setPermissions] = useState<Permission[]>(["order.respond"]);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Name")}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label={t("Email")}>
          <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field label={t("Password")} hint={t("At least 10 characters. A person who has an account already keeps their own.")}>
          <Input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        </Field>
        <Field label={t("Role")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(ROLE_LABEL.supplier[r])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {role === "member" ? (
        <div className="flex flex-col gap-1.5 text-[13px]">
          {SUPPLIER_PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="checkbox" checked={permissions.includes(p)} onChange={(e) => setPermissions(e.target.checked ? [...permissions, p] : permissions.filter((x) => x !== p))} />
              {t(PERMISSION_LABEL[p])}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-3">{t("An admin may do everything, and add or switch off other people.")}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("secondary")} disabled={busy || !v.email} onClick={() => call("addUser", { ...v, role, permissions }, () => setV({ name: "", email: "", password: "" }))}>
          {t("Add person")}
        </button>
        {problem}
      </div>
    </div>
  );
}

export function UserToggle({ userId, disabled }: { userId: string; disabled: boolean }) {
  const t = useT();
  const { busy, call, problem } = useCall();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-[12.5px] font-medium text-ink-2 hover:underline disabled:opacity-50" disabled={busy} onClick={() => call("setUserDisabled", { userId, disabled: !disabled })}>
        {disabled ? t("Let in again") : t("Switch off|account")}
      </button>
      {problem}
    </span>
  );
}

// ---------------- An article ----------------

/** What identifies an article: its code, its name, its technical description, its unit — and the confirmation that they say exactly which one it is. */
export function ProductForm({ product, from, label }: { product?: PortalProduct; from?: CatalogProposal; label?: string }) {
  const t = useT();
  const sheet = useSheet();
  return (
    <>
      <button type="button" className={buttonClass(product ? "ghost" : from ? "secondary" : "primary", product || from ? "sm" : "md")} onClick={sheet.show}>
        {label ?? (product ? t("Edit article") : from ? t("Add to my catalogue") : t("Add an article"))}
      </button>
      <Sheet open={sheet.open} onClose={sheet.hide} title={product ? t("Edit article") : t("Add an article")} description={t("An article can be ordered only when nobody could take it for another: its code, and a description that says the type, the grade or the specification.")}>
        {sheet.open && <ProductFields key={sheet.version} product={product} from={from} onClose={sheet.hide} />}
      </Sheet>
    </>
  );
}

function ProductFields({ product, from, onClose }: { product?: PortalProduct; from?: CatalogProposal; onClose: () => void }) {
  const t = useT();
  const { busy, call, error } = useCall();
  const [v, setV] = useState({ code: product?.code ?? from?.code ?? "", name: product?.name ?? from?.name ?? "", description: product?.description ?? "", unit: product?.unit ?? from?.unit ?? "" });
  const [confirmed, setConfirmed] = useState(product?.specConfirmed ?? false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <FormError message={error ?? undefined} />
        {from && <p className="mb-4 rounded-md bg-wash px-3 py-2 text-[13px] text-ink-2">{from.source === "invoice" ? t("As you wrote it on your invoices to {company}. Check it and complete the technical description.", { company: from.customerName }) : t("As you wrote it on your quotation to {company}. Check it and complete the technical description.", { company: from.customerName })}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Your article code")} required>
            <Input autoFocus value={v.code} onChange={set("code")} />
          </Field>
          <Field label={t("Unit it is sold in")} required hint={t("kg, pcs, l, m…")}>
            <Input value={v.unit} onChange={set("unit")} />
          </Field>
          <Field label={t("Name")} required className="sm:col-span-2">
            <Input value={v.name} onChange={set("name")} />
          </Field>
          <Field label={t("Technical description")} className="sm:col-span-2" hint={t("Type, grade, specification: what a buyer needs to be sure it is the right article. “Wax” is not enough; “fully refined paraffin 52/54, oil content max 0.5%” is.")}>
            <Textarea rows={3} value={v.description} onChange={set("description")} />
          </Field>
        </div>
        <label className="mt-4 flex items-start gap-2.5 text-[13px]">
          <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>{t("I confirm that this code and this description identify exactly one article, with its specification.")}</span>
        </label>
      </div>
      <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">
        <button
          type="button"
          className={buttonClass("primary")}
          disabled={busy || !v.name.trim() || !v.unit.trim()}
          onClick={() => call("saveProduct", { id: product?.id ?? null, ...v, specConfirmed: confirmed, from: from?.buyerProductId ? { relationshipId: from.relationshipId, buyerProductId: from.buyerProductId } : null }, onClose)}
        >
          {busy ? t("Saving…") : t("Save")}
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

// ---------------- The six conditions ----------------

type TermsDraft = {
  unitPrice: string; currency: string; taxesIncluded: boolean | null; minQuantity: string; quantityStep: string; leadTime: LeadTime | null; leadTimeNote: string; delivery: DeliveryTerm | null; deliveryPlace: string;
  incotermsVersion: string; deliveryNote: string; transportIncluded: boolean | null; payment: PaymentTerm | null; paymentNote: string; validUntil: string;
};
const toDraft = (x: Partial<Terms>, base?: TermsDraft): TermsDraft => ({
  unitPrice: x.unitPrice != null ? toInput(x.unitPrice) : (base?.unitPrice ?? ""),
  currency: x.currency ?? base?.currency ?? "EUR",
  // Business prices are stated net of VAT: offered as the starting choice, and the supplier confirms it with the rest.
  taxesIncluded: x.taxesIncluded ?? base?.taxesIncluded ?? false,
  minQuantity: x.minQuantity != null ? toInput(x.minQuantity) : (base?.minQuantity ?? ""),
  quantityStep: x.quantityStep != null ? toInput(x.quantityStep) : (base?.quantityStep ?? ""),
  leadTime: x.leadTime ?? base?.leadTime ?? null,
  leadTimeNote: x.leadTimeNote ?? base?.leadTimeNote ?? "",
  delivery: x.delivery ?? base?.delivery ?? null,
  deliveryPlace: x.deliveryPlace ?? base?.deliveryPlace ?? "",
  incotermsVersion: x.incotermsVersion ?? base?.incotermsVersion ?? "2020",
  deliveryNote: x.deliveryNote ?? base?.deliveryNote ?? "",
  transportIncluded: x.transportIncluded ?? base?.transportIncluded ?? null,
  payment: x.payment ?? base?.payment ?? null,
  paymentNote: x.paymentNote ?? base?.paymentNote ?? "",
  validUntil: x.validUntil ?? base?.validUntil ?? "",
});
const toTerms = (d: TermsDraft): Terms => ({
  ...EMPTY_TERMS, unitPrice: num(d.unitPrice), currency: d.currency.trim().toUpperCase() || null, taxesIncluded: d.taxesIncluded, minQuantity: num(d.minQuantity), quantityStep: d.quantityStep.trim() ? num(d.quantityStep) : null, leadTime: d.leadTime,
  leadTimeNote: d.leadTimeNote.trim() || null, delivery: d.delivery, deliveryPlace: d.delivery && NAMES_A_PLACE.includes(d.delivery) ? d.deliveryPlace.trim() || null : null, incotermsVersion: d.delivery && NAMES_A_PLACE.includes(d.delivery) ? d.incotermsVersion : null,
  deliveryNote: d.delivery === "other" ? d.deliveryNote.trim() || null : null, transportIncluded: d.delivery === "other" ? d.transportIncluded : null, payment: d.payment, paymentNote: d.paymentNote.trim() || null, validUntil: d.validUntil || null,
});

function Chips<V extends string>({ options, value, onChange, label }: { options: readonly V[]; value: V | null; onChange: (v: V) => void; label: (v: V) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={cx("h-8 rounded-md border px-2.5 text-[13px]", value === o ? "border-ledger bg-ledger-wash font-medium text-ledger" : "border-rule-strong bg-canvas text-ink-2 hover:bg-wash")}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}

const Step = ({ n, title, missing, children }: { n: number; title: string; missing: boolean; children: ReactNode }) => (
  <section className="border-t border-rule py-4 first:border-t-0 first:pt-0">
    <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold">
      <span className={cx("grid size-5 place-items-center rounded-full text-[11px] font-semibold", missing ? "bg-wash text-ink-3" : "bg-down-wash text-down")}>{missing ? n : "✓"}</span>
      {title}
    </h3>
    {children}
  </section>
);

/**
 * The button that opens the six conditions of an article — for every customer
 * allowed, or reserved to one. It says what is still missing as the fields
 * are filled, offers what the supplier already stated to that customer, and
 * switches orders on only with the confirmation in so many words.
 */
export function TermsPanel({ product, customer, current, proposals, blockers }: { product: PortalProduct; customer?: { relationshipId: string; name: string }; current: TermsView | null; proposals: (TermsProposal & { customerName: string })[]; blockers: string[] }) {
  const t = useT();
  const sheet = useSheet();
  const active = !!current?.confirmed;
  return (
    <>
      <button type="button" className={buttonClass(active ? "secondary" : "primary", customer ? "sm" : "md")} onClick={sheet.show}>
        {customer ? (active ? t("Change reserved conditions") : t("Reserve conditions for this customer")) : active ? t("Update prices and conditions") : t("Activate Direct Order")}
      </button>
      <Sheet
        open={sheet.open}
        onClose={sheet.hide}
        wide
        title={customer ? t("Conditions reserved to {company}", { company: customer.name }) : active ? t("Update prices and conditions") : t("Activate Direct Order")}
        description={`${[product.code, product.name].filter(Boolean).join(" · ")} — ${customer ? t("Only this customer reads them.") : t("They hold for every customer you allow to order this article.")}`}
      >
        {sheet.open && <TermsFields key={sheet.version} product={product} customer={customer} current={current} proposals={proposals} blockers={blockers} onClose={sheet.hide} />}
      </Sheet>
    </>
  );
}

function TermsFields({ product, customer, current, proposals, blockers, onClose }: { product: PortalProduct; customer?: { relationshipId: string; name: string }; current: TermsView | null; proposals: (TermsProposal & { customerName: string })[]; blockers: string[]; onClose: () => void }) {
  const t = useT();
  const { busy, call, error } = useCall();
  // Reserved conditions start from the ones for everyone: usually only the price differs.
  const [d, setD] = useState<TermsDraft>(() => toDraft(current?.terms ?? (customer ? (product.base?.terms ?? {}) : {})));
  const [confirmed, setConfirmed] = useState(false);
  const [used, setUsed] = useState<string | null>(null);
  const terms = useMemo(() => toTerms(d), [d]);
  const missing = missingTerms(terms);
  const set = <K extends keyof TermsDraft>(k: K, value: TermsDraft[K]) => setD((x) => ({ ...x, [k]: value }));
  // What was stated to one customer is offered for that customer only: never as the price for everyone.
  const offered = proposals.filter((p) => customer && p.relationshipId === customer.relationshipId);
  const elsewhere = !customer ? [...new Set(proposals.map((p) => p.customerName))] : [];
  const save = (confirm: boolean) => call("saveTerms", { orderProductId: product.id, relationshipId: customer?.relationshipId ?? null, terms, confirm }, onClose);
  const canDraft = !customer && !current?.confirmed;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <FormError message={error ?? undefined} />
        <p className={cx("mb-4 rounded-md px-3 py-2 text-[13px]", missing.length ? "bg-wash text-ink-2" : "bg-down-wash text-down")}>
          {missing.length === 0
            ? t("The six conditions are complete: confirm them below to switch orders on.")
            : missing.length === 1
              ? t("You are only missing {what} to activate orders.", { what: t(TERM_FIELD_MISSING[missing[0]]) })
              : t("Still missing: {what}.", { what: list(t, missing.map((m) => t(TERM_FIELD_MISSING[m]))) })}
        </p>
        {blockers.length > 0 && (
          <div className="mb-4 rounded-md bg-caution-wash px-3 py-2 text-[13px] text-caution">
            <div className="font-medium">{t("Before orders can be switched on:")}</div>
            <ul className="mt-1 list-disc pl-4">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        {offered.map((p) => {
          const key = `${p.kind}:${p.date}`;
          return (
            <div key={key} className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-rule px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 basis-[240px] text-ink-2">
                <span className="font-medium text-ink">{t(TERMS_SOURCE_LABEL[p.kind], { company: p.customerName, date: p.date ? f.date(p.date) : "—" })}</span>
                {p.values.unitPrice != null && p.values.currency ? ` · ${f.price(p.values.unitPrice, p.values.currency)}/${product.unit}` : ""}
                {Object.entries(p.asWritten).map(([field, words]) => ` · ${t(TERM_FIELD_LABEL[field as keyof typeof TERM_FIELD_LABEL])}: “${words}”`)}
              </span>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => (setD((x) => toDraft(p.values, x)), setUsed(key))}>
                {used === key ? t("Filled in: check each field") : t("Use these values")}
              </button>
            </div>
          );
        })}
        {elsewhere.length > 0 && <p className="mb-4 text-[12.5px] text-ink-3">{t("What you already stated to {companies} is proposed when you reserve conditions for that customer: one customer's price is never proposed as everyone's.", { companies: list(t, elsewhere) })}</p>}

        <Step n={1} title={t(TERM_FIELD_LABEL.price)} missing={missing.includes("price")}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)]">
            <Field label={t("Unit price")}>
              <Input inputMode="decimal" value={d.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} placeholder="1,45" />
            </Field>
            <Field label={t("Currency")}>
              <Select value={d.currency} onChange={(e) => set("currency", e.target.value)}>
                {["EUR", "USD", "GBP", "CHF"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("Per")}>
              <Input readOnly value={product.unit} className="bg-wash text-ink-2" />
            </Field>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            {[false, true].map((included) => (
              <label key={String(included)} className="flex items-center gap-2">
                <input type="radio" name="taxes" checked={d.taxesIncluded === included} onChange={() => set("taxesIncluded", included)} />
                {included ? t("VAT and taxes included") : t("VAT and taxes not included")}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-3">{t("Whether transport is in the price follows from the delivery terms below.")}</p>
        </Step>

        <Step n={2} title={t(TERM_FIELD_LABEL.minimum)} missing={missing.includes("minimum")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Minimum ({unit})", { unit: product.unit })}>
              <Input inputMode="decimal" value={d.minQuantity} onChange={(e) => set("minQuantity", e.target.value)} placeholder="1.000" />
            </Field>
            <Field label={t("In steps of ({unit})", { unit: product.unit })} hint={t("A pallet, a box: leave empty if any quantity from the minimum is fine.")}>
              <Input inputMode="decimal" value={d.quantityStep} onChange={(e) => set("quantityStep", e.target.value)} placeholder="500" />
            </Field>
          </div>
        </Step>

        <Step n={3} title={t(TERM_FIELD_LABEL.leadTime)} missing={missing.includes("leadTime")}>
          <Chips options={LEAD_TIMES} value={d.leadTime} onChange={(v) => set("leadTime", v)} label={(v) => t(LEAD_TIME_LABEL[v])} />
          {(d.leadTime === "custom" || d.leadTime === "on_schedule") && (
            <Field label={d.leadTime === "custom" ? t("Say the lead time") : t("A note, if useful")} className="mt-2.5">
              <Input value={d.leadTimeNote} onChange={(e) => set("leadTimeNote", e.target.value)} />
            </Field>
          )}
        </Step>

        <Step n={4} title={t(TERM_FIELD_LABEL.delivery)} missing={missing.includes("delivery")}>
          <Chips options={DELIVERY_TERMS} value={d.delivery} onChange={(v) => set("delivery", v)} label={(v) => (v === "other" || v === "existing_agreement" ? t(DELIVERY_LABEL[v]) : v)} />
          {d.delivery && <p className="mt-1.5 text-[12px] text-ink-3">{t(DELIVERY_LABEL[d.delivery])}</p>}
          {d.delivery && NAMES_A_PLACE.includes(d.delivery) && (
            <div className="mt-2.5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
              <Field label={t("Named place")} hint={d.delivery === "DAP" ? t("The price holds delivered to this place only: for another destination the customer asks you to confirm.") : undefined}>
                <Input value={d.deliveryPlace} onChange={(e) => set("deliveryPlace", e.target.value)} />
              </Field>
              <Field label="Incoterms®">
                <Select value={d.incotermsVersion} onChange={(e) => set("incotermsVersion", e.target.value)}>
                  {INCOTERMS_VERSIONS.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {d.delivery === "other" && (
            <div className="mt-2.5 flex flex-col gap-2.5">
              <Field label={t("Say the delivery terms")}>
                <Input value={d.deliveryNote} onChange={(e) => set("deliveryNote", e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                {[true, false].map((included) => (
                  <label key={String(included)} className="flex items-center gap-2">
                    <input type="radio" name="transport" checked={d.transportIncluded === included} onChange={() => set("transportIncluded", included)} />
                    {included ? t("Transport is in the price") : t("Transport is not in the price")}
                  </label>
                ))}
              </div>
            </div>
          )}
        </Step>

        <Step n={5} title={t(TERM_FIELD_LABEL.payment)} missing={missing.includes("payment")}>
          <Chips options={PAYMENT_TERMS} value={d.payment} onChange={(v) => set("payment", v)} label={(v) => t(PAYMENT_LABEL[v])} />
          {(d.payment === "other" || d.payment === "private_agreement") && (
            <Field label={d.payment === "other" ? t("Say the payment terms") : t("A note, if useful")} className="mt-2.5">
              <Input value={d.paymentNote} onChange={(e) => set("paymentNote", e.target.value)} />
            </Field>
          )}
        </Step>

        <Step n={6} title={t(TERM_FIELD_LABEL.validity)} missing={missing.includes("validity")}>
          <Field label={t("These conditions hold until")} hint={t("After this day the article stops taking new orders by itself, until you renew the price. Nothing is deleted.")} className="max-w-[240px]">
            <Input type="date" value={d.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
          </Field>
        </Step>

        <label className="mt-2 flex items-start gap-2.5 rounded-md border border-rule bg-well px-3 py-2.5 text-[13px]">
          <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>{t("I confirm the conditions entered and authorise the receipt of order requests for this article.")}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" className={buttonClass("primary")} disabled={busy || !confirmed || missing.length > 0} onClick={() => save(true)}>
          {busy ? t("Saving…") : current?.confirmed ? t("Confirm the new conditions") : t("Activate orders")}
        </button>
        {canDraft && (
          <button type="button" className={buttonClass("secondary")} disabled={busy} onClick={() => save(false)}>
            {t("Save for later")}
          </button>
        )}
        <button type="button" className={buttonClass("ghost")} onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

/** Pausing new orders for an article and taking them up again; who may order it. */
export function ProductOrders({ product }: { product: PortalProduct }) {
  const t = useT();
  const { busy, call, problem } = useCall();
  if (!product.enabled) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={buttonClass(product.suspended ? "primary" : "ghost", "sm")} disabled={busy} onClick={() => call("setProductOrders", { orderProductId: product.id, action: product.suspended ? "resume" : "suspend" })}>
        {product.suspended ? t("Take orders again") : t("Suspend new orders")}
      </button>
      {problem}
    </span>
  );
}

export function AudienceForm({ product }: { product: PortalProduct }) {
  const t = useT();
  const { busy, call, problem } = useCall();
  const [audience, setAudience] = useState(product.audience);
  const [allowed, setAllowed] = useState(product.customers.filter((c) => c.visible).map((c) => c.relationshipId));
  const changed = audience !== product.audience || (audience === "selected" && allowed.slice().sort().join() !== product.customers.filter((c) => c.visible).map((c) => c.relationshipId).sort().join());
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {(["all", "selected"] as const).map((a) => (
          <label key={a} className="flex items-center gap-2">
            <input type="radio" name={`audience-${product.id}`} checked={audience === a} onChange={() => setAudience(a)} />
            {a === "all" ? t("Every customer I have a channel with") : t("Only the customers I choose")}
          </label>
        ))}
      </div>
      {audience === "selected" && (
        <div className="flex flex-col gap-1 pl-6">
          {product.customers.map((c) => (
            <label key={c.relationshipId} className="flex items-center gap-2">
              <input type="checkbox" checked={allowed.includes(c.relationshipId)} onChange={(e) => setAllowed(e.target.checked ? [...allowed, c.relationshipId] : allowed.filter((x) => x !== c.relationshipId))} />
              {c.name}
            </label>
          ))}
        </div>
      )}
      {changed && (
        <div className="flex items-center gap-3">
          <button type="button" className={buttonClass("secondary", "sm")} disabled={busy} onClick={() => call("setAudience", { orderProductId: product.id, audience, allowed })}>
            {t("Save")}
          </button>
          {problem}
        </div>
      )}
    </div>
  );
}

export function WithdrawReserved({ orderProductId, relationshipId }: { orderProductId: string; relationshipId: string }) {
  const t = useT();
  const { busy, call, problem } = useCall();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-[12.5px] font-medium text-ink-2 hover:text-up hover:underline disabled:opacity-50" disabled={busy} onClick={() => call("withdrawReserved", { orderProductId, relationshipId })}>
        {t("Withdraw: back to the conditions for everyone")}
      </button>
      {problem}
    </span>
  );
}

export function CustomerOrdering({ relationshipId, ordering }: { relationshipId: string; ordering: "allowed" | "blocked" }) {
  const t = useT();
  const { busy, call, problem } = useCall();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={buttonClass(ordering === "blocked" ? "primary" : "ghost", "sm")} disabled={busy} onClick={() => call("setCustomerOrdering", { relationshipId, ordering: ordering === "blocked" ? "allowed" : "blocked" })}>
        {ordering === "blocked" ? t("Take orders from this customer again") : t("Stop taking orders from this customer")}
      </button>
      {problem}
    </span>
  );
}

export function PortalMarkRead() {
  const t = useT();
  const { busy, call } = useCall();
  return (
    <button type="button" className="text-[12.5px] font-medium text-ledger hover:underline disabled:opacity-50" disabled={busy} onClick={() => call("markRead", {})}>
      {t("Mark as read")}
    </button>
  );
}

// ---------------- Answering an order ----------------

/**
 * The three answers to a request, each one click away: accept, propose a
 * change, decline. Accepting shows the whole order once more and asks for the
 * confirmation in so many words; a proposal says that nothing is confirmed
 * until the customer accepts.
 */
export function OrderResponse({ order, alternatives }: { order: OrderView; alternatives: { id: string; label: string }[] }) {
  const t = useT();
  const accept = useSheet();
  const propose = useSheet();
  const reject = useSheet();
  if (!order.can.includes("accept")) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={cx(buttonClass("primary"), "h-9 px-4")} onClick={accept.show}>
          {t("Accept")}
        </button>
        <button type="button" className={cx(buttonClass("secondary"), "h-9 px-4")} onClick={propose.show}>
          {t("Propose changes")}
        </button>
        <button type="button" className={cx(buttonClass("danger"), "h-9 px-4")} onClick={reject.show}>
          {t("Decline")}
        </button>
      </div>
      <Sheet open={accept.open} onClose={accept.hide} wide title={t("Accept order {number}", { number: order.number })} description={t("Read it once more: accepting confirms it.")}>
        {accept.open && <AcceptFields key={accept.version} order={order} onClose={accept.hide} />}
      </Sheet>
      <Sheet open={propose.open} onClose={propose.hide} wide title={t("Propose changes to {number}", { number: order.number })} description={t("Change only what you need to: the rest stays as your customer asked. Nothing is confirmed until your customer accepts.")}>
        {propose.open && <ProposeFields key={propose.version} order={order} alternatives={alternatives} onClose={propose.hide} />}
      </Sheet>
      <Sheet open={reject.open} onClose={reject.hide} title={t("Decline request {number}", { number: order.number })} description={t("Your customer reads the reason.")}>
        {reject.open && <RejectFields key={reject.version} order={order} onClose={reject.hide} />}
      </Sheet>
    </>
  );
}

function AcceptFields({ order, onClose }: { order: OrderView; onClose: () => void }) {
  const t = useT();
  const { busy, call, error } = useCall();
  const open = order.amounts.open.length > 0;
  const needsDate = !order.wantedDate && order.terms.leadTime === "on_schedule";
  const [date, setDate] = useState("");
  const [transport, setTransport] = useState(false);
  const [sure, setSure] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 @container">
        <FormError message={error ?? undefined} />
        <OrderFacts order={order} side="supplier" />
        <div className="mt-5 flex flex-col gap-3 border-t border-rule pt-4">
          <Field label={order.wantedDate ? t("Delivery date (your customer asked by {date})", { date: f.date(order.wantedDate) }) : t("Delivery date")} hint={order.wantedDate ? t("Leave empty to confirm the date asked. A later date is a change: use “Propose changes”.") : needsDate ? t("Your lead time is “on schedule”: say when.") : t("If you know it: otherwise your lead time holds.")} className="max-w-[320px]" required={needsDate}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {open && (
            <label className="flex items-start gap-2.5 rounded-md bg-caution-wash px-3 py-2.5 text-[13px] text-caution">
              <input type="checkbox" className="mt-0.5" checked={transport} onChange={(e) => setTransport(e.target.checked)} />
              <span>{t("Your conditions do not cover this destination. I confirm that the price holds delivered to {where}, with no transport charge. (If there is one, use “Propose changes”.)", { where: order.destination.city })}</span>
            </label>
          )}
          <label className="flex items-start gap-2.5 rounded-md border border-rule bg-well px-3 py-2.5 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            <span>{t("I confirm this order to {company} at the conditions shown above.", { company: order.buyer.name })}</span>
          </label>
          <p className="text-[12.5px] text-ink-3">{t("From this moment the order shows as confirmed to both companies, with the day and the name of who confirmed it, and its conditions are kept as they are: changing your prices later does not change it. What a confirmation means in law between the two companies depends on your own agreements.")}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" className={buttonClass("primary")} disabled={busy || !sure || (open && !transport) || (needsDate && !date)} onClick={() => call("acceptOrder", { orderId: order.id, deliveryDate: date || null, transportConfirmed: transport }, onClose)}>
          {busy ? t("Saving…") : t("Confirm the order")}
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

function ProposeFields({ order, alternatives, onClose }: { order: OrderView; alternatives: { id: string; label: string }[]; onClose: () => void }) {
  const t = useT();
  const { busy, call, error } = useCall();
  const open = order.amounts.open.length > 0;
  const [v, setV] = useState({ unitPrice: "", quantity: "", deliveryDate: "", transportCost: "", delivery: "", deliveryPlace: "", deliveryNote: "", payment: "", paymentNote: "", product: "", note: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const changes = {
    ...(v.unitPrice.trim() ? { unitPrice: num(v.unitPrice) } : {}),
    ...(v.quantity.trim() ? { quantity: num(v.quantity) } : {}),
    ...(v.deliveryDate ? { deliveryDate: v.deliveryDate } : {}),
    ...(v.transportCost.trim() ? { transportCost: num(v.transportCost) } : {}),
    ...(v.delivery ? { delivery: { term: v.delivery, place: v.deliveryPlace || null, note: v.deliveryNote || null } } : {}),
    ...(v.payment ? { payment: { term: v.payment, note: v.paymentNote || null } } : {}),
    ...(v.product ? { product: { orderProductId: v.product, name: alternatives.find((a) => a.id === v.product)?.label ?? "", unit: order.line.unit } } : {}),
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <FormError message={error ?? undefined} />
        <p className="mb-4 rounded-md bg-wash px-3 py-2 text-[13px] text-ink-2">
          {t("Asked: {quantity} of {article} at {price}, to {where}{date}.", { quantity: f.quantity(order.line.quantity, order.line.unit), article: order.line.name, price: `${f.price(order.line.unitPrice, order.line.currency)}/${order.line.unit}`, where: order.destination.city, date: order.wantedDate ? ` — ${t("by {date}", { date: f.date(order.wantedDate) })}` : "" })}
        </p>
        {open && <p className="mb-4 rounded-md bg-caution-wash px-3 py-2 text-[13px] text-caution">{t("Your conditions do not cover this destination: state the transport for this order — 0 if it is in the price.")}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Another price ({currency}/{unit})", { currency: order.line.currency, unit: order.line.unit })}>
            <Input inputMode="decimal" value={v.unitPrice} onChange={set("unitPrice")} placeholder={toInput(order.line.unitPrice)} />
          </Field>
          <Field label={t("Another quantity ({unit})", { unit: order.line.unit })}>
            <Input inputMode="decimal" value={v.quantity} onChange={set("quantity")} placeholder={f.number(order.line.quantity, 4)} />
          </Field>
          <Field label={t("Delivery date")}>
            <Input type="date" value={v.deliveryDate} onChange={set("deliveryDate")} />
          </Field>
          <Field label={t("Transport for this order ({currency})", { currency: order.line.currency })} required={open} hint={t("For the whole order. 0: in the price, delivered to the customer's destination.")}>
            <Input inputMode="decimal" value={v.transportCost} onChange={set("transportCost")} />
          </Field>
          <Field label={t("Other delivery terms")}>
            <Select value={v.delivery} onChange={set("delivery")}>
              <option value="">{t("As asked")}</option>
              {DELIVERY_TERMS.map((d) => (
                <option key={d} value={d}>
                  {d === "other" || d === "existing_agreement" ? t(DELIVERY_LABEL[d]) : d}
                </option>
              ))}
            </Select>
          </Field>
          {v.delivery && (
            <Field label={v.delivery === "other" ? t("Say the delivery terms") : t("Named place")}>
              {v.delivery === "other" ? <Input value={v.deliveryNote} onChange={set("deliveryNote")} /> : <Input value={v.deliveryPlace} onChange={set("deliveryPlace")} disabled={v.delivery === "existing_agreement"} />}
            </Field>
          )}
          <Field label={t("Other payment terms")}>
            <Select value={v.payment} onChange={set("payment")}>
              <option value="">{t("As asked")}</option>
              {PAYMENT_TERMS.map((p) => (
                <option key={p} value={p}>
                  {t(PAYMENT_LABEL[p])}
                </option>
              ))}
            </Select>
          </Field>
          {v.payment === "other" && (
            <Field label={t("Say the payment terms")}>
              <Input value={v.paymentNote} onChange={set("paymentNote")} />
            </Field>
          )}
          {alternatives.length > 0 && (
            <Field label={t("Another article in place of the one asked")} className="sm:col-span-2" hint={t("A different specification: your customer has to approve it in so many words.")}>
              <Select value={v.product} onChange={set("product")}>
                <option value="">{t("The article asked")}</option>
                {alternatives.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("A note for your customer")} className="sm:col-span-2">
            <Textarea rows={2} value={v.note} onChange={set("note")} />
          </Field>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" className={buttonClass("primary")} disabled={busy || Object.keys(changes).length === 0} onClick={() => call("proposeChanges", { orderId: order.id, changes, note: v.note || null }, onClose)}>
          {busy ? t("Sending…") : t("Send the proposal to the customer")}
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

function RejectFields({ order, onClose }: { order: OrderView; onClose: () => void }) {
  const t = useT();
  const { busy, call, error } = useCall();
  const [reason, setReason] = useState("");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <FormError message={error ?? undefined} />
        <Field label={t("Why you decline")} required>
          <Textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" className={buttonClass("danger")} disabled={busy || !reason.trim()} onClick={() => call("rejectOrder", { orderId: order.id, reason }, onClose)}>
          {busy ? t("Saving…") : t("Decline the request")}
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={onClose}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}

/** The conditions of an article, read: for everyone, or reserved. */
export function TermsRead({ view, unit }: { view: TermsView; unit: string }) {
  const t = useT();
  return (
    <div>
      <TermsFacts terms={view.terms} unit={unit} />
      <p className="mt-1.5 text-[12px] text-ink-3">{view.confirmed ? t("Confirmed by {name} on {date}", { name: view.confirmedBy ?? "—", date: view.confirmedAt ? f.date(view.confirmedAt.slice(0, 10)) : "—" }) : t("Written down, not confirmed: nothing can be ordered on these yet.")}</p>
    </div>
  );
}

