/**
 * A supplier's answer to a request for quotation, read from the text of its
 * email: the price, its currency and unit, the minimum order, the lead time,
 * the delivery and payment terms, how long the offer holds. So that an
 * answer becomes a quote on file, not a paragraph lost in a mailbox.
 *
 * It reads what is written and nothing more. A value that could be read two
 * ways — several prices, no unit — is left for the user, with what was found;
 * every value says which sentence it came from, and the user confirms before
 * anything is saved.
 */
import { currencyInText, normalizeCurrency } from "../import/normalize/currency";
import { findDate } from "../import/normalize/dates";
import { parseNumber } from "../import/normalize/numbers";
import { parseIncoterm, parseLeadTime, parsePaymentTerms } from "../import/normalize/terms";
import { conversionFactor, normalizeUnit } from "../import/normalize/units";
import type { Msg } from "../i18n";

export type ReplyField = "price" | "moq" | "leadTime" | "incoterm" | "payment" | "validity";

export interface ReplyReading {
  /** Per unit of the product, in `currency`. Null: not found, or found in more than one way. */
  price: number | null;
  currency: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  paymentTermsDays: number | null;
  validUntil: string | null;
  /** The sentence each value was read from. */
  from: Partial<Record<ReplyField, string>>;
  /** What the user has to settle, each with the words it is about. */
  doubts: { message: Msg; detail: string }[];
  /** Sentences about transport, samples and technical matters: kept as they are written. */
  notes: string[];
}

const NUM = String.raw`(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?!\d)`;
const CUR = String.raw`€|eur(?:o|os)?|usd|us\$|\$|gbp|£|chf|pln`;
const UNIT = String.raw`[a-zA-Z²³]{1,12}`;
const PRICE = new RegExp(String.raw`(?:(${CUR})\s*(${NUM})|(${NUM})\s*(${CUR}))(?:\s*(?:/|per|al|alla|a|je|pro)\s*(${UNIT}))?`, "gi");
const MOQ = new RegExp(String.raw`(?:moq|minimum order(?: quantity)?|min\.? order|ordine minimo|quantit[aà] minima|minimo d'ordine|mindest(?:bestell)?menge)[^\d\n]{0,25}(${NUM})\s*(${UNIT})?`, "i");
const LEAD = /(lead[- ]?time|delivery time|delivery within|delivered within|ready in|tempi? di consegna|consegna (?:in|entro)|lieferzeit)/i;
const PAY = /(payment|pagamento|zahlung)/i;
const VALID = /(valid until|valid for|validity|offer is valid|valid[ao] fino|validit[aà]|valid[ao] \d|g[uü]ltig)/i;
const OTHER = /(freight|transport|shipping|trasporto|spedizione|sample|campion|datasheet|data sheet|scheda tecnica|certificat|pallet|packag|imball)/i;

const sentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.;!?])\s+(?=[A-ZÀ-Ý])/))
    .map((s) => s.trim())
    .filter(Boolean);

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function readReply(text: string, ctx: { unit: string; today: string }): ReplyReading {
  const out: ReplyReading = { price: null, currency: null, moq: null, leadTimeDays: null, incoterm: null, paymentTermsDays: null, validUntil: null, from: {}, doubts: [], notes: [] };
  const all = sentences(text);
  const sentenceOf = (index: number) => all.find((s) => text.indexOf(s) <= index && index < text.indexOf(s) + s.length) ?? text.slice(Math.max(0, index - 40), index + 60).trim();

  // ---- Price: a number next to a currency, with its unit when it has one.
  const prices: { perUnit: number | null; written: string; currency: string | null; at: number; unitRead: boolean }[] = [];
  // "1.420" is one thousand four hundred and twenty, or one point four two: not ours to decide.
  const unclear: string[] = [];
  for (const m of text.matchAll(PRICE)) {
    const number = parseNumber(m[2] ?? m[3]);
    if (number.ambiguous) unclear.push(m[0].trim());
    if (number.value == null || number.ambiguous) continue;
    const unit = m[5] ? normalizeUnit(m[5]) : null;
    // A unit that is not one ("EUR 1,45 for…") is no unit at all.
    const factor = unit ? (unit === ctx.unit ? 1 : conversionFactor(unit, ctx.unit)) : null;
    prices.push({ perUnit: unit ? (factor ? number.value / factor : null) : number.value, written: m[0].trim(), currency: normalizeCurrency(m[1] ?? m[4]) ?? currencyInText(m[1] ?? m[4]), at: m.index ?? 0, unitRead: !!unit });
  }
  const withUnit = prices.filter((p) => p.unitRead);
  const pool = withUnit.length ? withUnit : prices;
  const distinct = [...new Set(pool.map((p) => p.perUnit))];
  if (pool.length && distinct.length === 1 && distinct[0] != null) {
    const p = pool[0];
    out.price = Number(p.perUnit!.toFixed(6));
    out.currency = p.currency;
    out.from.price = sentenceOf(p.at);
    if (!p.unitRead) out.doubts.push({ message: "No unit next to the price: check that it is per {unit}.", detail: p.written });
  } else if (pool.length) {
    out.currency = pool[0].currency;
    out.doubts.push({ message: pool.some((p) => p.perUnit == null) ? "The price is in a unit that can't be converted to yours: write it per {unit}." : "Several prices in the text: write the one that applies to your quantity.", detail: pool.map((p) => p.written).join(" · ") });
  }

  if (out.price == null && unclear.length) out.doubts.push({ message: "A price that can be read two ways (thousands or decimals): write it per {unit}.", detail: unclear.join(" · ") });

  // ---- Minimum order.
  const moq = MOQ.exec(text);
  if (moq) {
    const n = parseNumber(moq[1]);
    const unit = moq[2] ? normalizeUnit(moq[2]) : null;
    const factor = unit ? (unit === ctx.unit ? 1 : conversionFactor(unit, ctx.unit)) : 1;
    if (n.value != null && !n.ambiguous && factor) {
      out.moq = n.value * factor;
      out.from.moq = sentenceOf(moq.index);
    } else out.doubts.push({ message: "The minimum order could not be read with certainty.", detail: moq[0] });
  }

  // ---- Terms, each from the sentence that names it.
  for (const s of all) {
    if (out.leadTimeDays == null && LEAD.test(s)) {
      const days = parseLeadTime(s.slice(s.search(LEAD)));
      if (days != null) [out.leadTimeDays, out.from.leadTime] = [days, s];
    }
    if (out.paymentTermsDays == null && PAY.test(s)) {
      const days = parsePaymentTerms(s.slice(s.search(PAY)));
      if (days != null) [out.paymentTermsDays, out.from.payment] = [days, s];
    }
    if (out.validUntil == null && VALID.test(s)) {
      const date = findDate(s);
      const days = /(\d{1,3})\s*(?:gg|giorni|days?|tage)/i.exec(s);
      const until = date ?? (days ? addDays(ctx.today, Number(days[1])) : null);
      if (until) [out.validUntil, out.from.validity] = [until, s];
    }
    if (OTHER.test(s) && out.notes.length < 6) out.notes.push(s);
  }
  out.incoterm = parseIncoterm(text);
  if (out.incoterm) out.from.incoterm = all.find((s) => new RegExp(`\\b${out.incoterm}\\b`, "i").test(s)) ?? out.incoterm;
  return out;
}
