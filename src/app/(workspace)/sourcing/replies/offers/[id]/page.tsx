import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { AskSupplier, AttributionFix, CompatibilityForm, DecisionForm, DocumentForm, LandedForm, LinkPicker, RemoveDocument, SuggestionButtons, UnlinkButton, VerifyDocument } from "@/components/replies/offer-controls";
import { Crumbs, Disclosure, PageHeader, Section, cx } from "@/components/ui";
import { getDb } from "@/db";
import { todayISO } from "@/lib/analytics";
import { catalogueTree } from "@/lib/catalog/tree";
import { getDataset, getT } from "@/lib/data";
import * as f from "@/lib/format";
import { LANDED_LABEL, LANDED_STATUS_LABEL } from "@/lib/replies/landed";
import { OFFER_STATE_LABEL, SHORTFALL_LABEL } from "@/lib/replies/offers";
import { validityText } from "@/lib/replies/rows";
import { ACTOR_LABEL, AUDIT_ACTION_LABEL, AVAILABILITY_LABEL, COMPATIBILITY_LABEL, COMPATIBILITY_MEANING, DOCUMENT_KIND_LABEL, DOCUMENT_ORIGIN_LABEL, SPEC_LABEL, availabilityOf, deliveryOf, specsOf } from "@/lib/replies/types";
import { rangesIn } from "@/lib/replies/match";
import { readAudit } from "@/server/audit";
import { getCategoryTree } from "@/server/categories";
import { placeOf } from "@/server/destinations";
import { readOffer } from "@/server/replies";

export async function generateMetadata({ params }: PageProps<"/sourcing/replies/offers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const page = await readOffer(await getDb(), id);
  return { title: page ? `${page.offer.productName} · ${page.company.name}` : (await getT())("Replies to requests for quotation") };
}

const ATTRIBUTION = { recorded: null, reconstructed: "rebuilt from the rows: recorded before the log existed", uncertain: "who did it was not recorded", corrected: "attribution corrected" } as const;

/**
 * One offer in full: what the company quoted, which of the buyer's products
 * it is looked at for and how far the two are the same thing, what it costs
 * to the plant, its documents, its versions and everything that was done to it.
 */
export default async function OfferPage({ params }: PageProps<"/sourcing/replies/offers/[id]">) {
  await connection();
  const { id } = await params;
  const [db, t] = await Promise.all([getDb(), getT()]);
  const page = await readOffer(db, id, t);
  if (!page) notFound();
  const { offer: o, company, thread, product, landed } = page;
  const today = todayISO();
  const [tree, events, data] = await Promise.all([getCategoryTree(), readAudit(db, [{ entity: "rfq_offer", ids: [o.id] }]), getDataset()]);
  const delivery = deliveryOf(o.incoterm, o.destination, t);
  const validity = validityText(o, today, t);
  const docs = thread.documents.filter((d) => !d.offerId || d.offerId === o.id);
  const none = <span className="text-ink-4">{t("Not stated")}</span>;
  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[minmax(120px,180px)_minmax(0,1fr)] gap-3 border-t border-rule py-2 text-[13.5px] first:border-t-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0">{value == null || value === "" ? none : value}</dd>
    </div>
  );
  const specs = specsOf(o.specs);
  const grade = (text: string | null | undefined) => rangesIn(text).map(([a, b]) => `${a}/${b}`).join(", ") || null;
  /**
   * Your product and the product offered, side by side: what each one's own words and data say. Nothing is filled in on
   * either side — a specification nobody wrote is said to be missing, which is itself a reason not to call them equivalent.
   */
  const sideBySide = (productId: string, differences: string[]) => {
    const mine = data.products.find((x) => x.id === productId);
    if (!mine) return null;
    const side = (title: string, lines: [string, ReactNode][]) => (
      <div className="min-w-0 rounded-md border border-rule px-3 py-2.5">
        <div className="mb-1.5 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{title}</div>
        <dl className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          {lines.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-3">{label}</dt>
              <dd className="min-w-0 break-words">{value == null || value === "" ? <span className="text-ink-4">{t("not on file")}</span> : value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
    return (
      <div className="mt-3 flex flex-col gap-2">
        <div className="grid gap-2 @3xl:grid-cols-2">
          {side(t("Your product"), [
            [t("Name"), <Link key="n" href={`/products/${mine.id}`} className="font-medium text-ledger hover:underline">{mine.name}</Link>],
            [t("Code"), mine.sku],
            [t("Grade"), grade(mine.name)],
            [t("Specification"), [mine.technicalSpecifications, ...Object.entries(mine.specs ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(" · ") || null],
            [t("Unit"), mine.unit],
          ])}
          {side(t("The product offered"), [
            [t("Name"), o.productName],
            [t("Code"), o.productCode],
            [t("Grade"), o.grade ?? grade(o.productName)],
            [t("Specification"), specs.map(([k, v]) => `${SPEC_LABEL[k] ? t(SPEC_LABEL[k]) : k}: ${v}`).join(" · ") || null],
            [t("Unit"), o.unit],
          ])}
        </div>
        <div className="rounded-md bg-wash px-3 py-2 text-[13px] text-ink-2">
          <span className="font-medium text-ink">{t("What the two say of each other")}: </span>
          {differences.length ? differences.join(" ") : t("Nothing on file tells them apart, and nothing proves they are the same: that is for a data sheet or a sample to say.")}
        </div>
      </div>
    );
  };
  // For the product it is tied to, the same reading the app made when it proposed it.
  const linkedReasons = page.view?.reasons ?? [];

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/sourcing", label: t("Market") }, { href: "/sourcing/replies", label: t("Replies to requests for quotation") }, { href: `/sourcing/replies/${company.id}`, label: company.name }]} />}
        title={o.productName}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="num font-medium text-ink">
              {f.price(o.unitPrice, o.currency)}/{o.unit}
            </span>
            <span>{[delivery.incoterm, o.destination].filter(Boolean).join(" ")}</span>
            <span className="inline-flex h-[22px] items-center rounded-full bg-wash px-2 text-[12px] font-medium text-ink-2">{t(OFFER_STATE_LABEL[page.state])}</span>
            <span className={cx("text-[12.5px]", validity.tone === "expired" ? "font-medium text-up" : validity.tone === "soon" ? "font-medium text-caution" : "")}>{validity.text}</span>
          </span>
        }
      />
      {page.supersededBy && (
        <p className="mb-4 rounded-md border border-caution/25 bg-caution-wash px-3 py-2 text-[13px] text-caution">
          {t("A newer version of this offer is on file: this one is kept as history.")}{" "}
          <Link href={`/sourcing/replies/offers/${page.supersededBy}`} className="font-medium underline">
            {t("Open the current one")}
          </Link>
        </p>
      )}

      {page.state === "expired" && (
        <div className="mb-4 rounded-lg border border-caution/25 bg-caution-wash/60 px-4 py-3">
          <p className="mb-3 text-[13px] text-caution">{t("This offer is past its date: its price is kept as history and is not used for a new decision.")}</p>
          <Disclosure title={t("Request an updated price")} description={t("Written down as the next action: you write to the company")}>
            <AskSupplier offerId={o.id} kind="price" today={today} suggested={[o.quantity != null ? f.quantity(o.quantity, o.unit) : null, o.productName, [delivery.incoterm, o.destination].filter(Boolean).join(" ") || null].filter(Boolean).join(" · ")} />
          </Disclosure>
        </div>
      )}

      <div className="grid gap-4">
        <Section title={t("Which of your products it is for")} description={t("A link is not an equivalence: how far the two are the same thing is said apart, with the reason")}>
          {product ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px]">
                <span className="text-ink-3">{t("Looked at as an alternative for")}</span>
                <Link href={`/products/${product.id}`} className="font-medium text-ledger hover:underline">
                  {product.name}
                </Link>
                <span title={t(COMPATIBILITY_MEANING[o.compatibility])} className="inline-flex h-[22px] items-center rounded-full bg-caution-wash px-2 text-[12px] font-medium text-caution">
                  {t(COMPATIBILITY_LABEL[o.compatibility])}
                </span>
                <UnlinkButton offerId={o.id} />
              </div>
              <dl className="grid grid-cols-[minmax(0,190px)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
                <dt className="text-ink-3">{t("Association with a product")}</dt>
                <dd>{t("Associated as a possible alternative — which says nothing of their equivalence")}</dd>
                <dt className="text-ink-3">{t("Technical compatibility")}</dt>
                <dd>
                  <span className="font-medium">{t(COMPATIBILITY_LABEL[o.compatibility])}</span>
                  {o.compatibilityNote && <span className="text-ink-2"> — {o.compatibilityNote}</span>}
                </dd>
              </dl>
              {sideBySide(product.id, o.compatibilityNote ? [o.compatibilityNote] : linkedReasons)}
              {page.view && page.view.shortfalls.length > 0 && (
                <p className="text-[13px] text-caution">
                  {t("To become comparable")}: {page.view.shortfalls.map((s) => t(SHORTFALL_LABEL[s])).join(" · ")}
                </p>
              )}
              <CompatibilityForm offerId={o.id} compatibility={o.compatibility} note={o.compatibilityNote} linked />
              {o.compatibility !== "validated" && (
                <Disclosure title={t("Request further information")} description={t("What is missing to judge it: it becomes the next action of the conversation")}>
                  <AskSupplier offerId={o.id} kind="information" productId={product.id} today={today} />
                </Disclosure>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4 text-[13.5px]">
              {page.suggestions.length === 0 ? (
                <p className="text-ink-3">{t("The app proposes none of your products for it: nothing in the catalogue is the same kind of thing in the same unit.")}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {page.suggestions.map((s) => (
                    <li key={s.productId} className="rounded-md border border-rule px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-[12px] font-medium tracking-wide text-ink-3 uppercase">{t("Suggested product")}</span>
                        <Link href={`/products/${s.productId}`} className="font-medium text-ledger hover:underline">
                          {s.productName}
                        </Link>
                        <span className="inline-flex h-[22px] items-center rounded-full bg-wash px-2 text-[12px] font-medium text-ink-2">{t(COMPATIBILITY_LABEL[s.compatibility])}</span>
                      </div>
                      <p className="mt-1 text-[13px] text-ink-2">
                        <span className="font-medium text-ink">{t("Why it is proposed")}: </span>
                        {s.reasons.join(" ")}
                      </p>
                      {sideBySide(s.productId, s.reasons)}
                      <div className="mt-3">
                        <SuggestionButtons offerId={o.id} productId={s.productId} compatibility={s.compatibility} reasons={s.reasons} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">{t("Or choose the product yourself")}</div>
                <LinkPicker offerId={o.id} tree={catalogueTree(tree)} />
              </div>
            </div>
          )}
        </Section>

        <div className="grid gap-4 @4xl:grid-cols-2">
          <Section title={t("The offer, as written")}>
            <dl>
              {row(t("Supplier"), <Link href={`/sourcing/replies/${company.id}`} className="text-ledger hover:underline">{company.name}</Link>)}
              {row(t("Product"), [o.productName, o.grade && o.grade !== o.productName ? o.grade : null, o.productCode].filter(Boolean).join(" · "))}
              {row(t("Price"), `${f.price(o.unitPrice, o.currency)}/${o.unit}`)}
              {row(t("Quantity"), o.quantity != null ? f.quantity(o.quantity, o.unit) : null)}
              {row(t("Minimum order"), o.moq != null ? f.quantity(o.moq, o.unit) : thread.moq)}
              {row(t("Delivery terms"), <><span className="font-medium">{[delivery.incoterm, o.destination].filter(Boolean).join(" ") || t("Not stated")}</span><span className="block text-[12.5px] text-ink-3">{delivery.text}</span></>)}
              {row(t("Payment terms"), o.paymentTerms ?? thread.paymentTerms)}
              {row(t("Delivery and shipping"), thread.leadTime)}
              {row(t("Received"), page.view?.receivedOn ? f.date(page.view.receivedOn) : (o.offeredOn ? f.date(o.offeredOn) : (thread.checkedAt ? t("read on {date}", { date: f.date(thread.checkedAt) }) : null)))}
              {row(t("Validity"), validity.text)}
            </dl>
          </Section>
          <Section title={t("Specification and source")}>
            <dl>
              {specs.length === 0 && row(t("Specification"), null)}
              {specs.map(([k, v]) => (
                <div key={k} className="contents">{row(SPEC_LABEL[k] ? t(SPEC_LABEL[k]) : k, v)}</div>
              ))}
              {row(t("What the source says of it"), o.technicalStatus)}
              {row(t("Still missing"), o.missing)}
              {row(t("Source"), o.sourceUrl && /^https?:\/\//i.test(o.sourceUrl) ? <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="text-ledger hover:underline">{t("Open the message")}</a> : null)}
              {row(t("Attached, as the answer names it"), o.sourceDocument)}
            </dl>
          </Section>
        </div>

        <Section
          title={t("Cost to your plant")}
          description={page.destination ? t("Worked out to {place}", { place: placeOf(page.destination) }) : t("No delivery destination is set: add one in Settings")}
          actions={<span className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium", landed.complete ? "bg-down-wash text-down" : "bg-caution-wash text-caution")}>{landed.complete ? t("Complete") : t("True landed cost incomplete")}</span>}
        >
          <ul className="divide-y divide-rule border-y border-rule">
            {landed.lines.map((line) => (
              <li key={line.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 py-2.5 text-[13.5px]">
                <div className="min-w-0">
                  <span className="font-medium">{t(LANDED_LABEL[line.key])}</span>
                  <span className={cx("ml-2 text-[12px] font-medium", line.status === "missing" ? "text-caution" : line.status === "estimated" ? "text-ink-2" : "text-ink-3")}>{t(LANDED_STATUS_LABEL[line.status])}</span>
                  <div className="text-[12.5px] text-ink-3">
                    {line.note}
                    {line.source && ` ${t("Source")}: ${line.source}${line.date ? `, ${f.date(line.date)}` : ""}.`}
                  </div>
                </div>
                <div className="num text-right font-medium">{line.perUnit == null || line.status === "included" || line.status === "not_applicable" ? "—" : `${f.price(line.perUnit)}/${o.unit}`}</div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-baseline justify-between gap-3 py-3 text-[14px]">
            <span className="font-semibold">{t("True landed cost")}</span>
            <span className="num font-semibold">{landed.total != null ? `${f.price(landed.total)}/${o.unit}${landed.estimated ? ` · ${t("includes estimates")}` : ""}` : t("Incomplete: {what} missing", { what: landed.missing.map((k) => t(LANDED_LABEL[k]).toLowerCase()).join(", ") })}</span>
          </div>
          {/* Quoted per another unit than the product's: the same cost per the product's unit, the one set against the price paid. */}
          {page.product && page.view?.perProductUnit != null && page.view.factor != null && page.view.factor !== 1 && (
            <p className="-mt-1.5 mb-3 text-right text-[12.5px] text-ink-3">
              {t("= {amount}/{unit}, the unit you buy {product} in", { amount: f.price(page.view.perProductUnit), unit: page.product.unit, product: page.product.name })}
            </p>
          )}
          {landed.partial && (
            <p className="mb-3 rounded-md bg-wash px-3 py-2 text-[13px] text-ink-2">
              <span className="font-semibold text-caution">{t("True landed cost incomplete")}.</span>{" "}
              {t("Known so far: {amount}/{unit} — it includes {included} and leaves out {excluded}. A partial figure: it is not a cost to your plant and is not set against the price you pay.", {
                amount: f.price(landed.partial.perUnit),
                unit: o.unit,
                included: landed.partial.includes.map((k) => t(LANDED_LABEL[k]).toLowerCase()).join(", "),
                excluded: landed.partial.excludes.map((k) => t(LANDED_LABEL[k]).toLowerCase()).join(", "),
              })}
            </p>
          )}
          <p className="mb-4 text-[12.5px] text-ink-3">{t("VAT is left out: it is recovered, so it is not a cost of the goods. What the delivery terms already include is not added again, and nothing here is filled in: a figure nobody stated stays missing, and the cost has no total until every one is there.")}</p>
          <Disclosure title={t("State the costs")} description={t("Each with whether it is confirmed or an estimate, its source and its date")}>
            <LandedForm offerId={o.id} currency={o.currency} unit={o.unit} input={page.input} destinations={page.destinations} destinationId={o.destinationId} today={today} />
          </Disclosure>
        </Section>

        <div className="grid gap-4 @4xl:grid-cols-2">
          <Section title={t("Documents")} description={t("A link to a message is not a copy: only a file uploaded here stays")}>
            {docs.length === 0 ? (
              <p className="mb-3 text-[13.5px] text-ink-3">{t("No document on file for this offer.")}</p>
            ) : (
              <ul className="mb-3 flex flex-col divide-y divide-rule">
                {docs.map((d) => {
                  const availability = availabilityOf(d);
                  return (
                    <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-[13.5px]">
                      <div className="min-w-0">
                        {d.documentId ? <a href={`/documents/${d.documentId}`} target="_blank" rel="noreferrer" className="font-medium text-ledger hover:underline">{d.name}</a> : d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-ledger hover:underline">{d.name}</a> : <span className="font-medium">{d.name}</span>}
                        <span className="ml-2 text-[12px] text-ink-3">{t(DOCUMENT_KIND_LABEL[d.kind])}</span>
                        <div className={cx("text-[12px]", availability === "stored" ? "text-down" : "text-caution")}>
                          {t(AVAILABILITY_LABEL[availability])}
                          {d.verifiedAt && ` · ${t("checked by {name} on {date}", { name: d.verifiedBy ?? "—", date: f.date(d.verifiedAt.slice(0, 10)) })}`}
                        </div>
                        {(d.receivedOn || d.origin) && <div className="text-[12px] text-ink-3">{[d.receivedOn ? t("received on {date}", { date: f.date(d.receivedOn) }) : null, d.origin ? t(DOCUMENT_ORIGIN_LABEL[d.origin]) : null].filter(Boolean).join(" · ")}</div>}
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
              <DocumentForm threadId={thread.id} offerId={o.id} />
            </Disclosure>
          </Section>
          <Section title={t("Versions and decision")}>
            {page.versions.length === 0 ? (
              <p className="text-[13.5px] text-ink-3">{t("The only version of this line on file.")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-rule text-[13.5px]">
                {page.versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                    <Link href={`/sourcing/replies/offers/${v.id}`} className="text-ledger hover:underline">
                      {f.date(v.offeredOn ?? v.createdAt.slice(0, 10))}
                    </Link>
                    <span className="num">{f.price(v.unitPrice, v.currency)}/{v.unit}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 border-t border-rule pt-4">
              <DecisionForm offerId={o.id} rejected={o.decision === "rejected"} note={o.decisionNote} />
            </div>
          </Section>
        </div>

        <Disclosure title={t("Change log")} description={t.n(events.length, "{n} event: who did what, and when", "{n} events: who did what, and when")}>
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
      </div>
    </>
  );
}
