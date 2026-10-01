/**
 * Input schemas shared by manual forms and importers. Any future ingestion
 * channel (invoice AI, email AI) must produce data that passes these.
 */
import { z } from "zod";
import { parseDate, parseNumber } from "./parse";

const optionalText = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null),
  z.string().nullable(),
);

const requiredText = (label: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().min(1, `${label} is required`));

const num = (label: string, opts: { required?: boolean; min?: number; positive?: boolean; int?: boolean } = {}) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : (parseNumber(v) ?? Number.NaN)),
    z
      .number({ error: `${label} must be a number` })
      .refine((n) => !Number.isNaN(n), `${label} must be a number`)
      .refine((n) => !opts.positive || n > 0, `${label} must be greater than 0`)
      .refine((n) => opts.min == null || n >= opts.min, `${label} cannot be negative`)
      .refine((n) => !opts.int || Number.isInteger(n), `${label} must be a whole number`)
      .nullable()
      .refine((n) => !opts.required || n != null, `${label} is required`),
  );

const isoDate = (label: string, required = true) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : (parseDate(v) ?? "invalid")),
    z
      .string()
      .nullable()
      .refine((d) => d !== "invalid", `${label} is not a valid date`)
      .refine((d) => !required || d != null, `${label} is required`),
  );

const currency = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim().toUpperCase() : "EUR"),
  z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code (EUR, USD…)"),
);

const id = (label: string) => z.string().uuid(`Select a ${label}`);
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
  email: optionalText.refine((v) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Email is not valid"),
  phone: optionalText,
  website: optionalText,
  currency,
  paymentTermsDays: num("Payment terms", { min: 0, int: true }),
  defaultLeadTimeDays: num("Lead time", { min: 0, int: true }),
  notes: optionalText,
});

export const productInput = z.object({
  name: requiredText("Name"),
  sku: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : ""),
    z.string().min(1, "SKU is required"),
  ),
  category: optionalText,
  unit: requiredText("Unit"),
  description: optionalText,
  technicalSpecifications: optionalText,
  specs: z.preprocess((v) => parseSpecs(typeof v === "string" ? v : ""), z.record(z.string(), z.string()).nullable()),
  currentSupplierId: optionalId,
});

export const purchaseInput = z.object({
  productId: id("product"),
  supplierId: id("supplier"),
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
  productId: id("product"),
  supplierId: id("supplier"),
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

export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
