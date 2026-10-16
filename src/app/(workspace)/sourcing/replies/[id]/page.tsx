import { ChannelSection } from "@/components/orders/sections";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { ReplyStatusPills } from "@/components/replies/pills";
import { AttributionFix, CompanyLinkDecision, DocumentForm, RemoveDocument, VerifyDocument } from "@/components/replies/offer-controls";
import { CompanyEdit, ThreadUpdate } from "@/components/replies/replies";
import { Crumbs, Disclosure, PageHeader, Section } from "@/components/ui";
import { CompanyLink } from "@/components/companies/company-link";
import { getDb } from "@/db";
import { marketSuppliers, products, rfqSuppliers, suppliers } from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { countryName, flagOf } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { ACTOR_LABEL, AUDIT_ACTION_LABEL, AVAILABILITY_LABEL, COMPATIBILITY_LABEL, COMPATIBILITY_MEANING, DOCUMENT_KIND_LABEL, MESSAGE_KIND_LABEL, REPLY_STATUS_LABEL, SPEC_LABEL, availabilityOf, deliveryOf, specsOf, statusesOf, validityOf } from "@/lib/replies/types";
import { readAudit } from "@/server/audit";
import { readReplies } from "@/server/replies";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/sourcing/replies/[id]">): Promise<Metadata> {
  const { id } = await params;
  // An address that is no record's: "not found", not a database error.
  const [row] = UUID.test(id) ? await (await getDb()).select({ name: rfqSuppliers.name }).from(rfqSuppliers).where(eq(rfqSuppliers.id, id)) : [];
  return { title: row?.name ?? (await getT())("Replies to requests for quotation") };
}

const ATTRIBUTION = { recorded: null, reconstructed: "rebuilt from the rows: recorded before the log existed", uncertain: "who did it was not recorded", corrected: "attribution corrected" } as const;
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
  if (!UUID.test(id)) notFound();
  const [db, t] = await Promise.all([getDb(), getT()]);
  const c = (await readReplies(db, t)).find((x) => x.id === id);
  if (!c) notFound();
  const today = todayISO();
  const offerIds = c.threads.flatMap((th) => th.offers.map((o) => o.id));
  const linked = [...new Set(c.threads.flatMap((th) => th.offers.map((o) => o.productId)).filter((x): x is string => !!x))];
  const [events, names] = await Promise.all([
    readAudit(db, [{ entity: "rfq_supplier", ids: [c.id] }, { entity: "rfq_thread", ids: c.threads.map((th) => th.id) }, { entity: "rfq_offer", ids: offerIds }]),
    linked.length ? db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, linked)) : Promise.resolve([]),
  ]);
  const productName = new Map(names.map((p) => [p.id, p.name]));
  // A resemblance nobody settled is shown with what each record says, side by side: the person decides on the facts.
  const unsettled = c.elsewhere.filter((e) => !e.certain && (!e.decided || e.decided === "later"));
  const facts = new Map<string, { name: string; country: string | null; city: string | null; vatNumber: string | null; email: string | null; phone: string | null; website: string | null }>();
  for (const e of unsettled) {
    if (e.where === "directory") {
      const [r] = await db.select().from(marketSuppliers).where(eq(marketSuppliers.id, e.id));
      if (r) facts.set(`${e.where}|${e.id}`, { name: r.name, country: r.country, city: r.city, vatNumber: null, email: r.email, phone: r.phone, website: r.website });
    } else if (e.where === "supplier") {
      const [r] = await db.select().from(suppliers).where(eq(suppliers.id, e.id));
      if (r) facts.set(`${e.where}|${e.id}`, { name: r.name, country: r.country, city: r.city, vatNumber: r.vatNumber, email: r.email, phone: r.phone, website: r.website });
    }
  }
  const compared = (other: NonNullable<ReturnType<typeof facts.get>>) => {
    const lines: [string, string | null, string | null][] = [
      [t("Name"), c.name, other.name],
      [t("Country"), c.country, other.country],
      [t("Address or town"), c.address, other.city],
      [t("VAT number"), c.vatNumber, other.vatNumber],
      [t("Email"), c.email, other.email],
      [t("Phone"), c.phone, other.phone],
      [t("Website"), c.website, other.website],
    ];
    return (
      <table className="mt-2 w-full max-w-[720px] text-left text-[12.5px]">
        <thead>
          <tr className="text-ink-3">
            <th className="w-[110px] py-1 font-medium" />
            <th className="py-1 pr-3 font-medium">{t("This company, as it answered")}</th>
            <th className="py-1 font-medium">{t("The other record")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(([label, a, b]) => (
            <tr key={label} className="border-t border-rule align-top">
              <td className="py-1 text-ink-3">{label}</td>
              <td className="py-1 pr-3 break-words">{a ?? <span className="text-ink-4">—</span>}</td>
              <td className="py-1 break-words">{b ?? <span className="text-ink-4">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };
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
            <CompanyLink t={t} kind="reply" id={c.id} />
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
                {th.followUpOn && <p className={`-mt-2 text-[12.5px] ${th.followUpOn < today ? "font-medium text-up" : "text-ink-3"}`}>{th.followUpOn < today ? t("To follow up since {date}", { date: f.date(th.followUpOn) }) : t("To follow up by {date}", { date: f.date(th.followUpOn) })}</p>}
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
                          <span title={t(COMPATIBILITY_MEANING[o.compatibility])} className="inline-flex h-[22px] items-center rounded-full bg-caution-wash px-2 text-[12px] font-medium text-caution">
                            {t(COMPATIBILITY_LABEL[o.compatibility])}
                          </span>
                          {o.productId && productName.get(o.productId) ? (
                            <span className="text-[12.5px] text-ink-2">
                              {t("for")}{" "}
                              <Link href={`/products/${o.productId}`} className="text-ledger hover:underline">
                                {productName.get(o.productId)}
                              </Link>
                            </span>
                          ) : (
                            <span className="text-[12.5px] text-ink-3">{t("Not linked to one of your products yet")}</span>
                          )}
                          <Link href={`/sourcing/replies/offers/${o.id}`} className="text-[12.5px] font-medium text-ledger hover:underline">
                            {t("Open the offer")}
                          </Link>
                        </div>
                        {o.technicalStatus && <p className="mt-2 text-[12.5px] text-caution">{o.technicalStatus}</p>}
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
                      {m.source === "assistant" && <span className="text-ink-3"> · {t("written by the AI assistant")}</span>}
                    </div>
                    {m.summary && <div className="text-ink-2">{m.summary}</div>}
                    {m.attachments && <div className="text-[12.5px] text-ink-3">{t("Attached: {files}", { files: m.attachments })}</div>}
                    {m.reference && (/^https?:\/\//i.test(m.reference) ? <div className="text-[12.5px]">{link(m.reference, t("Open the message"))}</div> : <div className="text-[12.5px] text-ink-3">{m.reference}</div>)}
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t("Documents")} description={t("A link to a message is not a copy: only a file uploaded here stays")}>
            {th.messages.some((m) => m.attachments) && (
              <p className="mb-3 text-[13px] text-ink-2">
                {t("Named in the answers, not on file")}: {th.messages.map((m) => m.attachments).filter(Boolean).join(" · ")}
              </p>
            )}
            {th.documents.length === 0 ? (
              <p className="mb-3 text-[13.5px] text-ink-3">{t("No document was added to this conversation.")}</p>
            ) : (
              <ul className="mb-3 flex flex-col divide-y divide-rule">
                {th.documents.map((d) => {
                  const availability = availabilityOf(d);
                  return (
                    <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-[13.5px]">
                      <div className="min-w-0">
                        {d.documentId ? <a href={`/documents/${d.documentId}`} target="_blank" rel="noreferrer" className="font-medium text-ledger hover:underline">{d.name}</a> : d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-ledger hover:underline">{d.name}</a> : <span className="font-medium">{d.name}</span>}
                        <span className="ml-2 text-[12px] text-ink-3">{t(DOCUMENT_KIND_LABEL[d.kind])}</span>
                        <div className={`text-[12px] ${availability === "stored" ? "text-down" : "text-caution"}`}>{t(AVAILABILITY_LABEL[availability])}</div>
                      </div>
                      <span className="flex items-center gap-3">
                        {d.documentId && <VerifyDocument id={d.id} verified={!!d.verifiedAt} />}
                        <RemoveDocument id={d.id} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <Disclosure title={t("Add a document")}>
              <DocumentForm threadId={th.id} />
            </Disclosure>
          </Section>

          <Disclosure title={t("Update this conversation")} description={t("An answer received, a message you sent, a note: it goes in the history")}>
            <ThreadUpdate threadId={th.id} status={th.status} nextAction={th.nextAction} followUpOn={th.followUpOn} missing={th.missing} categories={th.categories} today={today} />
          </Disclosure>
        </div>
      ))}

      <ChannelSection className="mt-4" record={{ kind: "reply", id: c.id }} defaultEmail={c.email} products={names} />

      <Section className="mt-4" title={t("In your records")} description={t("The same company in the other parts of the app: suppliers, candidates, the supplier directory")}>
        {c.elsewhere.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">{t("Nowhere else on file: it is not among your suppliers, your candidates or the supplier directory.")}</p>
        ) : (
          <ul className="flex flex-col gap-3 text-[13.5px]">
            {c.elsewhere.map((e) => (
              <li key={`${e.where}|${e.id}`}>
                {e.decided === "different" ? (
                  <span className="text-ink-3">{t("Kept apart by you")}: </span>
                ) : e.decided === "group" ? (
                  <span className="font-medium text-ink-2">{t("Same group, another company")}: </span>
                ) : !e.certain ? (
                  <span className="font-medium text-caution">{e.decided === "later" ? t("Possibly the same company — decision put off") : t("Possibly the same company")}: </span>
                ) : null}
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
                {e.decided === "same" && <span className="text-ink-3"> · {t("confirmed by a person")}</span>}
                {!e.certain && (!e.decided || e.decided === "later") && e.why && <span className="text-ink-3"> ({e.why})</span>}
                {facts.has(`${e.where}|${e.id}`) && compared(facts.get(`${e.where}|${e.id}`)!)}
                {(e.decided || !e.certain) && <CompanyLinkDecision replyId={c.id} where={e.where} id={e.id} decided={e.decided} />}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[13.5px] text-ink-2">
          {c.requests.length === 0
            ? t("No request for quotation is recorded as sent to it from the app.")
            : t.n(c.requests.length, "{n} request recorded as sent: {dates}", "{n} requests recorded as sent: {dates}", { dates: c.requests.map((r) => f.date(r.sentAt)).join(", ") })}
        </p>
        <p className="mt-3 text-[12.5px] text-ink-3">{t("These records are only pointed out: loading replies changes none of them, and no company becomes a supplier by answering.")}</p>
      </Section>

      <Disclosure className="mt-3" title={t("Change log")} description={t.n(events.length, "{n} event: who did what, and when", "{n} events: who did what, and when")}>
        <ul className="flex flex-col divide-y divide-rule text-[13px]">
          {events.map((e) => (
            <li key={e.id} className="py-2">
              <span className="num text-ink-3">{f.date(e.at.slice(0, 10))}</span> · <span className="font-medium">{t(ACTOR_LABEL[e.actorType])}</span>
              {e.actorId && e.actorType !== "user" && <span className="text-ink-3"> ({e.actorId})</span>} · {AUDIT_ACTION_LABEL[e.action] ? t(AUDIT_ACTION_LABEL[e.action]) : e.action}
              {e.field && ` · ${e.field}`}
              {(e.oldValue || e.newValue) && <span className="text-ink-2">: {e.oldValue ?? "—"} → {e.newValue ?? "—"}</span>}
              {ATTRIBUTION[e.attribution] && <span className="text-caution"> · {t(ATTRIBUTION[e.attribution]!)}</span>}
              {e.note && <div className="text-[12.5px] text-ink-3">{e.note}</div>}
              {e.attribution !== "corrected" && e.actorType !== "import" && e.action !== "attribution_corrected" && <div><AttributionFix eventId={e.id} actor={e.actorType} /></div>}
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure className="mt-3" title={t("Correct the company's details")} description={t("A name written wrong, a contact that changed")}>
        <CompanyEdit company={c} />
      </Disclosure>
    </>
  );
}
