/**
 * Before researching a product: what kind of thing is it, and so what is
 * worth looking for. A raw material has benchmarks and trade statistics; a
 * part made to a drawing has neither — it has suppliers to find and a
 * specification to match. One strategy for everything would search for
 * evidence that cannot exist.
 *
 * The rules read what the catalogue already knows (kind, unit, what the name
 * says, the company's own name): nothing here knows an industry. The user can
 * always say otherwise (products.research_class).
 */
import { categorize } from "../catalog/taxonomy";
import type { Msg } from "../i18n";
import { companyKey, normalizeKey } from "../import/normalize/text";
import { UNITS, normalizeUnit } from "../import/normalize/units";

export const PRODUCT_CLASSES = ["commodity", "standard", "custom", "private_label", "service", "other"] as const;
export type ProductClass = (typeof PRODUCT_CLASSES)[number];
export const isProductClass = (v: unknown): v is ProductClass => typeof v === "string" && (PRODUCT_CLASSES as readonly string[]).includes(v);

export const CLASS_LABEL: Record<ProductClass, Msg> = {
  commodity: "Raw material or commodity",
  standard: "Standard industrial product",
  custom: "Custom component",
  private_label: "Private label product",
  service: "Service",
  other: "Other|product class",
};

export interface Strategy {
  /** Look for published references for the product itself. */
  benchmarks: boolean;
  /** Import statistics by customs code. */
  trade: boolean;
  /** Prices suppliers publish. */
  publicPrices: boolean;
  /** The match hangs on a specification the name does not give: it has to be collected and sent. */
  specificationFirst: boolean;
  /** What the research will do, in one line. */
  plan: Msg;
}

export const STRATEGY: Record<ProductClass, Strategy> = {
  commodity: { benchmarks: true, trade: true, publicPrices: true, specificationFirst: false, plan: "Benchmarks, alternative suppliers, cost drivers and trade data." },
  standard: { benchmarks: false, trade: true, publicPrices: true, specificationFirst: false, plan: "Alternative suppliers, public price evidence and trade data." },
  custom: { benchmarks: false, trade: false, publicPrices: false, specificationFirst: true, plan: "Suppliers able to make it, a specification to match, then quotes: there is no public price for a custom part." },
  private_label: { benchmarks: false, trade: false, publicPrices: false, specificationFirst: true, plan: "Manufacturers that produce for other brands, then quotes on your own specification." },
  service: { benchmarks: false, trade: false, publicPrices: false, specificationFirst: true, plan: "Other providers, then quotes on the same scope." },
  other: { benchmarks: false, trade: false, publicPrices: true, specificationFirst: false, plan: "Alternative suppliers, then quotes." },
};

export interface ClassInput {
  name: string;
  kind: string;
  unit: string;
  /** Read from the name: size, diameter, capacity… */
  specifications: Record<string, string>;
  /** The buyer: its name in a product's name means the product is made for it. */
  companyName: string | null;
  /** What the user chose, if anything. */
  override?: string | null;
}

const MEASURES = ["size", "diameter", "capacity", "weight", "thickness"];
const dimensionOf = (unit: string) => UNITS.find((u) => u.code === (normalizeUnit(unit) ?? unit))?.dimension ?? null;

export function classifyProduct(input: ClassInput): { productClass: ProductClass; reason: Msg; chosen: boolean } {
  if (isProductClass(input.override)) return { productClass: input.override, reason: "Chosen by you.", chosen: true };
  if (["logistics", "service", "energy"].includes(input.kind)) return { productClass: "service", reason: "It is a service, not a product.", chosen: false };
  if (["indirect", "equipment", "other", "needs_review"].includes(input.kind)) return { productClass: "other", reason: "Not classified as a material, a component or packaging.", chosen: false };
  const name = ` ${normalizeKey(input.name)} `;
  const own = companyKey(input.companyName)
    .split(" ")
    .filter((word) => word.length >= 4 && !categorize(word));
  if (own.some((word) => name.includes(` ${word} `))) return { productClass: "private_label", reason: "Its name carries your company's name: it is made for you.", chosen: false };
  const taxonomy = categorize(input.name)?.category.research;
  if (taxonomy) return { productClass: taxonomy, reason: "From its category.", chosen: false };
  const dimension = dimensionOf(input.unit);
  if (input.kind === "direct_material" && (dimension === "mass" || dimension === "volume")) return { productClass: "commodity", reason: "A material bought by weight or volume.", chosen: false };
  if (MEASURES.some((key) => input.specifications[key])) return { productClass: "standard", reason: "Its name states measurable specifications.", chosen: false };
  return { productClass: "custom", reason: "It is identified by a supplier's article code, with no measurable specification in its name.", chosen: false };
}
