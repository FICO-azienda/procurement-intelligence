"use client";

/**
 * What both companies read the same way: the state of an article, the status
 * of an order, the six conditions, what an order is worth, its history. The
 * buttons differ by side and live elsewhere (buyer.tsx, portal.tsx).
 */
import { useState, useTransition, type ReactNode } from "react";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { destinationLine, termsLines } from "@/lib/orders/flow";
import {
  LISTING_LABEL, LISTING_MEANING, NOTIFICATION_TEXT, ORDER_EVENT_LABEL, ORDER_STATUS_LABEL, ORDER_STATUS_LABEL_SUPPLIER, PROPOSAL_FIELD_LABEL, TERM_FIELD_LABEL,
  type ListingState, type OrderStatus, type Side, type Terms,
} from "@/lib/orders/types";
import type { NotificationView, OrderView } from "@/server/orders";
import { changedFields } from "@/lib/orders/flow";
import { Field, Input } from "../form-kit";
import { buttonClass, cx } from "../ui";

const pill = "inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap";

const LISTING_TONE: Record<ListingState, string> = {
  order_ready: "bg-down-wash text-down",
  catalog_ready: "bg-wash text-ink-2",
  expired: "bg-caution-wash text-caution",
  suspended: "border border-rule-strong text-ink-3",
};

/** The state of an article for orders. Not a badge of reliability: it says only whether an order can be requested. */
export function ListingPill({ state }: { state: ListingState }) {
  const t = useT();
  return (
    <span title={t(LISTING_MEANING[state])} className={cx(pill, LISTING_TONE[state])}>
      {t(LISTING_LABEL[state])}
    </span>
  );
}

const STATUS_TONE: Record<OrderStatus, string> = {
  draft: "border border-dashed border-rule-strong text-ink-3",
  pending_supplier: "bg-ledger-wash text-ledger",
  pending_buyer_approval: "bg-caution-wash text-caution",
  confirmed: "bg-down-wash text-down",
  rejected: "bg-up-wash text-up",
  cancelled: "bg-wash text-ink-3",
  expired: "bg-wash text-ink-3",
  completed: "border border-down/30 text-down",
};
/** What needs this side to act stands out; what waits for the other side is quiet. */
const waitsFor = (status: OrderStatus, side: Side) => (status === "pending_supplier" ? side === "supplier" : status === "pending_buyer_approval" ? side === "buyer" : null);

export function OrderStatusPill({ status, side }: { status: OrderStatus; side: Side }) {
  const t = useT();
  const mine = waitsFor(status, side);
  return <span className={cx(pill, mine === false ? "bg-wash text-ink-2" : mine ? "bg-caution-wash text-caution" : STATUS_TONE[status])}>{t((side === "supplier" ? ORDER_STATUS_LABEL_SUPPLIER : ORDER_STATUS_LABEL)[status])}</span>;
}

/** Label and value, in rows that fold to one column when there is no room. */
export function Facts({ rows, className }: { rows: [label: string, value: ReactNode][]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]", className)}>
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-3">{label}</dt>
          <dd className="min-w-0 break-words text-ink">{value ?? <span className="text-ink-4">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

const formats = { price: (n: number, currency: string) => f.price(n, currency), quantity: (n: number, unit: string) => f.quantity(n, unit), date: (d: string) => f.date(d) };

/** The six conditions as stated. What nobody stated is said to be missing — never shown as something. */
export function TermsFacts({ terms, unit, className }: { terms: Terms; unit: string; className?: string }) {
  const t = useT();
  const l = termsLines(terms, unit, formats, t);
  const missing = <span className="text-ink-4">{t("not stated yet")}</span>;
  return (
    <Facts
      className={className}
      rows={[
        [t(TERM_FIELD_LABEL.price), l.price ? `${l.price} · ${l.taxes ?? ""}` : missing],
        [t(TERM_FIELD_LABEL.minimum), l.minimum ?? missing],
        [t(TERM_FIELD_LABEL.leadTime), l.leadTime ?? missing],
        [t(TERM_FIELD_LABEL.delivery), l.delivery ?? missing],
        [t(TERM_FIELD_LABEL.payment), l.payment ?? missing],
        [t(TERM_FIELD_LABEL.validity), l.validity ? t("until {date}", { date: l.validity }) : missing],
      ]}
    />
  );
}

/** What an order is worth, as far as it can be said: goods, transport, and a total only when nothing it depends on is open. */
export function AmountLines({ amounts }: { amounts: OrderView["amounts"] }) {
  const t = useT();
  const taxes = amounts.taxesIncluded == null ? "" : amounts.taxesIncluded ? t("VAT and taxes included") : t("VAT and taxes not included");
  return (
    <div className="text-[13px]">
      <Facts
        rows={[
          [t("Goods"), <span key="g" className="num">{f.money(amounts.goods, amounts.currency)}</span>],
          [
            t("Transport"),
            <span key="t">
              {amounts.transport.state === "stated" && <span className="num mr-1.5">{f.money(amounts.transport.amount, amounts.currency)}</span>}
              <span className={amounts.transport.state === "to_confirm" ? "text-caution" : "text-ink-2"}>{amounts.transport.note}</span>
            </span>,
          ],
          [
            t("Total"),
            amounts.total != null ? (
              <span key="x">
                <span className="num font-semibold">{f.money(amounts.total, amounts.currency)}</span> <span className="text-ink-3">{taxes}</span>
              </span>
            ) : (
              <span key="x" className="text-ink-2">
                {amounts.transport.state === "agreed" ? t("Goods only: what your agreement adds for transport is not on file.") : t("Not determined yet: it depends on the transport.")}
              </span>
            ),
          ],
        ]}
      />
    </div>
  );
}

/** One order, as both companies read it: what, how much, at what price, where and when, on which conditions. */
export function OrderFacts({ order, side }: { order: OrderView; side: Side }) {
  const t = useT();
  const o = order;
  return (
    <div className="grid gap-5 @3xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Facts
          rows={[
            [side === "supplier" ? t("Customer") : t("Supplier"), side === "supplier" ? o.buyer.name : o.supplier.name],
            [t("Article"), <span key="a">{[o.line.code, o.line.name].filter(Boolean).join(" · ")}</span>],
            [t("Specification"), o.line.description],
            [t("Quantity"), <span key="q" className="num font-medium">{f.quantity(o.line.quantity, o.line.unit)}</span>],
            [t("Price"), <span key="p" className="num">{`${f.price(o.line.unitPrice, o.line.currency)}/${o.line.unit}`}{o.terms.reserved ? ` · ${t("reserved to this customer")}` : ""}</span>],
            [t("Destination"), destinationLine(o.destination) || null],
            ...(o.destination.unloading || o.destination.restrictions ? ([[t("Unloading"), [o.destination.unloading, o.destination.restrictions].filter(Boolean).join(" · ")]] as [string, ReactNode][]) : []),
            [t("Delivery wanted"), o.wantedDate ? f.date(o.wantedDate) : t("no date asked")],
            ...(o.deliveryDate ? ([[t("Delivery date given"), f.date(o.deliveryDate)]] as [string, ReactNode][]) : []),
            ...(o.buyerNotes ? ([[t("Customer's notes"), o.buyerNotes]] as [string, ReactNode][]) : []),
          ]}
        />
      </div>
      <div className="flex flex-col gap-4">
        <AmountLines amounts={o.amounts} />
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-3">{t("Conditions the request was made on")}</div>
          <TermsFacts terms={o.terms} unit={o.terms.unit || o.line.unit} />
        </div>
      </div>
    </div>
  );
}

/** What the supplier would change: each thing as asked and as proposed. */
export function ProposalChangesList({ order }: { order: OrderView }) {
  const t = useT();
  const p = order.proposal;
  if (!p) return null;
  const c = p.changes;
  const row = (label: string, before: ReactNode, after: ReactNode) => (
    <div key={label} className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-4 py-1.5 text-[13px]">
      <span className="text-ink-3">{label}</span>
      <span>
        <span className="text-ink-3 line-through decoration-ink-4">{before}</span> <span aria-hidden>→</span> <span className="font-medium">{after}</span>
      </span>
    </div>
  );
  const l = (terms: Terms) => termsLines(terms, order.line.unit, formats, t);
  return (
    <div className="divide-y divide-rule">
      {changedFields(c).map((field) => {
        const label = t(PROPOSAL_FIELD_LABEL[field]);
        if (field === "unitPrice") return row(label, f.price(order.line.unitPrice, order.line.currency), f.price(c.unitPrice!, order.line.currency));
        if (field === "quantity") return row(label, f.quantity(order.line.quantity, order.line.unit), f.quantity(c.quantity!, p.after.line.unit));
        if (field === "deliveryDate") return row(label, order.wantedDate ? f.date(order.wantedDate) : t("no date asked"), f.date(c.deliveryDate!));
        if (field === "delivery") return row(label, l(order.terms).delivery, l(p.after.terms).delivery);
        if (field === "payment") return row(label, l(order.terms).payment, l(p.after.terms).payment);
        if (field === "transportCost") return row(label, order.amounts.transport.state === "to_confirm" ? t("to be confirmed") : order.amounts.transport.note, c.transportCost === 0 ? t("in the price, delivered to {where}", { where: order.destination.city }) : f.money(c.transportCost!, order.line.currency));
        return row(label, [order.line.code, order.line.name].filter(Boolean).join(" · "), [c.product!.code, c.product!.name, c.product!.description].filter(Boolean).join(" · "));
      })}
    </div>
  );
}

const who = (e: OrderView["events"][number], order: OrderView, t: ReturnType<typeof useT>) =>
  e.actorType === "system" ? t("the app, by its own rules") : e.actorType === "ai" ? t("an AI assistant, for {company}", { company: order.buyer.name }) : [e.actorName, e.side === "buyer" ? order.buyer.name : e.side === "supplier" ? order.supplier.name : null].filter(Boolean).join(", ");

/** Everything that happened to an order, in order: who, of which company, and when. */
export function OrderTimeline({ order }: { order: OrderView }) {
  const t = useT();
  return (
    <ol className="flex flex-col gap-3">
      {order.events.map((e) => (
        <li key={e.id} className="grid grid-cols-[minmax(0,132px)_minmax(0,1fr)] gap-x-4 text-[13px]">
          <span className="num text-ink-3">{new Date(e.at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <span>
            <span className="font-medium">{ORDER_EVENT_LABEL[e.action] ? t(ORDER_EVENT_LABEL[e.action]) : e.action === "refresh_conditions" ? t("The draft took the supplier's new conditions") : e.action}</span>
            <span className="text-ink-3"> — {who(e, order, t)}</span>
            {e.note && <span className="mt-0.5 block text-ink-2">“{e.note}”</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A notification in words: an order's number, a company, an article — never a figure. */
export function NotificationLine({ n }: { n: NotificationView }) {
  const t = useT();
  return <>{t(NOTIFICATION_TEXT[n.kind], n.params)}</>;
}

/** Changing one's own password: the one in use is asked first. Where it is sent is the caller's — the workspace's action, or the portal's entry. */
export function PasswordForm({ submit }: { submit: (current: string, next: string) => Promise<{ ok: boolean; error?: string }> }) {
  const t = useT();
  const [busy, start] = useTransition();
  const [v, setV] = useState({ current: "", next: "" });
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("The password you have now")}>
          <Input type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} />
        </Field>
        <Field label={t("The new password")} hint={t("At least 10 characters. It is kept only as a hash.")}>
          <Input type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonClass("secondary")}
          disabled={busy || !v.current || !v.next}
          onClick={() =>
            start(async () => {
              const res = await submit(v.current, v.next);
              setState(res.ok ? { ok: true, text: t("Password changed. Every other browser signed in with this account was signed out.") } : { ok: false, text: res.error || t("Something went wrong.") });
              if (res.ok) setV({ current: "", next: "" });
            })
          }
        >
          {t("Change password")}
        </button>
        {state && (
          <span role={state.ok ? undefined : "alert"} className={cx("text-[12.5px]", state.ok ? "text-down" : "text-up")}>
            {state.text}
          </span>
        )}
      </div>
    </div>
  );
}
