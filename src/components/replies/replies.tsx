"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { listReplyFilesAction, loadReplyFileAction, updateReplyCompanyAction, updateReplyThreadAction } from "@/app/actions";
import { countryName } from "@/lib/countries";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { Elsewhere, PlanSummary } from "@/lib/replies/plan";
import {
  FIELD_LABEL, MESSAGE_KINDS, MESSAGE_KIND_LABEL, REPLY_STATUSES, REPLY_STATUS_LABEL,
  type CompanyField, type MessageKind, type ReplyCompany, type ReplyStatus,
} from "@/lib/replies/types";
import { Field, Input, Select, Textarea } from "../form-kit";
import { buttonClass, cx } from "../ui";

/** Where else the buyer's records know a company, in a sentence. */
export function useElsewhere() {
  const t = useT();
  return (e: Elsewhere) => {
    const where =
      e.where === "supplier"
        ? t("{name} is one of your suppliers", { name: e.name })
        : e.where === "candidate"
          ? t.n(e.products.length, "{name} is a candidate for one of your products", "{name} is a candidate for {n} of your products", { name: e.name })
          : t("{name} is in the supplier directory", { name: e.name });
    return e.certain ? where : `${t("Possibly the same company")}: ${where} (${e.why})`;
  };
}

const ACTION_LABEL = { create: "New", update: "On file: to update", unchanged: "On file: nothing new" } as const;

/**
 * A file of replies is checked first: what it would add, what it would change,
 * what it would leave alone and what it cannot read. Nothing is written until
 * the user says so, and the load does what the check showed.
 */
function ReplyImport() {
  const t = useT();
  const router = useRouter();
  const elsewhere = useElsewhere();
  const [busy, start] = useTransition();
  const [files, setFiles] = useState<{ name: string; modified: string }[] | null>(null);
  const [checked, setChecked] = useState<{ source: { name: string; raw?: string }; outcome: PlanSummary; loaded: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const run = (source: { name: string; raw?: string }, confirm: boolean) =>
    start(async () => {
      setError(null);
      const res = await loadReplyFileAction(source, confirm);
      if (!res.ok || !res.outcome) return setError(res.error ?? t("Something went wrong."));
      setChecked({ source, outcome: res.outcome, loaded: !!res.loaded });
      if (confirm) router.refresh();
    });

  const c = checked?.outcome.counts;
  const toLoad = c ? c.create + c.update : 0;
  return (
    <div className="text-[13px]">
      <p className="max-w-[760px] text-ink-2">
        {t("The answers to your requests, written down in a file: one record per company, one line per product quoted. Check a file to see what it would add and change; nothing is loaded until you say so, and nothing is sent to anyone.")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {files == null && (
          <button type="button" className={buttonClass("secondary", "sm")} disabled={busy} onClick={() => start(async () => setFiles(await listReplyFilesAction()))}>
            {t("Show the files saved on this computer")}
          </button>
        )}
        <button type="button" className={buttonClass("secondary", "sm")} disabled={busy} onClick={() => picker.current?.click()}>
          {t("Choose a file")}
        </button>
        <input
          ref={picker}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) run({ name: file.name, raw: await file.text() }, false);
          }}
        />
      </div>
      {files != null &&
        (files.length === 0 ? (
          <p className="mt-3 text-ink-3">{t("No file of replies is saved on this computer.")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {files.map((file) => (
              <li key={file.name} className="flex flex-wrap items-center gap-2">
                <span className="num min-w-0 truncate font-medium">{file.name}</span>
                <span className="text-[12px] text-ink-3">{f.date(file.modified.slice(0, 10))}</span>
                <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => run({ name: file.name }, false)}>
                  {t("Check the file")}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {error && (
        <div role="alert" className="mt-3 rounded-md border border-up/25 bg-up-wash px-3 py-2 text-up">
          {error}
        </div>
      )}
      {checked && c && (
        <div className="mt-3 rounded-md border border-rule bg-well px-3 py-3" data-testid="reply-check">
          <div className="font-medium">
            {checked.loaded ? t("{file}: loaded.", { file: checked.source.name }) : t("{file}: checked. Nothing was written yet.", { file: checked.source.name })}
          </div>
          <dl className="mt-2 grid max-w-[640px] grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1">
            {(
              [
                [checked.loaded ? t("New companies added") : t("New companies to add"), c.create],
                [checked.loaded ? t("Companies on file updated") : t("Companies on file to update"), c.update],
                [t("Companies on file with nothing new"), c.unchanged],
                [checked.loaded ? t("Offers added") : t("Offers to add"), c.offersNew],
                [t("Offers already on file"), c.offersKnown],
                [t("Records that could not be read"), checked.outcome.rejected.length],
                [t("Values on file the file would have changed, and did not"), c.kept],
                [t("Notes on how records were read"), c.warnings],
                [t("Companies your other records already know"), c.elsewhere],
              ] as [string, number][]
            ).map(([label, n]) => (
              <div key={label} className="contents">
                <dt className="text-ink-2">{label}</dt>
                <dd className="num text-right font-medium">{n}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 text-[12.5px] text-ink-3">
            {REPLY_STATUSES.filter((s) => c.byStatus[s])
              .map((s) => `${t(REPLY_STATUS_LABEL[s])}: ${c.byStatus[s]}`)
              .join(" · ")}
          </div>
          {checked.outcome.repeated.length > 0 && <div className="mt-1 text-[12.5px] text-ink-3">{t("Written twice in the file, read once: {names}.", { names: checked.outcome.repeated.join(", ") })}</div>}
          {checked.outcome.rejected.length > 0 && (
            <ul className="mt-2 text-[12.5px] text-caution">
              {checked.outcome.rejected.map((r) => (
                <li key={`${r.kind}|${r.name}|${r.reason}`}>{t("Not read: {name} ({reason})", { name: r.name, reason: r.reason })}</li>
              ))}
            </ul>
          )}

          <ul className="mt-3 flex flex-col divide-y divide-rule border-y border-rule">
            {checked.outcome.rows.map((row) => (
              <li key={row.reference} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                  <span className="font-medium">{row.name}</span>
                  {row.country && <span className="text-[12px] text-ink-3">{countryName(row.country, t.locale)}</span>}
                  <span className="text-[12px] text-ink-3">{row.categories.join(", ")}</span>
                  <span className={cx("text-[12px] font-medium", row.action === "create" ? "text-ledger" : "text-ink-2")}>{t(ACTION_LABEL[row.action])}</span>
                </div>
                <div className="text-[12.5px] text-ink-2">
                  {t(REPLY_STATUS_LABEL[row.status])}
                  {row.statusText && <span className="text-ink-3"> — {t("as written: {text}", { text: row.statusText })}</span>}
                  {row.offersNew + row.offersKnown > 0 && <span> · {t.n(row.offersNew + row.offersKnown, "{n} offer", "{n} offers")}</span>}
                </div>
                {row.matchedBy && <div className="text-[12.5px] text-ink-3">{t("Read as the company on file: {why}.", { why: row.matchedBy })}</div>}
                {row.elsewhere.map((e) => (
                  <div key={`${e.where}|${e.id}`} className="text-[12.5px] text-ink-2">
                    {elsewhere(e)}
                  </div>
                ))}
                {row.changes.map((ch) => (
                  <div key={`c|${ch.field}`} className="text-[12.5px] text-ink-2">
                    {ch.from ? t("{field}: «{from}» becomes «{to}»", { field: t(FIELD_LABEL[ch.field]), from: ch.from, to: ch.to ?? "" }) : t("{field}: added «{to}»", { field: t(FIELD_LABEL[ch.field]), to: ch.to ?? "" })}
                  </div>
                ))}
                {row.kept.map((k) => (
                  <div key={`k|${k.field}`} className="text-[12.5px] text-caution">
                    {k.reason === "confirmed"
                      ? t("{field}: «{stored}» stays — you wrote it. The file says «{incoming}».", { field: t(FIELD_LABEL[k.field]), stored: k.stored, incoming: k.incoming })
                      : t("{field}: «{stored}» stays — the file is older than what is on file. It says «{incoming}».", { field: t(FIELD_LABEL[k.field]), stored: k.stored, incoming: k.incoming })}
                  </div>
                ))}
                {row.warnings.map((w) => (
                  <div key={w} className="text-[12.5px] text-caution">
                    {w}
                  </div>
                ))}
              </li>
            ))}
          </ul>

          {!checked.loaded &&
            (toLoad > 0 ? (
              <button type="button" className={cx(buttonClass("primary", "sm"), "mt-3")} disabled={busy} onClick={() => run(checked.source, true)}>
                {t("Load {companies} companies and {offers} offers", { companies: toLoad, offers: c.offersNew })}
              </button>
            ) : (
              <p className="mt-3 text-ink-3">{t("Everything in this file is on file already: there is nothing to load.")}</p>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * The same box, closed until asked for — and open by itself while nothing is on file. It keeps its own state: when a
 * load fills the page, it stays open on what was just loaded instead of closing over it.
 */
export function ReplyImportPanel({ startOpen }: { startOpen: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(startOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group mt-6 rounded-lg border border-rule bg-canvas">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-5 py-3.5 select-none hover:bg-well focus-visible:outline-2 focus-visible:outline-ledger [&::-webkit-details-marker]:hidden">
        <ChevronRight size={15} className="shrink-0 text-ink-4 transition-transform duration-150 group-open:rotate-90" />
        <span className="text-[14px] font-semibold tracking-[-0.005em]">{t("Load a file of replies")}</span>
        <span className="min-w-0 truncate text-[12.5px] text-ink-3">{t("Checked first, loaded only on your confirmation")}</span>
      </summary>
      <div className="border-t border-rule px-5 py-4">
        <ReplyImport />
      </div>
    </details>
  );
}

/** A person says what happened in a conversation and where it stands: it goes in the history, and is theirs from then on. */
export function ThreadUpdate({ threadId, status, nextAction, followUpOn, missing, categories, today }: { threadId: string; status: ReplyStatus; nextAction: string | null; followUpOn: string | null; missing: string | null; categories: string[]; today: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [v, setV] = useState({ kind: "note" as MessageKind, date: today, summary: "", reference: "", status, nextAction: nextAction ?? "", followUpOn: followUpOn ?? "", missing: missing ?? "", categories: categories.join(", ") });
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setDone(false);
    setV((old) => ({ ...old, [key]: value }));
  };

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateReplyThreadAction(threadId, {
        kind: v.kind,
        date: v.date,
        summary: v.summary,
        reference: v.reference,
        status: v.status,
        nextAction: v.nextAction,
        followUpOn: v.followUpOn,
        missing: v.missing,
        categories: v.categories.split(",").map((c) => c.trim()).filter(Boolean),
      });
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      setDone(true);
      setV((old) => ({ ...old, summary: "", reference: "" }));
      router.refresh();
    });

  return (
    <div className="grid gap-3 text-[13px] @2xl:grid-cols-2">
      <Field label={t("What happened")}>
        <Select value={v.kind} onChange={(e) => set("kind", e.target.value as MessageKind)}>
          {MESSAGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(MESSAGE_KIND_LABEL[k])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("Date")}>
        <Input type="date" value={v.date} onChange={(e) => set("date", e.target.value)} />
      </Field>
      <Field label={t("In a few words")} className="@2xl:col-span-2" hint={t("Kept in the history of this conversation.")}>
        <Textarea rows={2} value={v.summary} onChange={(e) => set("summary", e.target.value)} />
      </Field>
      <Field label={t("Where it stands now")}>
        <Select value={v.status} onChange={(e) => set("status", e.target.value as ReplyStatus)}>
          {REPLY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(REPLY_STATUS_LABEL[s])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("Link to the message")} hint={t("Optional")}>
        <Input value={v.reference} onChange={(e) => set("reference", e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t("Next action")}>
        <Textarea rows={2} value={v.nextAction} onChange={(e) => set("nextAction", e.target.value)} />
      </Field>
      <Field label={t("Follow up by")} hint={t("The day to come back to it. Leave it empty for none.")}>
        <Input type="date" value={v.followUpOn} onChange={(e) => set("followUpOn", e.target.value)} />
      </Field>
      <Field label={t("Still missing")} className="@2xl:col-span-2">
        <Textarea rows={2} value={v.missing} onChange={(e) => set("missing", e.target.value)} />
      </Field>
      <Field label={t("Categories")} className="@2xl:col-span-2" hint={t("Separated by commas: a company can be in several.")}>
        <Input value={v.categories} onChange={(e) => set("categories", e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 @2xl:col-span-2">
        <button type="button" className={buttonClass("primary", "sm")} disabled={busy} onClick={save}>
          {t("Save")}
        </button>
        {done && <span className="text-down">{t("Saved.")}</span>}
        {error && (
          <span role="alert" className="text-up">
            {error}
          </span>
        )}
        <span className="text-[12px] text-ink-3">{t("What you write here is yours: a file loaded later does not change it.")}</span>
      </div>
    </div>
  );
}

const EDITABLE: CompanyField[] = ["name", "country", "address", "website", "email", "phone", "contactName", "vatNumber", "taxCode", "companyType"];

/** A person corrects who the company is: a name written wrong, a contact that changed. */
export function CompanyEdit({ company }: { company: ReplyCompany }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [v, setV] = useState<Record<CompanyField, string>>(() => Object.fromEntries(EDITABLE.map((k) => [k, company[k] ?? ""])) as Record<CompanyField, string>);

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateReplyCompanyAction(company.id, v);
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      setDone(true);
      router.refresh();
    });

  return (
    <div className="grid gap-3 text-[13px] @2xl:grid-cols-2">
      {EDITABLE.map((k) => (
        <Field key={k} label={t(FIELD_LABEL[k])} className={k === "address" || k === "companyType" ? "@2xl:col-span-2" : undefined}>
          <Input
            value={v[k]}
            onChange={(e) => {
              setDone(false);
              setV((old) => ({ ...old, [k]: e.target.value }));
            }}
          />
        </Field>
      ))}
      <div className="flex flex-wrap items-center gap-3 @2xl:col-span-2">
        <button type="button" className={buttonClass("primary", "sm")} disabled={busy} onClick={save}>
          {t("Save")}
        </button>
        {done && <span className="text-down">{t("Saved.")}</span>}
        {error && (
          <span role="alert" className="text-up">
            {error}
          </span>
        )}
        <span className="text-[12px] text-ink-3">{t("What you write here is yours: a file loaded later does not change it.")}</span>
      </div>
    </div>
  );
}
