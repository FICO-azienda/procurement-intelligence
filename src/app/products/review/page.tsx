import type { Metadata } from "next";
import { MapperReview, type MapProductVM, type OptionGroup, type ReviewVM } from "@/components/catalog/mapper-review";
import { Crumbs, PageHeader } from "@/components/ui";
import { KIND_LABEL, PRODUCT_KINDS, isStrategic } from "@/lib/catalog/kinds";
import type { Mapping } from "@/lib/catalog/mapper";
import { TAXONOMY, subByKey } from "@/lib/catalog/taxonomy";
import { getMapAnalysis, getSpend, getT } from "@/lib/data";
import * as f from "@/lib/format";
import { getDb } from "@/db";
import { MacroReview } from "@/components/catalog/macro-review";
import { MergesMade } from "@/components/catalog/merges";
import { CLEANUP_TOP, ReadingTable } from "@/components/catalog/reading-table";
import { readProductMerges } from "@/server/mapper";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Product cleanup") };
}

/**
 * Product Mapper: the catalogue put in order by the software — names,
 * categories, families — with the user confirming in bulk and deciding only
 * the doubtful cases, the largest spend first.
 */
export default async function ProductReviewPage() {
  const [analysis, spend, t, merges] = await Promise.all([getMapAnalysis(), getSpend(), getT(), getDb().then(readProductMerges)]);
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
      ask: c.options.map((key) => subByKey(key)).filter((ref): ref is NonNullable<typeof ref> => !!ref).map((ref) => ({ value: ref.sub.key, label: t(ref.sub.label), noun: t(ref.sub.noun) })),
      // The code written in the description itself comes first: it is what the buyer reads on the invoice.
      code: c.options.length ? (byId.get(c.productIds[0])!.supplierCodes[0] ?? null) : null,
    })),
    options,
    families: analysis.families.map((x) => ({ name: x.name, subcategory: x.subcategory, products: x.productIds.length, spend: x.spend })),
  };
  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/products", label: t("Products") }]} />}
        title={t("Product cleanup")}
        meta={t("An invoice says who sold it and how the seller calls it; what the product is has to be read out of it. We read it for every product: you confirm what is sure, look at what is in doubt, and say what nothing on file can tell.")}
      />
      <ReadingTable rows={analysis.products.filter((m) => !m.mapped)} top={CLEANUP_TOP} groups={analysis.totals.groups} t={t} />
      <MacroReview
        products={analysis.macros.reduce((n, g) => n + g.members.length, 0)}
        macros={analysis.macros.map((g) => ({
          key: g.key,
          name: g.name,
          supplier: g.supplierName,
          unit: g.unit,
          spend: g.spend,
          suggestion: g.suggestion,
          confidence: g.confidence,
          differs: g.differs,
          reason: g.reason,
          members: g.members.map((x) => {
            const m = byId.get(x.productId)!;
            return { id: x.productId, name: x.name, variant: x.variant, price: x.price, spend: x.spend, original: m.originals.find((o) => o.toLowerCase() !== x.name.toLowerCase()) ?? null };
          }),
          leftOut: g.leftOut.map((x) => ({ name: x.name, price: x.price })),
        }))}
      />
      <MapperReview review={review} />
      <MergesMade merges={merges.map((m) => ({ id: m.id, kept: m.productName, merged: m.mergedName, date: f.date(m.createdAt.slice(0, 10)) }))} />
    </>
  );
}
