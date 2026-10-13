import Link from "next/link";
import type { Metadata } from "next";
import { OrderResponse, PortalMarkRead } from "@/components/orders/portal";
import { AmountLines, Facts, NotificationLine, OrderStatusPill, TermsFacts } from "@/components/orders/shared";
import { destinationLine } from "@/lib/orders/flow";
import { Empty, Section } from "@/components/ui";
import * as f from "@/lib/format";
import type { Msg } from "@/lib/i18n";
import { ORG_REQUIREMENT_LABEL } from "@/lib/orders/ready";
import type { OrderStatus } from "@/lib/orders/types";
import { readPortal } from "@/server/order-catalog";
import { readNotifications, readOrders, type OrderView } from "@/server/orders";
import { portal } from "@/server/portal-page";
import { getOutsideT } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getOutsideT())("Orders") };
}

const SECTIONS: { key: string; title: Msg; statuses: OrderStatus[] }[] = [
  { key: "waiting", title: "Changes waiting for the customer", statuses: ["pending_buyer_approval"] },
  { key: "confirmed", title: "Confirmed|orders", statuses: ["confirmed"] },
  { key: "declined", title: "Declined|orders", statuses: ["rejected"] },
  { key: "history", title: "History", statuses: ["completed", "cancelled", "expired"] },
];

export default async function PortalOrders() {
  const { who, db, t, today } = await portal();
  const [orders, notices, catalogue] = await Promise.all([readOrders(db, who, today, t), readNotifications(db, who), readPortal(db, who, today, t)]);
  const todo = orders.filter((o) => o.status === "pending_supplier");
  const unread = notices.filter((n) => !n.read);
  const alternatives = (o: OrderView) => catalogue.products.filter((p) => p.id !== o.line.orderProductId && p.identityGaps.length === 0).map((p) => ({ id: p.id, label: [p.code, p.name].filter(Boolean).join(" · ") }));
  const ready = catalogue.products.filter((p) => p.state === "order_ready").length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t("Orders")}</h1>
        <p className="mt-1 text-[13.5px] text-ink-3">{t("Your customers' order requests: accept them, propose a change, or decline. Nothing is an order until one of the two happens: you accept, or your customer accepts your changes.")}</p>
      </header>

      {catalogue.org.gaps.length > 0 && (
        <div className="rounded-lg border border-caution/30 bg-caution-wash px-4 py-3 text-[13px] text-caution">
          <div className="font-semibold">{t("Before you can receive orders, your company still needs:")}</div>
          <ul className="mt-1 list-disc pl-4">
            {catalogue.org.gaps.map((g) => (
              <li key={g}>{t(ORG_REQUIREMENT_LABEL[g])}</li>
            ))}
          </ul>
          <Link href="/portal/company" className="mt-2 inline-block font-medium underline">
            {t("Complete it now: it is asked once, for every article")}
          </Link>
        </div>
      )}
      {catalogue.org.gaps.length === 0 && ready === 0 && (
        <div className="rounded-lg border border-rule bg-canvas px-4 py-3 text-[13px] text-ink-2">
          {t("No article of yours can be ordered yet.")}{" "}
          <Link href="/portal/products" className="font-medium text-ledger hover:underline">
            {t("Open your catalogue and activate Direct Order on an article: six fields")}
          </Link>
        </div>
      )}

      {unread.length > 0 && (
        <div className="rounded-lg border border-rule bg-ledger-wash/60 px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-ledger">{t.n(unread.length, "{n} new notification", "{n} new notifications")}</span>
            <PortalMarkRead />
          </div>
          <ul className="flex flex-col gap-1 text-[13px]">
            {unread.slice(0, 8).map((n) => (
              <li key={n.id}>
                <Link href={n.orderId ? `/portal/orders/${n.orderId}` : "/portal/products"} className="hover:underline">
                  <NotificationLine n={n} />
                </Link>
                <span className="ml-2 text-ink-3">{f.date(n.at.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
          {t("To handle")}
          {todo.length > 0 && <span className="num rounded-full bg-caution-wash px-2 text-[12px] font-semibold text-caution">{todo.length}</span>}
        </h2>
        {todo.length === 0 ? (
          <Empty title={t("Nothing to handle")} body={t("A new request from a customer appears here, with everything needed to answer it.")} />
        ) : (
          <div className="flex flex-col gap-4">
            {todo.map((o) => (
              <article key={o.id} className="rounded-lg border border-rule bg-canvas p-5">
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded-[4px] bg-ledger px-1.5 py-0.5 text-[10.5px] font-semibold tracking-[0.05em] text-white uppercase">{t("New request")}</span>
                  <Link href={`/portal/orders/${o.id}`} className="num text-[13px] font-medium text-ledger hover:underline">
                    {o.number}
                  </Link>
                  <span className="text-[12.5px] text-ink-3">{t("received on {date} · lapses on {until}", { date: f.date((o.sentAt ?? o.createdAt).slice(0, 10)), until: o.expiresOn ? f.date(o.expiresOn) : "—" })}</span>
                </div>
                <div className="grid gap-5 @3xl:grid-cols-2">
                  <Facts
                    rows={[
                      [t("Customer"), <span key="c" className="font-medium">{o.buyer.name}</span>],
                      [t("Article"), [o.line.code, o.line.name].filter(Boolean).join(" · ")],
                      [t("Quantity"), <span key="q" className="num font-medium">{f.quantity(o.line.quantity, o.line.unit)}</span>],
                      [t("Price"), <span key="p" className="num">{`${f.price(o.line.unitPrice, o.line.currency)}/${o.line.unit}`}{o.terms.reserved ? ` · ${t("the one you reserved to this customer")}` : ""}</span>],
                      [t("Destination"), destinationLine(o.destination)],
                      [t("Delivery wanted"), o.wantedDate ? f.date(o.wantedDate) : t("no date asked")],
                      ...(o.buyerNotes ? ([[t("Customer's notes"), o.buyerNotes]] as [string, React.ReactNode][]) : []),
                    ]}
                  />
                  <div className="flex flex-col gap-3">
                    <AmountLines amounts={o.amounts} />
                    <details className="text-[13px]">
                      <summary className="cursor-pointer text-ink-3 hover:text-ink">{t("Conditions the request was made on")}</summary>
                      <TermsFacts terms={o.terms} unit={o.line.unit} className="mt-2" />
                    </details>
                  </div>
                </div>
                <div className="mt-4 border-t border-rule pt-4">
                  <OrderResponse order={o} alternatives={alternatives(o)} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {SECTIONS.map((s) => {
        const rows = orders.filter((o) => s.statuses.includes(o.status));
        if (!rows.length) return null;
        return (
          <Section key={s.key} title={t(s.title)} description={t.n(rows.length, "{n} order", "{n} orders")} flush>
            <ul className="divide-y divide-rule border-t border-rule">
              {rows.map((o) => (
                <li key={o.id}>
                  <Link href={`/portal/orders/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px] hover:bg-well">
                    <span className="num w-[110px] font-medium text-ledger">{o.number}</span>
                    <span className="min-w-0 flex-1 basis-[200px]">
                      <span className="font-medium">{o.buyer.name}</span> <span className="text-ink-3">· {f.quantity(o.line.quantity, o.line.unit)} · {o.line.name}</span>
                    </span>
                    <span className="num text-ink-2">{f.money(o.amounts.total ?? o.amounts.goods, o.amounts.currency)}</span>
                    <OrderStatusPill status={o.status} side="supplier" />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}
