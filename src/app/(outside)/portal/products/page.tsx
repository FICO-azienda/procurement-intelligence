import type { Metadata } from "next";
import { AudienceForm, ProductForm, ProductOrders, TermsPanel, TermsRead, WithdrawReserved } from "@/components/orders/portal";
import { ListingPill } from "@/components/orders/shared";
import { Empty, Section } from "@/components/ui";
import * as f from "@/lib/format";
import { list } from "@/lib/i18n";
import { IDENTITY_GAP_LABEL, ORG_REQUIREMENT_LABEL, type IdentityGap } from "@/lib/orders/ready";
import { LISTING_MEANING, TERM_FIELD_MISSING } from "@/lib/orders/types";
import { catalogProposals, readPortal, termsProposals } from "@/server/order-catalog";
import { markNotificationsRead } from "@/server/orders";
import { portal } from "@/server/portal-page";
import { getOutsideT } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getOutsideT())("Catalogue and conditions") };
}

export default async function PortalProducts() {
  const { who, db, t, today } = await portal();
  const canEdit = who.permissions.includes("terms.edit");
  const [catalogue, offered] = await Promise.all([readPortal(db, who, today, t), catalogProposals(db, who, t)]);
  const proposals = new Map(canEdit ? await Promise.all(catalogue.products.map(async (p) => [p.id, await termsProposals(db, who, p.id, t)] as const)) : []);
  // Reading the catalogue is reading what customers asked about its articles.
  for (const p of catalogue.products) await markNotificationsRead(db, who, { orderProductId: p.id });
  const orgBlockers = catalogue.org.gaps.map((g) => t(ORG_REQUIREMENT_LABEL[g]));
  const identityWords = (gaps: IdentityGap[]) => gaps.map((g) => t(IDENTITY_GAP_LABEL[g]));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{t("Catalogue and conditions")}</h1>
          <p className="mt-1 max-w-[720px] text-[13.5px] text-ink-3">{t("The articles your customers can order from you. An article becomes Order Ready when you complete and confirm six things: price, minimum quantity, lead time, delivery terms, payment terms, price validity.")}</p>
        </div>
        {canEdit && <ProductForm />}
      </header>

      {offered.length > 0 && canEdit && (
        <Section title={t("Already known: add without retyping")} description={t("Articles you already billed or quoted to a customer, in your own words. No price is taken along: you state it when you write the conditions.")}>
          <ul className="flex flex-col divide-y divide-rule">
            {offered.map((o) => (
              <li key={`${o.relationshipId}:${o.buyerProductId ?? o.name}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 basis-[260px]">
                  <span className="font-medium">{[o.code, o.name].filter(Boolean).join(" · ")}</span>
                  <span className="block text-[12.5px] text-ink-3">
                    {o.source === "invoice" ? t("billed to {company}{date}", { company: o.customerName, date: o.date ? ` · ${f.date(o.date)}` : "" }) : t("quoted to {company}{date}", { company: o.customerName, date: o.date ? ` · ${f.date(o.date)}` : "" })} · {o.unit}
                  </span>
                </span>
                <ProductForm from={o} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {catalogue.products.length === 0 ? (
        <Empty title={t("No article yet")} body={t("Add the first one: its code, its name and a technical description precise enough that nobody could take it for another.")} />
      ) : (
        catalogue.products.map((p) => {
          const blockers = [...orgBlockers, ...identityWords(p.identityGaps)];
          return (
            <section key={p.id} className="rounded-lg border border-rule bg-canvas">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-semibold">{[p.code, p.name].filter(Boolean).join(" · ")}</h2>
                    <ListingPill state={p.state} />
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-2">{p.description ?? <span className="text-ink-4">{t("no technical description yet")}</span>}</p>
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    {p.state === "order_ready"
                      ? t("Order Ready — active: your customers can send order requests for it.")
                      : p.state === "expired"
                        ? t("The price validity has passed: renew it to take new orders.")
                        : p.state === "suspended"
                          ? t("You paused new orders for this article.")
                          : p.missing.length === 0 && blockers.length === 0
                            ? t("Complete: confirm the conditions to switch orders on.")
                            : p.missing.length === 1 && blockers.length === 0
                              ? t("You are only missing {what} to activate orders.", { what: t(TERM_FIELD_MISSING[p.missing[0]]) })
                              : p.missing.length > 0
                                ? t("Still missing: {what}.", { what: list(t, p.missing.map((m) => t(TERM_FIELD_MISSING[m]))) })
                                : t(LISTING_MEANING.catalog_ready)}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <TermsPanel product={p} current={p.base} proposals={proposals.get(p.id) ?? []} blockers={blockers} />
                    <ProductOrders product={p} />
                    <ProductForm product={p} />
                  </div>
                )}
              </div>
              {p.identityGaps.length > 0 && (
                <ul className="mx-5 mb-3 list-disc rounded-md bg-caution-wash py-2 pr-3 pl-7 text-[12.5px] text-caution">
                  {identityWords(p.identityGaps).map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              )}
              <div className="grid gap-x-8 gap-y-5 border-t border-rule px-5 py-4 @3xl:grid-cols-2">
                <div>
                  <div className="mb-2 text-[12px] font-medium text-ink-3">{t("Conditions for every customer allowed")}</div>
                  {p.base ? <TermsRead view={p.base} unit={p.unit} /> : <p className="text-[13px] text-ink-3">{t("None yet.")}</p>}
                </div>
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="mb-2 text-[12px] font-medium text-ink-3">{t("Who can order it")}</div>
                    {catalogue.customers.length === 0 ? <p className="text-[13px] text-ink-3">{t("No customer has a channel with you yet.")}</p> : canEdit ? <AudienceForm product={p} /> : <p className="text-[13px] text-ink-2">{p.audience === "all" ? t("Every customer I have a channel with") : t("Only the customers I choose")}</p>}
                  </div>
                  {p.customers.filter((c) => c.visible).map((c) => (
                    <div key={c.relationshipId} className="rounded-md border border-rule px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                          {c.name} <ListingPill state={c.state} />
                        </span>
                        {canEdit && <TermsPanel product={p} customer={{ relationshipId: c.relationshipId, name: c.name }} current={c.reserved} proposals={proposals.get(p.id) ?? []} blockers={blockers} />}
                      </div>
                      {c.reserved ? (
                        <div className="mt-2">
                          <div className="mb-1.5 text-[12px] font-medium text-ink-3">{t("Reserved to this customer — nobody else reads them")}</div>
                          <TermsRead view={c.reserved} unit={p.unit} />
                          {canEdit && (
                            <div className="mt-1.5">
                              <WithdrawReserved orderProductId={p.id} relationshipId={c.relationshipId} />
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-1 text-[12.5px] text-ink-3">{c.blocked ? t("You are not taking orders from this customer for now.") : t("Orders on the conditions for everyone.")}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
