/**
 * What a purchase is, for the purpose of managing spend. Every invoice line
 * counts in the company's spend, but only some of it is a product to compare
 * and negotiate: materials, components, packaging. Transport, services,
 * utilities and office purchases are spend to know about, not a catalogue.
 */
import type { Msg } from "../i18n";

export const PRODUCT_KINDS = ["direct_material", "packaging", "component", "logistics", "service", "indirect", "energy", "equipment", "other", "needs_review"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const KIND_LABEL: Record<ProductKind, Msg> = {
  direct_material: "Direct material",
  packaging: "Packaging",
  component: "Component",
  logistics: "Logistics",
  service: "Service",
  indirect: "Indirect purchase",
  energy: "Energy / utility",
  equipment: "Equipment",
  other: "Other",
  needs_review: "To classify",
};

/** Kinds in the plural, to name a group of lines ("Logistics — DHL Express"). */
export const KIND_GROUP_LABEL: Record<ProductKind, Msg> = {
  direct_material: "Direct materials",
  packaging: "Packaging",
  component: "Components",
  logistics: "Transport and logistics",
  service: "Services",
  indirect: "Indirect purchases",
  energy: "Energy and utilities",
  equipment: "Equipment and spare parts",
  other: "Fees, taxes and other charges",
  needs_review: "To classify",
};

export const isProductKind = (v: unknown): v is ProductKind => typeof v === "string" && (PRODUCT_KINDS as readonly string[]).includes(v);

const STRATEGIC = new Set<string>(["direct_material", "packaging", "component", "needs_review"]);

/**
 * True for what Procurement Intelligence works on. A product whose kind is
 * still to be decided stays in the catalogue until someone says otherwise.
 */
export const isStrategic = (kind: string | null | undefined) => !kind || STRATEGIC.has(kind);
