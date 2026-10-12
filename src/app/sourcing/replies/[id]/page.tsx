import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { ReplyStatusPills } from "@/components/replies/pills";
import { CompanyEdit, OfferValidation, ThreadUpdate } from "@/components/replies/replies";
import { Crumbs, Disclosure, PageHeader, Section } from "@/components/ui";
import { getDb } from "@/db";
import { rfqSuppliers } from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { countryName, flagOf } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { MESSAGE_KIND_LABEL, REPLY_STATUS_LABEL, SPEC_LABEL, deliveryOf, statusesOf, validityOf } from "@/lib/replies/types";
import { readReplies } from "@/server/replies";

export async function generateMetadata({ params }: PageProps<"/sourcing/replies/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [row] = await (await getDb()).select({ name: rfqSuppliers.name }).from(rfqSuppliers).where(eq(rfqSuppliers.id, id));
  return { title: row?.name ?? (await getT())("Replies to requests for quotation") };
}

/** The specifications in one order everywhere: the ones the app knows first, the others as the source named them. */
const specsOf = (specs: Record<string, string>) => {
  const known = Object.keys(SPEC_LABEL);
  const rank = (k: string) => (known.includes(k) ? known.indexOf(k) : known.length);
  return Object.entries(specs).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
};
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * One company that answered: who it is, what it says it makes, the prices it
 * stated, where the conversation stands, what is missing, what to do next and
 * the messages all this was read from. Everything as the company wrote it:
 * nothing here is verified, compared or converted by the app.
 */
export default async function ReplyCompanyPage({ params }: PageProps<"/sourcing/replies/[id]">) {
  await connection();
  const { id } = await params;
  const [db, t] = await Promise.all([getDb(), getT()]);
  const c = (await readReplies(db, t)).find((x) => x.id === id);
  if (!c) notFound();
  const today = todayISO();
  const none = <span className="text-ink-4">{t("Not stated")}</span>;
  const link = (url: string | null, label?: string) =>
    url ? (
      <a href={url} target="_blank" rel="noreferrer" className="break-all text-ledger hover:underline">
        {label ?? url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </a>
    ) : (
      none
    );
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[minmax(120px,180px)_minmax(0,1fr)] gap-3 border-t border-rule py-2 text-[13.5px] first:border-t-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0">{value == null || value === "" ? none : value}</dd>
    </div>
  );
  const block = (label: string, value: string | null, tone = "text-ink") => (
    <div>
      <div className="mb-1 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{label}</div>
      <p className={`text-[13.5px] whitespace-pre-line ${value ? tone : ""}`}>{value ?? none}</p>
    </div>
  );
  const fact = (label: string, value: ReactNode) => (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  const all = c.threads.flatMap((th) => statusesOf(th));

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/sourcing", label: t("Market") }, { href: "/sourcing/replies", label: t("Replies to requests for quotation") }]} />}
        title={c.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {c.country && <span>{`${flagOf(c.country) ?? ""} ${countryName(c.country, t.locale)}`.trim()}</span>}
            {c.companyType && <span>{c.companyType}</span>}
            <ReplyStatusPills statuses={[...new Set(all)]} t={t} />
          </span>
        }
      />
      <p className="mb-6 max-w-[820px] text-[13px] text-ink-3">
        {t("A company that answered a request for quotation — not one of your suppliers, and not verified by the app. What follows is what it wrote, read on {date}.", { date: c.checkedAt ? f.date(c.checkedAt) : "—" })}
      </p>

      <div className="grid gap-4 @4xl:grid-cols-2">
        <Section title={t("Who it is")}>
          <dl>
            {row(t("Company"), c.name)}
            {row(t("Country"), c.country ? countryName(c.country, t.locale) : null)}
            {row(t("Address"), c.address)}
            {row(t("Website"), link(c.website))}
            {row(t("What it says it is"), c.companyType)}
            {row(t("VAT number"), c.vatNumber)}
            {c.taxCode && row(t("Tax code"), c.taxCode)}
          </dl>
        </Section>
        <Section title={t("How to reach it")}>
          <dl>
            {row(t("Contact name"), c.contactName)}
            {row(t("Email"), c.email ? <a href={`mailto:${c.email}`} className="break-all text-ledger hover:underline">{c.email}</a> : null)}
            {row(t("Phone"), c.phone)}
          </dl>
          <p className="mt-3 text-[12.5px] text-ink-3">{t("Nothing is sent from here: the app keeps what was received, you write to the company.")}</p>
        </Section>
      </div>

      {c.threads.map((th) => (
        <div key={th.id} className="mt-4 grid gap-4">
          <Section
            title={th.categories.length ? th.categories.join(", ") : t("Request")}
            description={[th.reference, th.checkedAt ? t("read on {date}", { date: f.date(th.checkedAt) }) : null].filter(Boolean).join(" · ")}
            actions={<ReplyStatusPills statuses={statusesOf(th)} t={t} />}
          >
            <div className="grid gap-5 @3xl:grid-cols-2">
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">{t("Where it stands")}</div>
                  <p className="text-[13.5px]">
                    <span className="font-medium">{t(REPLY_STATUS_LABEL[th.status])}</span>
                    {th.statusText && <span className="text-ink-3"> — {t("as written: {text}", { text: th.statusText })}</span>}
                  </p>
                  {th.offerSummary && <p className="mt-1 text-[13.5px] text-ink-2">{th.offerSummary}</p>}
                  {th.priority && <p className="mt-1 text-[12.5px] text-ink-3">{t("Priority: {priority}", { priority: th.priority })}</p>}
                </div>
                {block(t("Next action"), th.nextAction)}
                {block(t("Still missing"), th.missing, "text-caution")}
              </div>
              <div className="flex flex-col gap-4">
                {block(t("Products declared"), th.products)}
                <dl>
                  {row(t("Minimum order"), th.moq)}
                  {row(t("Payment terms"), th.paymentTerms)}
                  {row(t("Delivery and shipping"), th.leadTime)}
                  {row(t("Samples"), th.samples)}
                </dl>
                {th.notes && block(t("Notes"), th.notes, "text-ink-2")}
              </div>
            </div>
          </Section>

          <Section title={t("Prices stated")} description={th.offers.length ? t.n(th.offers.length, "{n} line, as the company wrote it", "{n} lines, each as the company wrote it") : undefined}>
            {th.offers.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">{t("No price received in this conversation.")}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-3">
                  {th.offers.map((o) => {
                    const delivery = deliveryOf(o.incoterm, o.destination, t);
                    const state = validityOf(o.validUntil, today);
                    const left = o.validUntil ? days(today, o.validUntil) : null;
                    const source = o.sourceUrl && /^https?:\/\//i.test(o.sourceUrl) ? o.sourceUrl : null;
                    return (
                      <li key={o.id} className="rounded-md border border-rule px-4 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                          <div className="min-w-0">
                            <span className="text-[14px] font-semibold">{o.productName}</span>
                            <span className="ml-2 text-[12.5px] text-ink-3">{[o.grade && o.grade !== o.productName ? o.grade : null, o.productCode, o.category].filter(Boolean).join(" · ")}</span>
                          </div>
                          <div className="num text-[15px] font-semibold whitespace-nowrap">
                            {f.price(o.unitPrice, o.currency)}/{o.unit}
                          </div>
                        </div>
                        {o.currency !== "EUR" && <p className="mt-0.5 text-right text-[12px] text-ink-3">{t("In {currency}: not converted, no dated exchange rate was verified", { currency: o.currency })}</p>}
                        <dl className="mt-3 grid gap-x-6 gap-y-2.5 text-[13px] @xl:grid-cols-2 @4xl:grid-cols-3">
                          {fact(t("Quantity"), o.quantity != null ? f.quantity(o.quantity, o.unit) : none)}
                          {fact(
                            t("Delivery terms"),
                            <>
                              <span className="font-medium">{[delivery.incoterm, o.destination].filter(Boolean).join(" ") || t("Not stated")}</span>
                              <span className="block text-[12px] text-ink-3">{delivery.text}</span>
                            </>,
                          )}
                          {fact(t("Payment terms"), o.paymentTerms ?? none)}
                          {fact(
                            t("Validity"),
                            <span className={state === "expired" ? "font-medium text-up" : left != null && left <= 5 ? "font-medium text-caution" : undefined}>
                              {state === "unknown"
                                ? (o.validity ?? t("Not stated"))
                                : state === "expired"
                                  ? t("Expired on {date}", { date: f.date(o.validUntil) })
                                  : left === 0
                                    ? t("Valid until today, {date}", { date: f.date(o.validUntil) })
                                    : t.n(left ?? 0, "Valid until {date}: {n} day left", "Valid until {date}: {n} days left", { date: f.date(o.validUntil) })}
                            </span>,
                          )}
                          {specsOf(o.specs).map(([k, v]) => (
                            <div key={k} className="contents">
                              {fact(SPEC_LABEL[k] ? t(SPEC_LABEL[k]) : k, v)}
                            </div>
                          ))}
                        </dl>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-rule pt-3">
                          <OfferValidation offerId={o.id} validation={o.validation} />
                          {o.technicalStatus && <span className="text-[12.5px] text-caution">{o.technicalStatus}</span>}
                        </div>
                        {o.missing && <p className="mt-2 text-[12.5px] text-ink-2">{t("Missing: {what}", { what: o.missing })}</p>}
                        {(source || o.sourceDocument) && (
                          <p className="mt-1 text-[12.5px] text-ink-3">
                            {t("Source")}: {source ? link(source, t("Open the message")) : null}
                            {source && o.sourceDocument ? " · " : null}
                            {o.sourceDocument}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-[12.5px] text-ink-3">
                  {t("Each price is shown as the company wrote it: its own product, its currency, its delivery terms. A price to a port is not a price delivered to you; prices for different grades, on different terms or in different currencies are not compared with each other or with what you pay, and no average is made of them. A price received is not an offer you can order from until the product is verified.")}
                </p>
              </>
            )}
          </Section>

          <Section title={t("History of communications")} description={t("The messages this was read from")}>
            <ul className="flex flex-col divide-y divide-rule">
              {[...th.messages].reverse().map((m) => (
                <li key={m.id} className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 py-2.5 text-[13.5px] first:pt-0 last:pb-0">
                  <span className="num text-ink-3">{f.date(m.date)}</span>
                  <div className="min-w-0">
                    <div>
                      <span className="font-medium">{t(MESSAGE_KIND_LABEL[m.kind])}</span>
                      {m.status && <span className="text-ink-3"> · {t(REPLY_STATUS_LABEL[m.status])}</span>}
                      {m.source === "manual" && <span className="text-ink-3"> · {t("written by you")}</span>}
                    </div>
                    {m.summary && <div className="text-ink-2">{m.summary}</div>}
                    {m.attachments && <div className="text-[12.5px] text-ink-3">{t("Attached: {files}", { files: m.attachments })}</div>}
                    {m.reference && (/^https?:\/\//i.test(m.reference) ? <div className="text-[12.5px]">{link(m.reference, t("Open the message"))}</div> : <div className="text-[12.5px] text-ink-3">{m.reference}</div>)}
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Disclosure title={t("Update this conversation")} description={t("An answer received, a message you sent, a note: it goes in the history")}>
            <ThreadUpdate threadId={th.id} status={th.status} nextAction={th.nextAction} missing={th.missing} categories={th.categories} today={today} />
          </Disclosure>
        </div>
      ))}

      <Section className="mt-4" title={t("In your records")}>
        {c.elsewhere.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">{t("Nowhere else on file: it is not among your suppliers, your candidates or the supplier directory.")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13.5px]">
            {c.elsewhere.map((e) => (
              <li key={`${e.where}|${e.id}`}>
                {!e.certain && <span className="font-medium text-caution">{t("Possibly the same company")}: </span>}
                {e.where === "supplier" ? (
                  <>
                    <Link href={`/suppliers/${e.id}`} className="font-medium text-ledger hover:underline">{e.name}</Link> — {t("one of your suppliers")}
                  </>
                ) : e.where === "directory" ? (
                  <>
                    <Link href={`/sourcing/directory/${e.id}`} className="font-medium text-ledger hover:underline">{e.name}</Link> — {t("in the supplier directory")}
                  </>
                ) : (
                  <>
                    <span className="font-medium">{e.name}</span> — {t.n(e.products.length, "a candidate for one of your products", "a candidate for {n} of your products")}:{" "}
                    {e.products.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <Link href={`/sourcing/${p.id}`} className="text-ledger hover:underline">{p.name}</Link>
                      </span>
                    ))}
                  </>
                )}
                {!e.certain && <span className="text-ink-3"> ({e.why})</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[12.5px] text-ink-3">{t("These records are only pointed out: loading replies changes none of them, and no company becomes a supplier by answering.")}</p>
      </Section>

      <Disclosure className="mt-3" title={t("Correct the company's details")} description={t("A name written wrong, a contact that changed")}>
        <CompanyEdit company={c} />
      </Disclosure>
    </>
  );
}
