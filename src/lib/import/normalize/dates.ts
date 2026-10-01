/**
 * Date parsing for imported documents. European day-first order is the
 * default; a column is read month-first only when its values prove it
 * (e.g. "09/15/2026"). Conflicting evidence is reported, never guessed.
 */

export type DateOrder = "dmy" | "mdy";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, gen: 1, gennaio: 1,
  feb: 2, february: 2, febbraio: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, aprile: 4,
  may: 5, mag: 5, maggio: 5,
  jun: 6, june: 6, giu: 6, giugno: 6,
  jul: 7, july: 7, lug: 7, luglio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, set: 9, settembre: 9,
  oct: 10, october: 10, ott: 10, ottobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, dic: 12, dicembre: 12,
};

const NUMERIC = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/;

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

export function detectDateOrder(values: (string | null | undefined)[]): { order: DateOrder; conflict: boolean } {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = typeof v === "string" ? NUMERIC.exec(v.trim()) : null;
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy = true;
    if (b > 12 && a <= 12) mdy = true;
  }
  return { order: mdy && !dmy ? "mdy" : "dmy", conflict: dmy && mdy };
}

/** Excel stores dates as days since 1899-12-30. */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseDate(raw: unknown, order: DateOrder = "dmy"): string | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    // SheetJS gives local-midnight dates; read the calendar date back locally.
    return iso(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  if (typeof raw === "number") return excelSerialToISO(raw);
  const s = String(raw).trim().replace(/\s+/g, " ");
  if (!s) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = NUMERIC.exec(s);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return order === "mdy" ? iso(y, a, b) : iso(y, b, a);
  }

  // 15 Sep 2026 · 15 settembre 2026 · 15-set-2026
  m = /^(\d{1,2})[\s\-.]+([a-zà-ù]+)\.?[\s\-.,]+(\d{2,4})$/i.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? iso(Number(m[3]), month, Number(m[1])) : null;
  }
  // Sep 15, 2026
  m = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? iso(Number(m[3]), month, Number(m[2])) : null;
  }
  return null;
}

/** First date found anywhere in a line of text. */
export function findDate(text: string, order: DateOrder = "dmy"): string | null {
  const patterns = [
    /\b\d{4}-\d{1,2}-\d{1,2}\b/,
    /\b\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{4}|\d{2})\b/,
    /\b\d{1,2}\s+[a-zà-ù]{3,10}\.?\s+\d{4}\b/i,
    /\b[a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}\b/i,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      const d = parseDate(m[0], order);
      if (d) return d;
    }
  }
  return null;
}
