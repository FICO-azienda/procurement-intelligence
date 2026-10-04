"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, Info, Plus, TrendingDown, TrendingUp } from "lucide-react";
import {
  acknowledgeAction,
  approveAction,
  approveAllAction,
  createAllNewAction,
  duplicateAction,
  duplicateFileAction,
  reclassifyAction,
  reopenMappingAction,
  resolveProductAction,
  resolveSupplierAction,
  skipItemAction,
  updateItemAction,
  updateSessionFieldsAction,
  type ActionResult,
} from "@/app/import/actions";
import * as f from "@/lib/format";
import { said, type Msg } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";
import { useT } from "@/lib/i18n/client";
import type { MatchGroup } from "@/lib/import/groups";
import { SUPPORTED_CURRENCIES } from "@/lib/import/normalize/currency";
import { INCOTERMS } from "@/lib/import/normalize/terms";
import { UNITS } from "@/lib/import/normalize/units";
import type { CurrentData, ExtractedData, Issue, ItemData, RecordType } from "@/lib/import/types";
import { parseDate, parseNumber } from "@/lib/parse";
import { Field, Grid, Input, Select, Sheet, toInput, useSheet } from "../form-kit";
import { buttonClass, cx } from "../ui";

// ---------------- helpers ----------------

function useAction() {
  const router = useRouter();
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? t("Something went wrong."));
      else {
        after?.();
        router.refresh();
      }
    });
  return { pending, error, run, t };
}

const SEVERITY_ORDER = { blocking: 0, review: 1, info: 2 } as const;

export function IssueIcon({ issue, size = 14 }: { issue: Pick<Issue, "severity" | "priority">; size?: number }) {
  const t = useT();
  if (issue.severity === "blocking") return <AlertCircle size={size} className="shrink-0 text-up" aria-label={t("Must fix")} />;
  if (issue.severity === "review") return <AlertTriangle size={size} className={cx("shrink-0", issue.priority === "high" ? "text-up" : "text-caution")} aria-label={t("Check|noun")} />;
  return <Info size={size} className="shrink-0 text-ink-4" aria-label={t("Note")} />;
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <div className="mt-2 text-[12.5px] text-up">{error}</div> : null;
}

// ---------------- Match groups ----------------

type GroupOptions = { id: string; name: string }[];

/**
 * What the file calls a supplier or product, and what we think it is. One
 * decision covers every line that writes it the same way, and is remembered:
 * the same spelling is never asked about again.
 */
export function MatchDecisions({ sessionId, kind, groups, options }: { sessionId: string; kind: "supplier" | "product"; groups: MatchGroup[]; options: GroupOptions }) {
  const open = groups.filter((g) => g.state !== "matched");
  if (open.length === 0) return null;
  // New names that can be created as written (a product also needs its unit from the file).
  const creatable = open.filter((g) => g.state === "unknown" && g.create.name && (kind === "supplier" || g.create.unit));
  return (
    <div className="space-y-3">
      {creatable.length >= 2 && <CreateAllBar sessionId={sessionId} kind={kind} names={creatable.map((g) => g.label)} />}
      <ul className="space-y-3">
        {open.map((g) => (
          <GroupRow key={g.key} sessionId={sessionId} kind={kind} group={g} options={options} />
        ))}
      </ul>
    </div>
  );
}

/** "12 suppliers are new — create all": one click instead of twelve forms. */
function CreateAllBar({ sessionId, kind, names }: { sessionId: string; kind: "supplier" | "product"; names: string[] }) {
  const { pending, error, run, t } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-ledger/25 bg-ledger-wash/50 px-5 py-3.5">
      <div className="min-w-[220px] flex-1 text-[13.5px]">
        <div className="font-semibold">
          {kind === "supplier" ? t("{n} suppliers are new to us", { n: names.length }) : t("{n} products are new to us", { n: names.length })}
        </div>
        <div className="truncate text-ink-3" title={names.join(", ")}>
          {names.slice(0, 4).join(", ")}
          {names.length > 4 && ` ${t("and {n} more", { n: names.length - 4 })}`}
        </div>
        <ErrorLine error={error} />
      </div>
      <button type="button" disabled={pending} className={buttonClass("primary", "sm")} onClick={() => run(() => createAllNewAction(sessionId, kind))}>
        {pending ? t("Creating…") : t("Create all {n} as written", { n: names.length })}
      </button>
    </div>
  );
}

/** One supplier/product question on its own (the review queue shows them one at a time). */
export function MatchDecision({ sessionId, kind, group, options }: { sessionId: string; kind: "supplier" | "product"; group: MatchGroup; options: GroupOptions }) {
  return (
    <ul>
      <GroupRow sessionId={sessionId} kind={kind} group={group} options={options} />
    </ul>
  );
}

/** The ones already recognised: listed compactly, each can still be changed. */
export function MatchGroupsPanel({ sessionId, kind, groups, options }: { sessionId: string; kind: "supplier" | "product"; groups: MatchGroup[]; options: GroupOptions }) {
  return (
    <ul>
      {groups.map((g) => (
        <GroupRow key={g.key} sessionId={sessionId} kind={kind} group={g} options={options} />
      ))}
    </ul>
  );
}

function GroupRow({ sessionId, kind, group: g, options }: { sessionId: string; kind: "supplier" | "product"; group: MatchGroup; options: GroupOptions }) {
  const { pending, error, run, t } = useAction();
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState(g.targetId ?? "");
  const create = useSheet();
  const supplier = kind === "supplier";
  const lines = t.n(g.lines, "{n} line", "{n} lines");

  const use = (id: string) =>
    run(() =>
      kind === "supplier"
        ? resolveSupplierAction(sessionId, g.key, { type: "use", supplierId: id })
        : resolveProductAction(sessionId, g.key, { type: "use", productId: id }),
      () => setChoosing(false),
    );

  const chooser = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-[260px] max-w-full">
        <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={supplier ? t("Choose a supplier…") : t("Choose a product…")}>
          <option value="">{supplier ? t("Choose a supplier…") : t("Choose a product…")}</option>
          {g.alternatives.length > 0 && (
            <optgroup label={t("Similar")}>
              {g.alternatives.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={supplier ? t("All suppliers") : t("All products")}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>
      <button type="button" disabled={!choice || pending} className={buttonClass("primary", "sm")} onClick={() => use(choice)}>
        {t("Use this one")}
      </button>
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setChoosing(false)}>
        {t("Cancel")}
      </button>
    </div>
  );

  const sheet = (
    <Sheet open={create.open} onClose={create.hide} title={supplier ? t("Create supplier") : t("Create product")} description={t("From “{name}” — used for {lines} of this file.", { name: g.label, lines })}>
      <CreateForm key={create.version} kind={kind} group={g} sessionId={sessionId} close={create.hide} />
    </Sheet>
  );

  // Already recognised: one compact line.
  if (g.state === "matched") {
    return (
      <li className={cx("border-b border-rule px-5 py-2.5 last:border-b-0", pending && "opacity-60")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          <Check size={14} className="shrink-0 text-down" />
          <span className="min-w-0 truncate text-ink-2">“{g.label}”</span>
          <span className="text-ink-4">→</span>
          <span className="font-medium">{g.targetName}</span>
          <span className="text-[12px] text-ink-3">
            {g.resolution === "created" ? t("created now") : g.resolution === "auto" ? t("recognised") : t("confirmed by you")} · {lines}
          </span>
          <div className="ml-auto">
            {choosing ? (
              chooser
            ) : (
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setChoosing(true)}>
                {t("Change|verb")}
              </button>
            )}
          </div>
        </div>
        <ErrorLine error={error} />
      </li>
    );
  }

  // Needs a decision: one question, a few buttons.
  const suggested = g.state === "suggested";
  return (
    <li className={cx("rounded-lg border border-rule bg-canvas px-5 py-4", pending && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[14px] font-semibold">{suggested ? (supplier ? t("We are not sure about this supplier") : t("We are not sure about this product")) : supplier ? t("We don't know this supplier") : t("We don't know this product")}</div>
        <span className="shrink-0 text-[12px] text-ink-3">{lines}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13.5px]">
        <dt className="text-ink-3">{t("The file says")}</dt>
        <dd className="font-medium">
          “{g.label}”{g.detail && <span className="ml-2 text-[12px] font-normal text-ink-3">{g.detail}</span>}
        </dd>
        {suggested && (
          <>
            <dt className="text-ink-3">{t("We think it is")}</dt>
            <dd className="font-medium">{g.targetName}</dd>
          </>
        )}
      </dl>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {choosing ? (
          chooser
        ) : suggested ? (
          <>
            <button type="button" disabled={pending} className={buttonClass("primary", "sm")} onClick={() => use(g.targetId!)}>
              <Check size={13} /> {t("Yes, match")}
            </button>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setChoosing(true)}>
              {t("Choose another")}
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={create.show}>
              {t("Create new")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={buttonClass("primary", "sm")} onClick={create.show}>
              <Plus size={13} /> {t("Create “{name}”", { name: g.label.length > 32 ? `${g.label.slice(0, 30)}…` : g.label })}
            </button>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setChoosing(true)}>
              {t("It is one I already have")}
            </button>
          </>
        )}
      </div>
      {!choosing && <p className="mt-2 text-[12px] text-ink-4">{t("Your answer is remembered: next time this name is recognised by itself.")}</p>}
      <ErrorLine error={error} />
      {sheet}
    </li>
  );
}

function CreateForm({ kind, group, sessionId, close }: { kind: "supplier" | "product"; group: MatchGroup; sessionId: string; close: () => void }) {
  const { pending, error, run, t } = useAction();
  const [v, setV] = useState<Record<string, string>>(group.create);
  const set = (k: string) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const submit = () =>
    run(
      () =>
        kind === "supplier"
          ? resolveSupplierAction(sessionId, group.key, { type: "create", name: v.name, country: v.country || null, vatNumber: v.vatNumber || null })
          : resolveProductAction(sessionId, group.key, { type: "create", name: v.name, sku: v.sku || null, unit: v.unit, category: v.category || null }),
      close,
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <Grid>
          <Field label={t("Name")} required className="sm:col-span-2">
            <Input value={v.name} onChange={set("name")} autoFocus />
          </Field>
          {kind === "supplier" ? (
            <>
              <Field label={t("Country")}>
                <Input value={v.country} onChange={set("country")} placeholder={t("Italy")} />
              </Field>
              <Field label={t("VAT number")}>
                <Input value={v.vatNumber} onChange={set("vatNumber")} />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("Unit you buy it in")} required>
                <Select value={v.unit} onChange={set("unit")}>
                  <option value="">{t("Choose…")}</option>
                  {UNITS.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.code} — {t(u.label)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("Category")}>
                <Input value={v.category} onChange={set("category")} placeholder={t("Glass")} />
              </Field>
              <Field label={t("Your code (SKU)")} hint={t("Optional — made from the name if you leave it as it is")} className="sm:col-span-2">
                <Input value={v.sku} onChange={set("sku")} className="font-mono uppercase" />
              </Field>
            </>
          )}
        </Grid>
        <ErrorLine error={error} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" onClick={close} className={buttonClass("ghost")}>
          {t("Cancel")}
        </button>
        <button type="button" disabled={pending || !v.name?.trim() || (kind === "product" && !v.unit)} onClick={submit} className={buttonClass("primary")}>
          {pending ? t("Creating…") : kind === "supplier" ? t("Create supplier") : t("Create product")}
        </button>
      </div>
    </div>
  );
}

// ---------------- Lines ----------------

export interface LineVM {
  id: string;
  line: number;
  status: "ready" | "attention" | "imported" | "skipped";
  recordType: RecordType;
  data: CurrentData;
  extracted: ExtractedData;
  raw: Record<string, string>;
  supplierLabel: string;
  productLabel: string;
  productMatched: string | null;
  issues: Issue[];
  acknowledged: boolean;
}

const TABS = [
  { key: "attention", label: "Needs attention" },
  { key: "ready", label: "Ready" },
  { key: "imported", label: "Imported" },
  { key: "skipped", label: "Skipped" },
  { key: "all", label: "All|feminine" },
] as const satisfies readonly { key: string; label: Msg }[];

const COLUMNS: { label: Msg | ""; right?: boolean }[] = [
  { label: "" },
  { label: "Line" },
  { label: "Date" },
  { label: "Supplier" },
  { label: "Product" },
  { label: "Quantity", right: true },
  { label: "Unit price", right: true },
  { label: "Total", right: true },
  { label: "Check|noun" },
];

export function LinesPanel({ lines }: { lines: LineVM[] }) {
  const t = useT();
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, t.key === "all" ? lines.length : lines.filter((l) => l.status === t.key).length])),
    [lines],
  );
  const fallback = counts.attention ? "attention" : counts.ready ? "ready" : "all";
  const [chosen, setTab] = useState<(typeof TABS)[number]["key"]>(fallback);
  // After an import or a fix the chosen tab may be empty: show the next useful one.
  const tab = chosen === "all" || counts[chosen] ? chosen : fallback;
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = tab === "all" ? lines : lines.filter((l) => l.status === tab);
  const current = lines.find((l) => l.id === openId) ?? null;

  return (
    <section className="rounded-lg border border-rule">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="text-[14px] font-semibold">{t("Lines")}</h2>
        <nav className="flex flex-wrap gap-1" aria-label={t("Filter lines")}>
          {TABS.map((x) =>
            counts[x.key] || x.key === "all" ? (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                aria-pressed={tab === x.key}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors",
                  tab === x.key ? "bg-ink text-white" : "text-ink-2 hover:bg-wash",
                )}
              >
                {t(x.label)}
                <span className={cx("num text-[12px]", tab === x.key ? "text-white/60" : "text-ink-4")}>{counts[x.key]}</span>
              </button>
            ) : null,
          )}
        </nav>
      </div>
      <div className="overflow-x-auto border-t border-rule">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-well text-left text-[12px] text-ink-3">
              {COLUMNS.map((h, i) => (
                <th key={i} className={cx("h-9 border-b border-rule px-2.5 font-medium whitespace-nowrap first:pl-5", h.right && "text-right")}>
                  {h.label && t(h.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-ink-3">
                  {t("Nothing here.")}
                </td>
              </tr>
            )}
            {visible.map((l) => {
              const worst = [...l.issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0];
              const shown = l.status === "ready" || l.status === "imported" ? l.issues.filter((i) => i.severity === "info" || i.code === "price_increase") : l.issues;
              const top = l.status === "attention" ? worst : shown.find((i) => i.code === "price_increase") ?? shown[0];
              const qtyUnit = l.data.unit ?? l.data.unitRaw ?? "";
              const total = l.data.total ?? (l.data.quantity != null && l.data.unitPrice != null ? l.data.quantity * l.data.unitPrice : null);
              return (
                <tr
                  key={l.id}
                  onClick={() => setOpenId(l.id)}
                  className="cursor-pointer border-b border-rule transition-colors last:border-b-0 hover:bg-well"
                >
                  <td className="w-8 py-2.5 pl-5">
                    <StatusDot status={l.status} />
                  </td>
                  <td className="num px-2.5 text-ink-4">{l.line}</td>
                  <td className="num px-2.5 whitespace-nowrap">{f.date(l.data.date)}</td>
                  <td className="max-w-[180px] truncate px-2.5">{l.supplierLabel}</td>
                  <td className="max-w-[280px] px-2.5">
                    <div className="truncate font-medium">{l.productLabel}</div>
                    {l.productMatched && l.productMatched !== l.productLabel && (
                      <div className="truncate text-[12px] text-ink-3">→ {l.productMatched}</div>
                    )}
                  </td>
                  <td className="num px-2.5 text-right whitespace-nowrap">
                    {l.data.quantity != null ? `${f.number(l.data.quantity)} ${qtyUnit}` : "—"}
                  </td>
                  <td className="num px-2.5 text-right whitespace-nowrap">{l.data.unitPrice != null ? f.price(l.data.unitPrice, l.data.currency ?? "EUR") : "—"}</td>
                  <td className="num px-2.5 text-right whitespace-nowrap">{total != null ? f.money(total, l.data.currency ?? "EUR") : "—"}</td>
                  <td className="max-w-[320px] px-2.5 pr-5">
                    {top ? (
                      <span className="flex items-center gap-1.5">
                        <IssueIcon issue={top} size={13} />
                        <span className={cx("truncate", top.severity === "info" && "text-ink-3")}>{said(t, top)}</span>
                        {l.status === "attention" && l.issues.filter((i) => i.severity !== "info").length > 1 && (
                          <span className="text-[12px] whitespace-nowrap text-ink-4">+{l.issues.filter((i) => i.severity !== "info").length - 1}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Sheet open={!!current} onClose={() => setOpenId(null)} title={current ? t("Line {n}", { n: current.line }) : ""} description={current ? current.productLabel : undefined}>
        {current && <LineEditor key={current.id + JSON.stringify(current.data)} line={current} close={() => setOpenId(null)} />}
      </Sheet>
    </section>
  );
}

function StatusDot({ status }: { status: LineVM["status"] }) {
  const t = useT();
  const map = {
    ready: ["bg-down", "Ready"],
    attention: ["bg-caution", "Needs attention"],
    imported: ["bg-ledger", "Imported"],
    skipped: ["bg-ink-4", "Skipped"],
  } as const satisfies Record<LineVM["status"], readonly [string, Msg]>;
  const [cls, label] = map[status];
  return <span className={cx("block size-2 rounded-full", cls)} title={t(label)} aria-label={t(label)} />;
}

type EditKey = "date" | "quantity" | "unit" | "unitPrice" | "currency" | "fxRate" | "freight" | "total" | "invoiceReference" | "moq" | "leadTimeDays" | "paymentTermsDays" | "incoterm" | "validUntil";

const FIELD_LABELS: Record<EditKey, Msg> = {
  date: "Date",
  quantity: "Quantity",
  unit: "Unit",
  unitPrice: "Unit price",
  currency: "Currency",
  fxRate: "FX rate (EUR per 1 unit)",
  freight: "Freight",
  total: "Line total",
  invoiceReference: "Invoice / reference",
  moq: "Minimum order",
  leadTimeDays: "Lead time (days)",
  paymentTermsDays: "Payment terms (days)",
  incoterm: "Incoterm",
  validUntil: "Valid until",
};
const NUMBER_KEYS: EditKey[] = ["quantity", "unitPrice", "fxRate", "freight", "total", "moq", "leadTimeDays", "paymentTermsDays"];
const DATE_KEYS: EditKey[] = ["date", "validUntil"];

function show(key: EditKey, v: ItemData[EditKey] | undefined): string {
  if (v == null) return "";
  if (DATE_KEYS.includes(key)) return String(v);
  if (NUMBER_KEYS.includes(key)) return toInput(v as number);
  return String(v);
}

function LineEditor({ line, close }: { line: LineVM; close: () => void }) {
  const { pending, error, run, t } = useAction();
  const keys: EditKey[] =
    line.recordType === "quote"
      ? ["date", "unitPrice", "currency", "fxRate", "unit", "quantity", "moq", "leadTimeDays", "paymentTermsDays", "incoterm", "validUntil", "freight"]
      : ["date", "quantity", "unit", "unitPrice", "currency", "fxRate", "freight", "total", "invoiceReference"];
  const [values, setValues] = useState<Record<EditKey, string>>(
    () => Object.fromEntries(keys.map((k) => [k, show(k, line.data[k])])) as Record<EditKey, string>,
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const editable = line.status === "ready" || line.status === "attention";
  const priceChange = line.issues.find((i) => i.code === "price_increase" || i.code === "price_decrease");
  const blocking = line.issues.some((i) => i.severity === "blocking");
  const reviewOnly = !blocking && line.issues.some((i) => i.severity === "review") && !line.acknowledged;
  const duplicate = line.issues.some((i) => i.code === "duplicate" || i.code === "duplicate_in_file");

  function save() {
    const patch: Partial<ItemData> = {};
    for (const k of keys) {
      const raw = values[k].trim();
      const before = show(k, line.data[k]);
      if (raw === before) continue;
      if (NUMBER_KEYS.includes(k)) {
        const n = raw === "" ? null : parseNumber(raw);
        if (raw !== "" && n == null) return setFieldError(t("{~label} must be a number", { label: FIELD_LABELS[k] }));
        (patch as Record<string, unknown>)[k] = n;
      } else if (DATE_KEYS.includes(k)) {
        const d = raw === "" ? null : parseDate(raw);
        if (raw !== "" && !d) return setFieldError(t("{~label} is not a valid date", { label: FIELD_LABELS[k] }));
        (patch as Record<string, unknown>)[k] = d;
      } else {
        (patch as Record<string, unknown>)[k] = raw === "" ? null : raw;
      }
    }
    setFieldError(null);
    if (Object.keys(patch).length === 0) return close();
    run(() => updateItemAction(line.id, patch));
  }

  const original = (k: EditKey) => {
    const e = line.extracted[k];
    const now = line.data[k];
    if (line.data.corrected?.includes(k) || (e ?? null) !== (now ?? null)) {
      return e == null ? t("empty") : NUMBER_KEYS.includes(k) ? f.number(e as number, 6) : DATE_KEYS.includes(k) ? f.date(e as string) : String(e);
    }
    return null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {Object.keys(line.raw).length > 0 && (
          <div className="mb-4 rounded-md bg-well px-3 py-2 text-[12px] text-ink-3">
            <div className="mb-1 font-medium text-ink-2">{t("In the file")}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {Object.entries(line.raw).map(([k, v]) => (
                <span key={k}>
                  {k === "Line on document" ? "" : `${k}: `}
                  <span className="text-ink-2">{v}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {priceChange?.data && <PriceChangeCard issue={priceChange} unit={line.data.unit} />}

        {line.issues.length > 0 && (
          <ul className="mb-4 space-y-1.5">
            {[...line.issues]
              .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
              .map((i, idx) => (
                <li key={idx} className="flex items-start gap-2 text-[13px]">
                  <span className="mt-0.5">
                    <IssueIcon issue={i} />
                  </span>
                  <span className={i.severity === "info" ? "text-ink-3" : ""}>
                    {said(t, i)}
                    {i.priority === "high" && <span className="ml-1.5 text-[11px] font-semibold tracking-wide text-up uppercase">{t("High priority")}</span>}
                  </span>
                </li>
              ))}
          </ul>
        )}

        <Grid>
          {keys
            .filter((k) => k !== "fxRate" || (values.currency && values.currency !== "EUR"))
            .map((k) => (
              <Field key={k} label={t(FIELD_LABELS[k])} hint={original(k) ? t("In file: {value}", { value: original(k) }) : undefined}>
                {k === "unit" ? (
                  <Select value={values.unit} disabled={!editable} onChange={(e) => setValues((p) => ({ ...p, unit: e.target.value }))}>
                    <option value="">{line.data.unitRaw ? t("“{unit}” — choose", { unit: line.data.unitRaw }) : t("Product's unit")}</option>
                    {UNITS.map((u) => (
                      <option key={u.code} value={u.code}>
                        {u.code} — {t(u.label)}
                      </option>
                    ))}
                  </Select>
                ) : k === "currency" ? (
                  <Select value={values.currency} disabled={!editable} onChange={(e) => setValues((p) => ({ ...p, currency: e.target.value }))}>
                    <option value="">{t("Choose…")}</option>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                ) : k === "incoterm" ? (
                  <Select value={values.incoterm} disabled={!editable} onChange={(e) => setValues((p) => ({ ...p, incoterm: e.target.value }))}>
                    <option value="">—</option>
                    {INCOTERMS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={values[k]}
                    disabled={!editable}
                    type={DATE_KEYS.includes(k) ? "date" : "text"}
                    inputMode={NUMBER_KEYS.includes(k) ? "decimal" : undefined}
                    onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
        </Grid>
        {fieldError && <div className="mt-3 text-[12.5px] text-up">{fieldError}</div>}
        <ErrorLine error={error} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-well px-6 py-3">
        {editable && (
          <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={() => run(() => skipItemAction(line.id, true), close)}>
            {t("Skip line")}
          </button>
        )}
        {line.status === "skipped" && (
          <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={() => run(() => skipItemAction(line.id, false), close)}>
            {t("Restore line")}
          </button>
        )}
        <div className="flex-1" />
        {editable && duplicate && (
          <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => run(() => duplicateAction({ itemId: line.id }, "import"))}>
            {t("Import anyway")}
          </button>
        )}
        {editable && reviewOnly && (
          <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => run(() => acknowledgeAction({ itemId: line.id }), close)}>
            <Check size={14} /> {t("Looks right")}
          </button>
        )}
        {editable ? (
          <button type="button" disabled={pending} className={buttonClass("primary")} onClick={save}>
            {pending ? t("Saving…") : t("Save changes")}
          </button>
        ) : (
          <button type="button" className={buttonClass("secondary")} onClick={close}>
            {t("Close")}
          </button>
        )}
      </div>
    </div>
  );
}

export function PriceChangeCard({ issue, unit }: { issue: Issue; unit: string | null }) {
  const t = useT();
  const d = issue.data as { previousPrice: number; newPrice: number; pct: number; annualImpact: number; annualQuantity: number; previousDate: string };
  const up = d.pct > 0;
  return (
    <div className={cx("mb-4 rounded-lg border px-4 py-3", up ? "border-up/20 bg-up-wash" : "border-down/20 bg-down-wash")}>
      <div className={cx("flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase", up ? "text-up" : "text-down")}>
        {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {t("Price change detected")}
      </div>
      <div className="num mt-2 flex flex-wrap items-baseline gap-x-2 text-[15px]">
        <span className="text-ink-3">{f.price(d.previousPrice)}</span>
        <span className="text-ink-4">→</span>
        <span className="font-semibold">
          {f.price(d.newPrice)}
          {unit && <span className="font-normal text-ink-3">/{unit}</span>}
        </span>
        <span className={cx("font-semibold", up ? "text-up" : "text-down")}>{f.pct(d.pct, 2)}</span>
      </div>
      <div className="mt-1 text-[12.5px] text-ink-2">
        {t("Previous purchase {date}.", { date: f.date(d.previousDate) })}{" "}
        {d.annualQuantity > 0 &&
          rich(t("Annualized impact at current consumption ({quantity}/yr): {amount}", { quantity: `${f.number(d.annualQuantity)} ${unit ?? ""}`.trim() }), {
            amount: (
              <span className="num font-semibold">
                {d.annualImpact > 0 ? "+" : ""}
                {t("{amount}/year", { amount: f.money(d.annualImpact) })}
              </span>
            ),
          })}
      </div>
    </div>
  );
}

// ---------------- Approve bar ----------------

export function ApproveBar({
  sessionId,
  recordType,
  ready,
  attention,
  flaggedOnly,
  duplicates,
}: {
  sessionId: string;
  recordType: RecordType;
  ready: number;
  attention: number;
  flaggedOnly: number;
  duplicates: number;
}) {
  const { pending, error, run, t } = useAction();
  if (ready === 0 && attention === 0) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-rule bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 text-[13px]">
          <span className="font-medium">{t("{n} ready", { n: ready })}</span>
          {attention > 0 && <span className="text-caution"> · {t.n(attention, "{n} needs your attention", "{n} need your attention")}</span>}
          {attention > 0 && ready > 0 && <span className="text-ink-3"> {t("— they stay in Review, the rest can be imported now")}</span>}
          <ErrorLine error={error} />
        </div>
        {duplicates > 0 && (
          <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={() => run(() => duplicateAction({ sessionId }, "skip"))}>
            {t.n(duplicates, "Skip {n} duplicate", "Skip {n} duplicates")}
          </button>
        )}
        {flaggedOnly > 0 && (
          <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => run(() => acknowledgeAction({ sessionId }))}>
            <Check size={14} /> {t.n(flaggedOnly, "Accept {n} flagged line", "Accept {n} flagged lines")}
          </button>
        )}
        <button type="button" disabled={pending || ready === 0} className={buttonClass("primary")} onClick={() => run(() => approveAction(sessionId))}>
          {pending ? t("Importing…") : recordType === "quote" ? t.n(ready, "Import {n} quote", "Import {n} quotes") : t.n(ready, "Import {n} purchase", "Import {n} purchases")}
        </button>
      </div>
    </div>
  );
}

// ---------------- Duplicate file ----------------

/**
 * mode "file":  the same file was uploaded before.
 * mode "lines": a different file, but its lines match purchases already imported.
 */
export function DuplicateBanner({
  sessionId,
  mode,
  previousHref,
  previousDate,
  isPdf,
}: {
  sessionId: string;
  mode: "file" | "lines";
  previousHref?: string;
  previousDate?: string;
  isPdf: boolean;
}) {
  const { pending, error, run, t } = useAction();
  const title =
    mode === "file"
      ? isPdf
        ? t("This document appears to have already been imported.")
        : t("This file appears to have already been imported.")
      : isPdf
        ? t("This invoice appears to have already been imported.")
        : t("These lines appear to have already been imported.");
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-caution/25 bg-caution-wash px-4 py-3">
      <AlertTriangle size={16} className="text-caution" />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-semibold">{title}</div>
        <div className="text-ink-2">
          {mode === "file" ? (
            <>
              {t("Same file uploaded on {date}.", { date: previousDate })}{" "}
              <a href={previousHref} className="font-medium text-ledger hover:underline">
                {t("See that import")}
              </a>
            </>
          ) : (
            t("Same supplier, reference, date, product, quantity and price as existing purchases.")
          )}
        </div>
        <ErrorLine error={error} />
      </div>
      <button
        type="button"
        disabled={pending}
        className={buttonClass("secondary")}
        onClick={() => run(() => (mode === "file" ? duplicateFileAction(sessionId, "skip") : duplicateAction({ sessionId }, "skip")))}
      >
        {t("Skip")}
      </button>
      <button
        type="button"
        disabled={pending}
        className={buttonClass("ghost")}
        onClick={() =>
          run(async () => {
            if (mode === "lines") return duplicateAction({ sessionId }, "import");
            const r = await duplicateFileAction(sessionId, "continue");
            return isPdf && r.ok ? duplicateAction({ sessionId }, "import") : r;
          })
        }
      >
        {t("Import anyway")}
      </button>
    </div>
  );
}

// ---------------- Document details (PDF) ----------------

export function DocumentDetails({
  sessionId,
  kind,
  fields,
  editableValues,
}: {
  sessionId: string;
  kind: "invoice" | "quote";
  fields: { label: string; value: ReactNode; confidence: number | null }[];
  editableValues: { supplierName: string; invoiceReference: string; date: string; currency: string; paymentTermsDays: string; validUntil: string };
}) {
  const sheet = useSheet();
  const t = useT();
  return (
    <section className="overflow-hidden rounded-lg border border-rule">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h2 className="text-[14px] font-semibold">{kind === "quote" ? t("Quote details") : t("Invoice details")}</h2>
        <button type="button" onClick={sheet.show} className={buttonClass("ghost", "sm")}>
          {t("Correct|verb")}
        </button>
      </div>
      {/* Cells draw their own right/bottom hairline; the negative margin hides the outer ones. */}
      <dl className="-mr-px -mb-px grid grid-cols-2 border-t border-rule sm:grid-cols-3 lg:grid-cols-4">
        {fields.map((fld) => (
          <div key={fld.label} className="px-5 py-3 shadow-[inset_-1px_-1px_0_var(--color-rule)]">
            <dt className="flex items-center gap-1.5 text-[12px] text-ink-3">
              {fld.label}
              {fld.confidence != null && <ConfidenceDot value={fld.confidence} />}
            </dt>
            <dd className="mt-0.5 truncate text-[13.5px] font-medium">{fld.value ?? <span className="font-normal text-ink-4">{t("Not found")}</span>}</dd>
          </div>
        ))}
      </dl>
      <Sheet open={sheet.open} onClose={sheet.hide} title={t("Correct document details")} description={t("Applies to every line of this document.")}>
        <DetailsForm key={sheet.version} sessionId={sessionId} kind={kind} initial={editableValues} close={sheet.hide} />
      </Sheet>
    </section>
  );
}

function ConfidenceDot({ value }: { value: number }) {
  const t = useT();
  const label = value >= 0.8 ? t("Read with a label") : value >= 0.6 ? t("Probably right") : value > 0 ? t("Uncertain — check") : t("Not found");
  return <span title={label} className={cx("size-1.5 rounded-full", value >= 0.8 ? "bg-down" : value >= 0.6 ? "bg-caution" : "bg-up")} />;
}

function DetailsForm({ sessionId, kind, initial, close }: { sessionId: string; kind: "invoice" | "quote"; initial: Record<string, string>; close: () => void }) {
  const { pending, error, run, t } = useAction();
  const [v, setV] = useState(initial);
  const set = (k: string) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  function save() {
    const patch: Partial<ItemData> = {};
    if (v.supplierName !== initial.supplierName) patch.supplierName = v.supplierName || null;
    if (v.invoiceReference !== initial.invoiceReference) patch.invoiceReference = v.invoiceReference || null;
    if (v.date !== initial.date) patch.date = v.date || null;
    if (v.currency !== initial.currency) patch.currency = v.currency || null;
    if (v.paymentTermsDays !== initial.paymentTermsDays) patch.paymentTermsDays = v.paymentTermsDays === "" ? null : parseNumber(v.paymentTermsDays);
    if (v.validUntil !== initial.validUntil) patch.validUntil = v.validUntil || null;
    if (!Object.keys(patch).length) return close();
    run(() => updateSessionFieldsAction(sessionId, patch), close);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <Grid>
          <Field label={t("Supplier (as written)")} className="sm:col-span-2">
            <Input value={v.supplierName} onChange={set("supplierName")} />
          </Field>
          <Field label={kind === "quote" ? t("Quote number") : t("Invoice number")}>
            <Input value={v.invoiceReference} onChange={set("invoiceReference")} />
          </Field>
          <Field label={t("Date")}>
            <Input type="date" value={v.date} onChange={set("date")} />
          </Field>
          <Field label={t("Currency")}>
            <Select value={v.currency} onChange={set("currency")}>
              <option value="">{t("Choose…")}</option>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("Payment terms (days)")} hint={t("0 = payment in advance")}>
            <Input value={v.paymentTermsDays} inputMode="numeric" onChange={set("paymentTermsDays")} />
          </Field>
          {kind === "quote" && (
            <Field label={t("Valid until")}>
              <Input type="date" value={v.validUntil} onChange={set("validUntil")} />
            </Field>
          )}
        </Grid>
        <ErrorLine error={error} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" onClick={close} className={buttonClass("ghost")}>
          {t("Cancel")}
        </button>
        <button type="button" disabled={pending} onClick={save} className={buttonClass("primary")}>
          {pending ? t("Saving…") : t("Apply to all lines")}
        </button>
      </div>
    </div>
  );
}

// ---------------- Review queue ----------------

/** Inline actions for one line in the Review queue. */
export function QueueLineActions({ sessionId, itemId, issues }: { sessionId: string; itemId: string; issues: Issue[] }) {
  const { pending, error, run, t } = useAction();
  const [currency, setCurrency] = useState("");
  const codes = new Set(issues.map((i) => i.code));
  const blocking = issues.some((i) => i.severity === "blocking");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {codes.has("currency_missing") && (
        <>
          <div className="w-[120px]">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label={t("Currency")}>
              <option value="">{t("Currency…")}</option>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <button type="button" disabled={!currency || pending} className={buttonClass("primary", "sm")} onClick={() => run(() => updateSessionFieldsAction(sessionId, { currency }))}>
            {t("Set for this file")}
          </button>
        </>
      )}
      {(codes.has("duplicate") || codes.has("duplicate_in_file")) && (
        <>
          <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => duplicateAction({ itemId }, "skip"))}>
            {t("Skip")}
          </button>
          <button type="button" disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => duplicateAction({ itemId }, "import"))}>
            {t("Import anyway")}
          </button>
        </>
      )}
      {!blocking && (
        <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => acknowledgeAction({ itemId }))}>
          <Check size={13} /> {t("Looks right")}
        </button>
      )}
      <button type="button" disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => skipItemAction(itemId, true))}>
        {t("Leave this line out")}
      </button>
      {error && <span className="text-[12px] text-up">{error}</span>}
    </div>
  );
}

export function ImportReadyButton({ sessionId, ready }: { sessionId: string; ready: number }) {
  const { pending, error, run, t } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} className={buttonClass("primary", "sm")} onClick={() => run(() => approveAction(sessionId))}>
        {pending ? t("Importing…") : t("Import {n} ready", { n: ready })}
      </button>
      {error && <span className="text-[12px] text-up">{error}</span>}
    </span>
  );
}

// ---------------- Inbox (all open files) ----------------

/** Imports every ready line of every open file: the user does not open 12 files one by one. */
export function ImportAllButton({ ready, primary }: { ready: number; primary: boolean }) {
  const { pending, error, run, t } = useAction();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending || ready === 0} className={buttonClass(primary ? "primary" : "secondary")} onClick={() => run(() => approveAllAction())}>
        {pending ? t("Importing…") : t.n(ready, "Import {n} ready line", "Import {n} ready lines")}
      </button>
      {error && <span className="text-[12.5px] text-up">{error}</span>}
    </span>
  );
}

/** Back to the column screen, for a spreadsheet whose columns were recognised by themselves. */
export function ReopenColumnsButton({ sessionId }: { sessionId: string }) {
  const { pending, error, run, t } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} className="font-medium text-ledger hover:underline disabled:opacity-60" onClick={() => run(() => reopenMappingAction(sessionId))}>
        {pending ? t("Opening…") : t("Change columns")}
      </button>
      {error && <span className="text-up">{error}</span>}
    </span>
  );
}

/** A PDF read as the wrong kind of document: read it again as the other. */
export function ReclassifyButton({ sessionId, to }: { sessionId: string; to: "invoice" | "quote" }) {
  const { pending, error, run, t } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} className="font-medium text-ledger hover:underline disabled:opacity-60" onClick={() => run(() => reclassifyAction(sessionId, to))}>
        {pending ? t("Reading again…") : to === "quote" ? t("It is a quote") : t("It is an invoice")}
      </button>
      {error && <span className="text-up">{error}</span>}
    </span>
  );
}
