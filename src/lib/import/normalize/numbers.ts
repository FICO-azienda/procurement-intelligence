/**
 * Number parsing for imported documents.
 *
 * "1.234,50" and "1,234.50" are both 1234.5, but "1.500" is 1500 in Italy and
 * 1.5 in the UK. We never guess silently:
 *   1. detect the decimal style from all values in a column/file
 *      (a value like "1,58" or "1.234,50" proves the comma style);
 *   2. parse each value with that style;
 *   3. values that stay ambiguous are returned with `ambiguous: true`, so the
 *      row goes to review instead of being stored as fact.
 */
import { stripCurrency } from "./currency";

export type DecimalStyle = "comma" | "dot";

export interface ParsedNumber {
  value: number | null;
  /** The value could be read two ways and the file gave no evidence. */
  ambiguous: boolean;
  /** Present when the text is not a number at all. */
  error?: string;
}

const THOUSANDS_DOT = /^[1-9]\d{0,2}(\.\d{3})+$/; // 1.500 · 12.345.678
const THOUSANDS_COMMA = /^[1-9]\d{0,2}(,\d{3})+$/; // 1,500 · 12,345,678

function clean(raw: string): { body: string; negative: boolean } | null {
  let s = stripCurrency(raw).replace(/[\s  ']/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    // SAP-style trailing minus: 1.234,50-
    negative = true;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  return { body: s, negative };
}

/** What a single value says about the decimal style (null = no evidence). */
export function styleEvidence(raw: string): DecimalStyle | null {
  const c = clean(raw);
  if (!c) return null;
  const s = c.body;
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  if (dot !== -1 && comma !== -1) return comma > dot ? "comma" : "dot";
  if (comma !== -1) {
    if ((s.match(/,/g) ?? []).length > 1) return THOUSANDS_COMMA.test(s) ? "dot" : null;
    return THOUSANDS_COMMA.test(s) ? null : "comma";
  }
  if (dot !== -1) {
    if ((s.match(/\./g) ?? []).length > 1) return THOUSANDS_DOT.test(s) ? "comma" : null;
    return THOUSANDS_DOT.test(s) ? null : "dot";
  }
  return null;
}

/** Decimal style shown by a set of values; `conflict` when both appear. */
export function detectDecimalStyle(values: (string | null | undefined)[]): {
  style: DecimalStyle | null;
  conflict: boolean;
} {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const e = styleEvidence(v);
    if (e === "comma") comma++;
    else if (e === "dot") dot++;
  }
  if (comma && dot) return { style: comma >= dot ? "comma" : "dot", conflict: true };
  return { style: comma ? "comma" : dot ? "dot" : null, conflict: false };
}

/**
 * Parses one value. With a known style the result is exact; without one,
 * ambiguous values ("1.500") are read the Italian way and flagged.
 */
export function parseNumber(raw: unknown, style: DecimalStyle | null = null): ParsedNumber {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { value: raw, ambiguous: false } : { value: null, ambiguous: false, error: "Not a number" };
  }
  if (raw == null) return { value: null, ambiguous: false };
  const text = String(raw).trim();
  if (text === "") return { value: null, ambiguous: false };
  const c = clean(text);
  if (!c) return { value: null, ambiguous: false, error: `"${text}" is not a number` };

  const own = styleEvidence(text);
  let use: DecimalStyle;
  let ambiguous = false;
  if (style) {
    use = style;
    // A value that contradicts the file's style is suspicious.
    if (own && own !== style) ambiguous = true;
  } else if (own) {
    use = own;
  } else {
    use = "comma";
    ambiguous = /[.,]/.test(c.body);
  }

  const body =
    use === "comma" ? c.body.replace(/\./g, "").replace(",", ".") : c.body.replace(/,/g, "");
  if ((body.match(/\./g) ?? []).length > 1) {
    return { value: null, ambiguous: false, error: `"${text}" is not a valid number` };
  }
  const value = Number(body) * (c.negative ? -1 : 1);
  if (!Number.isFinite(value)) return { value: null, ambiguous: false, error: `"${text}" is not a number` };
  return { value, ambiguous };
}

/** Round to cents without floating-point surprises. */
export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** True when a ≈ b within 0.5% or 2 cents (for quantity × price vs total). */
export function amountsMatch(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.005);
}
