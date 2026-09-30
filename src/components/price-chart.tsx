"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import * as f from "@/lib/format";

export interface PricePoint {
  date: string;
  price: number;
  supplier: string;
  quantity: number;
  unit: string;
}

const ACCENT = "#2443a6";
const GRID = "rgba(17,17,19,0.07)";
const AXIS_TEXT = "#6f6f76";

/** Price paid over time. Works with any number of observations. */
export function PriceChart({ points, height = 260 }: { points: PricePoint[]; height?: number }) {
  if (points.length === 0) {
    return (
      <div style={{ height }} className="grid place-items-center rounded-md bg-well text-[13px] text-ink-3">
        No purchases yet — the price history appears after the first purchase.
      </div>
    );
  }

  const data = points.map((p) => ({ ...p, t: Date.parse(p.date) }));
  const prices = data.map((d) => d.price);
  const ticks = niceTicks(Math.min(...prices), Math.max(...prices));
  const domainY: [number, number] = [ticks[0], ticks[ticks.length - 1]];
  const first = data[0].t;
  const last = data[data.length - 1].t;
  const padX = first === last ? 15 * 86_400_000 : 0;

  return (
    <div style={{ height }} role="img" aria-label={`Price history, ${points.length} purchases`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 56, bottom: 0, left: 0 }}>
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
            domain={domainY}
            tickFormatter={(v: number) => f.price(v)}
            tick={{ fill: AXIS_TEXT, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={64}
            ticks={ticks}
            interval={0}
          />
          <Tooltip
            content={(props) => <ChartTooltip {...props} />}
            cursor={{ stroke: "rgba(17,17,19,0.25)", strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="price"
            stroke={ACCENT}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={{ r: 4, fill: ACCENT, stroke: "#fff", strokeWidth: 2 }}
            activeDot={{ r: 5.5, fill: ACCENT, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={false}
            label={(props: { x?: number | string; y?: number | string; index?: number }) =>
              props.index === data.length - 1 ? (
                <text
                  key="end-label"
                  x={Number(props.x) + 10}
                  y={Number(props.y) + 4}
                  fill="#111113"
                  fontSize={12.5}
                  fontWeight={600}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {f.price(data[data.length - 1].price)}
                </text>
              ) : (
                <g key={`l-${props.index}`} />
              )
            }
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

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

function ChartTooltip({ active, payload }: TooltipContentProps) {
  const p = payload?.[0]?.payload as (PricePoint & { t: number }) | undefined;
  if (!active || !p) return null;
  return (
    <div className="rounded-md bg-canvas px-3 py-2 text-[12.5px] shadow-[0_0_0_1px_rgba(17,17,19,.08),0_4px_12px_-2px_rgba(17,17,19,.14)]">
      <div className="text-ink-3">{f.date(p.date)}</div>
      <div className="num mt-0.5 text-[14px] font-semibold">
        {f.price(p.price)}
        <span className="font-normal text-ink-3">/{p.unit}</span>
      </div>
      <div className="mt-0.5 text-ink-2">
        {p.supplier} · <span className="num">{f.quantity(p.quantity, p.unit)}</span>
      </div>
    </div>
  );
}
