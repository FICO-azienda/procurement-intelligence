/**
 * True landed cost of an offer: what its price becomes once the goods are at
 * the buyer's plant. The price, at a stated and dated exchange rate, plus
 * what the delivery terms leave to the buyer — transport, insurance, duty,
 * clearance, the last leg to the plant.
 *
 * Rules that must hold:
 *  - the delivery terms say what the price already includes, and nothing
 *    included is added a second time, whatever someone typed in;
 *  - a figure nobody gave is "missing": the cost is then incomplete and has no
 *    total. No freight, duty or exchange rate is ever made up;
 *  - every figure given says whether it is confirmed or an estimate, where it
 *    comes from and when; one estimate makes the total an estimate;
 *  - VAT is not in it: it is recovered, so it is not a cost of the goods.
 */
import { en, type Msg, type T } from "../i18n";
import { normalizeKey } from "../import/normalize/text";
import { parseIncoterm } from "../import/normalize/terms";

export const LANDED_KEYS = ["goods", "freight", "insurance", "duty", "clearance", "inland", "other"] as const;
export type LandedKey = (typeof LANDED_KEYS)[number];
/** What a person can state: everything but the price of the goods, which is the offer's. */
export const INPUT_KEYS = ["freight", "insurance", "duty", "clearance", "inland", "other"] as const;
export type InputKey = (typeof INPUT_KEYS)[number];

export const LANDED_LABEL: Record<LandedKey, Msg> = {
  goods: "Price of the goods",
  freight: "International transport",
  insurance: "Insurance",
  duty: "Customs duty",
  clearance: "Customs clearance",
  inland: "Transport to your plant",
  other: "Other costs to destination",
};

export type LandedStatus = "confirmed" | "estimated" | "missing" | "included" | "not_applicable";
export const LANDED_STATUS_LABEL: Record<LandedStatus, Msg> = {
  confirmed: "Confirmed|cost",
  estimated: "Estimated|cost",
  missing: "Missing",
  included: "Included in the price",
  not_applicable: "Does not apply",
};

export interface CostEntry {
  amount: number;
  /** unit: per unit of product · shipment: for the whole quantity quoted · percent: of the customs value (duty only). */
  per: "unit" | "shipment" | "percent";
  currency: string;
  status: "confirmed" | "estimated";
  source: string | null;
  date: string | null;
  note: string | null;
}

export interface FxEntry {
  /** EUR for one unit of the offer's currency. */
  rate: number;
  date: string;
  source: string;
  status: "confirmed" | "estimated";
}

export type LandedInput = { fx?: FxEntry } & Partial<Record<InputKey, CostEntry>>;

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const words = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** What is stored about an offer's costs, read back: an entry that is not whole — no amount, no status — is not an entry. */
export function readLandedInput(raw: unknown): LandedInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const out: LandedInput = {};
  const fx = o.fx;
  if (fx && typeof fx.rate === "number" && fx.rate > 0 && isDay(fx.date) && words(fx.source)) out.fx = { rate: fx.rate, date: fx.date, source: words(fx.source)!, status: fx.status === "confirmed" ? "confirmed" : "estimated" };
  for (const key of INPUT_KEYS) {
    const e = o[key];
    if (!e || typeof e.amount !== "number" || !Number.isFinite(e.amount) || e.amount < 0) continue;
    const per = e.per === "shipment" || e.per === "unit" ? e.per : e.per === "percent" && key === "duty" ? "percent" : null;
    if (!per) continue;
    out[key] = { amount: e.amount, per, currency: words(e.currency)?.toUpperCase() ?? "EUR", status: e.status === "confirmed" ? "confirmed" : "estimated", source: words(e.source), date: isDay(e.date) ? e.date : null, note: words(e.note) };
  }
  return out;
}

export interface LandedLine {
  key: LandedKey;
  status: LandedStatus;
  /** EUR per unit of product. Null: missing, or not computable from what is known. */
  perUnit: number | null;
  /** Why it is what it is, in words. */
  note: string;
  source: string | null;
  date: string | null;
}

export interface Landed {
  lines: LandedLine[];
  /** The exchange rate used. Null with a price in euro; `missing` when the price is in another currency and no dated rate was stated. */
  fx: { status: "confirmed" | "estimated" | "missing"; rate: number | null; date: string | null; source: string | null } | null;
  complete: boolean;
  missing: LandedKey[];
  /** EUR per unit, at the plant. Null while something is missing. */
  total: number | null;
  /**
   * What is known so far, when the cost is not whole: the sum of the lines with a figure, and the lines it leaves
   * out. A partial figure — never a cost to the plant, never set against the price paid. Null: whole, or nothing known.
   */
  partial: { perUnit: number; includes: LandedKey[]; excludes: LandedKey[] } | null;
  /** One figure in it is an estimate. */
  estimated: boolean;
}

/** Terms under which the seller pays the main transport, insures the goods, or delivers to the named place. */
const CARRIAGE_PAID = new Set(["CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]);
const INSURED = new Set(["CIF", "CIP"]);
const DELIVERED = new Set(["DAP", "DPU", "DDP"]);

export interface LandedContext {
  /** Whether buying from the supplier's country means customs. Null: a country is not known. */
  customs: boolean | null;
  /** The town of the buyer's delivery destination. Null: none is set. */
  destinationCity: string | null;
}

export function landedCost(offer: { unitPrice: number; currency: string; quantity: number | null; incoterm: string | null; destination: string | null }, input: LandedInput, ctx: LandedContext, t: T = en): Landed {
  const incoterm = parseIncoterm(offer.incoterm);
  const place = offer.destination ?? t("the place named in the offer");
  const foreign = offer.currency !== "EUR";
  const fx: Landed["fx"] = !foreign ? null : input.fx ? { status: input.fx.status, rate: input.fx.rate, date: input.fx.date, source: input.fx.source } : { status: "missing", rate: null, date: null, source: null };
  const rate = !foreign ? 1 : (input.fx?.rate ?? null);
  /** An amount in euro: its own when stated in euro, at the offer's rate when in the offer's currency — and unknown otherwise. */
  const eur = (amount: number, currency: string) => (currency === "EUR" ? amount : currency === offer.currency && rate != null ? amount * rate : null);
  const goods = rate != null ? offer.unitPrice * rate : null;

  const lines: LandedLine[] = [
    {
      key: "goods",
      status: goods == null ? "missing" : fx ? (fx.status as LandedStatus) : "confirmed",
      perUnit: goods,
      note: !foreign
        ? t("As quoted, in euro.")
        : goods == null
          ? t("Quoted in {currency}: no dated exchange rate was stated, so it is not converted.", { currency: offer.currency })
          : t("Quoted in {currency}, converted at {rate} of {date} ({source}).", { currency: offer.currency, rate: String(rate), date: fx!.date!, source: fx!.source! }),
      source: fx?.source ?? null,
      date: fx?.date ?? null,
    },
  ];

  const given = (key: InputKey, base?: number | null): { perUnit: number | null; why: string | null } => {
    const e = input[key];
    if (!e) return { perUnit: null, why: null };
    if (e.per === "percent") return base == null ? { perUnit: null, why: t("A percentage of the customs value, which is not known yet.") } : { perUnit: (base * e.amount) / 100, why: null };
    const amount = eur(e.amount, e.currency);
    if (amount == null) return { perUnit: null, why: t("Stated in {currency}: no dated exchange rate for it.", { currency: e.currency }) };
    if (e.per === "unit") return { perUnit: amount, why: null };
    return offer.quantity && offer.quantity > 0 ? { perUnit: amount / offer.quantity, why: null } : { perUnit: null, why: t("Stated for the whole shipment, and the offer does not say for what quantity.") };
  };
  const line = (key: InputKey, rule: { status: "included" | "not_applicable"; note: string } | null, missing: string, base?: number | null) => {
    const e = input[key];
    if (rule) {
      // Already in the price, or not due at all: what someone typed in is not added on top.
      lines.push({ key, status: rule.status, perUnit: 0, note: e ? `${rule.note} ${t("What was entered for it is not added again.")}` : rule.note, source: null, date: null });
      return;
    }
    const g = given(key, base);
    if (!e || g.perUnit == null) lines.push({ key, status: "missing", perUnit: null, note: g.why ?? missing, source: e?.source ?? null, date: e?.date ?? null });
    else lines.push({ key, status: e.status, perUnit: g.perUnit, note: e.note ?? (e.status === "confirmed" ? t("Stated as confirmed.") : t("An estimate: to be confirmed.")), source: e.source, date: e.date });
  };
  const value = (key: LandedKey) => lines.find((l) => l.key === key)?.perUnit ?? null;

  line(
    "freight",
    incoterm && CARRIAGE_PAID.has(incoterm) ? { status: "included", note: t("{incoterm}: the seller pays the transport to {place}.", { incoterm, place }) } : null,
    incoterm ? t("{incoterm}: the transport from {place} is not in the price.", { incoterm, place }) : t("Delivery terms not stated: it is not known whether transport is in the price."),
  );
  line(
    "insurance",
    incoterm && INSURED.has(incoterm)
      ? { status: "included", note: t("{incoterm}: insurance to {place} is in the price.", { incoterm, place }) }
      : incoterm && DELIVERED.has(incoterm)
        ? { status: "not_applicable", note: t("{incoterm}: the goods travel at the seller's risk to {place}.", { incoterm, place }) }
        : null,
    t("Not in the price: the goods travel at your risk."),
  );
  // Duty is charged on the value at the border: the goods, with transport and insurance to there.
  const customsValue = goods != null && value("freight") != null && value("insurance") != null ? goods + value("freight")! + value("insurance")! : null;
  const within = ctx.customs === false ? { status: "not_applicable" as const, note: t("Bought inside your customs area: no customs.") } : null;
  line("duty", within ?? (incoterm === "DDP" ? { status: "included", note: t("DDP: the seller pays the duty.") } : null), ctx.customs == null ? t("It is not known whether the goods cross customs: the supplier's country or yours is missing.") : t("From outside your customs area: the duty rate is to be stated — also when it is zero."), customsValue);
  line("clearance", within ?? (incoterm === "DDP" ? { status: "included", note: t("DDP: the seller clears the goods.") } : null), t("Clearing the goods through customs has a cost, to be stated."));

  const delivered = !!incoterm && DELIVERED.has(incoterm);
  const here = !!ctx.destinationCity && normalizeKey(offer.destination).includes(normalizeKey(ctx.destinationCity));
  line(
    "inland",
    delivered && here ? { status: "included", note: t("{incoterm}: delivered to {place}, your destination.", { incoterm: incoterm!, place }) } : null,
    !ctx.destinationCity
      ? t("No delivery destination is set: it cannot be told how far {place} is from your plant.", { place })
      : delivered
        ? t("Delivered to {place}, which is not your destination ({city}): the leg from there is missing.", { place, city: ctx.destinationCity })
        : t("From {place} to {city}: not in the price.", { place, city: ctx.destinationCity }),
  );
  const other = given("other");
  if (input.other && other.perUnit != null) lines.push({ key: "other", status: input.other.status, perUnit: other.perUnit, note: input.other.note ?? t("Stated as a further cost."), source: input.other.source, date: input.other.date });
  else lines.push({ key: "other", status: "not_applicable", perUnit: 0, note: t("None stated."), source: null, date: null });

  const missing = lines.filter((l) => l.perUnit == null).map((l) => l.key);
  const complete = missing.length === 0;
  const known = lines.filter((l) => l.perUnit != null && (l.status === "confirmed" || l.status === "estimated" || l.key === "goods"));
  return {
    lines,
    fx,
    complete,
    missing,
    total: complete ? lines.reduce((sum, l) => sum + (l.perUnit ?? 0), 0) : null,
    // Without the goods in euro there is nothing to add to: no partial figure either.
    partial: !complete && goods != null ? { perUnit: known.reduce((sum, l) => sum + l.perUnit!, 0), includes: lines.filter((l) => l.perUnit != null && l.status !== "not_applicable").map((l) => l.key), excludes: missing } : null,
    estimated: lines.some((l) => l.status === "estimated") || fx?.status === "estimated",
  };
}
