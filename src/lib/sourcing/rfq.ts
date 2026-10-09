/**
 * A request for quotation, ready to copy: short, professional, and with only
 * what a supplier needs to answer — the product, its specification, the
 * quantities, where it goes. One request can carry several products, so that
 * a supplier able to cover three of them gets one email, not three.
 *
 * It never says the price paid, the current supplier or the saving hoped
 * for. Nothing is sent from here: the user copies the text into their email.
 */
import * as f from "../format";
import { allSubs } from "../catalog/taxonomy";
import { countryName } from "../countries";
import { en, translator, type Msg, type T } from "../i18n";
import { normalizeKey } from "../import/normalize/text";

/**
 * The kind of material a request is about: each one has its own questions —
 * a price formula for wax, mould costs for containers, burn tests for wick
 * cord, dies for cardboard, tolerances for metal parts, print set-up for labels.
 */
export type RfqCategory = "wax" | "containers" | "wick" | "cardboard" | "sustainers" | "labels";
export const RFQ_CATEGORIES: RfqCategory[] = ["wax", "containers", "wick", "cardboard", "sustainers", "labels"];
export const RFQ_CATEGORY_LABEL: Record<RfqCategory, Msg> = { wax: "Wax", containers: "Glasses and containers", wick: "Wick cord", cardboard: "Cardboard", sustainers: "Wick sustainers and metal parts", labels: "Labels" };
const BY_SUB: Record<string, RfqCategory> = { paraffin: "wax", wax: "wax", wax_blend: "wax", vegetable_wax: "wax", candle_container: "containers", glass: "containers", ceramic: "containers", wick: "wick", cardboard: "cardboard", wick_holder: "sustainers", label: "labels" };

/** The request category of a product, from the subcategory it is filed under — written in either language, or as the taxonomy's key. */
export function rfqCategoryOf(subcategory: string | null | undefined): RfqCategory | null {
  const key = normalizeKey(subcategory);
  if (!key) return null;
  const it = translator("it");
  const ref = allSubs().find((r) => r.sub.key === subcategory || normalizeKey(r.sub.label) === key || normalizeKey(it(r.sub.label)) === key);
  return ref ? (BY_SUB[ref.sub.key] ?? null) : null;
}

const QUESTIONS: Record<RfqCategory, Msg[]> = {
  wax: [
    "melting point, oil content, colour and odour of the grade offered, with its technical and safety data sheets",
    "delivery form (liquid in tank truck, slabs or pastilles) and the minimum per delivery",
    "the price revision formula, if the price follows an index, and how often it is revised",
  ],
  containers: [
    "material, dimensions, weight and colours of the article offered",
    "mould and customisation costs, stated apart from the unit price",
    "pieces per carton and per pallet",
  ],
  wick: [
    "yarn composition, number of strands, construction and any treatment or impregnation",
    "weight or length per spool",
    "whether samples are available for burn tests: equivalence can be confirmed only after a test with our waxes",
  ],
  cardboard: [
    "board type, flute and weight of the board offered",
    "die, printing and tooling costs, stated apart from the unit price",
    "delivery format (bundles, pallets) and pieces per pallet",
  ],
  sustainers: [
    "material, thickness, tolerances and finish of the part offered",
    "stamping tool or die costs, stated apart from the unit price",
    "packaging format and pieces per carton",
  ],
  labels: [
    "material, adhesive, finish and printing technology offered",
    "print set-up and die costs, stated apart from the unit price",
    "the minimum quantity per design, and how many designs can share one run",
  ],
};

export interface RfqLine {
  productName: string;
  /** Label → value, the label already in words ("Diameter"). */
  specifications: Record<string, string>;
  /** The product's own description or technical notes, if any. */
  description: string | null;
  unit: string;
  annualQuantity: number | null;
  /** False: the yearly figure is worked out from the invoices and is said to be indicative. */
  annualConfirmed?: boolean;
  typicalOrderQuantity: number | null;
  /**
   * The quantities every supplier is asked to price, taken from the orders really placed: a smaller one, the usual
   * one, a larger one. Null where the purchases on file do not show one — no quantity is made up.
   */
  tiers?: { small: number | null; standard: number | null; large: number | null } | null;
  /** What the product is used for. */
  application?: string | null;
  /** Documents the user will attach: named in the text so that the supplier looks for them. */
  attachments?: string[];
}

export interface RfqRequestInput {
  lines: RfqLine[];
  deliveryCountry: string | null;
  companyName: string;
  userName: string | null;
  supplierName: string;
  /** The material the request is about: adds the questions that belong to it. */
  category?: RfqCategory | null;
  /** The town the goods are delivered to, as registered by the company. Null: only the country is said. */
  deliveryPlace?: string | null;
  /** request: the first time. update: products added to a request already sent. follow_up: no answer yet. */
  kind?: "request" | "update" | "follow_up";
  /** When the earlier request was sent, for an update or a follow-up. */
  previousDate?: string | null;
}

export interface RfqDraft {
  supplierName: string;
  subject: string;
  body: string;
}

function lineText(line: RfqLine, index: number | null, t: T): string[] {
  const qty = (n: number) => `${f.number(Math.round(n), 0)} ${line.unit}`;
  const specs = Object.entries(line.specifications).map(([k, v]) => `${k}: ${v}`);
  // The same quantities go to every supplier: the orders really placed, never round numbers made up for the occasion.
  const tiers = [
    ...(line.tiers?.small ? [t("{quantity} (smaller order)", { quantity: qty(line.tiers.small) })] : []),
    ...(line.tiers?.standard ? [t("{quantity} (usual order)", { quantity: qty(line.tiers.standard) })] : []),
    ...(line.tiers?.large ? [t("{quantity} (larger order)", { quantity: qty(line.tiers.large) })] : []),
  ];
  return [
    `${index != null ? `${index}. ` : `${t("Product")}: `}${line.productName}`,
    ...(specs.length ? [`   ${t("Specifications")}: ${specs.join("; ")}`] : []),
    ...(line.description ? [`   ${t("Technical specification")}: ${line.description}`] : []),
    ...(line.application ? [`   ${t("Application")}: ${line.application}`] : []),
    ...(line.attachments?.length ? [`   ${t("Attached")}: ${line.attachments.join(", ")}`] : []),
    ...(line.annualQuantity ? [`   ${t("Annual requirement")}: ${line.annualConfirmed === false ? t("about {quantity} (indicative estimate, not a commitment)", { quantity: qty(line.annualQuantity) }) : t("about {quantity}", { quantity: qty(line.annualQuantity) })}`] : []),
    ...(tiers.length > 1
      ? [`   ${t("Quantities to quote")}: ${tiers.join(" · ")}`]
      : line.typicalOrderQuantity
        ? [`   ${t("Typical order")}: ${t("about {quantity}", { quantity: qty(line.typicalOrderQuantity) })}`]
        : []),
  ];
}

export function rfqText(input: RfqRequestInput, t: T = en): RfqDraft {
  const many = input.lines.length > 1;
  const names = input.lines.map((l) => l.productName);
  const title = many ? t("{n} products", { n: input.lines.length }) : (names[0] ?? "");
  const sign = [t("Thank you, and best regards"), ...(input.userName ? [input.userName] : []), input.companyName];
  if (input.kind === "follow_up") {
    return {
      supplierName: input.supplierName,
      subject: t("Following up: request for quotation, {product}", { product: title }),
      body: [
        t("Dear {supplier} team,", { supplier: input.supplierName }),
        "",
        input.previousDate ? t("On {date} we sent you a request for quotation for:", { date: f.date(input.previousDate) }) : t("We recently sent you a request for quotation for:"),
        ...names.map((n) => `- ${n}`),
        "",
        t("We have not received your offer yet. Could you let us know whether you can quote, and by when?"),
        "",
        ...sign,
      ].join("\n"),
    };
  }
  const lines = [
    t("Dear {supplier} team,", { supplier: input.supplierName }),
    "",
    input.kind === "update"
      ? input.previousDate
        ? t("Further to our request of {date}, we would also like your quotation for the following.", { date: f.date(input.previousDate) })
        : t("Further to our earlier request, we would also like your quotation for the following.")
      : many
        ? t("{company} is looking for a supplier of the products below and would like to receive your quotation.", { company: input.companyName })
        : t("{company} is looking for a supplier of the product below and would like to receive your quotation.", { company: input.companyName }),
    "",
    ...input.lines.flatMap((line, i) => [...lineText(line, many ? i + 1 : null, t), ...(many ? [""] : [])]),
    ...(many ? [] : [""]),
    // The same delivery basis for everyone, so that the prices can be set side by side: delivered to us, duties not paid, VAT apart.
    ...(input.deliveryCountry
      ? [
          `${t("Delivery")}: ${input.deliveryPlace ? t("DAP {place}, {country} (Incoterms 2020)", { place: input.deliveryPlace, country: countryName(input.deliveryCountry, t.locale) }) : t("DAP our plant in {country} (Incoterms 2020); the exact address on request", { country: countryName(input.deliveryCountry, t.locale) })}`,
          t("Please quote net prices, VAT excluded, and say what the price includes and what it leaves out. If you can, add the FCA price from your plant or warehouse. If the goods come from outside the EU, state the duties and import costs not included."),
          "",
        ]
      : []),
    many ? t("Please include in your offer, for each product:") : t("Please include in your offer:"),
    `- ${t("net unit price, with the currency and the unit of measure, at each quantity above")}`,
    `- ${t("minimum order quantity")}`,
    `- ${t("lead time from order, and current availability")}`,
    `- ${t("delivery terms (Incoterm), the cost of transport, and packaging or pallet costs")}`,
    `- ${t("any other cost not in the unit price")}`,
    `- ${t("payment terms")}`,
    `- ${t("how long the offer is valid")}`,
    `- ${t("country of origin of the product")}`,
    `- ${t("technical data sheet and specifications of the product offered")}`,
    `- ${t("certifications, where they apply")}`,
    `- ${t("whether samples are available")}`,
    ...(input.category ? QUESTIONS[input.category].map((q) => `- ${t(q)}`) : []),
    "",
    ...sign,
  ];
  return { supplierName: input.supplierName, subject: t("Request for quotation: {product}", { product: title }), body: lines.join("\n") };
}

/** One product, one supplier: the request in its simplest form. */
export interface RfqInput extends RfqLine {
  deliveryCountry: string | null;
  companyName: string;
  userName: string | null;
  supplierName: string;
}

export function rfqDraft(input: RfqInput, t: T = en): RfqDraft {
  const { deliveryCountry, companyName, userName, supplierName, ...line } = input;
  return rfqText({ lines: [line], deliveryCountry, companyName, userName, supplierName }, t);
}
