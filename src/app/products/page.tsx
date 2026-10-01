import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { ProductDialog, PurchaseDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { AlertBadge, ConfidenceBadge } from "@/components/intel/badges";
import { ProductFilters } from "@/components/intel/product-filters";
import { Delta, Empty, ExportLink, PageHeader, Sku, StatusBadge, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDataset, getIntel } from "@/lib/data";
import * as f from "@/lib/format";
import { EXPLAIN } from "@/lib/intel/explain";
import { SORTS, filterProducts, quickFilters } from "@/lib/intel/filters";
import { lookups } from "@/lib/lookups";

export const metadata: Metadata = { title: "Products" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const sp = await searchParams;
  const [data, intel] = await Promise.all([getDataset(), getIntel()]);
  const l = lookups(data);
  const filters = one(sp.f).split(",").filter(Boolean);
  const query = { filters, supplierId: one(sp.supplier) || null, category: one(sp.category) || null, search: one(sp.q) || null, sort: one(sp.sort) || null };
  const visible = filterProducts(intel.products, query, intel.config);
  const quick = quickFilters(intel.config);

  // Toggle one quick filter, keeping the rest of the URL.
  const toggle = (key: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "f") next.set(k, v);
    const set = filters.includes(key) ? filters.filter((x) => x !== key) : [...filters, key];
    if (set.length) next.set("f", set.join(","));
    const s = next.toString();
    return s ? `/products?${s}` : "/products";
  };
  const filtered = filters.length > 0 || query.supplierId || query.category || query.search;

  return (
    <>
      <PageHeader
        title="Products"
        meta="Materials and components you buy. Prices, spend and savings are computed from your purchases and quotes."
        actions={
          <>
            <ExportLink href="/export/products" className="px-1" />
            <PurchaseDialog products={l.productOptions} suppliers={l.supplierOptions} trigger={{ label: "Add purchase" }} />
            <ProductDialog suppliers={l.supplierOptions} categories={l.categories} trigger={{ label: "Add product", variant: "primary" }} />
          </>
        }
      />

      <nav aria-label="Quick filters" className="mb-3 flex flex-wrap gap-1.5">
        {quick.map((q) => {
          const on = filters.includes(q.key);
          const n = intel.products.filter(q.test).length;
          return (
            <Link
              key={q.key}
              href={toggle(q.key)}
              aria-pressed={on}
              scroll={false}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors",
                on ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-2 hover:border-ink/30 hover:bg-wash",
                n === 0 && !on && "opacity-50",
              )}
            >
              {q.label}
              <span className={cx("num text-[11.5px]", on ? "text-white/60" : "text-ink-4")}>{n}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mb-4">
        <Suspense>
          <ProductFilters suppliers={l.supplierOptions} categories={l.categories} sorts={SORTS} />
        </Suspense>
      </div>

      <div className="rounded-lg border border-rule">
        {visible.length === 0 ? (
          <Empty
            title={intel.products.length === 0 ? "No products yet" : "No products match these filters"}
            body={intel.products.length === 0 ? "Add the materials you buy most — or import invoices and spreadsheets." : undefined}
            action={filtered ? <Link href="/products" className="text-[13px] font-medium text-ledger hover:underline">Clear filters</Link> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">Product</Th>
                <Th className="border-t-0">Category</Th>
                <Th className="border-t-0">Current supplier</Th>
                <Th className="border-t-0" align="right">Current price</Th>
                <Th className="border-t-0" align="right">
                  12M change <Hint text={EXPLAIN.change} />
                </Th>
                <Th className="border-t-0" align="right">Annual qty</Th>
                <Th className="border-t-0" align="right">Annual spend</Th>
                <Th className="border-t-0" align="right">Suppliers</Th>
                <Th className="border-t-0" align="right">
                  Potential saving <Hint text={EXPLAIN.potentialSaving} />
                </Th>
                <Th className="border-t-0">Last purchase</Th>
                <Th className="border-t-0">Status</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const current = p.comparison.find((r) => r.isCurrent);
                return (
                  <tr key={p.product.id} className={rowClass(true)}>
                    <Td className="py-2">
                      <Link href={`/products/${p.product.id}`} className="stretched font-medium">
                        {p.product.name}
                      </Link>
                      <div>
                        <Sku>{p.product.sku}</Sku>
                      </div>
                    </Td>
                    <Td muted>{p.product.category ?? "—"}</Td>
                    <Td>{current?.supplier.name ?? "—"}</Td>
                    <Td align="right" className="font-medium">
                      {p.price.current ? (
                        <>
                          {f.price(p.price.current.price)}
                          <span className="font-normal text-ink-3">/{p.product.unit}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td align="right">
                      <Delta value={p.price.changes.m12.pct} className="justify-end" />
                    </Td>
                    <Td align="right" muted>{p.metrics.annualQuantity > 0 ? f.number(p.metrics.annualQuantity) : "—"}</Td>
                    <Td align="right" className="font-medium">
                      {f.money(p.metrics.annualSpend)}
                      {p.highSpend && <span className="ml-1 text-[11px] font-normal text-ink-3" title="High-spend product">●</span>}
                    </Td>
                    <Td align="right" muted>
                      {p.supplierOptions}
                    </Td>
                    <Td align="right">
                      {p.bestSaving ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-medium">{f.money(p.bestSaving.potentialSaving)}/yr</span>
                          <ConfidenceBadge level={p.bestSaving.confidence} />
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </Td>
                    <Td muted className="num">{f.date(p.metrics.currentDate)}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        {p.alert ? <AlertBadge level={p.alert} short /> : <StatusBadge status={p.metrics.status} title={p.metrics.statusReason} />}
                        {p.concentration.sourcing === "single" && p.highSpend && (
                          <span className="inline-flex h-[22px] items-center rounded-full bg-caution-wash px-2 text-[12px] font-medium whitespace-nowrap text-caution">Single-source</span>
                        )}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
      <p className="mt-3 text-[12px] text-ink-4">
        {visible.length} of {intel.products.length} products · ● high-spend (first {Math.round(intel.config.paretoShare * 100)}% of annual spend) · potential savings are price-only estimates.
      </p>
    </>
  );
}
