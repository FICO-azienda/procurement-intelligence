import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { OrderResponse } from "@/components/orders/portal";
import { AmountLines, OrderFacts, OrderStatusPill, OrderTimeline, ProposalChangesList } from "@/components/orders/shared";
import { Disclosure, Section } from "@/components/ui";
import * as f from "@/lib/format";
import { readPortal } from "@/server/order-catalog";
import { markNotificationsRead, readOrder } from "@/server/orders";
import { portal } from "@/server/portal-page";
import { getOutsideT } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getOutsideT())("Order") };
}

export default async function PortalOrder({ params }: PageProps<"/portal/orders/[id]">) {
  const [{ id }, { who, db, t, today }] = await Promise.all([params, portal()]);
  const o = await readOrder(db, who, id, today, t);
  // Not this company's, a customer's draft, or no such order: all the same to whoever asks.
  if (!o) notFound();
  await markNotificationsRead(db, who, { orderId: o.id });
  const catalogue = await readPortal(db, who, today, t);
  const alternatives = catalogue.products.filter((p) => p.id !== o.line.orderProductId && p.identityGaps.length === 0).map((p) => ({ id: p.id, label: [p.code, p.name].filter(Boolean).join(" · ") }));
  const confirmedBy = o.confirmed?.confirmedBy as { company?: string; name?: string } | undefined;
  const waiting = o.proposals.find((p) => p.status === "pending");
  const last = o.proposals[0];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/portal" className="text-[12.5px] text-ink-3 hover:text-ink">
          ← {t("Orders")}
        </Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[24px] font-semibold tracking-[-0.02em]">
          {t("Order {number}", { number: o.number })} <OrderStatusPill status={o.status} side="supplier" />
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-3">
          {o.status === "pending_supplier"
            ? t("From {customer}, received on {date}. It lapses on {until} if you do not answer.", { customer: o.buyer.name, date: f.date((o.sentAt ?? o.createdAt).slice(0, 10)), until: o.expiresOn ? f.date(o.expiresOn) : "—" })
            : o.status === "pending_buyer_approval"
              ? t("You proposed changes: nothing is confirmed until {customer} accepts them.", { customer: o.buyer.name })
              : o.status === "confirmed" || o.status === "completed"
                ? t("Confirmed on {date} by {name} ({company}). These conditions are kept as they were confirmed.", { date: o.confirmedAt ? f.date(o.confirmedAt.slice(0, 10)) : "—", name: confirmedBy?.name ?? "—", company: confirmedBy?.company ?? "—" })
                : o.status === "rejected"
                  ? t("You declined this request.")
                  : o.status === "cancelled"
                    ? t("{customer} cancelled this request.", { customer: o.buyer.name })
                    : t("Nobody answered in time: the request lapsed.")}
        </p>
      </header>

      {o.status === "pending_supplier" && last?.status === "rejected" && (
        <p className="rounded-lg border border-rule bg-wash px-4 py-3 text-[13px] text-ink-2">
          {t("{customer} did not accept the changes you proposed{why}. The request is back as it was first written: accept it, propose something else, or decline.", { customer: o.buyer.name, why: last.decisionNote ? `: “${last.decisionNote}”` : "" })}
        </p>
      )}

      {waiting && o.proposal && (
        <Section title={t("The changes you proposed")} description={t("Waiting for {customer}'s answer", { customer: o.buyer.name })}>
          <ProposalChangesList order={o} />
          {o.proposal.note && <p className="mt-3 text-[13px] text-ink-2">“{o.proposal.note}”</p>}
          <div className="mt-4 rounded-md border border-rule bg-well px-4 py-3">
            <div className="mb-2 text-[12px] font-medium text-ink-3">{t("The order as it would be")}</div>
            <AmountLines amounts={o.proposal.amountsAfter} />
          </div>
        </Section>
      )}

      <Section title={o.status === "confirmed" || o.status === "completed" ? t("The order as confirmed") : t("The request")}>
        <OrderFacts order={o} side="supplier" />
        {o.can.includes("accept") && (
          <div className="mt-5 border-t border-rule pt-4">
            <OrderResponse order={o} alternatives={alternatives} />
          </div>
        )}
      </Section>

      <Disclosure title={t("History")} description={t.n(o.events.length, "{n} event", "{n} events")} defaultOpen>
        <OrderTimeline order={o} />
      </Disclosure>
    </div>
  );
}
