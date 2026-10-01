/**
 * Commercial terms written as free text: payment terms, lead time, Incoterm.
 * Returns null (never a guess) when the text can't be read with certainty.
 */

export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;

export function parseIncoterm(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = new RegExp(`\\b(${INCOTERMS.join("|")})\\b`, "i").exec(text);
  return m ? m[1].toUpperCase() : null;
}

const ADVANCE = /\b(anticipat[oa]|advance|prepa(?:id|yment)|in advance|cash in advance|pagamento anticipato|pro[- ]?forma)\b/i;

/** "60 gg d.f.f.m." → 60 · "Payment: 30 days" → 30 · "Anticipato" → 0 · "30/60/90" → null */
export function parsePaymentTerms(text: string | number | null | undefined): number | null {
  if (text == null) return null;
  if (typeof text === "number") return Number.isInteger(text) && text >= 0 && text <= 365 ? text : null;
  const s = text.trim();
  if (!s) return null;
  if (ADVANCE.test(s)) return 0;
  if (/^\d{1,3}$/.test(s)) return Number(s);
  const days = [...s.matchAll(/(\d{1,3})\s*(?:gg|giorni|days?|dd|d\b)/gi)].map((m) => Number(m[1]));
  if (days.length === 1) return days[0];
  // Several instalments (30/60/90) or no days found: not a single number.
  return null;
}

/** "15 days" → 15 · "2 settimane" → 14 · "3-4 weeks" → 28 (upper bound) */
export function parseLeadTime(text: string | number | null | undefined): number | null {
  if (text == null) return null;
  if (typeof text === "number") return Number.isFinite(text) && text >= 0 ? Math.round(text) : null;
  const s = text.trim().toLowerCase();
  if (!s) return null;
  if (/^\d{1,3}$/.test(s)) return Number(s);
  const m = /(\d{1,3})(?:\s*[-–/a]\s*(\d{1,3}))?\s*(gg|giorni|days?|dd|settimane|settimana|sett|weeks?|wks?|mesi|mese|months?)/.exec(s);
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  const unit = m[3];
  if (/^(sett|week|wk)/.test(unit)) return n * 7;
  if (/^(mes|month)/.test(unit)) return n * 30;
  return n;
}
