/**
 * Direct Order where the buyer already works: on a product's page (what can
 * be ordered of it, from whom, on which conditions) and on a company's page
 * (the channel with it). Server components: they read as the workspace's own
 * person, and render nothing while Direct Order is switched off.
 */
import Link from "next/link";
import { getDb } from "@/db";
import { todayISO } from "@/lib/analytics";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { LISTING_MEANING } from "@/lib/orders/types";
import { getCategoryTree } from "@/server/categories";
import { readDestinations } from "@/server/destinations";
import { readChannel, readListings, type Listing } from "@/server/order-catalog";
import { readOrders } from "@/server/orders";
import type { RecordRef } from "@/server/orgs";
import { directOrderOn, workspacePrincipal } from "@/server/session";
import { Section } from "../ui";
import { AskConditions, InviteCompany, RequestOrder, RevokeInvite, TieProduct } from "./buyer";
import { ListingPill, OrderStatusPill, TermsFacts } from "./shared";

async function context() {
  if (!(await directOrderOn())) return null;
  const who = await workspacePrincipal();
  return who ? { who, db: await getDb(), t: await getT(), today: todayISO() } : null;
}

/** One article a supplier made available: its state, its conditions once confirmed, and the one thing that can be done. */
async function ListingCard({ listing, showSupplier, tie }: { listing: Listing; showSupplier: boolean; tie?: React.ReactNode }) {
  const [t, destinations] = await Promise.all([getT(), readDestinations(await getDb())]);
  const l = listing;
  return (
    <div className="rounded-lg border border-rule px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{[l.code, l.name].filter(Boolean).join(" · ")}</span>
            <ListingPill state={l.state} />
          </div>
          {showSupplier && (
            <div className="mt-0.5 text-[13px] text-ink-2">
              {t("Supplier")}: {l.record?.kind === "supplier" ? <Link href={`/suppliers/${l.record.id}`} className="font-medium text-ledger hover:underline">{l.supplierName}</Link> : <span className="font-medium">{l.supplierName}</span>}
            </div>
          )}
          {l.description && <div className="mt-0.5 text-[12.5px] text-ink-3">{l.description}</div>}
        </div>
        <div className="shrink-0">{l.state === "order_ready" && l.terms ? <RequestOrder listing={l} destinations={destinations} /> : <AskConditions orderProductId={l.orderProductId} state={l.state} />}</div>
      </div>
      {l.terms ? (
        <div className="mt-3 border-t border-rule pt-3">
          <div className="mb-1.5 text-[12px] font-medium text-ink-3">{l.state === "expired" ? t("The conditions that expired") : l.reserved ? t("Conditions agreed with you — nobody else reads them") : t("The supplier's conditions")}</div>
          <TermsFacts terms={l.terms} unit={l.unit} className={l.state === "order_ready" ? undefined : "opacity-60"} />
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3">{t(LISTING_MEANING[l.state])}</p>
      )}
      {tie && <div className="mt-3 border-t border-rule pt-3">{tie}</div>}
    </div>
  );
}

/** On a product's page: what can be ordered of it through the channel. Nothing when no supplier made it available. */
export async function ProductOrderSection({ productId, className }: { productId: string; className?: string }) {
  const c = await context();
  if (!c) return null;
  const listings = await readListings(c.db, c.who, { productId }, c.today, c.t);
  if (!listings.length) return null;
  return (
    <Section className={className} title={c.t("Direct Order")} description={c.t("What your suppliers made available to order for this product, on the conditions they confirmed")}>
      <div className="flex flex-col gap-3">
        {listings.map((l) => (
          <ListingCard key={l.orderProductId} listing={l} showSupplier />
        ))}
      </div>
    </Section>
  );
}

/** On a company's page: not invited, invited, or registered — and then what it lets this buyer order. */
export async function ChannelSection({ record, defaultEmail, products, className }: { record: RecordRef; defaultEmail: string | null; products: { id: string; name: string }[]; className?: string }) {
  const c = await context();
  if (!c) return null;
  const { t } = c;
  const channel = await readChannel(c.db, c.who, record, c.today, t);
  const title = t("Direct Order");
  if (!channel.relationship)
    return (
      <Section className={className} title={title} description={t("A private channel to send this company structured order requests. It registers by accepting your invitation: nothing here registers it for you.")}>
        {/* The form keeps its place whether or not an invitation exists: the link it shows once must survive the page being read again. */}
        <div className="flex flex-col gap-3">
          {channel.invite ? (
            <div className="flex flex-col gap-2 text-[13px]">
              <p className="text-ink-2">{t("Invited on {date} at {email}: waiting for the company to accept. The invitation holds until {until}.", { date: f.date(channel.invite.createdAt.slice(0, 10)), email: channel.invite.email, until: f.date(channel.invite.expiresAt.slice(0, 10)) })}</p>
              <div className="flex flex-wrap items-center gap-4">
                <RevokeInvite inviteId={channel.invite.id} />
                <span className="text-ink-3">{t("The link was shown once. To have a new one, create another invitation: the old link stops working.")}</span>
              </div>
            </div>
          ) : null}
          <InviteCompany record={record} defaultEmail={channel.invite?.email ?? defaultEmail} />
        </div>
      </Section>
    );
  const [tree, orders] = await Promise.all([getCategoryTree(), readOrders(c.db, c.who, c.today, t)]);
  const theirs = orders.filter((o) => o.relationshipId === channel.relationship!.id);
  const r = channel.relationship;
  return (
    <Section
      className={className}
      title={title}
      description={t("Registered as {name} since {date}{vat}", { name: r.name, date: f.date(r.since.slice(0, 10)), vat: r.vatNumber ? ` · ${t("VAT number")} ${r.vatNumber}` : "" })}
      actions={theirs.length ? <Link href="/orders" className="text-[13px] font-medium text-ledger hover:underline">{t.n(theirs.length, "{n} order", "{n} orders")}</Link> : undefined}
    >
      {r.ordering === "blocked" && <p className="mb-3 rounded-md bg-wash px-3 py-2 text-[13px] text-ink-2">{t("This company is not taking order requests from you for now.")}</p>}
      {channel.listings.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">{t("The company has not made any article available to you yet. It does so from its own portal: nothing can be switched on from here.")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {channel.listings.map((l) => (
            <ListingCard key={l.orderProductId} listing={l} showSupplier={false} tie={<TieProduct orderProductId={l.orderProductId} tree={tree} tied={l.buyerProductId ? (products.find((p) => p.id === l.buyerProductId) ?? { id: l.buyerProductId, name: t("a product of yours") }) : null} />} />
          ))}
        </div>
      )}
      {theirs.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-rule pt-3 text-[13px]">
          {theirs.slice(0, 5).map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/orders/${o.id}`} className="num font-medium text-ledger hover:underline">{o.number}</Link>
              <span className="text-ink-2">{f.quantity(o.line.quantity, o.line.unit)} · {o.line.name}</span>
              <OrderStatusPill status={o.status} side="buyer" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
