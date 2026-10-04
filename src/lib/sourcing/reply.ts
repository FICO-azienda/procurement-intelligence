/**
 * A supplier's answer to a request for quotation, read from the text of its
 * email: the price, its currency and unit, the minimum order, the lead time,
 * the delivery and payment terms, the transport cost, how long the offer
 * holds. So that an answer becomes a quote on file, not a paragraph lost in
 * a mailbox.
 *
 * It reads what is written and nothing more. "1.420 €/t" is one thousand
 * four hundred and twenty a tonne or one point four two: it is settled only
 * when what the company pays today makes one of the two absurd — otherwise
 * it is left for the user. Several prices that can't be told apart, a price
 * with no unit: left empty, with the words found. Every value says which
 * sentence it came from, and the user confirms before anything is saved.
 */
import { currencyInText, normalizeCurrency } from "../import/normalize/currency";
import { findDate } from "../import/normalize/dates";
import { parseNumber } from "../import/normalize/numbers";
import { normalizeKey } from "../import/normalize/text";
import { parseIncoterm, parseLeadTime, parsePaymentTerms } from "../import/normalize/terms";
import { UNITS, conversionFactor, normalizeUnit } from "../import/normalize/units";
import type { Msg } from "../i18n";

export type ReplyField = "price" | "moq" | "leadTime" | "incoterm" | "payment" | "validity" | "freight";

export interface ReplyReading {
  /** Per unit of the product, in `currency`. Null: not found, or found in more than one way. */
  price: number | null;
  currency: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  paymentTermsDays: number | null;
  validUntil: string | null;
  /** Transport, per unit of the product, in the price's currency — when the answer states it per unit. */
  freightPerUnit: number | null;
  /** The sentence each value was read from. */
  from: Partial<Record<ReplyField, string>>;
  /** What the user has to settle, each with the words it is about. */
  doubts: { message: Msg; detail: string }[];
  /** Sentences about transport, samples and technical matters: kept as they are written. */
  notes: string[];
}

export interface ReplyContext {
  unit: string;
  today: string;
  /** What is paid today per unit, in EUR: the only thing that can tell "1.420" from "1420" — and only when one of the two is absurd. */
  anchor?: number | null;
}

const NUM = String.raw`(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?!\d)`;
const CUR = String.raw`€|eur(?:o|os)?|usd|us\$|\$|gbp|£|chf|pln`;
const UNIT = String.raw`[a-zA-Z²³]{1,12}`;
const PRICE = new RegExp(String.raw`(?:(${CUR})\s*(${NUM})|(${NUM})\s*(${CUR}))(?:\s*(?:/|per|al|alla|a|je|pro)\s*(${UNIT}))?`, "gi");
const MOQ = new RegExp(String.raw`(?:moq|minimum order(?: quantity)?|min\.? order|ordine minimo|quantit[aà] minima|minimo d'ordine|mindest(?:bestell)?menge)[^\d\n]{0,25}(${NUM})\s*(${UNIT})?`, "i");
const LEAD = /(lead[- ]?time|delivery time|delivery within|delivered within|ready in|tempi? di consegna|consegna (?:in|entro)|lieferzeit)/i;
const PAY = /(payment|pagamento|zahlung)/i;
const VALID = /(valid until|valid for|validity|offer is valid|valid[ao] fino|validit[aà]|valid[ao] \d|g[uü]ltig)/i;
const FREIGHT = /(freight|transport|delivery charge|delivery cost|shipping|carriage|trasporto|spedizione|fracht)/i;
const OTHER = /(freight|transport|shipping|trasporto|spedizione|sample|campion|datasheet|data sheet|scheda tecnica|certificat|pallet|packag|imball)/i;
/** How far from today's price a reading can be and still be believed: wide, to leave room for a real difference and for another currency. */
const PLAUSIBLE = 5;

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

const isMass = (unit: string) => UNITS.find((u) => u.code === unit)?.dimension === "mass";
/** The unit next to a price. "MT" is a metric tonne when the product is bought by weight — not metres. */
function unitOf(raw: string | undefined, productUnit: string): string | null {
  if (!raw) return null;
  if (/^(mt|to|tonn?e?s?)$/i.test(raw) && isMass(productUnit)) return "t";
  return normalizeUnit(raw);
}

/** The ways a written number can be read: one, or two when a single separator is followed by exactly three digits. */
function readings(raw: string): number[] {
  if (/^\d{1,3}[.,]\d{3}$/.test(raw)) return [Number(raw.replace(/[.,]/g, "")), Number(raw.replace(",", "."))];
  const n = parseNumber(raw);
  return n.value != null && !n.ambiguous ? [n.value] : [];
}

interface Found {
  perUnit: number | null;
  written: string;
  currency: string | null;
  at: number;
  unitRead: boolean;
  unclear: boolean;
  freight: boolean;
}

export function readReply(text: string, ctx: ReplyContext): ReplyReading {
  const out: ReplyReading = { price: null, currency: null, moq: null, leadTimeDays: null, incoterm: null, paymentTermsDays: null, validUntil: null, freightPerUnit: null, from: {}, doubts: [], notes: [] };
  const all = sentences(text);
  const sentenceOf = (index: number) => all.find((s) => text.indexOf(s) <= index && index < text.indexOf(s) + s.length) ?? text.slice(Math.max(0, index - 40), index + 60).trim();

  // ---- Every amount of money in the text, with its unit when it has one.
  const found: Found[] = [];
  for (const m of text.matchAll(PRICE)) {
    const at = m.index ?? 0;
    const unit = unitOf(m[5], ctx.unit);
    const factor = unit ? (unit === ctx.unit ? 1 : conversionFactor(unit, ctx.unit)) : 1;
    const values = readings(m[2] ?? m[3]).map((v) => (factor ? v / factor : null));
    // Two readings: today's price settles it only when it makes exactly one of them believable.
    const believable = ctx.anchor ? values.filter((v) => v != null && v >= ctx.anchor! / PLAUSIBLE && v <= ctx.anchor! * PLAUSIBLE) : [];
    const value = values.length === 1 ? values[0] : believable.length === 1 ? believable[0] : null;
    // Transport is not the product's price: the words just before the amount say which it is.
    const before = text.slice(Math.max(0, at - 45), at);
    const lead = before.slice(Math.max(before.lastIndexOf("\n"), before.lastIndexOf(". "), before.lastIndexOf(";")) + 1);
    found.push({ perUnit: value, written: m[0].trim(), currency: normalizeCurrency(m[1] ?? m[4]) ?? currencyInText(m[1] ?? m[4]), at, unitRead: !!unit, unclear: values.length !== 1 && value == null, freight: FREIGHT.test(lead) });
  }

  // ---- The product's price.
  const prices = found.filter((p) => !p.freight);
  const withUnit = prices.filter((p) => p.unitRead);
  const pool = withUnit.length ? withUnit : prices;
  const distinct = [...new Set(pool.map((p) => (p.unclear ? `?${p.written}` : p.perUnit)))];
  if (pool.length && distinct.length === 1 && pool[0].perUnit != null) {
    const p = pool[0];
    out.price = Number(p.perUnit!.toFixed(6));
    out.currency = p.currency;
    out.from.price = sentenceOf(p.at);
    if (!p.unitRead) out.doubts.push({ message: "No unit next to the price: check that it is per {unit}.", detail: p.written });
  } else if (pool.length) {
    out.currency = pool[0].currency;
    const detail = pool.map((p) => p.written).join(" · ");
    out.doubts.push(
      pool.length === 1 && pool[0].unclear
        ? { message: "A price that can be read two ways (thousands or decimals): write it per {unit}.", detail }
        : pool.some((p) => !p.unclear && p.perUnit == null)
          ? { message: "The price is in a unit that can't be converted to yours: write it per {unit}.", detail }
          : { message: "Several prices in the text: write the one that applies to your quantity.", detail },
    );
  }

  // ---- Transport, when the answer states it per unit: kept apart from the price.
  const freight = found.filter((p) => p.freight);
  if (freight.length === 1 && freight[0].unitRead && freight[0].perUnit != null && (!out.currency || freight[0].currency === out.currency)) {
    out.freightPerUnit = Number(freight[0].perUnit.toFixed(6));
    out.from.freight = sentenceOf(freight[0].at);
  } else if (freight.length) out.doubts.push({ message: "A transport cost is mentioned, but not per {unit}: add it to the true cost yourself.", detail: freight.map((p) => p.written).join(" · ") });

  // ---- Minimum order.
  const moq = MOQ.exec(text);
  if (moq) {
    const n = parseNumber(moq[1]);
    const unit = unitOf(moq[2], ctx.unit);
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

/** How a product can be recognised in an answer: the words and figures of its neutral name, and its line number in the request. */
export interface ReplyProduct {
  id: string;
  name: string;
  /** Its position in the request sent, from 1. */
  line?: number | null;
}

const tokensOf = (name: string) =>
  normalizeKey(name)
    .split(" ")
    .filter((w) => w.length >= 3 || /\d/.test(w));

/**
 * An answer to a request with several products: each line that carries a
 * price is given to the product it names — by its words, or by its number in
 * the request. A priced line that names none, or more than one, is not
 * guessed: every product it could belong to gets it as a doubt.
 */
export function readReplyFor(text: string, product: ReplyProduct, others: ReplyProduct[], ctx: ReplyContext): ReplyReading {
  if (!others.length) return readReply(text, ctx);
  const all = [product, ...others];
  // What tells one product from the others: words the others don't share.
  const own = (p: ReplyProduct) => tokensOf(p.name).filter((w) => all.filter((x) => tokensOf(x.name).includes(w)).length === 1);
  const mine: string[] = [];
  const unassigned: string[] = [];
  for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    // The figures of a price are not the figures of a name: "1,52 €/kg" does not name "paraffin 52/54".
    const key = ` ${normalizeKey(line.replace(PRICE, " "))} `;
    const numbered = /^\s*(\d{1,2})[.)]\s/.exec(line)?.[1];
    const byNumber = numbered != null ? all.filter((p) => p.line != null && Number(numbered) === p.line) : [];
    const named = byNumber.length === 1 ? byNumber : all.filter((p) => own(p).some((w) => key.includes(` ${w} `)));
    const priced = [...line.matchAll(PRICE)].length > 0;
    if (named.length === 1) {
      if (named[0].id === product.id) mine.push(line);
    } else if (!priced || FREIGHT.test(line.replace(PRICE, " "))) mine.push(line); // Terms and transport are for every product of the answer.
    else unassigned.push(line);
  }
  const reading = readReply(mine.join("\n"), ctx);
  if (reading.price == null && unassigned.length) reading.doubts.push({ message: "The answer covers several products and it is not clear which price is this one's: write it per {unit}.", detail: unassigned.join(" · ").slice(0, 240) });
  return reading;
}
