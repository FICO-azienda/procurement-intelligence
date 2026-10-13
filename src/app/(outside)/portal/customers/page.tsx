import Link from "next/link";
import type { Metadata } from "next";
import { CustomerOrdering } from "@/components/orders/portal";
import { ListingPill, OrderStatusPill } from "@/components/orders/shared";
import { Empty } from "@/components/ui";
import * as f from "@/lib/format";
import { readPortal } from "@/server/order-catalog";
import { readOrders } from "@/server/orders";
import { portal } from "@/server/portal-page";
import { getOutsideT } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getOutsideT())("Customers") };
}

export default async function PortalCustomers() {
  const { who, db, t, today } = await portal();
  const [catalogue, orders] = await Promise.all([readPortal(db, who, today, t), readOrders(db, who, today, t)]);
  const canEdit = who.permissions.includes("terms.edit");
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t("Customers")}</h1>
        <p className="mt-1 max-w-[720px] text-[13.5px] text-ink-3">{t("The companies that invited you: one private channel each. A customer sees only the articles you make available to it and the conditions that hold for it — never another customer's.")}</p>
      </header>
      {catalogue.customers.length === 0 ? (
        <Empty title={t("No customer yet")} body={t("A customer appears here when you accept its invitation.")} />
      ) : (
        catalogue.customers.map((c) => {
          const articles = catalogue.products.map((p) => ({ p, own: p.customers.find((x) => x.relationshipId === c.relationshipId)! })).filter((x) => x.own?.visible);
          const theirs = orders.filter((o) => o.relationshipId === c.relationshipId);
          return (
            <section key={c.relationshipId} className="rounded-lg border border-rule bg-canvas">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
                <div>
                  <h2 className="text-[15px] font-semibold">{c.name}</h2>
                  <p className="text-[12.5px] text-ink-3">{c.ordering === "blocked" ? t("You are not taking orders from this customer for now.") : t.n(articles.filter((a) => a.own.state === "order_ready").length, "{n} article it can order now", "{n} articles it can order now")}</p>
                </div>
                {canEdit && <CustomerOrdering relationshipId={c.relationshipId} ordering={c.ordering} />}
              </div>
              <div className="grid gap-x-8 gap-y-4 border-t border-rule px-5 py-4 @3xl:grid-cols-2">
                <div>
                  <div className="mb-2 text-[12px] font-medium text-ink-3">{t("Articles available to this customer")}</div>
                  {articles.length === 0 ? (
                    <p className="text-[13px] text-ink-3">{t("None yet.")}</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5 text-[13px]">
                      {articles.map(({ p, own }) => {
                        const terms = (own.reserved ?? p.base)?.terms;
                        return (
                          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-medium">{[p.code, p.name].filter(Boolean).join(" · ")}</span>
                            <ListingPill state={own.state} />
                            {terms?.unitPrice != null && terms.currency && (
                              <span className="num text-ink-2">
                                {f.price(terms.unitPrice, terms.currency)}/{p.unit}
                                {own.reserved ? ` · ${t("reserved")}` : ""}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Link href="/portal/products" className="mt-2 inline-block text-[12.5px] font-medium text-ledger hover:underline">
                    {t("Change articles and conditions")}
                  </Link>
                </div>
                <div>
                  <div className="mb-2 text-[12px] font-medium text-ink-3">{t("Orders")}</div>
                  {theirs.length === 0 ? (
                    <p className="text-[13px] text-ink-3">{t("None yet.")}</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5 text-[13px]">
                      {theirs.slice(0, 8).map((o) => (
                        <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <Link href={`/portal/orders/${o.id}`} className="num font-medium text-ledger hover:underline">
                            {o.number}
                          </Link>
                          <span className="text-ink-2">{f.quantity(o.line.quantity, o.line.unit)} · {o.line.name}</span>
                          <OrderStatusPill status={o.status} side="supplier" />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
