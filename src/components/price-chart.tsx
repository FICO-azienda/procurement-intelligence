"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { minusMonths } from "@/lib/analytics";
import * as f from "@/lib/format";
import { cx } from "./ui";

export interface PricePoint {
  id: string;
  date: string;
  /** EUR per product unit. */
  price: number;
  supplierId: string;
  supplier: string;
  quantity: number;
  unit: string;
  /** "Invoice FT 2026/0142", "CSV import", … */
  source: string;
}

const RANGES = [
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "12M", months: 12 },
  { key: "24M", months: 24 },
  { key: "ALL", months: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/** One supplier: the product accent. Several: a validated categorical palette, fixed per supplier. */
const SINGLE = "#2443a6";
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const OTHER = "#8a8a90";
const GRID = "rgba(17,17,19,0.07)";
const AXIS_TEXT = "#6f6f76";

/** Round tick values (…, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5…) spanning the data. */
function niceTicks(min: number, max: number, target = 4): number[] {
  const span = max - min || Math.abs(max) * 0.1 || 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (lo === min && lo - step >= 0) lo -= step; // keep points off the frame
  if (hi === max) hi += step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

type Row = { t: number } & Record<string, number | PricePoint | undefined>;

/** Price paid over time, one line per supplier. Works with any number of observations. */
export function PriceChart({ points, asOf, height = 260 }: { points: PricePoint[]; asOf: string; height?: number }) {
  // Colour follows the supplier (order of first appearance in the full history), not the selected range.
  const suppliers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of points) if (!seen.has(p.supplierId)) seen.set(p.supplierId, p.supplier);
    const list = [...seen.entries()].map(([id, name]) => ({ id, name }));
    return list.map((s, i) => ({ ...s, color: list.length === 1 ? SINGLE : (SERIES[i] ?? OTHER) }));
  }, [points]);

  const [range, setRange] = useState<RangeKey>(points.some((p) => p.date < minusMonths(asOf, 12)) ? "12M" : "ALL");
  const months = RANGES.find((r) => r.key === range)?.months ?? null;
  const visible = months == null ? points : points.filter((p) => p.date >= minusMonths(asOf, months));

  const rangeTabs = (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        {suppliers.length > 1 &&
          suppliers.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className="h-[3px] w-3.5 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
      </div>
      <div className="inline-flex shrink-0 rounded-md border border-rule-strong p-0.5" role="radiogroup" aria-label="Period">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="radio"
            aria-checked={range === r.key}
            onClick={() => setRange(r.key)}
            className={cx(
              "h-6 rounded-[5px] px-2 text-[12px] font-medium transition-colors",
              range === r.key ? "bg-ink text-white" : "text-ink-2 hover:bg-wash",
            )}
          >
            {r.key}
          </button>
        ))}
      </div>
    </div>
  );

  if (points.length === 0) {
    return (
      <div style={{ height }} className="grid place-items-center rounded-md bg-well text-[13px] text-ink-3">
        No comparable purchases yet — the price history appears after the first purchase.
      </div>
    );
  }
  if (visible.length === 0) {
    return (
      <div>
        {rangeTabs}
        <div style={{ height }} className="grid place-items-center rounded-md bg-well text-[13px] text-ink-3">
          No purchases in this period.
        </div>
      </div>
    );
  }

  // One row per purchase; each supplier has its own column so lines don't join across suppliers.
  const rows: Row[] = visible.map((p) => ({ t: Date.parse(p.date), [p.supplierId]: p.price, [`meta:${p.supplierId}`]: p }));
  const prices = visible.map((p) => p.price);
  const ticks = niceTicks(Math.min(...prices), Math.max(...prices));
  const first = rows[0].t;
  const last = rows[rows.length - 1].t;
  const padX = first === last ? 15 * 86_400_000 : 0;
  const lastPoint = visible[visible.length - 1];

  return (
    <div>
      {rangeTabs}
      <div style={{ height }} role="img" aria-label={`Price history, ${visible.length} purchases from ${suppliers.length} supplier${suppliers.length > 1 ? "s" : ""}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 16, right: suppliers.length === 1 ? 56 : 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[first - padX, last + padX]}
              tickFormatter={(t: number) => f.month(new Date(t).toISOString())}
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={36}
              tickMargin={8}
            />
            <YAxis
              domain={[ticks[0], ticks[ticks.length - 1]]}
              tickFormatter={(v: number) => f.price(v)}
              tick={{ fill: AXIS_TEXT, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={64}
              ticks={ticks}
              interval={0}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "rgba(17,17,19,0.25)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as Row | undefined;
                if (!active || !row) return null;
                const metas = suppliers.map((s) => row[`meta:${s.id}`] as PricePoint | undefined).filter((m): m is PricePoint => !!m);
                return (
                  <div className="rounded-md bg-canvas px-3 py-2 text-[12.5px] shadow-[0_0_0_1px_rgba(17,17,19,.08),0_4px_12px_-2px_rgba(17,17,19,.14)]">
                    {metas.map((p) => (
                      <div key={p.id}>
                        <div className="text-ink-3">{f.date(p.date)}</div>
                        <div className="num mt-0.5 text-[14px] font-semibold">
                          {f.price(p.price)}
                          <span className="font-normal text-ink-3">/{p.unit}</span>
                        </div>
                        <div className="mt-0.5 text-ink-2">
                          {p.supplier} · <span className="num">{f.quantity(p.quantity, p.unit)}</span>
                        </div>
                        <div className="text-ink-3">{p.source}</div>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {suppliers.map((s) => (
              <Line
                key={s.id}
                type="linear"
                dataKey={s.id}
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                connectNulls
                dot={{ r: 4, fill: s.color, stroke: "#fff", strokeWidth: 2 }}
                activeDot={{ r: 5.5, fill: s.color, stroke: "#fff", strokeWidth: 2 }}
                isAnimationActive={false}
                label={
                  suppliers.length === 1
                    ? (props: { x?: number | string; y?: number | string; index?: number }) =>
                        props.index === rows.length - 1 ? (
                          <text key="end" x={Number(props.x) + 10} y={Number(props.y) + 4} fill="#111113" fontSize={12.5} fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                            {f.price(lastPoint.price)}
                          </text>
                        ) : (
                          <g key={`l-${props.index}`} />
                        )
                    : undefined
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
