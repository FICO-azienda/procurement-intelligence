/**
 * Direct Order: a private channel for orders between a buyer and a supplier
 * that registered on the platform. The buyer asks for a quantity of an article
 * at the conditions the supplier confirmed; the supplier accepts, proposes
 * changes or declines.
 *
 * Things kept apart here:
 *  - a company the buyer knows (a supplier on its invoices, a company that
 *    answered a request for quotation) is not a registered company: an
 *    organisation exists only when a person of that company accepted an
 *    invitation;
 *  - "Order Ready" is a state worked out from facts (lib/orders/ready.ts), not
 *    a badge: it says nothing about how reliable a supplier is, and it cannot
 *    be bought;
 *  - a request is not an order, and an order is not a purchase: it is
 *    confirmed only when both companies said yes to the same conditions, and a
 *    purchase is still what an invoice proves.
 */
import type { Msg } from "../i18n";

export const ORDER_CONFIG = {
  /** Days a request waits for the other company before it lapses. */
  requestExpiryDays: 14,
  /** Days an invitation can be accepted. */
  inviteDays: 30,
  sessionDays: 14,
  emailCodeMinutes: 30,
  emailCodeAttempts: 5,
  passwordMin: 10,
  /** Words that name and technical description must put together before an article is precise enough to be ordered. */
  minIdentityWords: 4,
};

/** The conditions of the order service a supplier accepts once (lib/orders/conditions.ts). */
export const ORDER_TERMS_VERSION = "pilot-draft-1";

// ---------------- Who ----------------

export const SIDES = ["buyer", "supplier"] as const;
export type Side = (typeof SIDES)[number];

/**
 * What a person may do. Reading the workspace needs only a session: a member
 * with no permission at all is someone who looks and changes nothing. Every
 * write of the workspace names one of these (server/guard.ts).
 */
export const PERMISSIONS = {
  buyer: ["data.edit", "data.import", "sourcing.manage", "decision.make", "data.export", "order.send", "channel.manage", "company.manage"],
  supplier: ["order.respond", "terms.edit", "company.manage"],
} as const;
export type Permission = (typeof PERMISSIONS)[Side][number];
export const isPermission = (v: unknown): v is Permission => typeof v === "string" && ([...PERMISSIONS.buyer, ...PERMISSIONS.supplier] as string[]).includes(v);

export const PERMISSION_LABEL: Record<Permission, Msg> = {
  "data.edit": "Change products, suppliers, purchases and the catalogue",
  "data.import": "Import files and confirm what they bring",
  "sourcing.manage": "Research suppliers, record requests, replies and offers",
  "decision.make": "Take purchasing decisions",
  "data.export": "Download exports of the data",
  "order.send": "Send, cancel and confirm orders",
  "channel.manage": "Invite suppliers and tie their articles to products",
  "order.respond": "Accept, change and decline orders",
  "terms.edit": "Change articles, prices and conditions",
  "company.manage": "Change the company's data and its people",
};

/**
 * A person's role in a company. An admin may do everything the company's side
 * can do, today and when something is added; a member, what was given to them
 * one by one. There is no role above the companies: nobody administers the
 * platform from inside the app yet.
 */
export const ROLES = ["admin", "member"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Side, Record<Role, Msg>> = {
  buyer: { admin: "Buyer admin", member: "Buyer member" },
  supplier: { admin: "Supplier admin", member: "Supplier member" },
};

/** What a membership lets a person do: everything of the side for an admin, else the permissions listed that belong to the side. */
export const permissionsOf = (side: Side, role: string, listed: readonly string[]): Permission[] =>
  role === "admin" ? [...PERMISSIONS[side]] : listed.filter(isPermission).filter((p) => (PERMISSIONS[side] as readonly string[]).includes(p));

/**
 * Who is acting, as the server established it — never as the browser says.
 * `userId` is null only for the buyer's workspace used on its own computer
 * without sign-in.
 */
export interface Principal {
  side: Side;
  orgId: string;
  orgName: string;
  userId: string | null;
  name: string;
  permissions: Permission[];
  /** How what they do is recorded: a person of the buyer, an assistant operating the buyer's app, a person of the supplier. */
  actorType: "user" | "ai" | "supplier";
}

// ---------------- The six conditions ----------------

export const LEAD_TIMES = ["1_3", "4_7", "7_14", "15_30", "on_schedule", "custom"] as const;
export type LeadTime = (typeof LEAD_TIMES)[number];
export const LEAD_TIME_LABEL: Record<LeadTime, Msg> = {
  "1_3": "1–3 days",
  "4_7": "4–7 days",
  "7_14": "7–14 days",
  "15_30": "15–30 days",
  on_schedule: "On schedule",
  custom: "Custom|lead time",
};

export const DELIVERY_TERMS = ["DAP", "FCA", "EXW", "other", "existing_agreement"] as const;
export type DeliveryTerm = (typeof DELIVERY_TERMS)[number];
export const DELIVERY_LABEL: Record<DeliveryTerm, Msg> = {
  DAP: "DAP — delivered to a named place",
  FCA: "FCA — handed to the carrier at a named place",
  EXW: "EXW — collected at the supplier's premises",
  other: "Other|delivery",
  existing_agreement: "As in the agreement already in force",
};
/** Terms that name a place: without it they say nothing. */
export const NAMES_A_PLACE: readonly DeliveryTerm[] = ["DAP", "FCA", "EXW"];
export const INCOTERMS_VERSIONS = ["2020", "2010"] as const;

export const PAYMENT_TERMS = ["advance", "30_days", "60_days", "90_days", "private_agreement", "other"] as const;
export type PaymentTerm = (typeof PAYMENT_TERMS)[number];
export const PAYMENT_LABEL: Record<PaymentTerm, Msg> = {
  advance: "In advance",
  "30_days": "30 days",
  "60_days": "60 days",
  "90_days": "90 days",
  private_agreement: "Private agreement",
  other: "Other|payment",
};

const oneOf = <V extends string>(list: readonly V[]) => (v: unknown): v is V => typeof v === "string" && (list as readonly string[]).includes(v);
export const isLeadTime = oneOf(LEAD_TIMES);
export const isDeliveryTerm = oneOf(DELIVERY_TERMS);
export const isPaymentTerm = oneOf(PAYMENT_TERMS);

/** What a supplier states to receive orders for an article. A value nobody stated is null — never a default taken for said. */
export interface Terms {
  unitPrice: number | null;
  currency: string | null;
  /** Whether the price includes VAT and other taxes. */
  taxesIncluded: boolean | null;
  minQuantity: number | null;
  /** Orders go up in steps of this: a pallet, a box. Null: any quantity from the minimum. */
  quantityStep: number | null;
  leadTime: LeadTime | null;
  leadTimeNote: string | null;
  delivery: DeliveryTerm | null;
  deliveryPlace: string | null;
  incotermsVersion: string | null;
  deliveryNote: string | null;
  /** Said by the supplier when the delivery terms do not say it themselves ("other"). */
  transportIncluded: boolean | null;
  payment: PaymentTerm | null;
  paymentNote: string | null;
  validUntil: string | null;
}

export const EMPTY_TERMS: Terms = {
  unitPrice: null, currency: null, taxesIncluded: null, minQuantity: null, quantityStep: null, leadTime: null, leadTimeNote: null, delivery: null, deliveryPlace: null,
  incotermsVersion: null, deliveryNote: null, transportIncluded: null, payment: null, paymentNote: null, validUntil: null,
};

export const TERM_FIELDS = ["price", "minimum", "leadTime", "delivery", "payment", "validity"] as const;
export type TermField = (typeof TERM_FIELDS)[number];
export const TERM_FIELD_LABEL: Record<TermField, Msg> = {
  price: "Price",
  minimum: "Minimum order quantity",
  leadTime: "Lead time",
  delivery: "Delivery terms",
  payment: "Payment terms",
  validity: "Price validity",
};
/** The same six, as the thing that is missing: "you are only missing the price validity". */
export const TERM_FIELD_MISSING: Record<TermField, Msg> = {
  price: "the price",
  minimum: "the minimum order quantity",
  leadTime: "the lead time",
  delivery: "the delivery terms",
  payment: "the payment terms",
  validity: "the price validity",
};

/** The conditions an order was made on: the six, with the unit they are in and whether they were reserved to this customer. */
export interface TermsSnapshot extends Terms {
  unit: string;
  termsId: string | null;
  reserved: boolean;
}

// ---------------- An article's state for orders ----------------

export const LISTING_STATES = ["order_ready", "catalog_ready", "expired", "suspended"] as const;
export type ListingState = (typeof LISTING_STATES)[number];
export const LISTING_LABEL: Record<ListingState, Msg> = {
  order_ready: "Order Ready",
  catalog_ready: "In the catalogue",
  expired: "Conditions expired",
  suspended: "Orders suspended",
};
/** What each state means for whoever wants to order. */
export const LISTING_MEANING: Record<ListingState, Msg> = {
  order_ready: "The supplier confirmed everything needed: an order can be requested.",
  catalog_ready: "The article is in the supplier's catalogue, but its commercial conditions are not complete: ask for a quotation.",
  expired: "The price is past its date: ask the supplier to renew it.",
  suspended: "The supplier is not taking new orders for this article for now.",
};

// ---------------- Orders ----------------

export const ORDER_STATUSES = ["draft", "pending_supplier", "pending_buyer_approval", "confirmed", "rejected", "cancelled", "expired", "completed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const isOrderStatus = oneOf(ORDER_STATUSES);
export const ORDER_STATUS_LABEL: Record<OrderStatus, Msg> = {
  draft: "Draft|order",
  pending_supplier: "Waiting for the supplier",
  pending_buyer_approval: "Changes to approve",
  confirmed: "Confirmed|order",
  rejected: "Declined|order",
  cancelled: "Cancelled|order",
  expired: "Lapsed|order",
  completed: "Completed|order",
};
/** The same statuses, as the supplier reads them. */
export const ORDER_STATUS_LABEL_SUPPLIER: Record<OrderStatus, Msg> = {
  ...ORDER_STATUS_LABEL,
  pending_supplier: "To handle",
  pending_buyer_approval: "Waiting for the customer",
};
export const OPEN_STATUSES: readonly OrderStatus[] = ["pending_supplier", "pending_buyer_approval"];

export const ORDER_ACTIONS = ["send", "accept", "propose", "reject", "accept_changes", "reject_changes", "cancel", "complete", "expire"] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** What an event of an order is called when it is listed. */
export const ORDER_EVENT_LABEL: Record<string, Msg> = {
  create: "Draft written",
  send: "Request sent to the supplier",
  accept: "Accepted by the supplier: the order is confirmed",
  propose: "The supplier proposed changes",
  reject: "Declined by the supplier",
  accept_changes: "Changes accepted by the customer: the order is confirmed",
  reject_changes: "Changes not accepted by the customer",
  cancel: "Cancelled by the customer",
  complete: "Marked as received by the customer",
  expire: "Lapsed: nobody answered in time",
};

export const PROPOSAL_FIELDS = ["unitPrice", "quantity", "deliveryDate", "delivery", "transportCost", "payment", "product"] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];
export const PROPOSAL_FIELD_LABEL: Record<ProposalField, Msg> = {
  unitPrice: "Price",
  quantity: "Quantity",
  deliveryDate: "Delivery date",
  delivery: "Delivery terms",
  transportCost: "Transport",
  payment: "Payment terms",
  product: "Another article",
};

/** What a supplier would change in a request. A field left out stays as asked. */
export interface ProposalChanges {
  unitPrice?: number;
  quantity?: number;
  deliveryDate?: string;
  delivery?: { term: DeliveryTerm; place: string | null; note: string | null };
  /** For the whole order, in the order's currency. */
  transportCost?: number;
  payment?: { term: PaymentTerm; note: string | null };
  /** Another article of the supplier in place of the one asked: a different specification, which the customer approves in so many words. */
  product?: { orderProductId: string; code: string | null; name: string; description: string | null; unit: string };
}

// ---------------- Notifications ----------------

export const NOTIFICATION_KINDS = [
  "order_received", "changes_accepted", "changes_rejected", "order_cancelled", "order_completed", "conditions_requested", "update_requested",
  "order_accepted", "order_rejected", "changes_proposed", "order_expired", "supplier_registered",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
/** The words of each notification: an order's number, a company, an article's name — never a price or a quantity. */
export const NOTIFICATION_TEXT: Record<NotificationKind, Msg> = {
  order_received: "New order request {number} from {company}",
  changes_accepted: "{company} accepted your changes: order {number} is confirmed",
  changes_rejected: "{company} did not accept your changes to request {number}",
  order_cancelled: "{company} cancelled order request {number}",
  order_completed: "{company} marked order {number} as received",
  conditions_requested: "{company} asks for your conditions on {product}",
  update_requested: "{company} asks you to renew the conditions of {product}",
  order_accepted: "{company} accepted order {number}: it is confirmed",
  order_rejected: "{company} declined order request {number}",
  changes_proposed: "{company} proposes changes to order request {number}",
  order_expired: "Order request {number} lapsed: nobody answered in time",
  supplier_registered: "{company} registered: you can now see what it makes available to order",
};
export const isNotificationKind = oneOf(NOTIFICATION_KINDS);

/** A quoted or agreed price is the two companies' private data: never a list price, never in a public page. */
export const ORDER_DATA_CLASS = "private_agreement";
