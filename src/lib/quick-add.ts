/**
 * Quick add: reads a purchase written the way people say it.
 *
 *   "Comprati 2000 kg di paraffina da ABC a 1,58€/kg il 28 settembre"
 *   "Bought 500 pcs glass jars from Rossi at 1.18 on 22/09"
 *
 * Rules, not a language model: the same sentence always reads the same way,
 * and what is not written stays empty instead of being guessed. The result is
 * a proposal the user reviews in the normal form — nothing is saved here.
 * A model can replace `parseQuickPurchase` later without touching the rest.
 */
import { normalizeCurrency } from "./import/normalize/currency";
import { normalizeUnit } from "./import/normalize/units";
import { parseNumber } from "./parse";

export interface QuickPurchase {
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  currency: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  supplierText: string | null;
  productText: string | null;
}

const NUM = String.raw`\d[\d.,]*\d|\d`;
const CUR = String.raw`€|\$|£|eur|euro|usd|gbp|chf`;
const UNIT_WORD = String.raw`[a-zà-ù²]+\.?`;

const MONTHS: Record<string, number> = {
  gen: 1, gennaio: 1, jan: 1, january: 1,
  feb: 2, febbraio: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  apr: 4, aprile: 4, april: 4,
  mag: 5, maggio: 5, may: 5,
  giu: 6, giugno: 6, jun: 6, june: 6,
  lug: 7, luglio: 7, jul: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, sett: 9, settembre: 9, sep: 9, sept: 9, september: 9,
  ott: 10, ottobre: 10, oct: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dic: 12, dicembre: 12, dec: 12, december: 12,
};

const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};

function shift(asOf: string, days: number) {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A date without a year is the most recent one that is not in the future. */
function withYear(asOf: string, month: number, day: number): string | null {
  const year = Number(asOf.slice(0, 4));
  const thisYear = iso(year, month, day);
  if (!thisYear) return null;
  return thisYear > shift(asOf, 7) ? iso(year - 1, month, day) : thisYear;
}

/** Cuts `m` out of the text, leaving a separator so words don't merge. */
function cut(text: string, m: RegExpExecArray) {
  return `${text.slice(0, m.index)} | ${text.slice(m.index + m[0].length)}`;
}

export function parseQuickPurchase(input: string, asOf: string): QuickPurchase {
  const out: QuickPurchase = { quantity: null, unit: null, unitPrice: null, currency: null, date: null, supplierText: null, productText: null };
  let text = ` ${input.replace(/\s+/g, " ").trim()} `;
  let m: RegExpExecArray | null;

  // ---- Date
  if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text))) {
    out.date = iso(Number(m[1]), Number(m[2]), Number(m[3]));
  } else if ((m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(text))) {
    const y = Number(m[3]);
    out.date = iso(y < 100 ? 2000 + y : y, Number(m[2]), Number(m[1]));
  } else if ((m = /\b(\d{1,2})[/-](\d{1,2})\b(?!\s*(?:€|\$|£))/.exec(text)) && Number(m[2]) <= 12 && Number(m[1]) <= 31) {
    out.date = withYear(asOf, Number(m[2]), Number(m[1]));
  } else if ((m = /\b(\d{1,2})°?\s+([a-zà-ù]{3,9})\.?(?:\s+(\d{4}))?\b/i.exec(text)) && MONTHS[m[2].toLowerCase()]) {
    out.date = m[3] ? iso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])) : withYear(asOf, MONTHS[m[2].toLowerCase()], Number(m[1]));
  } else if ((m = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i.exec(text)) && MONTHS[m[1].toLowerCase()]) {
    out.date = m[3] ? iso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])) : withYear(asOf, MONTHS[m[1].toLowerCase()], Number(m[2]));
  } else if ((m = /\b(oggi|today)\b/i.exec(text))) {
    out.date = asOf;
  } else if ((m = /\b(ieri|yesterday)\b/i.exec(text))) {
    out.date = shift(asOf, -1);
  }
  if (m && out.date) {
    // Drop the little word in front of the date too: "il 28 settembre", "on Sep 28".
    const before = /\s(il|l'|del|in data|on|the|dated)\s*$/i.exec(text.slice(0, m.index));
    text = cut(before ? text.slice(0, before.index) + " ".repeat(before[0].length) + text.slice(m.index) : text, m);
  }

  // ---- Price: a number with a currency, or after "a / at / @"
  const price =
    new RegExp(String.raw`(${CUR})\s*(${NUM})(?:\s*(?:/|al|a|per)\s*(${UNIT_WORD}))?`, "i").exec(text) ??
    new RegExp(String.raw`(${NUM})\s*(${CUR})(?![a-zà-ù])(?:\s*(?:/|al|a|per)\s*(${UNIT_WORD}))?`, "i").exec(text);
  if (price) {
    const symbolFirst = Number.isNaN(Number(price[1][0])) && !/\d/.test(price[1]);
    out.unitPrice = parseNumber(symbolFirst ? price[2] : price[1]);
    out.currency = normalizeCurrency(symbolFirst ? price[1] : price[2]);
    out.unit = normalizeUnit(price[3]?.replace(/\.$/, ""));
    text = cut(text.replace(/\s(a|at|@|per|for)\s*$/i, " "), price);
    const lead = /\s(a|at|@|per|for)\s*\|/i.exec(text);
    if (lead) text = text.replace(lead[0], " |");
  } else if ((m = new RegExp(String.raw`\s(?:a|at|@)\s*(${NUM})(?:\s*(?:/|al|per)\s*(${UNIT_WORD}))?(?=\s)`, "i").exec(text))) {
    out.unitPrice = parseNumber(m[1]);
    out.unit = normalizeUnit(m[2]?.replace(/\.$/, ""));
    text = cut(text, m);
  }

  // ---- Quantity: a number followed by a unit, otherwise the first number left
  const qty = new RegExp(String.raw`(${NUM})\s*(${UNIT_WORD})(?=[\s|])`, "gi");
  for (let q = qty.exec(text); q; q = qty.exec(text)) {
    const unit = normalizeUnit(q[2].replace(/\.$/, ""));
    if (!unit) continue;
    out.quantity = parseNumber(q[1]);
    out.unit = unit;
    text = cut(text, q);
    break;
  }
  if (out.quantity == null && (m = new RegExp(String.raw`(?<![\w/])(${NUM})(?![\w/])`).exec(text))) {
    out.quantity = parseNumber(m[1]);
    text = cut(text, m);
  }

  // ---- Supplier: what follows "da / from"
  if ((m = /\s(?:da|dal|dalla|dall'|presso|from)\s+([^|]+?)(?=\s*\||\s+(?:a|at|per|il|on|di|of)\s|\s*$)/i.exec(text))) {
    out.supplierText = m[1].trim() || null;
    text = cut(text, m);
  }

  // ---- Product: what follows "di / of", otherwise the words that are left
  const VERBS = /\b(comprat[oiae]|acquistat[oiae]|ordinat[oiae]|pres[oiae]|ricevut[oiae]|ho|abbiamo|bought|purchased|ordered|received|we|i)\b/gi;
  let rest = text.replace(VERBS, " ");
  if ((m = /\|\s*(?:di|d'|of)\s+([^|]+)/i.exec(rest)) || (m = /^\s*(?:di|d'|of)\s+([^|]+)/i.exec(rest))) {
    out.productText = m[1].trim() || null;
  } else {
    rest = rest
      .split("|")
      .map((s) => s.replace(/^\s*(?:di|d'|of|a|at|il|on|per)\s+/i, "").trim())
      .filter((s) => s.length > 1 && /[a-zà-ù]/i.test(s))
      .sort((a, b) => b.length - a.length)[0];
    out.productText = rest ?? null;
  }
  return out;
}
