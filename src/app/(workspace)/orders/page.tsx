import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AskConditions, MarkOrdersRead, RequestOrder } from "@/components/orders/buyer";
import { NotificationLine, OrderStatusPill } from "@/components/orders/shared";
import { Empty, PageHeader, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDb } from "@/db";
import { todayISO } from "@/lib/analytics";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import type { Msg } from "@/lib/i18n";
import { reorderNotes } from "@/lib/orders/flow";
import { LEAD_TIME_LABEL, type OrderStatus } from "@/lib/orders/types";
import { readDestinations } from "@/server/destinations";
import { readListings } from "@/server/order-catalog";
import { readNotifications, readOrders, type OrderView } from "@/server/orders";
import { directOrderOn, workspacePrincipal } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("My orders") };
}

const GROUPS = ["all", "open", "confirmed", "closed", "drafts"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_LABEL: Record<Group, Msg> = { all: "All|orders", open: "Waiting", confirmed: "Confirmed|orders", closed: "Closed|orders", drafts: "Drafts" };
const IN: Record<Exclude<Group, "all">, OrderStatus[]> = { open: ["pending_supplier", "pending_buyer_approval"], confirmed: ["confirmed", "completed"], closed: ["rejected", "cancelled", "expired"], drafts: ["draft"] };

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  if (!(await directOrderOn())) notFound();
  const who = await workspacePrincipal();
  if (!who) notFound();
  const [query, t, db] = await Promise.all([searchParams, getT(), getDb()]);
  const today = todayISO();
  const [orders, listings, destinations, notices] = await Promise.all([readOrders(db, who, today, t), readListings(db, who, {}, today, t), readDestinations(db), readNotifications(db, who)]);
  const show: Group = GROUPS.includes(query.show as Group) ? (query.show as Group) : "all";
  const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";
  const listed = orders.filter((o) => (show === "all" || IN[show].includes(o.status)) && (!q || [o.number, o.supplier.name, o.line.name, o.line.code ?? ""].some((x) => x.toLowerCase().includes(q))));
  const unread = notices.filter((n) => !n.read);
  const price = { price: (n: number, c: string) => f.price(n, c) };
  const delivery = (o: OrderView) => (o.deliveryDate ? f.date(o.deliveryDate) : o.wantedDate ? t("asked by {date}", { date: f.date(o.wantedDate) }) : o.terms.leadTime && o.terms.leadTime !== "custom" ? t(LEAD_TIME_LABEL[o.terms.leadTime]) : (o.terms.leadTimeNote ?? "—"));
  const chip = (g: Group) => `/orders${g === "all" ? "" : `?show=${g}`}`;

  return (
    <>
      <PageHeader title={t("My orders")} meta={t("Order requests sent to your suppliers through Direct Order, and what became of them. An order here is not a purchase: purchases are what invoices prove.")} />

      {unread.length > 0 && (
        <div className="mb-6 rounded-lg border border-rule bg-ledger-wash/60 px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-ledger">{t.n(unread.length, "{n} new notification", "{n} new notifications")}</span>
            <MarkOrdersRead />
          </div>
          <ul className="flex flex-col gap-1 text-[13px]">
            {unread.slice(0, 8).map((n) => (
              <li key={n.id}>
                {n.orderId ? (
                  <Link href={`/orders/${n.orderId}`} className="hover:underline">
                    <NotificationLine n={n} />
                  </Link>
                ) : (
                  <NotificationLine n={n} />
                )}
                <span className="ml-2 text-ink-3">{f.date(n.at.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {GROUPS.map((g) => {
          const n = g === "all" ? orders.length : orders.filter((o) => IN[g].includes(o.status)).length;
          return (
            <Link key={g} href={chip(g)} aria-current={show === g ? "true" : undefined} className={cx("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium", show === g ? "border-ledger bg-ledger text-white" : "border-rule-strong text-ink-2 hover:bg-wash")}>
              {t(GROUP_LABEL[g])} <span className={cx("num", show === g ? "text-white/80" : "text-ink-3")}>{n}</span>
            </Link>
          );
        })}
        <form className="ml-auto" action="/orders">
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          <input name="q" defaultValue={q} placeholder={t("Search a number, a supplier, an article")} aria-label={t("Search orders")} className="h-8 w-[260px] max-w-full rounded-md border border-rule-strong bg-well px-2.5 text-[13px] focus:border-ledger focus:outline-none" />
        </form>
      </div>

      {orders.length === 0 ? (
        <Empty title={t("No order yet")} body={t("An order starts from a product's page, where a supplier made it available to order — or from the supplier's own page. A supplier takes orders once it registered through your invitation and confirmed its conditions.")} />
      ) : listed.length === 0 ? (
        <Empty title={t("Nothing matches")} body={t("No order with this status or these words.")} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("Order")}</Th>
              <Th className="hidden @2xl:table-cell">{t("Date")}</Th>
              <Th>{t("Supplier")}</Th>
              <Th className="hidden @xl:table-cell">{t("Article")}</Th>
              <Th align="right" className="hidden @3xl:table-cell">{t("Quantity")}</Th>
              <Th align="right" className="hidden @2xl:table-cell">{t("Total")}</Th>
              <Th>{t("Status")}</Th>
              <Th className="hidden @4xl:table-cell">{t("Delivery")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {listed.map((o) => {
              const now = listings.find((l) => l.orderProductId === o.line.orderProductId) ?? null;
              const again = o.status === "confirmed" || o.status === "completed";
              return (
                <tr key={o.id} className={rowClass()}>
                  <Td>
                    <Link href={`/orders/${o.id}`} className="num font-medium text-ledger hover:underline">
                      {o.number}
                    </Link>
                    <div className="text-[12px] text-ink-3 @xl:hidden">{o.line.name}</div>
                  </Td>
                  <Td className="hidden @2xl:table-cell"><span className="num">{f.date((o.sentAt ?? o.createdAt).slice(0, 10))}</span></Td>
                  <Td>{o.supplier.name}</Td>
                  <Td className="hidden @xl:table-cell">{[o.line.code, o.line.name].filter(Boolean).join(" · ")}</Td>
                  <Td align="right" className="hidden @3xl:table-cell"><span className="num">{f.quantity(o.line.quantity, o.line.unit)}</span></Td>
                  <Td align="right" className="hidden @2xl:table-cell">
                    <span className="num">{f.money(o.amounts.total ?? o.amounts.goods, o.amounts.currency)}</span>
                    {o.amounts.total == null && <div className="text-[11.5px] text-ink-3">{t("goods only")}</div>}
                  </Td>
                  <Td><OrderStatusPill status={o.status} side="buyer" /></Td>
                  <Td className="hidden @4xl:table-cell">{delivery(o)}</Td>
                  <Td align="right">
                    {again &&
                      (now && now.state === "order_ready" && now.terms ? (
                        <RequestOrder
                          listing={now}
                          destinations={destinations}
                          label={t("Reorder")}
                          variant="secondary"
                          size="sm"
                          preset={{ quantity: o.line.quantity, destinationId: o.destinationId, notes: reorderNotes({ unitPrice: o.line.unitPrice, currency: o.line.currency, quantity: o.line.quantity, unit: o.line.unit, terms: o.terms }, now.terms, price, t) }}
                        />
                      ) : now ? (
                        <AskConditions orderProductId={now.orderProductId} state={now.state === "expired" ? "expired" : now.state} size="sm" />
                      ) : (
                        <span className="text-[12px] text-ink-3">{t("no longer available")}</span>
                      ))}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
