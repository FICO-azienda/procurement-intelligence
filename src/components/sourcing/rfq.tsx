"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Check, Copy, Download, Mail } from "lucide-react";
import { markRequestsSentAction, recordCandidateQuoteAction } from "@/app/actions";
import { todayISO } from "@/lib/analytics";
import { translator } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { readReply } from "@/lib/sourcing/reply";
import { rfqText } from "@/lib/sourcing/rfq";
import type { RfqLineData } from "@/server/sourcing";
import { Field, Grid, Input, Textarea } from "../form-kit";
import { buttonClass, cx } from "../ui";

/** What every request says about who is asking. */
export interface RfqContext {
  deliveryCountry: string | null;
  companyName: string;
  userName: string | null;
}

/** One email to one supplier: one product, or several. */
export interface RfqItem {
  key: string;
  supplierName: string;
  /** An address read on their site, if any. */
  email: string | null;
  kind: "request" | "update" | "follow_up";
  /** When the earlier request was sent, for an update or a follow-up. */
  previousDate: string | null;
  lines: RfqLineData[];
  candidateIds: string[];
}

const fileName = (name: string) => `${name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "rfq"}.txt`;

/**
 * The requests for quotation, one per supplier, ready to copy or download.
 * The user reads them, sends them from their own email, and then says so:
 * nothing leaves the app, and the current price and supplier are never in the text.
 */
export function RfqPanel({ items, context, language, onClose, onSent }: { items: RfqItem[]; context: RfqContext; language: "en" | "it"; onClose: () => void; onSent?: () => void }) {
  const t = useT();
  const router = useRouter();
  const [lang, setLang] = useState<"en" | "it">(language);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const drafts = useMemo(() => {
    const tt = translator(lang);
    return new Map(
      items.map((item) => [
        item.key,
        rfqText(
          {
            lines: item.lines.map((l) => ({ productName: l.productName, specifications: Object.fromEntries(l.specifications.map((s) => [tt.any(s.label), s.value])), description: l.description, unit: l.unit, annualQuantity: l.annualQuantity, typicalOrderQuantity: l.typicalOrderQuantity })),
            deliveryCountry: context.deliveryCountry,
            companyName: context.companyName,
            userName: context.userName,
            supplierName: item.supplierName,
            kind: item.kind,
            previousDate: item.previousDate,
          },
          tt,
        ),
      ]),
    );
  }, [items, context, lang]);
  const whole = (key: string) => `${drafts.get(key)!.subject}\n\n${drafts.get(key)!.body}`;
  const copy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(whole(key));
      setCopied(key);
    } catch {
      setCopied(null);
    }
  };
  const download = (item: RfqItem) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([whole(item.key)], { type: "text/plain;charset=utf-8" }));
    link.download = fileName(`rfq-${item.supplierName}`);
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const followUp = items.every((i) => i.kind === "follow_up");
  return (
    <div className="rounded-xl border border-ledger/25">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-ledger-wash/50 px-5 py-3.5">
        <div className="min-w-[220px] flex-1">
          <div className="text-[14.5px] font-semibold">{followUp ? t.n(items.length, "Follow-up to {n} supplier", "Follow-up to {n} suppliers") : t.n(items.length, "Request for quotation: {n} supplier", "Requests for quotation: {n} suppliers")}</div>
          <div className="text-[12.5px] text-ink-2">{t("Read each text, then send it from your own email. Nothing is sent from here, and your current price and supplier are not mentioned.")}</div>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-rule-strong text-[12.5px]">
          {(["it", "en"] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={cx("h-7 px-2.5", lang === l ? "bg-ink text-white" : "bg-canvas text-ink-2 hover:bg-wash")}>
              {l === "it" ? "Italiano" : "English"}
            </button>
          ))}
        </div>
        <button type="button" className={buttonClass("ghost")} onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.key} className="border-t border-rule px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[200px] flex-1 text-[13.5px]">
                <span className="font-medium">{item.supplierName}</span>{" "}
                <span className="text-ink-3">
                  · {item.lines.length > 1 ? t("one request, {n} products", { n: item.lines.length }) : drafts.get(item.key)!.subject}
                  {item.email && (
                    <>
                      {" · "}
                      <Mail size={11} className="-mt-0.5 inline" /> {item.email}
                    </>
                  )}
                </span>
              </div>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => copy(item.key)}>
                {copied === item.key ? <Check size={13} /> : <Copy size={13} />} {copied === item.key ? t("Copied") : t("Copy")}
              </button>
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => download(item)}>
                <Download size={13} /> {t("Download")}
              </button>
            </div>
            <Textarea readOnly rows={Math.min(22, 9 + item.lines.length * 4)} value={`${drafts.get(item.key)!.subject}\n\n${drafts.get(item.key)!.body}`} className="mt-2 w-full font-mono text-[12px]" aria-label={t("Request text for {name}", { name: item.supplierName })} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-rule px-5 py-3">
        <button
          type="button"
          disabled={pending}
          className={buttonClass("primary")}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await markRequestsSentAction(items.map((i) => ({ supplierName: i.supplierName, candidateIds: i.candidateIds, productIds: i.lines.map((l) => l.productId), kind: i.kind })));
              if (!res.ok) return setError(res.error ?? t("Something went wrong."));
              router.refresh();
              onSent?.();
              onClose();
            })
          }
        >
          {followUp ? t.n(items.length, "I sent {n} follow-up", "I sent {n} follow-ups") : t.n(items.length, "I sent {n} request", "I sent {n} requests")}
        </button>
        <span className="text-[12.5px] text-ink-3">{t("Press it only after sending: the app remembers who was asked and when, so nobody is written to twice.")}</span>
        {error && <span className="text-[12.5px] text-up">{error}</span>}
      </div>
    </div>
  );
}

const EMPTY = { date: "", unitPrice: "", currency: "EUR", moq: "", leadTimeDays: "", paymentTermsDays: "", incoterm: "", validUntil: "", notes: "" };

/**
 * A supplier answered: paste the email, the app reads the price and the
 * terms into a form, the user checks them and saves a quote. What could be
 * read two ways is left empty, with the words it was about.
 */
export function ReplyPanel({ candidateId, supplierName, unit, onClose }: { candidateId: string; supplierName: string; unit: string; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [v, setV] = useState({ ...EMPTY, date: todayISO() });
  const [read, setRead] = useState<ReturnType<typeof readReply> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [key]: e.target.value }));
  const understand = () => {
    const r = readReply(raw, { unit, today: todayISO() });
    setRead(r);
    setV((x) => ({
      ...x,
      unitPrice: r.price != null ? String(r.price).replace(".", ",") : "",
      currency: r.currency ?? "EUR",
      moq: r.moq != null ? String(r.moq) : "",
      leadTimeDays: r.leadTimeDays != null ? String(r.leadTimeDays) : "",
      paymentTermsDays: r.paymentTermsDays != null ? String(r.paymentTermsDays) : "",
      incoterm: r.incoterm ?? "",
      validUntil: r.validUntil ?? "",
      notes: r.notes.join(" "),
    }));
  };
  const field = (key: keyof typeof EMPTY, label: string, opts: { type?: string; from?: string; required?: boolean } = {}) => (
    <Field label={label} error={errors[key]} hint={opts.from ? `“${opts.from.slice(0, 120)}”` : undefined} required={opts.required}>
      <Input value={v[key]} onChange={set(key)} type={opts.type} />
    </Field>
  );
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-ledger/25 px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[13.5px] font-semibold">{t("The answer from {name}", { name: supplierName })}</div>
          <p className="text-[12.5px] text-ink-3">{t("Paste their email: the price and the terms are read into the form below, for you to check. Saving it adds {name} to your suppliers, with this quote.", { name: supplierName })}</p>
        </div>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5} className="w-full text-[12.5px]" placeholder={t("Paste the supplier's answer here")} aria-label={t("The supplier's answer")} />
      <button type="button" className={buttonClass("secondary", "sm")} disabled={!raw.trim()} onClick={understand}>
        {t("Read the answer")}
      </button>
      {read && read.doubts.length > 0 && (
        <ul className="space-y-1 text-[12.5px] text-caution">
          {read.doubts.map((d) => (
            <li key={d.message + d.detail}>
              {t(d.message, { unit })} <span className="text-ink-3">“{d.detail}”</span>
            </li>
          ))}
        </ul>
      )}
      <Grid>
        {field("unitPrice", t("Price per {unit}", { unit }), { required: true, from: read?.from.price })}
        {field("currency", t("Currency"))}
        {field("date", t("Date of the offer"), { type: "date", required: true })}
        {field("moq", t("Minimum order ({unit})", { unit }), { from: read?.from.moq })}
        {field("leadTimeDays", t("Lead time (days)"), { from: read?.from.leadTime })}
        {field("incoterm", t("Delivery terms"), { from: read?.from.incoterm })}
        {field("paymentTermsDays", t("Payment (days)"), { from: read?.from.payment })}
        {field("validUntil", t("Valid until"), { type: "date", from: read?.from.validity })}
      </Grid>
      <Field label={t("Note")}>
        <Textarea value={v.notes} onChange={set("notes")} rows={2} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass("primary")}
          disabled={pending || !v.unitPrice.trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await recordCandidateQuoteAction(candidateId, v, raw);
              setErrors(res.errors ?? {});
              if (!res.ok) return res.errors ? undefined : setError(res.error ?? t("Something went wrong."));
              router.refresh();
              onClose();
            })
          }
        >
          {pending ? t("Saving…") : t("Save as quote")}
        </button>
        <span className="text-[12.5px] text-ink-3">{t("A quote enters the comparison; it is not a decision.")}</span>
        {error && <span className="text-[12.5px] text-up">{error}</span>}
      </div>
    </div>
  );
}

export interface SupplierVM {
  key: string;
  name: string;
  /** "🇵🇱 Poland · Manufacturer" */
  about: string;
  email: string | null;
  website: string | null;
  recommended: boolean;
  combinedSpend: string;
  missing: string[];
  lines: { candidateId: string; productId: string; productName: string; spend: string; shortlisted: boolean; firstRound: boolean; asked: boolean; line: RfqLineData }[];
  history: { times: number; last: string | null; lastISO: string | null; days: number | null; recent: boolean; followUpDue: boolean; products: number };
  /** A quote from this company is on file. */
  answered: boolean;
}

/**
 * Requests by supplier: a company that could cover several products is
 * written to once, with one request. The lines of the first round are
 * ticked; the others it could also cover can be added to the same email.
 */
export function SupplierRfqBoard({ suppliers, context, language }: { suppliers: SupplierVM[]; context: RfqContext; language: "en" | "it" }) {
  const t = useT();
  const [open, setOpen] = useState<{ key: string; kind: RfqItem["kind"] } | null>(null);
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const picked = (s: SupplierVM) => ticked[s.key] ?? s.lines.filter((l) => l.shortlisted && l.firstRound && !l.asked).map((l) => l.candidateId);
  const toggle = (s: SupplierVM, id: string) => setTicked((x) => ({ ...x, [s.key]: picked(s).includes(id) ? picked(s).filter((y) => y !== id) : [...picked(s), id] }));
  if (!suppliers.length) return <p className="text-[13px] text-ink-3">{t("No supplier is recommended for a request yet: research the products first.")}</p>;
  return (
    <ul className="space-y-3">
      {suppliers.map((s) => {
        const chosen = s.lines.filter((l) => picked(s).includes(l.candidateId));
        const asked = s.lines.filter((l) => l.asked);
        const item = (kind: RfqItem["kind"]): RfqItem => {
          const lines = kind === "follow_up" ? asked : chosen;
          return { key: s.key, supplierName: s.name, email: s.email, kind, previousDate: s.history.lastISO, lines: lines.map((l) => l.line), candidateIds: lines.map((l) => l.candidateId) };
        };
        const kind: RfqItem["kind"] = s.history.recent && !s.answered ? "update" : "request";
        return (
          <li key={s.key} className="rounded-lg border border-rule px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-[220px] flex-1">
                <div className="text-[14.5px] font-semibold">{s.name}</div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">{[s.about, s.email].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="text-right">
                <div className="num text-[15px] font-semibold">{s.combinedSpend}</div>
                <div className="text-[12px] text-ink-3">{t.n(s.lines.length, "your spend today on {n} product it could cover", "your spend today on the {n} products it could cover")}</div>
              </div>
            </div>
            <ul className="mt-2.5 space-y-1 text-[13px]">
              {s.lines.map((l) => (
                <li key={l.candidateId} className="flex flex-wrap items-center gap-x-2">
                  <input type="checkbox" className="size-3.5 accent-ledger" checked={picked(s).includes(l.candidateId)} disabled={l.asked} onChange={() => toggle(s, l.candidateId)} aria-label={t("Include {name}", { name: l.productName })} />
                  <Link href={`/sourcing/${l.productId}`} className="font-medium hover:underline">
                    {l.productName}
                  </Link>
                  <span className="num text-ink-3">{l.spend}</span>
                  {l.asked ? <span className="text-[12px] text-caution">{t("already asked")}</span> : !l.firstRound ? <span className="text-[12px] text-ink-3">{t("not in the first round: add it if you write anyway")}</span> : !l.shortlisted ? <span className="text-[12px] text-ink-3">{t("could also cover it")}</span> : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12.5px] text-ink-3">
              {t("To ask:")} {s.missing.join(" · ")}
            </p>
            {s.history.times > 0 && (
              <p className={cx("mt-1 text-[12.5px]", s.history.followUpDue ? "text-caution" : "text-ink-3")}>
                {t.n(s.history.times, "Written to {n} time, last on {date}.", "Written to {n} times, last on {date}.", { date: s.history.last ?? "" })}{" "}
                {s.answered ? t("A quote is on file.") : s.history.followUpDue ? t("No answer after {n} days: a follow-up is in order.", { n: s.history.days ?? 0 }) : t("Waiting for the answer.")}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {s.lines.some((l) => !l.asked) && (
                <button type="button" className={buttonClass(s.recommended && !asked.length ? "primary" : "secondary")} disabled={!chosen.length} onClick={() => setOpen({ key: s.key, kind })}>
                  {kind === "update" ? t("Add these products to the request already sent") : chosen.length > 1 ? t("Prepare consolidated RFQ") : t("Prepare RFQ")}
                </button>
              )}
              {s.history.followUpDue && asked.length > 0 && (
                <button type="button" className={buttonClass("secondary")} onClick={() => setOpen({ key: s.key, kind: "follow_up" })}>
                  {t("Prepare follow-up")}
                </button>
              )}
              {kind === "update" && chosen.length > 0 && <span className="text-[12.5px] text-ink-3">{t("Asked recently: one more email extends that request, instead of a new one from scratch.")}</span>}
            </div>
            {open?.key === s.key && <div className="mt-3">{<RfqPanel items={[item(open.kind)]} context={context} language={language} onClose={() => setOpen(null)} onSent={() => setTicked((x) => ({ ...x, [s.key]: [] }))} />}</div>}
          </li>
        );
      })}
    </ul>
  );
}
