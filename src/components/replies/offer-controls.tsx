"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  addReplyDocumentAction, correctAttributionAction, decideCompanyLinkAction, decideOfferAction, declineSuggestionAction, linkOfferAction, referenceRateAction, removeDestinationAction, removeReplyDocumentAction,
  requestFromSupplierAction, saveDestinationAction, saveLandedAction, setOfferCompatibilityAction, unlinkOfferAction, verifyReplyDocumentAction, type SimpleResult,
} from "@/app/actions";
import type { CategoryTree, Selection } from "@/lib/catalog/tree";
import { useT } from "@/lib/i18n/client";
import { INPUT_KEYS, LANDED_LABEL, type CostEntry, type InputKey, type LandedInput } from "@/lib/replies/landed";
import { ACTORS, ACTOR_LABEL, COMPATIBILITIES, COMPATIBILITY_LABEL, DOCUMENT_KINDS, DOCUMENT_KIND_LABEL, DOCUMENT_ORIGINS, DOCUMENT_ORIGIN_LABEL, type ActorType, type Compatibility } from "@/lib/replies/types";
import type { Destination, DestinationField } from "@/server/destinations";
import { ProductCategoryPicker } from "../catalog/category-picker";
import { Field, Input, Select, Textarea } from "../form-kit";
import { buttonClass, cx } from "../ui";

/** Runs an action, says what went wrong, and shows the page as it is afterwards. */
function useRun() {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const run = (action: () => Promise<SimpleResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      setDone(false);
      const res = await action();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      setDone(true);
      after?.();
      router.refresh();
    });
  const status = (
    <>
      {done && <span className="text-[12.5px] text-down">{t("Saved.")}</span>}
      {error && (
        <span role="alert" className="text-[12.5px] text-up">
          {error}
        </span>
      )}
    </>
  );
  return { busy, run, status };
}

/** A proposal of the app: confirm that the offer is an alternative to verify for the product, or say it is not for it. */
/**
 * The three answers to a product the app proposes for an offer. Associating
 * the two is not saying they are equivalent: the technical compatibility is
 * kept apart, and stays "to verify" until a person says more, with the reason.
 */
export function SuggestionButtons({ offerId, productId, compatibility, reasons }: { offerId: string; productId: string; compatibility: Compatibility; reasons: string[] }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("primary", "sm")} disabled={busy} onClick={() => run(() => linkOfferAction(offerId, productId, { compatibility, note: reasons.join(" ") }))}>
          {t("Associate as a possible alternative")}
        </button>
        <button type="button" className={buttonClass("secondary", "sm")} disabled={busy} onClick={() => run(() => declineSuggestionAction(offerId, productId))}>
          {t("Not the same product")}
        </button>
        <button type="button" className={buttonClass("secondary", "sm")} disabled={busy} aria-expanded={asking} onClick={() => setAsking((a) => !a)}>
          {t("Request further information")}
        </button>
        {status}
      </span>
      {asking && <AskSupplier offerId={offerId} kind="information" productId={productId} />}
    </div>
  );
}

/**
 * What to ask the company — more information, or a price still valid — is
 * written down on the offer and on its conversation, with the day to come
 * back to it. The app sends nothing: the person writes to the company.
 */
export function AskSupplier({ offerId, kind, productId, suggested, today }: { offerId: string; kind: "information" | "price"; productId?: string | null; suggested?: string; today?: string }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const [what, setWhat] = useState(suggested ?? "");
  const [followUpOn, setFollowUpOn] = useState("");
  return (
    <div className="grid gap-3 rounded-md border border-rule bg-well px-3 py-3 text-[13px] @2xl:grid-cols-[minmax(0,1fr)_180px]">
      <Field label={kind === "price" ? t("What to ask for") : t("What is needed to judge it")} hint={kind === "price" ? t("The quantity and the terms you want the new price for.") : t("A data sheet, the oil content, the melting point, a sample: what is missing to say whether it is the same product.")}>
        <Textarea rows={2} value={what} onChange={(e) => setWhat(e.target.value)} />
      </Field>
      <Field label={t("Come back to it on")} hint={t("Optional")}>
        <Input type="date" min={today} value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 @2xl:col-span-2">
        <button type="button" className={buttonClass("secondary", "sm")} disabled={busy || !what.trim()} onClick={() => run(() => requestFromSupplierAction(offerId, { kind, productId: productId ?? null, what, followUpOn: followUpOn || null }))}>
          {kind === "price" ? t("Record: updated price to ask") : t("Record: information to ask")}
        </button>
        <span className="text-ink-3">{t("Nothing is sent: it becomes the next action of the conversation, and you write to the company.")}</span>
        {status}
      </div>
    </div>
  );
}

export function UnlinkButton({ offerId }: { offerId: string }) {
  const t = useT();
  const { busy, run, status } = useRun();
  return (
    <span className="flex items-center gap-2">
      <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => run(() => unlinkOfferAction(offerId))}>
        {t("Remove the link")}
      </button>
      {status}
    </span>
  );
}

/** Ties an offer to a product chosen by hand, when the app proposes none or the wrong one. */
export function LinkPicker({ offerId, tree }: { offerId: string; tree: CategoryTree }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const [picked, setPicked] = useState<Selection>({ category: null, subcategory: null, product: null });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ProductCategoryPicker tree={tree} value={picked} onChange={setPicked} mode="product" placeholder={t("Choose one of your products")} className="w-full @xl:w-[340px]" />
      <button type="button" className={buttonClass("secondary", "sm")} disabled={busy || !picked.product} onClick={() => picked.product && run(() => linkOfferAction(offerId, picked.product!))}>
        {t("Link as an alternative to verify")}
      </button>
      {status}
    </div>
  );
}

/** How far the offer is the product bought, and why. A classification with no reason is not saved. */
export function CompatibilityForm({ offerId, compatibility, note, linked }: { offerId: string; compatibility: Compatibility; note: string | null; linked: boolean }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const [value, setValue] = useState(compatibility);
  const [reason, setReason] = useState(note ?? "");
  return (
    <div className="grid gap-3 text-[13px] @2xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <Field label={t("Technical compatibility")} hint={!linked ? t("Equivalence can be said only once the offer is linked to one of your products.") : undefined}>
        <Select value={value} onChange={(e) => setValue(e.target.value as Compatibility)}>
          {COMPATIBILITIES.map((c) => (
            <option key={c} value={c} disabled={c === "validated" && !linked}>
              {t(COMPATIBILITY_LABEL[c])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("Why")} hint={t("What it is based on: a data sheet, a sample tested, a difference in grade.")}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 @2xl:col-span-2">
        <button type="button" className={buttonClass("primary", "sm")} disabled={busy} onClick={() => run(() => setOfferCompatibilityAction(offerId, value, reason))}>
          {t("Save")}
        </button>
        {status}
      </div>
    </div>
  );
}

/** Turning an offer down, or taking it up again. It stays on file either way. */
export function DecisionForm({ offerId, rejected, note }: { offerId: string; rejected: boolean; note: string | null }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const [reason, setReason] = useState(note ?? "");
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {rejected ? (
        <p className="text-ink-2">{t("You turned this offer down: {reason}", { reason: note ?? "—" })}</p>
      ) : (
        <Field label={t("Why it is turned down")}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass(rejected ? "secondary" : "danger", "sm")} disabled={busy} onClick={() => run(() => decideOfferAction(offerId, !rejected, rejected ? null : reason))}>
          {rejected ? t("Take the offer up again") : t("Turn the offer down")}
        </button>
        {status}
      </div>
    </div>
  );
}

type Row = { amount: string; per: CostEntry["per"]; currency: string; status: CostEntry["status"]; source: string; date: string; note: string };
const blank = (currency: string): Row => ({ amount: "", per: "unit", currency, status: "estimated", source: "", date: "", note: "" });
const toNumber = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));

/**
 * What it costs to bring the goods to the plant: each figure with whether it is
 * confirmed or an estimate, where it comes from and when. A line left empty
 * stays missing — nothing is filled in for it.
 */
export function LandedForm({ offerId, currency, unit, input, destinations, destinationId, today }: { offerId: string; currency: string; unit: string; input: LandedInput; destinations: Destination[]; destinationId: string | null; today: string }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const foreign = currency !== "EUR";
  const [fx, setFx] = useState({ rate: input.fx ? String(input.fx.rate).replace(".", ",") : "", date: input.fx?.date ?? today, source: input.fx?.source ?? "", status: input.fx?.status ?? "confirmed" });
  const [rows, setRows] = useState<Record<InputKey, Row>>(
    () => Object.fromEntries(INPUT_KEYS.map((k) => [k, input[k] ? { amount: String(input[k]!.amount).replace(".", ","), per: input[k]!.per, currency: input[k]!.currency, status: input[k]!.status, source: input[k]!.source ?? "", date: input[k]!.date ?? "", note: input[k]!.note ?? "" } : blank("EUR")])) as Record<InputKey, Row>,
  );
  const [destination, setDestination] = useState(destinationId ?? "");
  const [looking, look] = useTransition();
  const [fxNote, setFxNote] = useState<string | null>(null);
  const set = (key: InputKey, patch: Partial<Row>) => setRows((old) => ({ ...old, [key]: { ...old[key], ...patch } }));

  const save = () => {
    const out: Record<string, unknown> = {};
    if (foreign && fx.rate.trim()) out.fx = { rate: toNumber(fx.rate), date: fx.date, source: fx.source, status: fx.status };
    for (const key of INPUT_KEYS) {
      const r = rows[key];
      if (!r.amount.trim()) continue;
      out[key] = { amount: toNumber(r.amount), per: r.per, currency: r.currency, status: r.status, source: r.source, date: r.date, note: r.note };
    }
    run(() => saveLandedAction(offerId, out, destination || null));
  };

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      {destinations.length > 1 && (
        <Field label={t("Delivered to")} className="max-w-[360px]">
          <Select value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="">{t("The default destination")}</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {[d.city, d.province].filter(Boolean).join(" ")}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {foreign && (
        <fieldset className="grid gap-3 rounded-md border border-rule px-3 py-3 @2xl:grid-cols-4">
          <legend className="px-1 text-[12.5px] font-medium text-ink-2">{t("Exchange rate: euro for one {currency}", { currency })}</legend>
          <div className="flex flex-wrap items-center gap-3 @2xl:col-span-4">
            <button
              type="button"
              className={buttonClass("secondary", "sm")}
              disabled={looking}
              onClick={() =>
                look(async () => {
                  setFxNote(null);
                  const res = await referenceRateAction(currency, fx.date || today);
                  if (!res.ok || res.rate == null) return setFxNote(res.error ?? t("Something went wrong."));
                  // A reference rate is not the rate a bank will apply: offered as an estimate, for the person to keep or change.
                  setFx({ rate: String(res.rate).replace(".", ","), date: res.date ?? fx.date, source: res.source ?? "", status: "estimated" });
                  setFxNote(t("Filled in with the official reference rate of {date}: check it, then save. It is kept with this offer as it is today.", { date: res.date ?? "" }));
                })
              }
            >
              {looking ? t("Looking…") : t("Use the official reference rate of that day")}
            </button>
            {fxNote && <span className="text-[12.5px] text-ink-2">{fxNote}</span>}
          </div>
          <Field label={t("Rate")}>
            <Input inputMode="decimal" value={fx.rate} onChange={(e) => setFx({ ...fx, rate: e.target.value })} placeholder="0,92" />
          </Field>
          <Field label={t("Date of the rate")}>
            <Input type="date" value={fx.date} onChange={(e) => setFx({ ...fx, date: e.target.value })} />
          </Field>
          <Field label={t("Source")}>
            <Input value={fx.source} onChange={(e) => setFx({ ...fx, source: e.target.value })} placeholder={t("ECB reference rate, your bank…")} />
          </Field>
          <Field label={t("Status")}>
            <Select value={fx.status} onChange={(e) => setFx({ ...fx, status: e.target.value as "confirmed" | "estimated" })}>
              <option value="confirmed">{t("Confirmed|cost")}</option>
              <option value="estimated">{t("Estimated|cost")}</option>
            </Select>
          </Field>
        </fieldset>
      )}
      {INPUT_KEYS.map((key) => (
        <fieldset key={key} className="grid gap-3 rounded-md border border-rule px-3 py-3 @2xl:grid-cols-4 @5xl:grid-cols-7">
          <legend className="px-1 text-[12.5px] font-medium text-ink-2">{t(LANDED_LABEL[key])}</legend>
          <Field label={t("Amount")}>
            <Input inputMode="decimal" value={rows[key].amount} onChange={(e) => set(key, { amount: e.target.value })} />
          </Field>
          <Field label={t("Counted")}>
            <Select value={rows[key].per} onChange={(e) => set(key, { per: e.target.value as CostEntry["per"] })}>
              <option value="unit">{t("per {unit}", { unit })}</option>
              <option value="shipment">{t("for the whole shipment")}</option>
              {key === "duty" && <option value="percent">{t("% of the customs value")}</option>}
            </Select>
          </Field>
          <Field label={t("Currency")}>
            <Select value={rows[key].currency} disabled={rows[key].per === "percent"} onChange={(e) => set(key, { currency: e.target.value })}>
              <option value="EUR">EUR</option>
              {foreign && <option value={currency}>{currency}</option>}
            </Select>
          </Field>
          <Field label={t("Status")}>
            <Select value={rows[key].status} onChange={(e) => set(key, { status: e.target.value as CostEntry["status"] })}>
              <option value="estimated">{t("Estimated|cost")}</option>
              <option value="confirmed">{t("Confirmed|cost")}</option>
            </Select>
          </Field>
          <Field label={t("Source")}>
            <Input value={rows[key].source} onChange={(e) => set(key, { source: e.target.value })} placeholder={t("A forwarder's quote, a tariff…")} />
          </Field>
          <Field label={t("Date")}>
            <Input type="date" value={rows[key].date} onChange={(e) => set(key, { date: e.target.value })} />
          </Field>
          <Field label={t("Assumptions")}>
            <Input value={rows[key].note} onChange={(e) => set(key, { note: e.target.value })} />
          </Field>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass("primary", "sm")} disabled={busy} onClick={save}>
          {t("Save the costs")}
        </button>
        {status}
        <span className="text-[12px] text-ink-3">{t("A line left empty stays missing. Zero is a figure: write it when a cost is really nil.")}</span>
      </div>
    </div>
  );
}

/** A document of a conversation: a name, a link, or the file itself. Only the file is a copy on file. */
export function DocumentForm({ threadId, offerId }: { threadId: string; offerId?: string }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const [key, setKey] = useState(0);
  return (
    <form
      key={key}
      className="grid gap-3 text-[13px] @2xl:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        run(() => addReplyDocumentAction(form), () => setKey((k) => k + 1));
      }}
    >
      <input type="hidden" name="threadId" value={threadId} />
      {offerId && <input type="hidden" name="offerId" value={offerId} />}
      <Field label={t("Kind")}>
        <Select name="kind" defaultValue="offer">
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(DOCUMENT_KIND_LABEL[k])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("Name")}>
        <Input name="name" placeholder={t("As the file is called")} />
      </Field>
      <Field label={t("Link")} hint={t("Optional")}>
        <Input name="url" placeholder="https://" />
      </Field>
      <Field label={t("The file")} hint={t("Uploading it keeps a copy on file")}>
        <input name="file" type="file" className="block w-full text-[12.5px] file:mr-2 file:rounded-md file:border file:border-rule-strong file:bg-canvas file:px-2.5 file:py-1.5 file:text-[12.5px]" />
      </Field>
      <Field label={t("Received on")} hint={t("Optional")}>
        <Input name="receivedOn" type="date" />
      </Field>
      <Field label={t("How it came")}>
        <Select name="origin" defaultValue="">
          <option value="">{t("Not said")}</option>
          {DOCUMENT_ORIGINS.map((o) => (
            <option key={o} value={o}>
              {t(DOCUMENT_ORIGIN_LABEL[o])}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-3 @2xl:col-span-4">
        <button type="submit" className={buttonClass("secondary", "sm")} disabled={busy}>
          {t("Add the document")}
        </button>
        {status}
      </div>
    </form>
  );
}

export function RemoveDocument({ id }: { id: string }) {
  const t = useT();
  const { busy, run } = useRun();
  return (
    <button type="button" className="text-[12px] text-ink-3 hover:text-up hover:underline" disabled={busy} onClick={() => run(() => removeReplyDocumentAction(id))}>
      {t("Remove")}
    </button>
  );
}

/** A person checked that a document on file is what it says, or takes the check back. Only a copy on file can be checked. */
export function VerifyDocument({ id, verified }: { id: string; verified: boolean }) {
  const t = useT();
  const { busy, run } = useRun();
  return (
    <button type="button" className="text-[12px] text-ink-3 hover:text-ink hover:underline" disabled={busy} onClick={() => run(() => verifyReplyDocumentAction(id, !verified))}>
      {verified ? t("Take the check back") : t("Mark as checked")}
    </button>
  );
}

/** What a record of another part of the app is to this company: a person says, and can take it back. */
export function CompanyLinkDecision({ replyId, where, id, decided }: { replyId: string; where: string; id: string; decided: "same" | "group" | "different" | "later" | null }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const say = (relation: string | null) => run(() => decideCompanyLinkAction(replyId, where, id, relation));
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      {decided && decided !== "later" ? (
        <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => say(null)}>
          {t("Take the decision back")}
        </button>
      ) : (
        <>
          <button type="button" className={buttonClass("secondary", "sm")} disabled={busy} onClick={() => say("same")}>
            {t("The same company")}
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => say("group")}>
            {t("Same group, two companies")}
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => say("different")}>
            {t("Two different companies")}
          </button>
          {decided !== "later" && (
            <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => say("later")}>
              {t("Decide later")}
            </button>
          )}
        </>
      )}
      {status}
    </span>
  );
}

/** An event attributed to the wrong actor: attributed again, with the evidence for it. */
export function AttributionFix({ eventId, actor }: { eventId: string; actor: ActorType }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<ActorType>(actor);
  const [evidence, setEvidence] = useState("");
  if (!open)
    return (
      <button type="button" className="text-[12px] text-ink-3 hover:text-ledger hover:underline" onClick={() => setOpen(true)}>
        {t("Correct who did it")}
      </button>
    );
  return (
    <span className="mt-1 flex flex-wrap items-end gap-2">
      <Select aria-label={t("Who did it")} className="h-8! w-auto! text-[12.5px]!" value={who} onChange={(e) => setWho(e.target.value as ActorType)}>
        {ACTORS.map((a) => (
          <option key={a} value={a}>
            {t(ACTOR_LABEL[a])}
          </option>
        ))}
      </Select>
      <Input aria-label={t("Evidence")} className="h-8! min-w-[260px] flex-1 text-[12.5px]!" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder={t("What shows it")} />
      <button type="button" className={buttonClass("secondary", "sm")} disabled={busy} onClick={() => run(() => correctAttributionAction(eventId, who, evidence), () => setOpen(false))}>
        {t("Save")}
      </button>
      {status}
    </span>
  );
}

const DEST_FIELDS: { key: DestinationField; wide?: boolean }[] = [{ key: "recipient", wide: true }, { key: "address", wide: true }, { key: "postalCode" }, { key: "city" }, { key: "province" }, { key: "country" }, { key: "unloading", wide: true }, { key: "restrictions", wide: true }];
const DEST_LABEL = { recipient: "Recipient's company name", address: "Address", postalCode: "Postcode", city: "Town", province: "Province", country: "Country", unloading: "Unloading instructions", restrictions: "Delivery restrictions" } as const;

/** One delivery destination: written down, and confirmed by a person when the address is right. */
export function DestinationForm({ destination, children }: { destination: Destination | null; children?: ReactNode }) {
  const t = useT();
  const { busy, run, status } = useRun();
  const [v, setV] = useState<Record<DestinationField, string>>(() => Object.fromEntries(DEST_FIELDS.map(({ key }) => [key, destination?.[key] ?? ""])) as Record<DestinationField, string>);
  const [isDefault, setDefault] = useState(destination?.isDefault ?? false);
  const [confirmed, setConfirmed] = useState(!!destination?.confirmedAt);
  const [key, setKey] = useState(0);
  return (
    <div key={key} className="grid gap-3 text-[13px] @2xl:grid-cols-4">
      {children}
      {DEST_FIELDS.map(({ key: f, wide }) => (
        <Field key={f} label={t(DEST_LABEL[f])} className={wide ? "@2xl:col-span-2" : undefined} required={f === "city"}>
          <Input value={v[f]} onChange={(e) => setV((old) => ({ ...old, [f]: e.target.value }))} />
        </Field>
      ))}
      <label className="flex items-center gap-2 @2xl:col-span-2">
        <input type="checkbox" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} />
        {t("The default destination: used when nothing says another")}
      </label>
      <label className="flex items-center gap-2 @2xl:col-span-2">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {t("I confirm this address is right")}
      </label>
      <div className="flex flex-wrap items-center gap-3 @2xl:col-span-4">
        <button
          type="button"
          className={buttonClass("primary", "sm")}
          disabled={busy}
          onClick={() =>
            run(
              () => saveDestinationAction({ ...v, id: destination?.id ?? null, isDefault, confirmed }),
              () => {
                if (!destination) {
                  setV(Object.fromEntries(DEST_FIELDS.map(({ key: f }) => [f, ""])) as Record<DestinationField, string>);
                  setKey((k) => k + 1);
                }
              },
            )
          }
        >
          {destination ? t("Save") : t("Add the destination")}
        </button>
        {destination && (
          <button type="button" className={cx(buttonClass("ghost", "sm"), "text-ink-3")} disabled={busy} onClick={() => run(() => removeDestinationAction(destination.id))}>
            {t("Remove")}
          </button>
        )}
        {status}
      </div>
    </div>
  );
}
