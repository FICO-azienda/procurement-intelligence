import Link from "next/link";
import type { Metadata } from "next";
import { QuoteDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { SupplierComparison } from "@/components/intel/supplier-comparison";
import { ProductPicker } from "@/components/product-picker";
import { ButtonLink, Crumbs, Empty, ExportLink, PageHeader } from "@/components/ui";
import { getDataset, getIntel, getT } from "@/lib/data";
import { compareColumns, decisionFor } from "@/lib/intel/decision";
import { explain } from "@/lib/intel/explain";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Compare") };
}

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const [data, intel, t] = await Promise.all([getDataset(), getIntel(), getT()]);
  const EXPLAIN = explain(t);

  if (intel.products.length === 0) {
    return (
      <>
        <PageHeader title={t("Compare suppliers")} />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title={t("Nothing to compare yet")}
            body={t("Import your invoices first: each product then shows what you pay next to what other suppliers offer.")}
            action={
              <ButtonLink href="/import" variant="primary">
                {t("Import invoices")}
              </ButtonLink>
            }
          />
        </div>
      </>
    );
  }

  // Without a choice: the product with the most suppliers on file — the most interesting comparison.
  const requested = typeof sp.product === "string" ? sp.product : "";
  const pi = intel.products.find((p) => p.product.id === requested) ?? [...intel.products].sort((a, b) => b.supplierOptions - a.supplierOptions || b.metrics.annualSpend - a.metrics.annualSpend)[0];
  const { product } = pi;
  const columns = compareColumns(pi, intel.config, t);
  const d = decisionFor(intel, product.id, t)!;
  const alternatives = columns.filter((c) => !c.isCurrent).length;

  return (
    <>
      <PageHeader
        eyebrow={
          requested ? (
            <Crumbs
              items={[
                { href: "/products", label: t("Products") },
                { href: `/products/${product.id}`, label: product.name },
              ]}
            />
          ) : undefined
        }
        title={t("Compare suppliers")}
        meta={
          <span className="inline-flex items-center gap-1.5">
            {t("Every supplier with a price for one product, side by side. Prices only for now")} <Hint text={EXPLAIN.trueCost} label={t("What is not included")} />
          </span>
        }
        actions={<QuoteDialog defaultProductId={product.id} trigger={{ label: t("Add quote"), variant: "primary" }} />}
      />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <ProductPicker products={intel.products.map(({ product: { id, name, sku } }) => ({ id, name, sku }))} value={product.id} />
        <div className="flex items-center gap-4">
          <ExportLink href={`/export/comparison?product=${product.id}`} />
          <Link href={`/products/${product.id}`} className="text-[13px] font-medium text-ledger hover:underline">
            {t("Open product")}
          </Link>
        </div>
      </div>

      <SupplierComparison product={product} columns={columns} rows={pi.comparison} quotes={data.quotes.filter((q) => q.productId === product.id)} />

      {alternatives === 0 && columns.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-rule-strong px-5 py-4 text-[13.5px]">
          <span className="min-w-[240px] flex-1 text-ink-2">{t("Only one supplier on file for this product. Add a quote from another supplier to see how your price compares.")}</span>
          <QuoteDialog defaultProductId={product.id} trigger={{ label: t("Add quote") }} />
        </div>
      )}

      {d.cheapestNotFirst && (
        <div className="mt-4 rounded-lg bg-wash px-4 py-3 text-[13.5px]">
          <div className="font-medium">{t("Why isn't the cheapest quote first?")}</div>
          <p className="mt-0.5 text-ink-2">{d.cheapestNotFirst.explanation}</p>
        </div>
      )}
      {alternatives > 0 && (
        <p className="mt-4 text-[12.5px] text-ink-3">
          {t("Suppliers are shown in order of how reliably they can be compared, not by price. Labels state facts — which one to buy from is your call.")}
        </p>
      )}
    </>
  );
}
