import Link from "next/link";
import type { Metadata } from "next";
import { QuoteDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { ConfidenceBadge } from "@/components/intel/badges";
import { PriceOnlyNotice, SupplierComparison } from "@/components/intel/supplier-comparison";
import { ProductPicker } from "@/components/product-picker";
import { Basis, ButtonLink, Empty, ExportLink, PageHeader } from "@/components/ui";
import { getDataset, getIntel } from "@/lib/data";
import * as f from "@/lib/format";
import { EXPLAIN } from "@/lib/intel/explain";
import { lookups } from "@/lib/lookups";

export const metadata: Metadata = { title: "Compare" };

/** Cost components a true comparison needs. Shown so the gap is explicit. */
const NOT_INCLUDED = ["Freight", "Insurance", "Duties", "Anti-dumping", "Broker fees", "FX", "Working capital", "Inventory", "Quality", "MOQ impact"];

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const [data, intel] = await Promise.all([getDataset(), getIntel()]);
  const l = lookups(data);

  if (intel.products.length === 0) {
    return (
      <>
        <PageHeader title="Compare" />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty title="No products yet" action={<ButtonLink href="/products">Add products</ButtonLink>} />
        </div>
      </>
    );
  }

  // Default to the product with the most supplier options — the most interesting comparison.
  const requested = typeof sp.product === "string" ? sp.product : "";
  const pi =
    intel.products.find((p) => p.product.id === requested) ??
    [...intel.products].sort((a, b) => b.supplierOptions - a.supplierOptions || b.metrics.annualSpend - a.metrics.annualSpend)[0];
  const { product } = pi;
  const best = pi.bestSaving;
  const common = { products: l.productOptions, suppliers: l.supplierOptions };

  return (
    <>
      <PageHeader
        title="Compare"
        meta="The latest price from every supplier for one product, on the same basis."
        actions={<QuoteDialog {...common} defaultProductId={product.id} trigger={{ label: "Add quote", variant: "primary" }} />}
      />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <ProductPicker products={data.products.map(({ id, name, sku }) => ({ id, name, sku }))} value={product.id} />
        <div className="flex items-center gap-4">
          <ExportLink href={`/export/comparison?product=${product.id}`}>CSV</ExportLink>
          <Link href={`/products/${product.id}`} className="text-[13px] font-medium text-ledger hover:underline">
            Open product
          </Link>
        </div>
      </div>

      <PriceOnlyNotice className="mb-4" />

      <div className="rounded-lg border border-rule">
        <SupplierComparison intel={pi} quotes={data.quotes.filter((q) => q.productId === product.id)} products={l.productOptions} suppliers={l.supplierOptions} />
      </div>

      {best && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-rule px-5 py-4">
          <div className="min-w-[260px] flex-1 text-[13.5px]">
            <div className="font-medium">
              Largest nominal gap: {l.supplierName(best.alternativeSupplierId)} at <span className="num">{f.price(best.comparePrice)}</span>, {f.pct(-best.priceDifferencePct!)} vs the current price
            </div>
            <div className="mt-0.5 text-ink-3">
              Potential nominal saving <span className="num font-medium text-ink-2">{f.money(best.potentialSaving)}/year</span> on {f.quantity(best.annualQuantity, product.unit)} <Hint text={EXPLAIN.potentialSaving} />
            </div>
          </div>
          <ConfidenceBadge level={best.confidence} suffix=" confidence" />
          <ButtonLink href={`/opportunities/${best.key}`} size="sm">
            See what&apos;s missing
          </ButtonLink>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-dashed border-rule-strong px-5 py-4">
        <div className="text-[13px] font-medium">Not in this comparison yet</div>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          These will make up the true landed cost per supplier. Until then, suppliers are listed, not ranked — and no supplier is called the best.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {NOT_INCLUDED.map((c) => (
            <Basis key={c} tone="muted">
              {c}
            </Basis>
          ))}
        </div>
      </div>
    </>
  );
}
