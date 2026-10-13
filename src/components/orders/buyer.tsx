"use client";

/**
 * What the buyer does in Direct Order: request an order, answer the
 * supplier's changes, cancel, mark as received, invite a supplier, say which
 * of its own products an article is. Every button calls a server action that
 * checks again who is asking and whether it can be done — what a page shows
 * is never what decides.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  addWorkspaceUserAction, askConditionsAction, cancelOrderAction, completeOrderAction, decideProposalAction, inviteCompanyAction, markOrdersReadAction, requestOrderAction, revokeInviteAction, sendDraftAction,
  setDirectOrderAction, setWorkspaceUserDisabledAction, tieListingAction, type OrderResult,
} from "@/app/order-actions";
import type { CategoryTree, Selection } from "@/lib/catalog/tree";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { parseNumber } from "@/lib/import/normalize/numbers";
import { orderAmounts } from "@/lib/orders/flow";
import { checkQuantity } from "@/lib/orders/ready";
import { PERMISSIONS, PERMISSION_LABEL, ROLES, ROLE_LABEL, type ListingState, type Permission, type Role } from "@/lib/orders/types";
import type { Destination } from "@/server/destinations";
import type { Listing } from "@/server/order-catalog";
import type { RecordRef } from "@/server/orgs";
import { ProductCategoryPicker } from "../catalog/category-picker";
import { Field, FormError, Input, Select, Sheet, Textarea, useSheet } from "../form-kit";
import { buttonClass, cx, type Variant } from "../ui";
import { AmountLines, Facts, TermsFacts } from "./shared";

/** Runs an action, says what went wrong, and shows the page as it is afterwards. */
function useRun() {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** `stay`: the page is not read again yet — for an answer that must stay on screen (a link shown once). */
  const run = <R,>(action: () => Promise<OrderResult<R>>, after?: (res: { ok: true } & R) => void, stay = false) =>
    start(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      after?.(res);
      if (!stay) router.refresh();
    });
  const problem = error ? (
    <span role="alert" className="text-[12.5px] text-up">
      {error}
    </span>
  ) : null;
  return { busy, run, error, problem };
}

const placeOf = (d: Pick<Destination, "city" | "province" | "country">) => [d.province ? `${d.city} (${d.province})` : d.city, d.country].filter(Boolean).join(", ");

// ---------------- Requesting an order ----------------

export interface OrderPreset {
  quantity: number;
  destinationId: string | null;
  /** What changed since the order being repeated, in words. */
  notes: string[];
}

/**
 * The button and its panel: quantity, destination, a date if wanted, notes —
 * then the conditions to read before sending. It is a request: the panel says
 * so, and never shows a total that cannot be worked out.
 */
export function RequestOrder({ listing, destinations, preset, label, variant = "primary", size = "md" }: { listing: Listing; destinations: Destination[]; preset?: OrderPreset; label?: string; variant?: Variant; size?: "sm" | "md" }) {
  const t = useT();
  const sheet = useSheet();
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={sheet.show}>
        {label ?? t("Request order")}
      </button>
      <Sheet open={sheet.open} onClose={sheet.hide} title={t("Request an order")} description={`${[listing.code, listing.name].filter(Boolean).join(" · ")} — ${listing.supplierName}`} wide>
        {sheet.open && <RequestForm key={sheet.version} listing={listing} destinations={destinations} preset={preset} onClose={sheet.hide} />}
      </Sheet>
    </>
  );
}

function RequestForm({ listing, destinations, preset, onClose }: { listing: Listing; destinations: Destination[]; preset?: OrderPreset; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const { busy, run, error } = useRun();
  const terms = listing.terms!;
  // One key per opening of the panel: however many times the button is pressed, one request.
  const key = useMemo(() => crypto.randomUUID(), []);
  const first = destinations.find((d) => d.id === preset?.destinationId) ?? destinations.find((d) => d.isDefault) ?? destinations[0] ?? null;
  const [quantity, setQuantity] = useState(preset ? f.number(preset.quantity, 4) : "");
  const [destinationId, setDestinationId] = useState(first?.id ?? "");
  const [wantedDate, setWantedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<"form" | "review">("form");
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = parseNumber(quantity, "comma").value;
  const destination = destinations.find((d) => d.id === destinationId) ?? null;
  const amounts = parsed != null && parsed > 0 ? orderAmounts({ quantity: parsed, unitPrice: terms.unitPrice!, currency: terms.currency!, unit: listing.unit, terms, destinationCity: destination?.city ?? null, transportCost: null }, t) : null;

  const review = () => {
    const check = checkQuantity(parsed, terms, listing.unit, t);
    if (!check.ok) return setProblem(check.message);
    if (!destination) return setProblem(t("Choose where the goods go."));
    setProblem(null);
    setStep("review");
  };
  const submit = (send: boolean) =>
    run(
      () => requestOrderAction({ idempotencyKey: key, orderProductId: listing.orderProductId, quantity: parsed!, destinationId, wantedDate: wantedDate || null, notes: notes.trim() || null, send }),
      (res) => {
        onClose();
        router.push(`/orders/${res.id}`);
      },
    );

  if (step === "form")
    return (
      <div className="flex min-h-0 flex-1 flex-col text-left">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <FormError message={problem ?? undefined} />
          {preset && preset.notes.length > 0 && (
            <div className="mb-4 rounded-md bg-caution-wash px-3 py-2 text-[13px] text-caution">
              <div className="font-medium">{t("Since the order you are repeating:")}</div>
              <ul className="mt-1 list-disc pl-4">
                {preset.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Quantity ({unit})", { unit: listing.unit })} required hint={terms.quantityStep != null ? t("Minimum {min}, in steps of {step}", { min: f.quantity(terms.minQuantity, listing.unit), step: f.quantity(terms.quantityStep, listing.unit) }) : t("Minimum {min}", { min: f.quantity(terms.minQuantity, listing.unit) })}>
              <Input inputMode="decimal" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field label={t("Destination")} required hint={destinations.length === 0 ? t("No destination on file: add one in Settings.") : undefined}>
              <Select value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
                {destinations.length === 0 && <option value="">—</option>}
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {placeOf(d)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Delivery wanted by")} hint={t("Only if you need one: otherwise the supplier's lead time holds.")}>
              <Input type="date" value={wantedDate} onChange={(e) => setWantedDate(e.target.value)} />
            </Field>
            <Field label={t("Notes for the supplier")} className="sm:col-span-2">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          <div className="mt-5 rounded-md border border-rule bg-well px-4 py-3">
            <div className="mb-2 text-[12px] font-medium text-ink-3">{listing.reserved ? t("Conditions agreed with you") : t("The supplier's conditions")}</div>
            <TermsFacts terms={terms} unit={listing.unit} />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">
          <button type="button" className={buttonClass("primary")} onClick={review}>
            {t("Review before sending")}
          </button>
          <button type="button" className={buttonClass("ghost")} onClick={onClose}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col text-left">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <FormError message={error ?? undefined} />
        <Facts
          rows={[
            [t("Supplier"), listing.supplierName],
            [t("Article"), [listing.code, listing.name].filter(Boolean).join(" · ")],
            [t("Specification"), listing.description],
            [t("Quantity"), <span key="q" className="num font-medium">{f.quantity(parsed, listing.unit)}</span>],
            [t("Destination"), destination ? [destination.recipient, destination.address, placeOf(destination)].filter(Boolean).join(", ") : null],
            [t("Delivery wanted"), wantedDate ? f.date(wantedDate) : t("no date asked")],
            ...(notes.trim() ? ([[t("Notes"), notes.trim()]] as [string, ReactNode][]) : []),
          ]}
        />
        <div className="mt-4 border-t border-rule pt-4">{amounts && <AmountLines amounts={amounts} />}</div>
        <div className="mt-4 border-t border-rule pt-4">
          <TermsFacts terms={terms} unit={listing.unit} />
        </div>
        <div className="mt-4 flex flex-col gap-2 text-[13px]">
          {amounts && amounts.open.length > 0 && <p className="rounded-md bg-caution-wash px-3 py-2 text-caution">{t("The supplier has to confirm the transport before this can be an order: you will see its answer, and nothing is confirmed without you.")}</p>}
          {destination && !destination.address && <p className="rounded-md bg-wash px-3 py-2 text-ink-2">{t("This destination has no street address on file: the supplier will read only the town. You can complete it in Settings.")}</p>}
          <p className="text-ink-3">{t("This is a request, not an order yet: it becomes a confirmed order only when the supplier accepts it. If the supplier proposes changes, nothing is confirmed until you accept them.")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" className={buttonClass("primary")} disabled={busy} onClick={() => submit(true)}>
          {busy ? t("Sending…") : t("Send order request")}
        </button>
        <button type="button" className={buttonClass("secondary")} disabled={busy} onClick={() => submit(false)}>
          {t("Save as draft")}
        </button>
        <button type="button" className={buttonClass("ghost")} disabled={busy} onClick={() => setStep("form")}>
          {t("Back")}
        </button>
      </div>
    </div>
  );
}

/** For an article that cannot be ordered yet: ask the supplier, through the channel, for its conditions or for a renewed price. */
export function AskConditions({ orderProductId, state, size = "md" }: { orderProductId: string; state: ListingState; size?: "sm" | "md" }) {
  const t = useT();
  const { busy, run, problem } = useRun();
  const [asked, setAsked] = useState<boolean | null>(null);
  if (state === "suspended") return <span className="text-[13px] text-ink-3">{t("Orders temporarily suspended")}</span>;
  if (state === "order_ready") return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass("secondary", size)} disabled={busy || asked != null} onClick={() => run(() => askConditionsAction(orderProductId), (res) => setAsked(res.asked))}>
        {state === "expired" ? t("Request update") : t("Request a quotation")}
      </button>
      {asked === true && <span className="text-[12.5px] text-down">{t("Asked: the supplier has been told in its portal.")}</span>}
      {asked === false && <span className="text-[12.5px] text-ink-3">{t("Already asked: the supplier has not read it yet.")}</span>}
      {problem}
    </span>
  );
}

// ---------------- An order ----------------

/** The buyer's answer to the supplier's changes. Another article is approved in so many words, apart from the rest. */
export function ProposalDecision({ orderId, specChange, article }: { orderId: string; specChange: boolean; article: string | null }) {
  const t = useT();
  const { busy, run, problem } = useRun();
  const [approved, setApproved] = useState(false);
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {specChange && (
        <label className="flex items-start gap-2.5 rounded-md bg-caution-wash px-3 py-2.5 text-[13px] text-caution">
          <input type="checkbox" className="mt-0.5" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
          <span>{t("The supplier proposes another article ({article}). I have checked its specification and approve it in place of the one I asked for.", { article: article ?? "" })}</span>
        </label>
      )}
      <Field label={t("A note for the supplier")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("primary")} disabled={busy || (specChange && !approved)} onClick={() => run(() => decideProposalAction(orderId, true, { specApproved: approved, note: note || null }))}>
          {t("Accept changes")}
        </button>
        <button type="button" className={buttonClass("secondary")} disabled={busy} onClick={() => run(() => decideProposalAction(orderId, false, { note: note || null }))}>
          {t("Reject changes")}
        </button>
        {problem}
      </div>
      <p className="text-[12.5px] text-ink-3">{t("Accepting confirms the order as changed. Rejecting sends the request back to the supplier as you first wrote it.")}</p>
    </div>
  );
}

/** What the buyer can still do to an order of its own: what the server said is possible, nothing more. */
export function OrderButtons({ orderId, can }: { orderId: string; can: string[] }) {
  const t = useT();
  const { busy, run, problem } = useRun();
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!can.some((a) => a === "send" || a === "cancel" || a === "complete")) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {can.includes("send") && (
        <button
          type="button"
          className={buttonClass("primary")}
          disabled={busy}
          onClick={() => run(() => sendDraftAction(orderId), (res) => setNote(res.refreshed ? t("The supplier's conditions changed since this draft was written: it now shows the new ones. Read them, then send.") : null))}
        >
          {t("Send order request")}
        </button>
      )}
      {can.includes("complete") && (
        <button type="button" className={buttonClass("secondary")} disabled={busy} onClick={() => run(() => completeOrderAction(orderId))}>
          {t("Mark as received")}
        </button>
      )}
      {can.includes("cancel") &&
        (armed ? (
          <button type="button" className={buttonClass("danger")} disabled={busy} onClick={() => run(() => cancelOrderAction(orderId, null))}>
            {t("Yes, cancel it")}
          </button>
        ) : (
          <button type="button" className={buttonClass("ghost")} disabled={busy} onClick={() => setArmed(true)}>
            {can.includes("send") ? t("Delete draft") : t("Cancel request")}
          </button>
        ))}
      {note && <span className="basis-full text-[12.5px] text-caution">{note}</span>}
      {problem}
    </div>
  );
}

export function MarkOrdersRead({ orderId }: { orderId?: string }) {
  const t = useT();
  const { busy, run } = useRun();
  return (
    <button type="button" className="text-[12.5px] font-medium text-ledger hover:underline disabled:opacity-50" disabled={busy} onClick={() => run(() => markOrdersReadAction(orderId))}>
      {t("Mark as read")}
    </button>
  );
}

// ---------------- The channel with a supplier ----------------

/** Invites a company the buyer knows. The link is shown once, to be sent by the buyer: the app sends nothing. */
export function InviteCompany({ record, defaultEmail }: { record: RecordRef; defaultEmail: string | null }) {
  const t = useT();
  const { busy, run, problem } = useRun();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [made, setMade] = useState<{ url: string; until: string } | null>(null);
  const [copied, setCopied] = useState(false);
  if (made)
    return (
      <div className="flex flex-col gap-2 text-[13px]">
        <p className="text-ink-2">{t("Send this link yourself to the person you deal with at the company: the app sends nothing. It can be used once, until {date}, and is not shown again.", { date: f.date(made.until.slice(0, 10)) })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-[12px]" aria-label={t("Invitation link")} />
          <button
            type="button"
            className={buttonClass("primary")}
            onClick={() => {
              void navigator.clipboard?.writeText(made.url).then(() => setCopied(true));
            }}
          >
            {copied ? t("Copied") : t("Copy")}
          </button>
          {/* The link is not on file: leaving this view is the last time it is seen. */}
          <button type="button" className={buttonClass("ghost")} onClick={() => setMade(null)}>
            {t("Done: I have the link")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("Email of the person at the supplier")} className="min-w-0 flex-1 basis-[260px]">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
      </Field>
      <button type="button" className={buttonClass("primary")} disabled={busy || !email.trim()} onClick={() => run(() => inviteCompanyAction(record, email), (res) => setMade({ url: `${window.location.origin}${res.path}`, until: res.expiresAt }), true)}>
        {t("Create invitation link")}
      </button>
      {problem && <span className="basis-full">{problem}</span>}
    </div>
  );
}

export function RevokeInvite({ inviteId }: { inviteId: string }) {
  const t = useT();
  const { busy, run, problem } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-[12.5px] font-medium text-ink-2 hover:text-up hover:underline disabled:opacity-50" disabled={busy} onClick={() => run(() => revokeInviteAction(inviteId))}>
        {t("Withdraw invitation")}
      </button>
      {problem}
    </span>
  );
}

/** The buyer says which of its own products a supplier's article is. It ties the two for ordering; it is not a technical validation of anything. */
export function TieProduct({ orderProductId, tree, tied }: { orderProductId: string; tree: CategoryTree; tied: { id: string; name: string } | null }) {
  const t = useT();
  const { busy, run, problem } = useRun();
  const [picked, setPicked] = useState<Selection>({ category: null, subcategory: null, product: null });
  if (tied)
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-ink-3">{t("Your product:")}</span>
        <Link href={`/products/${tied.id}`} className="font-medium text-ledger hover:underline">
          {tied.name}
        </Link>
        <button type="button" className="text-ink-3 hover:text-up hover:underline disabled:opacity-50" disabled={busy} onClick={() => run(() => tieListingAction(orderProductId, null))}>
          {t("untie")}
        </button>
        {problem}
      </span>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ProductCategoryPicker tree={tree} value={picked} onChange={setPicked} mode="product" placeholder={t("Which of your products is it?")} className="w-full @xl:w-[300px]" />
      <button type="button" className={buttonClass("secondary", "sm")} disabled={busy || !picked.product} onClick={() => picked.product && run(() => tieListingAction(orderProductId, picked.product!))}>
        {t("Tie to this product")}
      </button>
      {problem}
    </div>
  );
}

// ---------------- Settings ----------------

export function DirectOrderSwitch({ on }: { on: boolean }) {
  const t = useT();
  const { busy, run, problem } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium", on ? "bg-down-wash text-down" : "bg-wash text-ink-3")}>{on ? t("Switched on") : t("Switched off")}</span>
      <button type="button" className={buttonClass(on ? "secondary" : "primary")} disabled={busy} onClick={() => run(() => setDirectOrderAction(!on))}>
        {on ? t("Switch off") : t("Switch on Direct Order")}
      </button>
      {problem}
    </div>
  );
}

const BUYER_PERMISSIONS = PERMISSIONS.buyer as readonly Permission[];

/** A person who can sign in to the workspace when it runs on a server: an admin, or a member with what they may do. */
export function WorkspaceUserForm() {
  const t = useT();
  const { busy, run, problem } = useRun();
  const [v, setV] = useState({ name: "", email: "", password: "" });
  const [role, setRole] = useState<Role>("member");
  const [permissions, setPermissions] = useState<Permission[]>(["order.send"]);
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 @3xl:grid-cols-4">
        <Field label={t("Name")}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label={t("Email")}>
          <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field label={t("Password")} hint={t("At least 10 characters. It is kept only as a hash.")}>
          <Input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        </Field>
        <Field label={t("Role")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(ROLE_LABEL.buyer[r])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {role === "member" ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {BUYER_PERMISSIONS.map((p) => (
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
        <button
          type="button"
          className={buttonClass("secondary")}
          disabled={busy || !v.name || !v.email || !v.password}
          onClick={() =>
            run(
              () => addWorkspaceUserAction({ ...v, role, permissions }),
              () => {
                setV({ name: "", email: "", password: "" });
                setDone(true);
              },
            )
          }
        >
          {t("Add person")}
        </button>
        {done && <span className="text-[12.5px] text-down">{t("Saved.")}</span>}
        {problem}
      </div>
    </div>
  );
}

export function WorkspaceUserToggle({ userId, disabled }: { userId: string; disabled: boolean }) {
  const t = useT();
  const { busy, run, problem } = useRun();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="text-[12.5px] font-medium text-ink-2 hover:underline disabled:opacity-50" disabled={busy} onClick={() => run(() => setWorkspaceUserDisabledAction(userId, !disabled))}>
        {disabled ? t("Let in again") : t("Switch off|account")}
      </button>
      {problem}
    </span>
  );
}
