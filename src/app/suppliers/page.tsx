import Link from "next/link";
import type { Metadata } from "next";
import { SupplierDialog } from "@/components/dialogs";
import { Empty, PageHeader, SupplierStatusBadge, Table, Td, Th, rowClass } from "@/components/ui";
import { supplierMetrics, todayISO } from "@/lib/analytics";
import { getDataset } from "@/lib/data";
import * as f from "@/lib/format";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const data = await getDataset();
  const asOf = todayISO();
  const rows = data.suppliers
    .map((s) => ({ s, m: supplierMetrics(s, data, asOf) }))
    .sort((a, b) => b.m.annualSpend - a.m.annualSpend || a.s.name.localeCompare(b.s.name));

  return (
    <>
      <PageHeader
        title="Suppliers"
        meta="Who you buy from, and who has quoted. Spend is the last 12 months of purchases."
        actions={<SupplierDialog trigger={{ label: "Add supplier", variant: "primary" }} />}
      />
      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty title="No suppliers yet" body="Add the companies you buy from." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">Supplier</Th>
                <Th className="border-t-0">Country</Th>
                <Th className="border-t-0">Products supplied</Th>
                <Th className="border-t-0" align="right">Annual spend</Th>
                <Th className="border-t-0" align="right">Avg. lead time</Th>
                <Th className="border-t-0" align="right">Payment terms</Th>
                <Th className="border-t-0">Last purchase</Th>
                <Th className="border-t-0">Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, m }) => {
                const names = m.productIds
                  .map((id) => data.products.find((p) => p.id === id)?.name)
                  .filter(Boolean) as string[];
                return (
                  <tr key={s.id} className={rowClass(true)}>
                    <Td className="font-medium">
                      <Link href={`/suppliers/${s.id}`} className="stretched">
                        {s.name}
                      </Link>
                    </Td>
                    <Td muted>{s.country ?? "—"}</Td>
                    <Td className="max-w-[260px] truncate" muted={names.length === 0}>
                      {names.length === 0
                        ? m.quotedProductIds.length > 0
                          ? `Quoted ${m.quotedProductIds.length} product${m.quotedProductIds.length > 1 ? "s" : ""}`
                          : "—"
                        : names.join(", ")}
                    </Td>
                    <Td align="right" className="font-medium">{m.annualSpend > 0 ? f.money(m.annualSpend) : "—"}</Td>
                    <Td align="right" muted>{f.days(m.avgLeadTimeDays)}</Td>
                    <Td align="right" muted>{f.paymentTerms(s.paymentTermsDays)}</Td>
                    <Td muted className="num">{f.date(m.lastPurchaseDate)}</Td>
                    <Td>
                      <SupplierStatusBadge status={m.status} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
      <p className="mt-3 text-[12px] text-ink-4">
        Lead time: average of the supplier&apos;s latest quotes, otherwise their typical lead time.
      </p>
    </>
  );
}
