import Link from "next/link";
import type { Metadata } from "next";
import { ProductDialog, PurchaseDialog } from "@/components/dialogs";
import { Delta, Empty, PageHeader, Sku, StatusBadge, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { currentSupplierId, productMetrics, todayISO, type ProductStatus } from "@/lib/analytics";
import { getDataset } from "@/lib/data";
import * as f from "@/lib/format";
import { lookups } from "@/lib/lookups";

export const metadata: Metadata = { title: "Products" };

const FILTERS: { value: ProductStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "increase", label: "Price increase" },
  { value: "stable", label: "Stable" },
  { value: "review", label: "Review" },
];

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const { status } = await searchParams;
  const data = await getDataset();
  const asOf = todayISO();
  const l = lookups(data);

  const rows = data.products
    .map((product) => ({ product, m: productMetrics(product, data.purchases, asOf) }))
    .sort((a, b) => b.m.annualSpend - a.m.annualSpend || a.product.name.localeCompare(b.product.name));
  const active = FILTERS.some((x) => x.value === status) ? (status as ProductStatus | "all") : "all";
  const visible = active === "all" ? rows : rows.filter((r) => r.m.status === active);

  return (
    <>
      <PageHeader
        title="Products"
        meta="Materials and components you buy. Prices and spend are computed from purchases."
        actions={
          <>
            <PurchaseDialog products={l.productOptions} suppliers={l.supplierOptions} trigger={{ label: "Add purchase" }} />
            <ProductDialog
              suppliers={l.supplierOptions}
              categories={l.categories}
              trigger={{ label: "Add product", variant: "primary" }}
            />
          </>
        }
      />

      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((x) => {
          const n = x.value === "all" ? rows.length : rows.filter((r) => r.m.status === x.value).length;
          const on = x.value === active;
          return (
            <Link
              key={x.value}
              href={x.value === "all" ? "/products" : `/products?status=${x.value}`}
              aria-current={on ? "page" : undefined}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors",
                on ? "bg-ink text-white" : "text-ink-2 hover:bg-wash",
              )}
            >
              {x.label}
              <span className={cx("num text-[12px]", on ? "text-white/60" : "text-ink-4")}>{n}</span>
            </Link>
          );
        })}
      </nav>

      <div className="rounded-lg border border-rule">
        {visible.length === 0 ? (
          <Empty
            title={rows.length === 0 ? "No products yet" : "Nothing here"}
            body={rows.length === 0 ? "Add the materials you buy most — start with the biggest spend." : "No product has this status."}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">Product</Th>
                <Th className="border-t-0">SKU</Th>
                <Th className="border-t-0">Category</Th>
                <Th className="border-t-0">Supplier</Th>
                <Th className="border-t-0" align="right">Price</Th>
                <Th className="border-t-0">Unit</Th>
                <Th className="border-t-0" align="right">12M change</Th>
                <Th className="border-t-0" align="right">Annual qty</Th>
                <Th className="border-t-0" align="right">Annual spend</Th>
                <Th className="border-t-0">Last purchase</Th>
                <Th className="border-t-0">Status</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ product, m }) => (
                <tr key={product.id} className={rowClass(true)}>
                  <Td className="font-medium">
                    <Link href={`/products/${product.id}`} className="stretched">
                      {product.name}
                    </Link>
                  </Td>
                  <Td>
                    <Sku>{product.sku}</Sku>
                  </Td>
                  <Td muted>{product.category ?? "—"}</Td>
                  <Td>{l.supplierName(currentSupplierId(product, m))}</Td>
                  <Td align="right" className="font-medium">{f.price(m.currentPrice)}</Td>
                  <Td muted>{product.unit}</Td>
                  <Td align="right">
                    <Delta value={m.changePct} className="justify-end" />
                  </Td>
                  <Td align="right" muted>{f.number(m.annualQuantity)}</Td>
                  <Td align="right" className="font-medium">{f.money(m.annualSpend)}</Td>
                  <Td muted className="num">{f.date(m.currentDate)}</Td>
                  <Td>
                    <StatusBadge status={m.status} title={m.statusReason} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      <p className="mt-3 text-[12px] text-ink-4">
        Price change: last price paid vs. 12 months ago. Status: above +5% → Price increase · no purchase for 6 months or no data → Review.
      </p>
    </>
  );
}
