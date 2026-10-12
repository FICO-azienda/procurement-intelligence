/**
 * Reading a file of replies to requests for quotation.
 *
 * The file is what someone wrote down from the answers received — a person or
 * a session with access to the mailbox: one record per company asked, one line
 * per product quoted. It is read as written. A value that is not there stays
 * empty; a price with no currency, a line whose company the file does not
 * name, a status nobody can read are set aside with the reason, never guessed.
 * Every record is kept whole next to its reading (`original`).
 */
import { en, type T } from "../i18n";
import { normalizeCurrency } from "../import/normalize/currency";
import { parseDate } from "../import/normalize/dates";
import { parseNumber } from "../import/normalize/numbers";
import { parseIncoterm } from "../import/normalize/terms";
import { normalizeKey, productKey, tidy } from "../import/normalize/text";
import type { ReplyStatus } from "./types";

type Raw = Record<string, unknown>;

export interface FileCompany {
  /** The request's own reference in the file. */
  reference: string;
  name: string;
  country: string | null;
  address: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  companyType: string | null;
  categories: string[];
  status: ReplyStatus;
  statusText: string | null;
  products: string | null;
  offerSummary: string | null;
  moq: string | null;
  paymentTerms: string | null;
  leadTime: string | null;
  samples: string | null;
  missing: string | null;
  nextAction: string | null;
  priority: string | null;
  notes: string | null;
  /** Where the answer is (a link to the message), and what came with it. */
  sourceUrl: string | null;
  attachments: string | null;
  checkedAt: string | null;
  /** What had to be said about how the record was read. */
  warnings: string[];
  original: Raw;
}

export interface FileOffer {
  reference: string;
  key: string;
  productName: string;
  productCode: string | null;
  grade: string | null;
  category: string | null;
  unitPrice: number;
  currency: string;
  unit: string;
  quantity: number | null;
  moq: number | null;
  incoterm: string | null;
  destination: string | null;
  paymentTerms: string | null;
  offeredOn: string | null;
  validUntil: string | null;
  validity: string | null;
  specs: Record<string, string>;
  technicalStatus: string | null;
  missing: string | null;
  sourceUrl: string | null;
  original: Raw;
}

export interface Rejected {
  kind: "company" | "offer";
  name: string;
  reason: string;
}

export interface ReplyFile {
  snapshotDate: string | null;
  source: string | null;
  companies: FileCompany[];
  offers: FileOffer[];
  rejected: Rejected[];
  /** Written twice in the file, read once. */
  repeated: string[];
}

const text = (v: unknown): string | null => {
  if (v == null || typeof v === "object") return null;
  const s = tidy(String(v));
  return s ? s : null;
};
const isLink = (v: string | null) => !!v && /^https?:\/\//i.test(v);
const day = (v: unknown): string | null => {
  const s = text(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : parseDate(s);
};
const number = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = text(v);
  if (!s) return null;
  const parsed = parseNumber(s);
  return parsed.value != null && !parsed.ambiguous ? parsed.value : null;
};

const includes = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

/**
 * The status a record states, read from its own words. Refusals first: a
 * company that said no is "not suitable" whatever else the record says. A
 * record with priced lines and no readable status is "price received"; any
 * other record nobody can read has no status, and is set aside.
 */
export function readStatus(statusText: string | null, group: string | null, known: { excluded: boolean; priced: boolean }): ReplyStatus | null {
  const s = normalizeKey(`${statusText ?? ""} ${group ?? ""}`);
  if (known.excluded || includes(s, "rifiuto", "negativa", "declin", "refus", "not suitable", "non adatto", "escluso", "excluded")) return "not_suitable";
  if (includes(s, "prezzo ricevuto", "prezzi ricevuti", "preventivo ricevuto", "offerta ricevuta", "price received", "quote received")) return "quote_received";
  if (includes(s, "in attesa", "presa in carico", "awaiting", "waiting")) return "awaiting_reply";
  if (includes(s, "richiede", "needs", "requires", "da selezionare", "to select", "promesso", "promised", "da approfondire")) return "needs_information";
  if (includes(s, "validazione tecnica", "verifica tecnica", "technical validation")) return "technical_validation_required";
  return known.priced ? "quote_received" : null;
}

const addDays = (isoDay: string, days: number) => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Until when an offer holds: a date written alone, or a number of days from a
 * date ("7 days from 12/10/2026"). Anything else — "not stated", "two weeks" —
 * is no date: the words are kept, and nothing is assumed.
 */
export function readValidity(words: string | null): string | null {
  if (!words) return null;
  const span = /(\d{1,3})\s*(?:gg|giorni|days?)\b\D{0,24}(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i.exec(words);
  if (span) {
    const from = day(span[2]);
    return from ? addDays(from, Number(span[1])) : null;
  }
  return /^[\d./-]+$/.test(words.trim()) ? day(words) : null;
}

/** A VAT number or a tax id the notes state under their own label: read as an identifier, since two records with the same one are one company. */
function identifiers(notes: string | null): { vatNumber: string | null; taxCode: string | null } {
  const vat = /(?:p\.?\s*iva|partita iva|vat(?:\s*(?:no\.?|number|id))?)\s*(?:riportata|dichiarata|declared)?\s*:?\s*([A-Z]{2}\s?[0-9A-Z]{8,12})\b/i.exec(notes ?? "");
  const tax = /(?:tax id|codice fiscale|registration(?:\s*(?:no\.?|number))?)\s*(?:riportato|dichiarato|declared)?\s*:?\s*([0-9A-Z]{10,20})\b/i.exec(notes ?? "");
  return { vatNumber: vat ? vat[1].replace(/\s/g, "").toUpperCase() : null, taxCode: tax ? tax[1].toUpperCase() : null };
}

/** The identity of a quoted line inside its conversation: the same product, quantity, terms and price is the same line. */
export const offerKey = (o: Pick<FileOffer, "productName" | "grade" | "quantity" | "incoterm" | "destination" | "currency" | "unitPrice" | "unit">) =>
  [productKey(o.productName), normalizeKey(o.grade), o.quantity ?? "", o.incoterm ?? "", normalizeKey(o.destination), o.currency, o.unitPrice, o.unit].join("|");

function readCompany(raw: Raw, known: { excluded: boolean; priced: boolean; snapshotDate: string | null }, t: T): FileCompany | { error: string } {
  const reference = text(raw.supplier_id) ?? text(raw.reference);
  const name = text(raw.name);
  if (!name) return { error: t("no company name") };
  if (!reference) return { error: t("no reference for the request") };
  const warnings: string[] = [];

  let priority = text(raw.priority);
  let sourceUrl = text(raw.source_email_url) ?? text(raw.source_url) ?? text(raw.source);
  let notes = text(raw.notes);
  let importStatus = text(raw.import_status);
  let attachments = text(raw.attachments);
  // A record whose columns slid one place to the right: the link to the message stands under the notes, and each
  // field after "next action" holds its neighbour's value. They are read in their place; `original` keeps the record.
  if (!isLink(sourceUrl) && isLink(notes)) {
    const remark = priority;
    priority = sourceUrl;
    sourceUrl = notes;
    notes = [remark, importStatus].filter(Boolean).join(" ") || null;
    importStatus = attachments;
    attachments = null;
    warnings.push(t("Its fields are moved by one column in the file: the link to the message stood under the notes. They were read in their place; the record is kept as written."));
  }
  if (sourceUrl && !isLink(sourceUrl)) {
    notes = [notes, sourceUrl].filter(Boolean).join(" · ");
    sourceUrl = null;
  }

  const statusText = text(raw.status);
  const status = readStatus(statusText, text(raw.reply_group), known);
  if (!status) return { error: t("its status could not be read: «{status}»", { status: statusText ?? "—" }) };
  if (status === "quote_received" && !known.priced) warnings.push(t("Its status says a price was received, and the file has no priced line for it."));
  if (status !== "quote_received" && known.priced) warnings.push(t("The file has priced lines for it, and its status does not say a price was received."));
  if (status === "not_suitable" && raw.is_suitable_for_import_as_candidate === true)
    warnings.push(t("The file marks it both as excluded and as suitable to import: it is kept on file as not suitable, so that it is not asked again."));

  const categories = [...new Set((Array.isArray(raw.categories) ? raw.categories : [raw.category]).map(text).filter((c): c is string => !!c))];
  const ids = identifiers(notes);
  return {
    reference,
    name,
    country: text(raw.country),
    address: text(raw.address),
    website: text(raw.website),
    email: text(raw.email),
    phone: text(raw.phone),
    contactName: text(raw.contact) ?? text(raw.contact_name),
    vatNumber: text(raw.vat_number) ?? ids.vatNumber,
    taxCode: text(raw.tax_id) ?? text(raw.tax_code) ?? ids.taxCode,
    companyType: text(raw.supplier_type) ?? text(raw.company_type),
    categories,
    status,
    statusText,
    products: text(raw.products),
    offerSummary: text(raw.offer_summary),
    moq: text(raw.moq),
    paymentTerms: text(raw.payment_terms),
    leadTime: text(raw.lead_time_shipping) ?? text(raw.lead_time),
    samples: text(raw.samples),
    missing: text(raw.missing_data) ?? text(raw.missing),
    nextAction: text(raw.next_action),
    priority,
    notes: [notes, importStatus].filter(Boolean).join(" · ") || null,
    sourceUrl,
    attachments,
    checkedAt: day(raw.verified_at) ?? known.snapshotDate,
    warnings,
    original: raw,
  };
}

function readOffer(raw: Raw, t: T): FileOffer | { error: string } {
  const reference = text(raw.supplier_id) ?? text(raw.reference);
  const productName = text(raw.product) ?? text(raw.product_name) ?? text(raw.grade);
  if (!reference) return { error: t("the line does not say which company quoted it") };
  if (!productName) return { error: t("no product name") };
  const perKg = number(raw.price_per_kg);
  const unitPrice = perKg ?? number(raw.unit_price) ?? number(raw.price);
  if (unitPrice == null || unitPrice <= 0) return { error: t("no price that can be read") };
  const unit = perKg != null ? "kg" : text(raw.unit);
  if (!unit) return { error: t("the price does not say per what unit") };
  // A currency is never assumed: a price with none is not a price yet.
  const currency = normalizeCurrency(text(raw.currency));
  if (!currency) return { error: t("the price does not say its currency") };
  const specs: Record<string, string> = {};
  for (const [key, value] of [...Object.entries({ melting_point: raw.melting_point, oil_content: raw.oil_content, packaging: raw.packaging }), ...Object.entries((raw.specs as Raw | undefined) ?? {})]) {
    const v = text(value);
    if (v) specs[key] = v;
  }
  const validity = text(raw.validity) ?? text(raw.valid_until);
  const offer = {
    reference,
    productName,
    productCode: text(raw.product_code) ?? text(raw.code),
    grade: text(raw.grade),
    category: text(raw.category),
    unitPrice,
    currency,
    unit,
    quantity: number(raw.quantity_kg) ?? number(raw.quantity),
    moq: number(raw.moq),
    incoterm: parseIncoterm(text(raw.incoterm)),
    destination: text(raw.destination),
    paymentTerms: text(raw.payment) ?? text(raw.payment_terms),
    offeredOn: day(raw.date) ?? day(raw.offered_on),
    validUntil: readValidity(validity),
    validity,
    specs,
    technicalStatus: text(raw.technical_status),
    missing: text(raw.missing),
    sourceUrl: isLink(text(raw.source)) ? text(raw.source) : null,
    original: raw,
  };
  return { ...offer, key: offerKey(offer) };
}

/** A file of replies, read. An error only when it is not such a file at all. */
export function parseReplyFile(raw: string, t: T = en): { ok: true; file: ReplyFile } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: t("This is not a JSON file.") };
  }
  const root = json as { metadata?: Raw; suppliers?: unknown; quotations?: unknown; excluded?: unknown } | null;
  if (!root || typeof root !== "object" || !Array.isArray(root.suppliers)) return { ok: false, error: t("This file has no list of suppliers: it is not a file of replies to requests for quotation.") };
  const quotations = Array.isArray(root.quotations) ? (root.quotations as Raw[]) : [];
  const excluded = new Set((Array.isArray(root.excluded) ? root.excluded : []).map(text).filter(Boolean));
  const snapshotDate = day(root.metadata?.snapshot_date);
  const priced = new Set(quotations.map((q) => text(q?.supplier_id) ?? text(q?.reference)).filter(Boolean));

  const file: ReplyFile = { snapshotDate, source: text(root.metadata?.source), companies: [], offers: [], rejected: [], repeated: [] };
  const seen = new Set<string>();
  for (const entry of root.suppliers as Raw[]) {
    const label = text(entry?.name) ?? text(entry?.supplier_id) ?? "?";
    if (!entry || typeof entry !== "object") {
      file.rejected.push({ kind: "company", name: label, reason: t("not a record") });
      continue;
    }
    const reference = text(entry.supplier_id) ?? text(entry.reference) ?? "";
    const company = readCompany(entry, { excluded: excluded.has(reference), priced: priced.has(reference), snapshotDate }, t);
    if ("error" in company) file.rejected.push({ kind: "company", name: label, reason: company.error });
    else if (seen.has(company.reference)) file.repeated.push(`${company.name} (${company.reference})`);
    else {
      seen.add(company.reference);
      file.companies.push(company);
    }
  }

  const lines = new Set<string>();
  for (const entry of quotations) {
    const label = [text(entry?.supplier_id), text(entry?.product)].filter(Boolean).join(" · ") || "?";
    const offer = entry && typeof entry === "object" ? readOffer(entry, t) : { error: t("not a record") };
    if ("error" in offer) file.rejected.push({ kind: "offer", name: label, reason: offer.error });
    else if (!seen.has(offer.reference)) file.rejected.push({ kind: "offer", name: label, reason: t("the file has no company with the reference {reference}", { reference: offer.reference }) });
    else if (lines.has(`${offer.reference}|${offer.key}`)) file.repeated.push(label);
    else {
      lines.add(`${offer.reference}|${offer.key}`);
      file.offers.push(offer);
    }
  }
  return { ok: true, file };
}
