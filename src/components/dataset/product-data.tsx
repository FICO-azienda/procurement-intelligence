"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Check, FileText, Link2, Paperclip, Pencil } from "lucide-react";
import { confirmDataFieldAction, linkProductDocumentAction, saveDataFieldAction, uploadProductFileAction, type SourcingResult } from "@/app/actions";
import { DIMENSIONS, DIMENSION_LABEL, DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL, FIELDS, INCOTERMS, READINESS_WORD, STATUS_LABEL, type Dimension, type FieldKey, type FieldStatus, type Readiness } from "@/lib/dataset/fields";
import type { ProductProfile, ProfileField } from "@/lib/dataset/profile";
import { useT } from "@/lib/i18n/client";
import { Input, Select, Textarea } from "../form-kit";
import { buttonClass, cx } from "../ui";

const READINESS_TONE: Record<Readiness, string> = { ready: "bg-down-wash text-down", partial: "bg-caution-wash text-caution", not_ready: "bg-up-wash text-up" };
const STATUS_TONE: Record<FieldStatus, string> = { confirmed: "bg-down-wash text-down", estimated: "bg-caution-wash text-caution", missing: "bg-up-wash text-up" };

export function DataReadinessPill({ level, label }: { level: Readiness; label?: string }) {
  const t = useT();
  return (
    <span className={cx("inline-flex h-[20px] items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap", READINESS_TONE[level])}>
      {label && <span className="font-normal opacity-80">{label}</span>}
      {t(READINESS_WORD[level])}
    </span>
  );
}

export function FieldStatusTag({ status }: { status: FieldStatus }) {
  const t = useT();
  return <span className={cx("inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10.5px] font-semibold tracking-[0.04em] uppercase", STATUS_TONE[status])}>{t(STATUS_LABEL[status])}</span>;
}

/** The six checks side by side: being ready to ask a new supplier is judged apart from the true cost. */
export function ReadinessRow({ readiness }: { readiness: Record<Dimension, { level: Readiness }> }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {DIMENSIONS.map((d) => (
        <DataReadinessPill key={d} level={readiness[d].level} label={t(DIMENSION_LABEL[d])} />
      ))}
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<SourcingResult>, then?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      router.refresh();
      then?.();
    });
  return { pending, error, run, t, clear: () => setError(null) };
}

export interface DocumentsVM {
  linked: { id: string; documentId: string; filename: string; type: string }[];
  /** Documents already in the app (the invoices and quotes this product was read from), not linked yet. */
  onFile: { documentId: string; filename: string; recordType: string }[];
}

const SECTIONS: { key: string; title: "Product specification" | "Quantities" | "Commercial terms (current supplier)" | "Quality"; fields: FieldKey[] }[] = [
  { key: "spec", title: "Product specification", fields: ["neutral_name", "technical_spec", "application", "material", "grade", "dimensions", "capacity", "form", "packaging", "internal_code"] },
  { key: "qty", title: "Quantities", fields: ["annual_volume", "typical_order", "purchase_frequency"] },
  { key: "commercial", title: "Commercial terms (current supplier)", fields: ["delivery_basis", "freight_included", "payment_terms", "moq", "lead_time"] },
  { key: "quality", title: "Quality", fields: ["quality_issues", "returns", "reliability"] },
];

/**
 * Product data on the product page: how ready the data is, what is missing
 * and who can say it, and — on demand — the short form to complete it, with
 * everything already known filled in and the estimates to confirm.
 */
export function ProductDataPanel({ profile, documents, open: startOpen, next }: { profile: ProductProfile; documents: DocumentsVM; open?: boolean; next?: { href: string; name: string } | null }) {
  const t = useT();
  const [open, setOpen] = useState(!!startOpen);
  const ref = useRef<HTMLDivElement>(null);
  const supplier = profile.currentSupplier?.name ?? null;
  const internal = profile.missing.filter((k) => FIELDS[k].ask === "internal");
  const fromSupplier = profile.missing.filter((k) => FIELDS[k].ask === "supplier");
  const nothingLeft = profile.missing.length === 0 && profile.toConfirm.length === 0;
  const openForm = () => {
    setOpen(true);
    setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  return (
    <section id="product-data" className="mt-6 scroll-mt-4 rounded-xl border border-rule">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
        <div className="min-w-[240px] flex-1">
          <h2 className="text-[15.5px] font-semibold">{t("Product data")}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {t("{known} of {total} important fields known · {confirmed} confirmed, {estimated} estimated", { known: profile.counts.importantKnown, total: profile.counts.important, confirmed: profile.counts.confirmed, estimated: profile.counts.estimated })}
          </p>
          <div className="mt-2.5">
            <ReadinessRow readiness={profile.readiness} />
          </div>
        </div>
        {!nothingLeft && !open && (
          <button type="button" className={buttonClass("primary")} onClick={openForm}>
            {t("Complete missing data")}
          </button>
        )}
      </div>

      <div className="border-t border-rule px-5 py-4 sm:px-6">
        <h3 className="text-[13.5px] font-semibold">{t("What is missing?")}</h3>
        {nothingLeft ? (
          <p className="mt-1 text-[13px] text-ink-2">{t("Nothing important: every field that matters is known and confirmed.")}</p>
        ) : (
          <>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {profile.missing.length ? t.n(profile.missing.length, "{n} thing still needed", "{n} things still needed") : t("Nothing missing.")}
              {profile.toConfirm.length > 0 && ` · ${t.n(profile.toConfirm.length, "{n} estimate to confirm", "{n} estimates to confirm")}`}
            </p>
            <div className="mt-2 grid gap-x-8 gap-y-3 @2xl:grid-cols-2">
              {internal.length > 0 && <AskList title={t("Ask inside the company")} keys={internal} profile={profile} />}
              {fromSupplier.length > 0 && <AskList title={supplier ? t("Ask {supplier}", { supplier }) : t("Ask the current supplier")} keys={fromSupplier} profile={profile} />}
            </div>
            {profile.readiness.sourcing.other.map((o) => (
              <p key={o} className="mt-2 text-[12.5px] text-caution">
                {o}{" "}
                <Link href="/settings" className="font-medium text-ledger hover:underline">
                  {t("Settings")}
                </Link>
              </p>
            ))}
            {profile.readiness.true_cost.level !== "ready" && profile.readiness.sourcing.level !== "not_ready" && (
              <p className="mt-2 text-[12.5px] text-ink-3">{t("The true cost can wait: what is missing for it does not stop the search for alternative suppliers.")}</p>
            )}
          </>
        )}
        <p className="mt-3 text-[12.5px] text-ink-2">
          <span className="text-ink-3">{t("Next")}: </span>
          {profile.next.kind === "sourcing" ? (
            <Link href={`/sourcing/${profile.productId}`} className="font-medium text-ledger hover:underline">
              {profile.next.label}
            </Link>
          ) : profile.next.kind === "settings" ? (
            <Link href="/settings" className="font-medium text-ledger hover:underline">
              {profile.next.label}
            </Link>
          ) : (
            <button type="button" className="font-medium text-ledger hover:underline" onClick={openForm}>
              {profile.next.label}
            </button>
          )}
        </p>
      </div>

      {open && (
        <div ref={ref} className="scroll-mt-4 border-t border-rule">
          {SECTIONS.map((s) => (
            <div key={s.key} className="border-b border-rule px-5 py-4 sm:px-6">
              <h3 className="mb-2 text-[13.5px] font-semibold">{t(s.title)}</h3>
              <ul className="divide-y divide-rule">
                {s.fields.map((k) => (
                  <FieldRow key={k} productId={profile.productId} field={profile.fields[k]} unit={profile.unit} />
                ))}
              </ul>
              {s.key === "commercial" && !profile.currentSupplier && <p className="mt-2 text-[12.5px] text-caution">{t("No current supplier on file: import or add a purchase first.")}</p>}
            </div>
          ))}
          <div className="px-5 py-4 sm:px-6">
            <h3 className="mb-2 text-[13.5px] font-semibold">{t("Documents")}</h3>
            <Documents productId={profile.productId} documents={documents} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule bg-well px-5 py-3 sm:px-6">
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
              {t("Close")}
            </button>
            {next && (
              <Link href={next.href} className={buttonClass("primary", "sm")}>
                {t("Next product: {name}", { name: next.name })} →
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function AskList({ title, keys, profile }: { title: string; keys: FieldKey[]; profile: ProductProfile }) {
  const t = useT();
  return (
    <div>
      <div className="text-[12px] font-medium text-ink-3">{title}</div>
      <ul className="mt-1 space-y-0.5 text-[13px]">
        {keys.map((k) => (
          <li key={k} className="flex items-baseline gap-2">
            <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-up" />
            <span>{t(FIELDS[k].label)}</span>
            {(profile.readiness.sourcing.missing.includes(k) || profile.readiness.true_cost.missing.includes(k)) && (
              <span className="text-[11.5px] text-ink-3">{profile.readiness.sourcing.missing.includes(k) ? t("needed for sourcing") : t("needed for the true cost")}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One field: what is known, where it comes from, and — when it can be typed — confirm or edit. */
function FieldRow({ productId, field, unit }: { productId: string; field: ProfileField; unit: string }) {
  const { pending, error, run, t, clear } = useAction();
  const def = FIELDS[field.key];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.raw ?? "");
  const highlight = field.status !== "confirmed" && (field.important || field.confirmable);
  const save = () => run(() => saveDataFieldAction(productId, field.key, value), () => setEditing(false));
  return (
    <li className={cx("-mx-2 grid gap-x-4 gap-y-1 rounded-md px-2 py-2.5 @2xl:grid-cols-[220px_1fr_auto]", highlight && (field.status === "missing" ? "bg-up-wash/50" : "bg-caution-wash/60"))}>
      <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <span className="font-medium">{t(def.label)}</span>
        {def.input === "number" && <span className="text-[11.5px] text-ink-3">({unit})</span>}
      </div>
      <div className="min-w-0 text-[13px]">
        {editing ? (
          <div className="flex flex-wrap items-start gap-2">
            <Editor kind={def.input!} value={value} onChange={setValue} onEnter={save} />
            <button type="button" className={buttonClass("primary", "sm")} disabled={pending} onClick={save}>
              {pending ? t("Saving…") : t("Save")}
            </button>
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              onClick={() => {
                clear();
                setValue(field.raw ?? "");
                setEditing(false);
              }}
            >
              {t("Cancel")}
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <FieldStatusTag status={field.status} />
              <span className={cx("break-words whitespace-pre-line", field.display ? "text-ink" : "text-ink-4")}>{field.display ?? t("Not known")}</span>
            </div>
            <FieldProvenance field={field} />
          </>
        )}
        {error && <div className="mt-1 text-[12px] text-up">{error}</div>}
      </div>
      {!editing && (
        <div className="flex items-start gap-1.5">
          {field.confirmable && (
            <button type="button" className={buttonClass("secondary", "sm")} disabled={pending} onClick={() => run(() => confirmDataFieldAction(productId, field.key))}>
              <Check size={13} /> {t("Confirm")}
            </button>
          )}
          {def.input && (
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setEditing(true)}>
              <Pencil size={12} /> {field.status === "missing" ? t("Add") : t("Edit")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function FieldProvenance({ field }: { field: ProfileField }) {
  const t = useT();
  return (
    <div className="mt-0.5 space-y-0.5 text-[12px] text-ink-3">
      {field.source && (
        <div>
          {t("Source")}:{" "}
          {field.source.documentId ? (
            <a href={`/documents/${field.source.documentId}`} target="_blank" rel="noreferrer" className="text-ledger hover:underline">
              {field.source.label}
            </a>
          ) : (
            field.source.label
          )}
          {field.source.date && ` · ${field.source.date.split("-").reverse().join("/")}`}
        </div>
      )}
      {field.method && (
        <div>
          {t("Method")}: {field.method}
        </div>
      )}
      {field.original && <div>{t("The software had estimated: {value}", { value: field.original.value })}{field.original.method ? ` — ${field.original.method}` : ""}</div>}
      {field.note && <div>{field.note}</div>}
    </div>
  );
}

function Editor({ kind, value, onChange, onEnter }: { kind: NonNullable<(typeof FIELDS)[FieldKey]["input"]>; value: string; onChange: (v: string) => void; onEnter: () => void }) {
  const t = useT();
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && kind !== "longtext") {
      e.preventDefault();
      onEnter();
    }
  };
  if (kind === "longtext") return <Textarea autoFocus className="min-w-[260px] flex-1" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
  if (kind === "yesno")
    return (
      <Select autoFocus className="w-[160px]" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("Not known")}</option>
        <option value="yes">{t("Yes")}</option>
        <option value="no">{t("No")}</option>
      </Select>
    );
  if (kind === "incoterm")
    return (
      <>
        <Input autoFocus className="w-[200px]" list="incoterms" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={key} placeholder="EXW, FCA, DAP…" />
        <datalist id="incoterms">
          {INCOTERMS.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </>
    );
  return <Input autoFocus className={kind === "text" ? "min-w-[260px] flex-1" : "w-[160px]"} inputMode={kind === "number" || kind === "days" ? "decimal" : undefined} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={key} placeholder={kind === "days" ? t("days") : undefined} />;
}

/** Documents of the product: those linked, those already in the app that can be linked, a new one to attach. */
function Documents({ productId, documents }: { productId: string; documents: DocumentsVM }) {
  const { pending, error, run, t } = useAction();
  const [type, setType] = useState<string>("technical_datasheet");
  const file = useRef<HTMLInputElement>(null);
  const label = (x: string) => ((DOCUMENT_TYPES as readonly string[]).includes(x) ? t(DOCUMENT_TYPE_LABEL[x as (typeof DOCUMENT_TYPES)[number]]) : x);
  return (
    <div className="space-y-3 text-[13px]">
      <ul className="space-y-1">
        {documents.linked.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2">
            <FileText size={13} className="text-ink-3" />
            <a href={`/documents/${d.documentId}`} target="_blank" rel="noreferrer" className="text-ledger hover:underline">
              {d.filename}
            </a>
            <span className="text-[12px] text-ink-3">{label(d.type)}</span>
          </li>
        ))}
        {documents.linked.length === 0 && <li className="text-ink-3">{t("No document linked to this product yet.")}</li>}
      </ul>
      {documents.onFile.length > 0 && (
        <div>
          <div className="text-[12px] font-medium text-ink-3">{t("Already in the app: link instead of uploading again")}</div>
          <ul className="mt-1 space-y-1">
            {documents.onFile.map((d) => (
              <li key={d.documentId} className="flex flex-wrap items-center gap-2">
                <FileText size={13} className="text-ink-4" />
                <a href={`/documents/${d.documentId}`} target="_blank" rel="noreferrer" className="text-ink-2 hover:underline">
                  {d.filename}
                </a>
                <span className="text-[12px] text-ink-3">{d.recordType === "quote" ? t("quote") : t("invoice")}</span>
                <button type="button" disabled={pending} className="inline-flex items-center gap-1 text-[12px] font-medium text-ledger hover:underline" onClick={() => run(() => linkProductDocumentAction(productId, d.documentId, type))}>
                  <Link2 size={12} /> {t("Link as {type}", { type: label(type).toLowerCase() })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-[220px]" value={type} onChange={(e) => setType(e.target.value)} aria-label={t("Kind of document")}>
          {DOCUMENT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(DOCUMENT_TYPE_LABEL[x])}
            </option>
          ))}
        </Select>
        <input
          ref={file}
          type="file"
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (!picked) return;
            const data = new FormData();
            data.set("file", picked);
            data.set("type", type);
            run(() => uploadProductFileAction(productId, data));
            e.target.value = "";
          }}
        />
        <button type="button" className={buttonClass("secondary", "sm")} disabled={pending} onClick={() => file.current?.click()}>
          <Paperclip size={13} /> {t("Attach a document")}
        </button>
      </div>
      {error && <div className="text-[12px] text-up">{error}</div>}
    </div>
  );
}
