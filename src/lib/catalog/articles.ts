/**
 * The articles of the suppliers: what a company sells, as it names it. One
 * article whichever part of the app met it — an invoice, an offer, the
 * portal's catalogue — matched inside its company by its code, else by its
 * name read the same way each time. Pure, tested.
 */
import { codeKey, productKey } from "../import/normalize/text";
import type { Msg } from "../i18n";
import type { Compatibility } from "../replies/types";
import type { RelationType } from "./technical";

/** How an article is found again inside its company: its own code first, else its name. */
export function articleKey(code: string | null | undefined, name: string): string {
  const c = codeKey(code);
  return c ? `code:${c}` : `name:${productKey(name)}`;
}

/** The types an article can be to a product: identical (it is the product) and the technical relations. */
export type ArticleLinkType = "identical" | RelationType;
export const ARTICLE_LINK_LABEL: Record<ArticleLinkType, Msg> = {
  identical: "It is this product",
  possible_equivalent: "Possible equivalent, to verify",
  equivalent_validated: "Equivalent, validated",
  same_family: "Same family, another grade",
  technical_alternative: "Technical alternative",
  not_equivalent: "Not equivalent",
};

/**
 * What a person said of an offer's compatibility, as a relation of its article to the product — the memory read when
 * the same article comes again. Nothing said, or "to analyse": no relation.
 */
export function linkTypeOf(c: Compatibility): RelationType | null {
  switch (c) {
    case "validated":
      return "equivalent_validated";
    case "possible":
    case "sample_to_test":
      return "possible_equivalent";
    case "not_equivalent":
      return "not_equivalent";
    default:
      return null;
  }
}

/**
 * What an earlier decision on the same article proposes for a new offer line: the same reading — except that an
 * equivalence is never validated by the app on a new line; it is proposed as possible, and a person says it again.
 */
export function compatibilityFromMemory(type: ArticleLinkType): Compatibility | null {
  switch (type) {
    case "equivalent_validated":
    case "identical":
    case "possible_equivalent":
      return "possible";
    case "not_equivalent":
      return "not_equivalent";
    default:
      return null;
  }
}
