"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, CircleDashed, Info, Plus, TrendingDown, TrendingUp } from "lucide-react";
import {
  acknowledgeAction,
  approveAction,
  duplicateAction,
  duplicateFileAction,
  resolveProductAction,
  resolveSupplierAction,
  skipItemAction,
  updateItemAction,
  updateSessionFieldsAction,
  type ActionResult,
} from "@/app/import/actions";
import * as f from "@/lib/format";
import type { MatchGroup } from "@/lib/import/groups";
import { SUPPORTED_CURRENCIES } from "@/lib/import/normalize/currency";
import { INCOTERMS } from "@/lib/import/normalize/terms";
import { UNITS } from "@/lib/import/normalize/units";
import type { CurrentData, ExtractedData, Issue, ItemData, RecordType } from "@/lib/import/types";
import { parseDate, parseNumber } from "@/lib/parse";
import { Field, Grid, Input, Select, Sheet, toInput, useSheet } from "../form-kit";
import { Basis, buttonClass, cx } from "../ui";

// ---------------- helpers ----------------

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        after?.();
        router.refresh();
      }
    });
  return { pending, error, run };
}

const SEVERITY_ORDER = { blocking: 0, review: 1, info: 2 } as const;

export function IssueIcon({ issue, size = 14 }: { issue: Pick<Issue, "severity" | "priority">; size?: number }) {
  if (issue.severity === "blocking") return <AlertCircle size={size} className="shrink-0 text-up" aria-label="Must fix" />;
  if (issue.severity === "review") return <AlertTriangle size={size} className={cx("shrink-0", issue.priority === "high" ? "text-up" : "text-caution")} aria-label="Check" />;
  return <Info size={size} className="shrink-0 text-ink-4" aria-label="Note" />;
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <div className="mt-2 text-[12.5px] text-up">{error}</div> : null;
}

// ---------------- Match groups ----------------

export function MatchGroupsPanel({
  sessionId,
  kind,
  groups,
  options,
}: {
  sessionId: string;
  kind: "supplier" | "product";
  groups: MatchGroup[];
  options: { id: string; name: string }[];
}) {
  const open = groups.filter((g) => g.state !== "matched").length;
  return (
    <section className="rounded-lg border border-rule">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="text-[14px] font-semibold">{kind === "supplier" ? "Suppliers in this file" : "Products in this file"}</h2>
        <span className="text-[12.5px] text-ink-3">
          {open ? `${open} to confirm` : "All recognised"} · {groups.length} total
        </span>
      </div>
      <ul className="border-t border-rule">
        {groups.map((g) => (
          <GroupRow key={g.key} sessionId={sessionId} kind={kind} group={g} options={options} />
        ))}
      </ul>
    </section>
  );
}

function GroupRow({ sessionId, kind, group: g, options }: { sessionId: string; kind: "supplier" | "product"; group: MatchGroup; options: { id: string; name: string }[] }) {
  const { pending, error, run } = useAction();
  const [choosing, setChoosing] = useState(false);
  const [choice, setChoice] = useState(g.targetId ?? "");
  const create = useSheet();

  const use = (id: string) =>
    run(() =>
      kind === "supplier"
        ? resolveSupplierAction(sessionId, g.key, { type: "use", supplierId: id })
        : resolveProductAction(sessionId, g.key, { type: "use", productId: id }),
      () => setChoosing(false),
    );

  const icon =
    g.state === "matched" ? (
      <Check size={15} className="text-down" />
    ) : g.state === "suggested" ? (
      <AlertTriangle size={15} className="text-caution" />
    ) : (
      <CircleDashed size={15} className="text-up" />
    );

  return (
    <li className={cx("border-b border-rule px-5 py-3 last:border-b-0", pending && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[220px] flex-1 items-start gap-2.5">
          <span className="mt-0.5">{icon}</span>
          <div className="min-w-0">
            <div className="truncate font-medium">{g.label}</div>
            <div className="text-[12px] text-ink-3">
              {[g.detail, `${g.lines} ${g.lines === 1 ? "line" : "lines"}`].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>

        {g.state === "matched" && !choosing && (
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-ink-3">→</span>
            <span className="font-medium">{g.targetName}</span>
            <Basis tone="muted">{g.resolution === "created" ? "New" : g.resolution === "auto" ? "Recognised" : "Confirmed"}</Basis>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setChoosing(true)}>
              Change
            </button>
          </div>
        )}

        {g.state === "suggested" && !choosing && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink-3">Suggested</span>
            <span className="font-medium">{g.targetName}</span>
            {g.confidence != null && (
              <span className="num rounded-full bg-caution-wash px-1.5 text-[12px] font-medium text-caution" title={g.reason ?? undefined}>
                {Math.round(g.confidence * 100)}%
              </span>
            )}
            <button type="button" disabled={pending} className={buttonClass("primary", "sm")} onClick={() => use(g.targetId!)}>
              Confirm
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setChoosing(true)}>
              Choose another
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={create.show}>
              Create new
            </button>
          </div>
        )}

        {g.state === "unknown" && !choosing && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink-3">{kind === "supplier" ? "Unknown supplier" : "Unknown product"}</span>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setChoosing(true)}>
              Choose existing
            </button>
            <button type="button" className={buttonClass("primary", "sm")} onClick={create.show}>
              <Plus size={13} /> {kind === "supplier" ? "Create supplier" : "Create product"}
            </button>
          </div>
        )}

        {choosing && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-[240px]">
              <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={`Choose ${kind}`}>
                <option value="">Choose {kind === "supplier" ? "a supplier" : "a product"}…</option>
                {g.alternatives.length > 0 && (
                  <optgroup label="Similar">
                    {g.alternatives.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({Math.round(a.confidence * 100)}%)
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={kind === "supplier" ? "All suppliers" : "All products"}>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </div>
            <button type="button" disabled={!choice || pending} className={buttonClass("primary", "sm")} onClick={() => use(choice)}>
              Use
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {g.state === "suggested" && g.reason && !choosing && <div className="mt-1 pl-[26px] text-[12px] text-ink-4">{g.reason}</div>}
      <ErrorLine error={error} />

      <Sheet
        open={create.open}
        onClose={create.hide}
        title={kind === "supplier" ? "Create supplier" : "Create product"}
        description={`From “${g.label}” — used for ${g.lines} ${g.lines === 1 ? "line" : "lines"} of this file.`}
      >
        <CreateForm key={create.version} kind={kind} group={g} sessionId={sessionId} close={create.hide} />
      </Sheet>
    </li>
  );
}

function CreateForm({ kind, group, sessionId, close }: { kind: "supplier" | "product"; group: MatchGroup; sessionId: string; close: () => void }) {
  const { pending, error, run } = useAction();
  const [v, setV] = useState<Record<string, string>>(group.create);
  const set = (k: string) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const submit = () =>
    run(
      () =>
        kind === "supplier"
          ? resolveSupplierAction(sessionId, group.key, { type: "create", name: v.name, country: v.country || null, vatNumber: v.vatNumber || null })
          : resolveProductAction(sessionId, group.key, { type: "create", name: v.name, sku: v.sku, unit: v.unit, category: v.category || null }),
      close,
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <Grid>
          <Field label="Name" required className="sm:col-span-2">
            <Input value={v.name} onChange={set("name")} autoFocus />
          </Field>
          {kind === "supplier" ? (
            <>
              <Field label="Country">
                <Input value={v.country} onChange={set("country")} placeholder="Italy" />
              </Field>
              <Field label="VAT number">
                <Input value={v.vatNumber} onChange={set("vatNumber")} />
              </Field>
            </>
          ) : (
            <>
              <Field label="SKU / internal code" required hint="Your own code for this product">
                <Input value={v.sku} onChange={set("sku")} className="font-mono uppercase" />
              </Field>
              <Field label="Unit of measure" required>
                <Select value={v.unit} onChange={set("unit")}>
                  <option value="">Choose…</option>
                  {UNITS.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.code} — {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Category" className="sm:col-span-2">
                <Input value={v.category} onChange={set("category")} placeholder="Glass" />
              </Field>
            </>
          )}
        </Grid>
        <ErrorLine error={error} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" onClick={close} className={buttonClass("ghost")}>
          Cancel
        </button>
        <button type="button" disabled={pending || !v.name?.trim() || (kind === "product" && (!v.sku?.trim() || !v.unit))} onClick={submit} className={buttonClass("primary")}>
          {pending ? "Creating…" : kind === "supplier" ? "Create supplier" : "Create product"}
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
  { key: "all", label: "All" },
] as const;

export function LinesPanel({ lines }: { lines: LineVM[] }) {
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
        <h2 className="text-[14px] font-semibold">Lines</h2>
        <nav className="flex flex-wrap gap-1" aria-label="Filter lines">
          {TABS.map((t) =>
            counts[t.key] || t.key === "all" ? (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors",
                  tab === t.key ? "bg-ink text-white" : "text-ink-2 hover:bg-wash",
                )}
              >
                {t.label}
                <span className={cx("num text-[12px]", tab === t.key ? "text-white/60" : "text-ink-4")}>{counts[t.key]}</span>
              </button>
            ) : null,
          )}
        </nav>
      </div>
      <div className="overflow-x-auto border-t border-rule">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-well text-left text-[12px] text-ink-3">
              {["", "Line", "Date", "Supplier", "Product", "Quantity", "Unit price", "Total", "Check"].map((h, i) => (
                <th key={i} className={cx("h-9 border-b border-rule px-2.5 font-medium whitespace-nowrap first:pl-5", ["Quantity", "Unit price", "Total"].includes(h) && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-ink-3">
                  Nothing here.
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
                        <span className={cx("truncate", top.severity === "info" && "text-ink-3")}>{top.message}</span>
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
      <Sheet open={!!current} onClose={() => setOpenId(null)} title={current ? `Line ${current.line}` : ""} description={current ? current.productLabel : undefined}>
        {current && <LineEditor key={current.id + JSON.stringify(current.data)} line={current} close={() => setOpenId(null)} />}
      </Sheet>
    </section>
  );
}

function StatusDot({ status }: { status: LineVM["status"] }) {
  const map = {
    ready: ["bg-down", "Ready"],
    attention: ["bg-caution", "Needs attention"],
    imported: ["bg-ledger", "Imported"],
    skipped: ["bg-ink-4", "Skipped"],
  } as const;
  const [cls, label] = map[status];
  return <span className={cx("block size-2 rounded-full", cls)} title={label} aria-label={label} />;
}

type EditKey = "date" | "quantity" | "unit" | "unitPrice" | "currency" | "fxRate" | "freight" | "total" | "invoiceReference" | "moq" | "leadTimeDays" | "paymentTermsDays" | "incoterm" | "validUntil";

const FIELD_LABELS: Record<EditKey, string> = {
  date: "Date",
  quantity: "Quantity",
  unit: "Unit",
  unitPrice: "Unit price",
  currency: "Currency",
  fxRate: "FX rate (EUR per 1 unit)",
  freight: "Freight",
  total: "Line total",
  invoiceReference: "Invoice / reference",
  moq: "MOQ",
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
  const { pending, error, run } = useAction();
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
        if (raw !== "" && n == null) return setFieldError(`${FIELD_LABELS[k]} is not a number`);
        (patch as Record<string, unknown>)[k] = n;
      } else if (DATE_KEYS.includes(k)) {
        const d = raw === "" ? null : parseDate(raw);
        if (raw !== "" && !d) return setFieldError(`${FIELD_LABELS[k]} is not a valid date`);
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
      return e == null ? "empty" : NUMBER_KEYS.includes(k) ? f.number(e as number, 6) : DATE_KEYS.includes(k) ? f.date(e as string) : String(e);
    }
    return null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {Object.keys(line.raw).length > 0 && (
          <div className="mb-4 rounded-md bg-well px-3 py-2 text-[12px] text-ink-3">
            <div className="mb-1 font-medium text-ink-2">In the file</div>
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
                    {i.message}
                    {i.priority === "high" && <span className="ml-1.5 text-[11px] font-semibold tracking-wide text-up uppercase">High priority</span>}
                  </span>
                </li>
              ))}
          </ul>
        )}

        <Grid>
          {keys
            .filter((k) => k !== "fxRate" || (values.currency && values.currency !== "EUR"))
            .map((k) => (
              <Field key={k} label={FIELD_LABELS[k]} hint={original(k) ? `In file: ${original(k)}` : undefined}>
                {k === "unit" ? (
                  <Select value={values.unit} disabled={!editable} onChange={(e) => setValues((p) => ({ ...p, unit: e.target.value }))}>
                    <option value="">{line.data.unitRaw ? `“${line.data.unitRaw}” — choose` : "Product's unit"}</option>
                    {UNITS.map((u) => (
                      <option key={u.code} value={u.code}>
                        {u.code} — {u.label}
                      </option>
                    ))}
                  </Select>
                ) : k === "currency" ? (
                  <Select value={values.currency} disabled={!editable} onChange={(e) => setValues((p) => ({ ...p, currency: e.target.value }))}>
                    <option value="">Choose…</option>
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
            Skip line
          </button>
        )}
        {line.status === "skipped" && (
          <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={() => run(() => skipItemAction(line.id, false), close)}>
            Restore line
          </button>
        )}
        <div className="flex-1" />
        {editable && duplicate && (
          <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => run(() => duplicateAction({ itemId: line.id }, "import"))}>
            Import anyway
          </button>
        )}
        {editable && reviewOnly && (
          <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => run(() => acknowledgeAction({ itemId: line.id }), close)}>
            <Check size={14} /> Looks right
          </button>
        )}
        {editable ? (
          <button type="button" disabled={pending} className={buttonClass("primary")} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        ) : (
          <button type="button" className={buttonClass("secondary")} onClick={close}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}

export function PriceChangeCard({ issue, unit }: { issue: Issue; unit: string | null }) {
  const d = issue.data as { previousPrice: number; newPrice: number; pct: number; annualImpact: number; annualQuantity: number; previousDate: string };
  const up = d.pct > 0;
  return (
    <div className={cx("mb-4 rounded-lg border px-4 py-3", up ? "border-up/20 bg-up-wash" : "border-down/20 bg-down-wash")}>
      <div className={cx("flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase", up ? "text-up" : "text-down")}>
        {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />} Price change detected
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
        Previous purchase {f.date(d.previousDate)}.{" "}
        {d.annualQuantity > 0 && (
          <>
            Annualized impact at current consumption ({f.number(d.annualQuantity)} {unit ?? ""}/yr):{" "}
            <span className="num font-semibold">
              {d.annualImpact > 0 ? "+" : ""}
              {f.money(d.annualImpact)}/year
            </span>
          </>
        )}
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
  const { pending, error, run } = useAction();
  const noun = recordType === "quote" ? (ready === 1 ? "quote" : "quotes") : ready === 1 ? "purchase" : "purchases";
  if (ready === 0 && attention === 0) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-rule bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 text-[13px]">
          <span className="font-medium">{ready} ready</span>
          {attention > 0 && <span className="text-caution"> · {attention} {attention === 1 ? "needs" : "need"} your attention</span>}
          {attention > 0 && ready > 0 && <span className="text-ink-3"> — they stay in Review, the rest can be imported now</span>}
          <ErrorLine error={error} />
        </div>
        {duplicates > 0 && (
          <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={() => run(() => duplicateAction({ sessionId }, "skip"))}>
            Skip {duplicates} duplicate{duplicates > 1 ? "s" : ""}
          </button>
        )}
        {flaggedOnly > 0 && (
          <button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => run(() => acknowledgeAction({ sessionId }))}>
            <Check size={14} /> Accept {flaggedOnly} flagged line{flaggedOnly > 1 ? "s" : ""}
          </button>
        )}
        <button type="button" disabled={pending || ready === 0} className={buttonClass("primary")} onClick={() => run(() => approveAction(sessionId))}>
          {pending ? "Importing…" : `Import ${ready} ${noun}`}
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
  const { pending, error, run } = useAction();
  const title =
    mode === "file"
      ? `This ${isPdf ? "document" : "file"} appears to have already been imported.`
      : isPdf
        ? "This invoice appears to have already been imported."
        : "These lines appear to have already been imported.";
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-caution/25 bg-caution-wash px-4 py-3">
      <AlertTriangle size={16} className="text-caution" />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-semibold">{title}</div>
        <div className="text-ink-2">
          {mode === "file" ? (
            <>
              Same file uploaded on {previousDate}.{" "}
              <a href={previousHref} className="font-medium text-ledger hover:underline">
                See that import
              </a>
            </>
          ) : (
            "Same supplier, reference, date, product, quantity and price as existing purchases."
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
        Skip
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
        Import anyway
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
  return (
    <section className="overflow-hidden rounded-lg border border-rule">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <h2 className="text-[14px] font-semibold">{kind === "quote" ? "Quote details" : "Invoice details"}</h2>
        <button type="button" onClick={sheet.show} className={buttonClass("ghost", "sm")}>
          Correct
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
            <dd className="mt-0.5 truncate text-[13.5px] font-medium">{fld.value ?? <span className="font-normal text-ink-4">Not found</span>}</dd>
          </div>
        ))}
      </dl>
      <Sheet open={sheet.open} onClose={sheet.hide} title="Correct document details" description="Applies to every line of this document.">
        <DetailsForm key={sheet.version} sessionId={sessionId} kind={kind} initial={editableValues} close={sheet.hide} />
      </Sheet>
    </section>
  );
}

function ConfidenceDot({ value }: { value: number }) {
  const label = value >= 0.8 ? "Read with a label" : value >= 0.6 ? "Probably right" : value > 0 ? "Uncertain — check" : "Not found";
  return <span title={label} className={cx("size-1.5 rounded-full", value >= 0.8 ? "bg-down" : value >= 0.6 ? "bg-caution" : "bg-up")} />;
}

function DetailsForm({ sessionId, kind, initial, close }: { sessionId: string; kind: "invoice" | "quote"; initial: Record<string, string>; close: () => void }) {
  const { pending, error, run } = useAction();
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
          <Field label="Supplier (as written)" className="sm:col-span-2">
            <Input value={v.supplierName} onChange={set("supplierName")} />
          </Field>
          <Field label={kind === "quote" ? "Quote number" : "Invoice number"}>
            <Input value={v.invoiceReference} onChange={set("invoiceReference")} />
          </Field>
          <Field label="Date">
            <Input type="date" value={v.date} onChange={set("date")} />
          </Field>
          <Field label="Currency">
            <Select value={v.currency} onChange={set("currency")}>
              <option value="">Choose…</option>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Payment terms (days)" hint="0 = advance">
            <Input value={v.paymentTermsDays} inputMode="numeric" onChange={set("paymentTermsDays")} />
          </Field>
          {kind === "quote" && (
            <Field label="Valid until">
              <Input type="date" value={v.validUntil} onChange={set("validUntil")} />
            </Field>
          )}
        </Grid>
        <ErrorLine error={error} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" onClick={close} className={buttonClass("ghost")}>
          Cancel
        </button>
        <button type="button" disabled={pending} onClick={save} className={buttonClass("primary")}>
          {pending ? "Saving…" : "Apply to all lines"}
        </button>
      </div>
    </div>
  );
}

// ---------------- Review queue ----------------

/** Inline actions for one line in the Review queue. */
export function QueueLineActions({ sessionId, itemId, issues }: { sessionId: string; itemId: string; issues: Issue[] }) {
  const { pending, error, run } = useAction();
  const [currency, setCurrency] = useState("");
  const codes = new Set(issues.map((i) => i.code));
  const blocking = issues.some((i) => i.severity === "blocking");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {codes.has("currency_missing") && (
        <>
          <div className="w-[120px]">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
              <option value="">Currency…</option>
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <button type="button" disabled={!currency || pending} className={buttonClass("primary", "sm")} onClick={() => run(() => updateSessionFieldsAction(sessionId, { currency }))}>
            Set for this file
          </button>
        </>
      )}
      {(codes.has("duplicate") || codes.has("duplicate_in_file")) && (
        <>
          <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => duplicateAction({ itemId }, "skip"))}>
            Skip
          </button>
          <button type="button" disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => duplicateAction({ itemId }, "import"))}>
            Import anyway
          </button>
        </>
      )}
      {!blocking && (
        <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => acknowledgeAction({ itemId }))}>
          <Check size={13} /> Looks right
        </button>
      )}
      <a href={`/import/${sessionId}`} className={buttonClass("ghost", "sm")}>
        Open
      </a>
      {error && <span className="text-[12px] text-up">{error}</span>}
    </div>
  );
}

export function ImportReadyButton({ sessionId, ready }: { sessionId: string; ready: number }) {
  const { pending, error, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} className={buttonClass("primary", "sm")} onClick={() => run(() => approveAction(sessionId))}>
        {pending ? "Importing…" : `Import ${ready} ready`}
      </button>
      {error && <span className="text-[12px] text-up">{error}</span>}
    </span>
  );
}
