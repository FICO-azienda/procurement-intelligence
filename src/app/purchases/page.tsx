import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { PurchaseDialog } from "@/components/dialogs";
import { PurchaseFilters } from "@/components/purchase-filters";
import { Basis, Empty, PageHeader, Sku, Table, Td, Th, rowClass } from "@/components/ui";
import { baseTotal } from "@/lib/analytics";
import { getDataset } from "@/lib/data";
import * as f from "@/lib/format";
import { lookups, plural } from "@/lib/lookups";

export const metadata: Metadata = { title: "Purchases" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const sp = await searchParams;
  const q = one(sp.q).toLowerCase();
  const product = one(sp.product);
  const supplier = one(sp.supplier);
  const from = one(sp.from);
  const to = one(sp.to);

  const data = await getDataset();
  const l = lookups(data);

  const rows = data.purchases
    .filter((p) => {
      if (product && p.productId !== product) return false;
      if (supplier && p.supplierId !== supplier) return false;
      if (from && p.date < from) return false;
      if (to && p.date > to) return false;
      if (q) {
        const prod = l.product(p.productId);
        const hay = [prod?.name, prod?.sku, l.supplierName(p.supplierId), p.invoiceReference, p.notes]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const total = rows.reduce((s, p) => s + baseTotal(p), 0);
  const common = { products: l.productOptions, suppliers: l.supplierOptions };

  return (
    <>
      <PageHeader
        title="Purchases"
        meta="Every purchase line. This is the raw data all prices and spend are calculated from."
        actions={<PurchaseDialog {...common} trigger={{ label: "Add purchase", variant: "primary" }} />}
      />

      <Suspense>
        <PurchaseFilters products={l.productOptions} suppliers={l.supplierOptions} />
      </Suspense>

      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty
            title={data.purchases.length === 0 ? "No purchases yet" : "No purchases match these filters"}
            body={data.purchases.length === 0 ? "Add a purchase or import a CSV." : undefined}
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="border-t-0">Date</Th>
                  <Th className="border-t-0">Supplier</Th>
                  <Th className="border-t-0">Product</Th>
                  <Th className="border-t-0">SKU</Th>
                  <Th className="border-t-0" align="right">Quantity</Th>
                  <Th className="border-t-0">Unit</Th>
                  <Th className="border-t-0" align="right">Unit price</Th>
                  <Th className="border-t-0">Currency</Th>
                  <Th className="border-t-0" align="right">Freight</Th>
                  <Th className="border-t-0" align="right">Total</Th>
                  <Th className="border-t-0">Invoice / Ref.</Th>
                  <Th className="border-t-0">Source</Th>
                  <Th className="w-10 border-t-0" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const prod = l.product(p.productId);
                  return (
                    <tr key={p.id} className={rowClass()}>
                      <Td className="num">{f.date(p.date)}</Td>
                      <Td>
                        <Link href={`/suppliers/${p.supplierId}`} className="hover:text-ledger">
                          {l.supplierName(p.supplierId)}
                        </Link>
                      </Td>
                      <Td className="font-medium">
                        <Link href={`/products/${p.productId}`} className="hover:text-ledger">
                          {prod?.name}
                        </Link>
                      </Td>
                      <Td>
                        <Sku>{prod?.sku}</Sku>
                      </Td>
                      <Td align="right">{f.number(p.quantity)}</Td>
                      <Td muted>{p.unit}</Td>
                      <Td align="right" className="font-medium">{f.price(p.unitPrice, p.currency)}</Td>
                      <Td muted>{p.currency}</Td>
                      <Td align="right" muted>{p.freightCost ? f.money(p.freightCost, p.currency) : "—"}</Td>
                      <Td align="right">{f.money(p.totalAmount, p.currency)}</Td>
                      <Td muted>{p.invoiceReference ?? "—"}</Td>
                      <Td>
                        <Basis tone={p.source === "demo" ? "muted" : "neutral"}>{p.source}</Basis>
                      </Td>
                      <Td>
                        <PurchaseDialog {...common} purchase={p} trigger={{ label: "Edit purchase", iconOnly: true }} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-well px-5 py-3 text-[13px]">
              <span className="text-ink-3">{plural(rows.length, "purchase")}</span>
              <span>
                <span className="text-ink-3">Total </span>
                <span className="num font-semibold">{f.money(total)}</span>
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
