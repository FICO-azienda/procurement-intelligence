import type { Metadata } from "next";
import { MapperReview, type MapProductVM, type OptionGroup, type ReviewVM } from "@/components/catalog/mapper-review";
import { Crumbs, PageHeader } from "@/components/ui";
import { KIND_LABEL, PRODUCT_KINDS, isStrategic } from "@/lib/catalog/kinds";
import type { Mapping } from "@/lib/catalog/mapper";
import { TAXONOMY } from "@/lib/catalog/taxonomy";
import { getMapAnalysis, getSpend, getT } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Product Mapper") };
}

/**
 * Product Mapper: the catalogue put in order by the software — names,
 * categories, families — with the user confirming in bulk and deciding only
 * the doubtful cases, the largest spend first.
 */
export default async function ProductReviewPage() {
  const [analysis, spend, t] = await Promise.all([getMapAnalysis(), getSpend(), getT()]);
  const byId = new Map(analysis.products.map((m) => [m.productId, m]));
  const vm = (m: Mapping): MapProductVM => ({
    id: m.productId,
    current: m.current,
    name: m.name,
    category: m.category,
    subcategory: m.subcategory,
    answer: m.subKey ?? (isStrategic(m.kind) ? "" : m.kind),
    family: m.family,
    variant: m.variant,
    spend: m.spend,
    supplier: m.supplierName,
  });
  const inDuplicates = new Set(analysis.duplicates.flatMap((d) => d.productIds));
  const options: OptionGroup[] = [
    ...TAXONOMY.map((c) => ({ label: t(c.label), options: c.subs.map((s) => ({ value: s.key, label: t(s.label) })) })),
    { label: t("Not a product to compare"), options: PRODUCT_KINDS.filter((k) => !isStrategic(k)).map((k) => ({ value: k, label: t(KIND_LABEL[k]) })) },
  ];
  const review: ReviewVM = {
    analysed: analysis.totals.analysed,
    spend: analysis.totals.spend,
    confirmed: analysis.totals.confirmed,
    highSpend: analysis.totals.highSpend,
    reviewProducts: analysis.totals.review,
    reviewSpend: analysis.totals.reviewSpend,
    otherSpend: { items: spend.items.length, amount: spend.other },
    pareto: analysis.pareto,
    high: analysis.products.filter((m) => !m.mapped && m.level === "high" && !inDuplicates.has(m.productId)).map(vm),
    duplicates: analysis.duplicates.map((d) => ({
      key: d.key,
      level: d.level,
      reason: d.reason,
      suggestion: d.suggestion,
      proposedName: d.proposedName,
      spend: d.spend,
      products: d.productIds.map((id) => byId.get(id)!).map((m) => ({ id: m.productId, name: m.current, spend: m.spend, supplier: m.supplierName })),
    })),
    cards: analysis.cards.map((c) => ({
      key: c.key,
      type: c.type,
      supplier: c.supplierName,
      answer: c.subKey ?? c.kind ?? "",
      reason: c.reason,
      spend: c.spend,
      products: c.productIds.map((id) => vm(byId.get(id)!)),
    })),
    options,
    families: analysis.families.map((x) => ({ name: x.name, subcategory: x.subcategory, products: x.productIds.length, spend: x.spend })),
  };
  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/products", label: t("Products") }]} />}
        title={t("Product Mapper")}
        meta={t("We worked out what you buy. You only check where we are in doubt.")}
      />
      <MapperReview review={review} />
    </>
  );
}
