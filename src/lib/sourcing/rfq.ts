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
import { countryName } from "../countries";
import { en, type T } from "../i18n";

export interface RfqLine {
  productName: string;
  /** Label → value, the label already in words ("Diameter"). */
  specifications: Record<string, string>;
  /** The product's own description or technical notes, if any. */
  description: string | null;
  unit: string;
  annualQuantity: number | null;
  typicalOrderQuantity: number | null;
}

export interface RfqRequestInput {
  lines: RfqLine[];
  deliveryCountry: string | null;
  companyName: string;
  userName: string | null;
  supplierName: string;
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
  return [
    `${index != null ? `${index}. ` : `${t("Product")}: `}${line.productName}`,
    ...(specs.length ? [`   ${t("Specifications")}: ${specs.join("; ")}`] : []),
    ...(line.description ? [`   ${t("Notes|rfq")}: ${line.description}`] : []),
    ...(line.annualQuantity ? [`   ${t("Annual requirement")}: ${t("about {quantity}", { quantity: qty(line.annualQuantity) })}`] : []),
    ...(line.typicalOrderQuantity ? [`   ${t("Typical order")}: ${t("about {quantity}", { quantity: qty(line.typicalOrderQuantity) })}`] : []),
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
    ...(input.deliveryCountry ? [`${t("Delivery")}: ${countryName(input.deliveryCountry, t.locale)}`, ""] : []),
    many ? t("Please include in your offer, for each product:") : t("Please include in your offer:"),
    `- ${t("price per unit, with the currency and any quantity breaks")}`,
    `- ${t("minimum order quantity")}`,
    `- ${t("lead time from order")}`,
    `- ${t("delivery terms (Incoterm) and whether transport is included")}`,
    `- ${t("payment terms")}`,
    `- ${t("how long the offer is valid")}`,
    `- ${t("technical data sheet and specifications of the product offered")}`,
    `- ${t("certifications, where they apply")}`,
    `- ${t("whether samples are available")}`,
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
