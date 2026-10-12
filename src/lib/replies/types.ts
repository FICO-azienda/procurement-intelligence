/**
 * Replies to requests for quotation: the companies that answered, what each
 * said, and where each conversation stands.
 *
 * Three things are kept apart here, because a reply mixes them up easily:
 * the company (who it is), the conversation (one request, with its status),
 * and the offers (one line per product quoted, as the company quoted it).
 * A price received is not a quotation one can order from: every offer says
 * whether anyone has verified that the product is the buyer's.
 */
import { en, type Msg, type T } from "../i18n";
import { parseIncoterm } from "../import/normalize/terms";

/** Where a conversation stands. No workflow: any status can follow any other. */
export const REPLY_STATUSES = ["quote_received", "needs_information", "awaiting_reply", "technical_validation_required", "not_suitable"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];
export const isReplyStatus = (v: unknown): v is ReplyStatus => typeof v === "string" && (REPLY_STATUSES as readonly string[]).includes(v);

export const REPLY_STATUS_LABEL: Record<ReplyStatus, Msg> = {
  quote_received: "Price received",
  needs_information: "Needs information",
  awaiting_reply: "Awaiting reply",
  technical_validation_required: "Technical validation required",
  not_suitable: "Not suitable",
};

export const REPLY_STATUS_MEANING: Record<ReplyStatus, Msg> = {
  quote_received: "It stated real prices. A price received is not a final quotation: each offer still has to be checked.",
  needs_information: "It answered, and something more is needed before it can quote: a specification, a choice of articles, quantities.",
  awaiting_reply: "Its commercial answer has not come yet.",
  technical_validation_required: "Nobody has verified yet that its product is the one you buy.",
  not_suitable: "It said it cannot supply the product, or not on the conditions asked.",
};

/** Whether someone verified that the product offered is the buyer's. A file never says "validated" by itself. */
export const VALIDATIONS = ["required", "validated", "not_equivalent"] as const;
export type Validation = (typeof VALIDATIONS)[number];
export const isValidation = (v: unknown): v is Validation => typeof v === "string" && (VALIDATIONS as readonly string[]).includes(v);
export const VALIDATION_LABEL: Record<Validation, Msg> = {
  required: "Technical validation required",
  validated: "Technically validated",
  not_equivalent: "Not the same product",
};

export const MESSAGE_KINDS = ["reply", "sent", "note"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export const isMessageKind = (v: unknown): v is MessageKind => typeof v === "string" && (MESSAGE_KINDS as readonly string[]).includes(v);
export const MESSAGE_KIND_LABEL: Record<MessageKind, Msg> = { reply: "Reply received", sent: "Message sent", note: "Note|history" };

/** The specifications a file may state for an offer; any other is shown under the name the file gives it. */
export const SPEC_LABEL: Record<string, Msg> = { melting_point: "Melting point", oil_content: "Oil content", packaging: "Packaging" };

export interface ReplyCompany {
  id: string;
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
  confirmed: string[];
  checkedAt: string | null;
  sourceFile: string | null;
}

export interface ReplyOffer {
  id: string;
  threadId: string;
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
  validation: Validation;
  technicalStatus: string | null;
  missing: string | null;
  sourceUrl: string | null;
  sourceDocument: string | null;
}

export interface ReplyMessage {
  id: string;
  threadId: string;
  key: string;
  date: string;
  kind: MessageKind;
  status: ReplyStatus | null;
  summary: string | null;
  reference: string | null;
  attachments: string | null;
  source: "file" | "manual";
}

export interface ReplyThread {
  id: string;
  supplierId: string;
  reference: string | null;
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
  confirmed: string[];
  checkedAt: string | null;
  sourceFile: string | null;
  offers: ReplyOffer[];
  messages: ReplyMessage[];
}

/** The fields of a company and of a conversation a file may fill in, and a person may correct. */
export const COMPANY_FIELDS = ["name", "country", "address", "website", "email", "phone", "contactName", "vatNumber", "taxCode", "companyType"] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];
export const THREAD_FIELDS = ["status", "statusText", "products", "offerSummary", "moq", "paymentTerms", "leadTime", "samples", "missing", "nextAction", "priority", "notes"] as const;
export type ThreadField = (typeof THREAD_FIELDS)[number];

export const FIELD_LABEL: Record<CompanyField | ThreadField | "categories", Msg> = {
  name: "Company",
  country: "Country",
  address: "Address",
  website: "Website",
  email: "Email",
  phone: "Phone",
  contactName: "Contact name",
  vatNumber: "VAT number",
  taxCode: "Tax code",
  companyType: "What it says it is",
  status: "Status",
  statusText: "Status, as written",
  products: "Products declared",
  offerSummary: "What it offered",
  moq: "Minimum order",
  paymentTerms: "Payment terms",
  leadTime: "Delivery and shipping",
  samples: "Samples",
  missing: "Still missing",
  nextAction: "Next action",
  priority: "Priority",
  notes: "Notes",
  categories: "Categories",
};

/** The statuses a conversation's offers add to its own: a price received whose product nobody verified is both. */
export function statusesOf(thread: Pick<ReplyThread, "status" | "offers">): ReplyStatus[] {
  const pending = thread.offers.some((o) => o.validation === "required");
  return pending && thread.status !== "technical_validation_required" ? [thread.status, "technical_validation_required"] : [thread.status];
}

/** How far the seller carries the goods for the price it quoted. */
export type FreightScope = "not_included" | "to_named_place" | "delivered" | "unknown";

/**
 * What a price includes, read from its delivery terms alone — and what it does
 * not. Nothing is converted: a price quoted to a port is not a price delivered
 * to the plant, and is never shown as one.
 */
export function deliveryOf(incotermText: string | null, destination: string | null, t: T = en): { incoterm: string | null; scope: FreightScope; label: string; text: string } {
  const incoterm = parseIncoterm(incotermText);
  const place = destination ?? t("the place named in the offer");
  switch (incoterm) {
    case "EXW":
      return { incoterm, scope: "not_included", label: t("Transport not included"), text: t("Ex works: collected at the seller's. No transport is in the price.") };
    case "FCA":
      return { incoterm, scope: "not_included", label: t("Transport not included"), text: t("Handed to the carrier in {place}. Transport from there, customs and delivery are not in the price.", { place }) };
    case "FAS":
    case "FOB":
      return { incoterm, scope: "not_included", label: t("Transport not included"), text: t("Loaded on the ship in {place}. Sea freight, insurance, customs and delivery are not in the price.", { place }) };
    case "CFR":
    case "CPT":
      return { incoterm, scope: "to_named_place", label: t("Freight included to {place}", { place }), text: t("Freight to {place} is in the price. Insurance, unloading, customs and the delivery from there to you are not.", { place }) };
    case "CIF":
    case "CIP":
      return { incoterm, scope: "to_named_place", label: t("Freight included to {place}", { place }), text: t("Freight and insurance to {place} are in the price. Unloading, customs and the delivery from there to you are not.", { place }) };
    case "DAP":
    case "DPU":
      return { incoterm, scope: "delivered", label: t("Delivered to {place}", { place }), text: t("Delivered to {place}. Import duties and taxes are not in the price.", { place }) };
    case "DDP":
      return { incoterm, scope: "delivered", label: t("Delivered to {place}", { place }), text: t("Delivered to {place}, duties paid.", { place }) };
    default:
      return { incoterm: null, scope: "unknown", label: t("Delivery terms not stated"), text: t("Delivery terms not stated: it is not known whether transport is in the price.") };
  }
}

/** Whether an offer still holds on a day: it does until its last day included; with no date, nobody knows. */
export function validityOf(validUntil: string | null, today: string): "open" | "expired" | "unknown" {
  if (!validUntil) return "unknown";
  return validUntil >= today ? "open" : "expired";
}

/** The order to work in, read from the priority as written: what is urgent first, what nobody ranked last. */
export function priorityRank(priority: string | null): number {
  const p = (priority ?? "").toLowerCase();
  if (/urgen/.test(p)) return 0;
  if (/\b(alta|high)\b/.test(p)) return 1;
  if (/\b(media|medium)\b/.test(p)) return 2;
  if (/\b(bassa|low)\b/.test(p)) return 3;
  return 4;
}
