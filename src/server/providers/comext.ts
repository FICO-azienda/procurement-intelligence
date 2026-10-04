/**
 * Eurostat Comext: what entered an EU country under a customs code, month by
 * month, in euros and in kilograms. Public and free. What comes out is the
 * average of everything declared under the code, valued at the border — a
 * trade benchmark, never the price of one product.
 */
import type { TradeDataProvider, TradeSeries } from "@/lib/sourcing/providers";
import { httpGet } from "./http";

const API = "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/DS-045409";
const BROWSER = "https://ec.europa.eu/eurostat/databrowser/view/DS-045409/default/table";

interface JsonStat {
  value?: Record<string, number>;
  updated?: string;
  id?: string[];
  size?: number[];
  dimension?: Record<string, { category?: { index?: Record<string, number>; label?: Record<string, string> } }>;
}

/** The monthly values and quantities in a Comext answer (JSON-stat). */
export function parseComext(json: JsonStat, code: string, reporter: string): TradeSeries | null {
  const ids = json.id ?? [];
  const size = json.size ?? [];
  const index = (dim: string, key: string) => json.dimension?.[dim]?.category?.index?.[key];
  const at = (coords: Record<string, number>) => {
    let i = 0;
    for (let d = 0; d < ids.length; d++) i = i * size[d] + (coords[ids[d]] ?? 0);
    return json.value?.[String(i)];
  };
  const value = index("indicators", "VALUE_IN_EUROS");
  const quantity = index("indicators", "QUANTITY_IN_100KG");
  const periods = json.dimension?.time?.category?.index ?? {};
  if (value == null || quantity == null) return null;
  const months = Object.entries(periods)
    .map(([period, t]) => ({ period, valueEUR: at({ indicators: value, time: t }), q: at({ indicators: quantity, time: t }) }))
    .filter((m): m is { period: string; valueEUR: number; q: number } => m.valueEUR != null && m.q != null && m.q > 0 && m.valueEUR > 0)
    .map((m) => ({ period: m.period, valueEUR: m.valueEUR, quantityKg: m.q * 100 }))
    .sort((a, b) => a.period.localeCompare(b.period));
  return {
    code,
    description: json.dimension?.product?.category?.label?.[code] ?? null,
    reporter,
    months,
    sourceName: "Eurostat Comext",
    sourceUrl: BROWSER,
    updated: json.updated ? json.updated.slice(0, 10) : null,
  };
}

export const eurostatComext: TradeDataProvider = {
  key: "eurostat_comext",
  name: "Eurostat Comext",
  async imports({ code, reporter, months }) {
    const url = `${API}?format=JSON&freq=M&reporter=${encodeURIComponent(reporter)}&partner=WORLD&product=${encodeURIComponent(code)}&flow=1&indicators=VALUE_IN_EUROS&indicators=QUANTITY_IN_100KG${months.map((m) => `&time=${m}`).join("")}`;
    const { text } = await httpGet("Eurostat Comext", url, { timeoutMs: 30_000 });
    return parseComext(JSON.parse(text) as JsonStat, code, reporter);
  },
};
