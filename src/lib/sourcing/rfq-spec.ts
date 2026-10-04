/**
 * What a product is called and described as to someone who is not its
 * current supplier. An invoice name is often the supplier's own code ("WAX
 * SER 14581"): another supplier can't know what it means, and a request sent
 * with it gets no useful answer. Before a request can be prepared, a product
 * needs a neutral description and a specification — written by the company,
 * never made up here.
 *
 * The rules read what every product has: its name, the codes its suppliers
 * use for it, what the name states. Nothing here knows an industry.
 */
import { attributesOf, ATTRIBUTE_LABEL } from "../catalog/attributes";
import { en, type T } from "../i18n";
import { normalizeKey } from "../import/normalize/text";
import { productTerms } from "../research/inspect";
import { neutralName } from "./discovery";

export type Readiness = "ready" | "partial" | "not_ready";

export interface RfqSpecInput {
  /** As it is on file: usually what the invoices write. */
  name: string;
  /** The neutral description the company wrote or confirmed. */
  rfqName: string | null;
  technical: string | null;
  application: string | null;
  specs: Record<string, string> | null;
  /** The codes suppliers use for it on their documents. */
  supplierCodes: string[];
  knownSuppliers: string[];
  companyName: string | null;
  unit: string;
  annualQuantity: number | null;
  typicalOrderQuantity: number | null;
  deliveryCountry: string | null;
  /** Technical documents attached to the product. */
  documents: number;
}

export interface RfqSpec {
  originalName: string;
  supplierCodes: string[];
  /** What goes in a request: the company's own description, or the one read from the name when it says enough. Null: nothing safe to send. */
  neutralName: string | null;
  neutralSource: "yours" | "suggested" | "missing";
  /** What the name gives once the supplier's name and codes are taken out — a starting point for the user. */
  suggestedName: string | null;
  technical: string | null;
  /** What the name itself states: size, diameter, capacity… Label (English text of the dictionary) and value. */
  attributes: { label: string; value: string }[];
  /** Grades and measures written in the name that are not one of the known attributes ("52/54"). */
  figures: string[];
  application: string | null;
  unit: string;
  annualQuantity: number | null;
  typicalOrderQuantity: number | null;
  deliveryCountry: string | null;
  documents: number;
  readiness: Readiness;
  /** Exactly what is missing, in words. */
  missing: string[];
}

/** A token that is a code, not a word: digits only and long, or one of the supplier's own codes. */
const isCode = (token: string, codes: Set<string>) => codes.has(normalizeKey(token)) || /^\d{4,}$/.test(token);

export function rfqSpec(input: RfqSpecInput, t: T = en): RfqSpec {
  const codes = new Set(input.supplierCodes.map((c) => normalizeKey(c)).filter(Boolean));
  const tokens = neutralName({ name: input.name, knownSuppliers: input.knownSuppliers }).split(" ");
  const removed = tokens.filter((x) => isCode(x, codes));
  const suggested = tokens.filter((x) => !isCode(x, codes)).join(" ").trim() || null;
  const terms = suggested ? productTerms({ name: suggested, companyName: input.companyName }) : { words: [], specs: [] };
  const attributes = [...attributesOf(input.name).map((a) => ({ label: ATTRIBUTE_LABEL[a.key] as string, value: a.value })), ...Object.entries(input.specs ?? {}).map(([label, value]) => ({ label, value }))];
  const specOk = !!input.technical?.trim() || attributes.length > 0 || terms.specs.length > 0 || input.documents > 0;
  // The name read from the invoice is safe to send only when it says what the thing is and carries its specification.
  const suggestedOk = !!suggested && terms.words.length > 0 && specOk;
  const rfqName = input.rfqName?.trim() || null;
  const neutralSource: RfqSpec["neutralSource"] = rfqName ? "yours" : suggestedOk ? "suggested" : "missing";
  const missing = [
    ...(neutralSource === "missing" ? [removed.length || !terms.words.length ? t("A neutral description: “{name}” is how the current supplier writes it, and another supplier can't know what it means.", { name: input.name }) : t("A neutral description of what the product is.")] : []),
    ...(!specOk ? [t("The technical specification: what another supplier needs to know to quote the same thing.")] : []),
    ...(!input.annualQuantity ? [t("The annual volume: there are no purchases in the last 12 months.")] : []),
    ...(!input.deliveryCountry ? [t("Where it has to be delivered: set your country in Settings.")] : []),
  ];
  return {
    originalName: input.name,
    supplierCodes: [...new Set([...input.supplierCodes, ...removed])],
    neutralName: rfqName ?? (suggestedOk ? suggested : null),
    neutralSource,
    suggestedName: suggested,
    technical: input.technical?.trim() || null,
    attributes,
    figures: terms.specs,
    application: input.application?.trim() || null,
    unit: input.unit,
    annualQuantity: input.annualQuantity,
    typicalOrderQuantity: input.typicalOrderQuantity,
    deliveryCountry: input.deliveryCountry,
    documents: input.documents,
    readiness: neutralSource === "missing" ? "not_ready" : missing.length ? "partial" : "ready",
    missing,
  };
}
