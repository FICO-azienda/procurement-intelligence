/**
 * Input schemas shared by manual forms and importers. Any future ingestion
 * channel (invoice AI, email AI) must produce data that passes these.
 */
import { z } from "zod";
import { en, type Msg, type T } from "./i18n";
import { parseDate, parseNumber } from "./parse";

const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null),
  z.string().nullable(),
);

/**
 * A message about a field ("Quantity is required"), kept as template + field
 * so `fieldErrors` can say it in the reader's language.
 */
const SEP = "\u0001";
const about = (msg: Msg, label: Msg) => `${msg}${SEP}${label}`;

const requiredText = (label: Msg) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, about("{~label} is required", label)));

const num = (label: Msg, opts: { required?: boolean; min?: number; positive?: boolean; int?: boolean } = {}) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : (parseNumber(v) ?? Number.NaN)),
    z
      .number({ error: about("{~label} must be a number", label) })
      .refine((n) => !Number.isNaN(n), about("{~label} must be a number", label))
      .refine((n) => !opts.positive || n > 0, about("{~label} must be greater than 0", label))
      .refine((n) => opts.min == null || n >= opts.min, about("{~label} cannot be negative", label))
      .refine((n) => !opts.int || Number.isInteger(n), about("{~label} must be a whole number", label))
      .nullable()
      .refine((n) => !opts.required || n != null, about("{~label} is required", label)),
  );

const isoDate = (label: Msg, required = true) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : (parseDate(v) ?? "invalid")),
    z
      .string()
      .nullable()
      .refine((d) => d !== "invalid", about("{~label} is not a valid date", label))
      .refine((d) => !required || d != null, about("{~label} is required", label)),
  );

const currency = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim().toUpperCase() : "EUR"),
  z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code (EUR, USD…)" satisfies Msg),
);

const id = (message: Msg) => z.string().uuid(message);
const optionalId = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().uuid().nullable());

/**
 * "capacity: 300 ml" lines → { capacity: "300 ml" }. Lines without a colon
 * are ignored; an empty text gives null.
 */
export function parseSpecs(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (name && value) out[name] = value;
  }
  return Object.keys(out).length ? out : null;
}

export function formatSpecs(specs: Record<string, string> | null | undefined): string {
  return specs ? Object.entries(specs).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
}

export const supplierInput = z.object({
  name: requiredText("Name"),
  country: optionalText,
  city: optionalText,
  contactName: optionalText,
  email: optionalText.refine((v) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Email is not valid" satisfies Msg),
  phone: optionalText,
  website: optionalText,
  currency,
  paymentTermsDays: num("Payment terms", { min: 0, int: true }),
  defaultLeadTimeDays: num("Lead time", { min: 0, int: true }),
  notes: optionalText,
});

export const productInput = z.object({
  name: requiredText("Name"),
  /** Optional: when empty, a code is generated from the name. */
  sku: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""), z.string()),
  category: optionalText,
  unit: requiredText("Unit"),
  description: optionalText,
  technicalSpecifications: optionalText,
  specs: z.preprocess((v) => parseSpecs(typeof v === "string" ? v : ""), z.record(z.string(), z.string()).nullable()),
  currentSupplierId: optionalId,
});

export const purchaseInput = z.object({
  productId: id("Select a product"),
  supplierId: id("Select a supplier"),
  date: isoDate("Date"),
  quantity: num("Quantity", { required: true, positive: true }),
  unitPrice: num("Unit price", { required: true, min: 0 }),
  currency,
  fxRate: num("FX rate", { positive: true }),
  freightCost: num("Freight", { min: 0 }),
  otherCosts: num("Other costs", { min: 0 }),
  invoiceReference: optionalText,
  notes: optionalText,
});

export const quoteInput = z.object({
  productId: id("Select a product"),
  supplierId: id("Select a supplier"),
  date: isoDate("Date"),
  quantity: num("Quantity", { positive: true }),
  unitPrice: num("Unit price", { required: true, min: 0 }),
  currency,
  fxRate: num("FX rate", { positive: true }),
  moq: num("MOQ", { min: 0 }),
  leadTimeDays: num("Lead time", { min: 0, int: true }),
  paymentTermsDays: num("Payment terms", { min: 0, int: true }),
  incoterm: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim().toUpperCase() : null),
    z.string().nullable(),
  ),
  validUntil: isoDate("Valid until", false),
  notes: optionalText,
});

/** A candidate's answer recorded as a quote: the product and the supplier are the candidate's own. */
export const candidateQuoteInput = quoteInput.omit({ productId: true, supplierId: true, quantity: true, fxRate: true });

const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? (/^https?:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`) : null),
  z
    .string()
    .nullable()
    .refine((u) => u == null || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(u), "Write a web address, like https://www.example.com" satisfies Msg),
);
const oneOf = <V extends string>(values: readonly V[], fallback: V | null) =>
  z.preprocess((v) => (typeof v === "string" && (values as readonly string[]).includes(v) ? v : fallback), z.custom<V | null>());

/**
 * A possible supplier added by hand. It needs a name and where it was found —
 * a page, or a few words ("met at a trade fair"). A price needs its unit: it
 * is what the supplier publishes, never an offer (offers are recorded as quotes).
 */
export const candidateInput = z
  .object({
    name: requiredText("Supplier"),
    country: optionalText,
    website: optionalUrl,
    sourceUrl: optionalUrl,
    sourceDate: isoDate("Date", false),
    sourceLevel: oneOf(["supplier_official", "official_data", "licensed_data", "external"] as const, "external"),
    productMatched: optionalText,
    matchReason: optionalText,
    technicalCompatibility: oneOf(["high", "partial", "not"] as const, null),
    priceLow: num("Price", { positive: true }),
    priceHigh: num("Price", { positive: true }),
    priceSourceUrl: optionalUrl,
    currency,
    unit: optionalText,
    incoterm: optionalText,
    moq: num("Minimum order", { positive: true }),
    leadTimeDays: num("Lead time", { min: 0, int: true }),
    paymentTerms: optionalText,
    certifications: optionalText,
    shippingOrigin: optionalText,
    notes: optionalText,
  })
  .superRefine((v, ctx) => {
    if (!v.sourceUrl && !v.notes) ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "Say where you found this supplier: a web page, or a note" satisfies Msg });
    if ((v.priceLow != null || v.priceHigh != null) && !v.unit) ctx.addIssue({ code: "custom", path: ["unit"], message: "A price needs its unit" satisfies Msg });
    if (v.priceLow != null && v.priceHigh != null && v.priceHigh < v.priceLow) ctx.addIssue({ code: "custom", path: ["priceHigh"], message: "The second price must not be lower than the first" satisfies Msg });
  });

/** An external reference typed from a report or a public source: always with who published it and when. */
export const benchmarkInput = z
  .object({
    type: oneOf(["direct_benchmark", "trade_benchmark", "cost_driver"] as const, "direct_benchmark"),
    label: requiredText("What it refers to"),
    low: num("Price", { positive: true }),
    high: num("Price", { positive: true }),
    changePct: num("Change"),
    period: optionalText,
    sourceName: requiredText("Source"),
    sourceUrl: optionalUrl,
    sourceDate: isoDate("Date"),
    sourceLevel: oneOf(["official_data", "licensed_data", "external"] as const, "external"),
    comparability: oneOf(["comparable", "partial", "not"] as const, "partial"),
    notes: optionalText,
  })
  .superRefine((v, ctx) => {
    if (v.type === "cost_driver" ? v.changePct == null : v.low == null) ctx.addIssue({ code: "custom", path: [v.type === "cost_driver" ? "changePct" : "low"], message: v.type === "cost_driver" ? ("Write the change, in %" satisfies Msg) : ("Write the price, or the range" satisfies Msg) });
    if (v.low != null && v.high != null && v.high < v.low) ctx.addIssue({ code: "custom", path: ["high"], message: "The second price must not be lower than the first" satisfies Msg });
  });

export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError, t: T = en): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    const [msg, label] = issue.message.split(SEP);
    out[key] ??= label ? t.any(msg, { label }) : t.any(msg);
  }
  return out;
}
