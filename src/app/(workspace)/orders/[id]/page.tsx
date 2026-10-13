import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AskConditions, OrderButtons, ProposalDecision, RequestOrder } from "@/components/orders/buyer";
import { AmountLines, OrderFacts, OrderStatusPill, OrderTimeline, ProposalChangesList } from "@/components/orders/shared";
import { Crumbs, Disclosure, PageHeader, Section } from "@/components/ui";
import { getDb } from "@/db";
import { todayISO } from "@/lib/analytics";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { reorderNotes } from "@/lib/orders/flow";
import { readDestinations } from "@/server/destinations";
import { readListings } from "@/server/order-catalog";
import { markNotificationsRead, readOrder } from "@/server/orders";
import { directOrderOn, workspacePrincipal } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/orders/[id]">): Promise<Metadata> {
  const t = await getT();
  const who = (await directOrderOn()) ? await workspacePrincipal() : null;
  const order = who ? await readOrder(await getDb(), who, (await params).id, todayISO(), t) : null;
  return { title: order ? t("Order {number}", { number: order.number }) : t("Order") };
}

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  if (!(await directOrderOn())) notFound();
  const who = await workspacePrincipal();
  if (!who) notFound();
  const [{ id }, t, db] = await Promise.all([params, getT(), getDb()]);
  const today = todayISO();
  const o = await readOrder(db, who, id, today, t);
  if (!o) notFound();
  // Opening an order is reading what was said about it.
  await markNotificationsRead(db, who, { orderId: o.id });
  const [listings, destinations] = await Promise.all([o.line.orderProductId ? readListings(db, who, { orderProductId: o.line.orderProductId }, today, t) : [], readDestinations(db)]);
  const now = listings[0] ?? null;
  const again = o.status === "confirmed" || o.status === "completed";
  const confirmedBy = o.confirmed?.confirmedBy as { company?: string; name?: string } | undefined;
  const lastNote = [...o.events].reverse().find((e) => e.action === "reject")?.note;

  return (
    <>
      <Crumbs items={[{ href: "/orders", label: t("My orders") }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{t("Order {number}", { number: o.number })} <OrderStatusPill status={o.status} side="buyer" /></span>}
        meta={
          o.status === "draft"
            ? t("A draft: the supplier does not see it until you send it.")
            : o.status === "pending_supplier"
              ? t("Sent on {date}: waiting for {supplier} to accept, propose changes or decline. It lapses on {until} if nobody answers.", { date: f.date((o.sentAt ?? o.createdAt).slice(0, 10)), supplier: o.supplier.name, until: o.expiresOn ? f.date(o.expiresOn) : "—" })
              : o.status === "pending_buyer_approval"
                ? t("{supplier} proposes changes: nothing is confirmed until you accept them.", { supplier: o.supplier.name })
                : o.status === "confirmed" || o.status === "completed"
                  ? t("Confirmed on {date} by {name} ({company}). The conditions below are kept as they were confirmed: a later price list does not change them.", { date: o.confirmedAt ? f.date(o.confirmedAt.slice(0, 10)) : "—", name: confirmedBy?.name ?? "—", company: confirmedBy?.company ?? "—" })
                  : o.status === "rejected"
                    ? t("{supplier} declined this request{why}", { supplier: o.supplier.name, why: lastNote ? `: “${lastNote}”` : "." })
                    : o.status === "expired"
                      ? t("Nobody answered in time: the request lapsed. Nothing was ordered.")
                      : t("You cancelled this request. Nothing was ordered.")
        }
        actions={
          again ? (
            now && now.state === "order_ready" && now.terms ? (
              <RequestOrder
                listing={now}
                destinations={destinations}
                label={t("Reorder")}
                variant="secondary"
                preset={{ quantity: o.line.quantity, destinationId: o.destinationId, notes: reorderNotes({ unitPrice: o.line.unitPrice, currency: o.line.currency, quantity: o.line.quantity, unit: o.line.unit, terms: o.terms }, now.terms, { price: (n, c) => f.price(n, c) }, t) }}
              />
            ) : now ? (
              <AskConditions orderProductId={now.orderProductId} state={now.state} />
            ) : undefined
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6">
        {again && now && now.state !== "order_ready" && (
          <p className="rounded-lg border border-rule bg-wash px-4 py-3 text-[13px] text-ink-2">{t("This article cannot be ordered again as it is: its conditions are no longer in force. Ask the supplier for a new quotation — the old price is not taken along.")}</p>
        )}

        {o.proposal && (
          <Section title={t("Changes proposed by {supplier}", { supplier: o.supplier.name })} description={o.proposal.createdBy ? t("By {name}, on {date}", { name: o.proposal.createdBy, date: f.date(o.proposal.createdAt.slice(0, 10)) }) : undefined}>
            <ProposalChangesList order={o} />
            {o.proposal.note && <p className="mt-3 text-[13px] text-ink-2">“{o.proposal.note}”</p>}
            <div className="mt-4 rounded-md border border-rule bg-well px-4 py-3">
              <div className="mb-2 text-[12px] font-medium text-ink-3">{t("The order as it would be")}</div>
              <AmountLines amounts={o.proposal.amountsAfter} />
            </div>
            <div className="mt-4">
              <ProposalDecision orderId={o.id} specChange={o.proposal.specChange} article={o.proposal.changes.product ? [o.proposal.changes.product.code, o.proposal.changes.product.name].filter(Boolean).join(" · ") : null} />
            </div>
          </Section>
        )}

        <Section title={o.status === "confirmed" || o.status === "completed" ? t("The order as confirmed") : t("The request")} actions={o.line.buyerProductId ? <Link href={`/products/${o.line.buyerProductId}`} className="text-[13px] font-medium text-ledger hover:underline">{t("Your product")}</Link> : undefined}>
          <OrderFacts order={o} side="buyer" />
          <div className="mt-4">
            <OrderButtons orderId={o.id} can={o.can} />
          </div>
        </Section>

        <Disclosure title={t("History")} description={t.n(o.events.length, "{n} event", "{n} events")} defaultOpen>
          <OrderTimeline order={o} />
        </Disclosure>
      </div>
    </>
  );
}
