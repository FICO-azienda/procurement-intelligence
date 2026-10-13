import type { Metadata } from "next";
import { CategoryManager, type ManagedProduct } from "@/components/catalog/category-manager";
import { Crumbs, PageHeader } from "@/components/ui";
import type { TreeProduct } from "@/lib/catalog/tree";
import { getT } from "@/lib/data";
import { getCategoryTree } from "@/server/categories";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Categories") };
}

/**
 * The company's own hierarchy — category › subcategory › product — and where
 * it is arranged. The daily filters only read it; what is decided here is
 * what every page shows the next time it is opened.
 */
export default async function CategoriesPage() {
  const [tree, t] = await Promise.all([getCategoryTree(), getT()]);
  const product = (p: TreeProduct): ManagedProduct => ({ id: p.id, name: p.name, detail: [p.supplier, p.unit].filter(Boolean).join(" · ") });
  const spend = tree.categories.find((c) => c.group === "spend");
  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/products", label: t("Products") }]} />}
        title={t("Categories")}
        meta={t("How your products are filed: category, subcategory, product. Rename, move or add: the products stay the same ones, with their purchases, prices and invoices.")}
      />
      <CategoryManager
        categories={tree.categories
          .filter((c) => c.group === "category")
          .map((c) => ({
            name: c.name,
            count: c.count,
            subs: [...c.subs.map((s) => ({ name: s.name as string | null, products: s.products.map(product) })), ...(c.direct.length ? [{ name: null, products: c.direct.map(product) }] : [])],
          }))}
        unclassified={(tree.categories.find((c) => c.group === "unclassified")?.direct ?? []).map(product)}
      />
      {spend && (
        <p className="mt-6 max-w-[720px] text-[13px] text-ink-3">
          {t.n(spend.count, "{n} more item on file is not a product of the catalogue — transport, services, utilities, charges: it is grouped by kind, which is set on its own page.", "{n} more items on file are not products of the catalogue — transport, services, utilities, charges: they are grouped by kind, which is set on each item's page.")}
        </p>
      )}
    </>
  );
}
