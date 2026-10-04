import Link from "next/link";
import type { Metadata } from "next";
import { SupplierDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { ButtonLink, Delta, Empty, ExportLink, PageHeader, SupplierStatusBadge, Table, Td, Th, rowClass } from "@/components/ui";
import { countryName } from "@/lib/countries";
import { KIND_LABEL } from "@/lib/catalog/kinds";
import { getDataset, getIntel, getSpend, getT } from "@/lib/data";
import * as f from "@/lib/format";
import { explain } from "@/lib/intel/explain";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Suppliers") };
}

export default async function SuppliersPage() {
  const [data, intel, spend, t] = await Promise.all([getDataset(), getIntel(), getSpend(), getT()]);
  const EXPLAIN = explain(t);
  const rows = [...intel.suppliers].sort((a, b) => b.metrics.annualSpend - a.metrics.annualSpend || a.supplier.name.localeCompare(b.supplier.name));

  return (
    <>
      <PageHeader title={t("Suppliers")} meta={t("Who you buy from, and who has given you a quote.")} actions={rows.length > 0 ? <ExportLink href="/export/suppliers" className="px-1" /> : undefined} />
      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty
            title={t("No suppliers yet")}
            body={t("Suppliers appear by themselves when you import invoices. You can also add one by hand: a name and a country are enough.")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/import" variant="primary">
                  {t("Import invoices")}
                </ButtonLink>
                <SupplierDialog trigger={{ label: t("Add a supplier") }} />
              </div>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Supplier")}</Th>
                <Th className="hidden border-t-0 @4xl:table-cell">{t("What you buy")}</Th>
                <Th className="border-t-0" align="right">{t("Annual spend")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">
                  {t("Prices this year")} <Hint text={EXPLAIN.supplierWeightedChange} />
                </Th>
                <Th className="hidden border-t-0 @3xl:table-cell">{t("Last purchase")}</Th>
                <Th className="border-t-0">{t("Status")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ supplier: s, metrics: m, priceChange }) => {
                const products = m.productIds.map((id) => data.products.find((p) => p.id === id)?.name).filter(Boolean) as string[];
                // Nothing from the catalogue: say what kind of spend it is instead.
                const names = products.length ? products : [...new Set(spend.items.filter((i) => i.supplierIds.includes(s.id)).map((i) => t(KIND_LABEL[i.kind])))];
                return (
                  <tr key={s.id} className={rowClass(true)}>
                    <Td className="py-2.5">
                      <Link href={`/suppliers/${s.id}`} className="stretched font-medium">
                        {s.name}
                      </Link>
                      <div className="text-[12px] text-ink-3">{countryName(s.country, t.locale) ?? t("Country not set")}</div>
                    </Td>
                    <Td className="hidden max-w-[280px] truncate @4xl:table-cell" muted={names.length === 0}>
                      {names.length === 0 ? (m.quotedProductIds.length > 0 ? t.n(m.quotedProductIds.length, "Quoted {n} product", "Quoted {n} products") : "—") : names.join(", ")}
                    </Td>
                    <Td align="right" className="font-medium">
                      {m.annualSpend > 0 ? f.money(Math.round(m.annualSpend)) : <span className="font-normal text-ink-4">—</span>}
                    </Td>
                    <Td align="right" className="hidden @2xl:table-cell">
                      <Delta value={priceChange.weightedPct} className="justify-end" />
                    </Td>
                    <Td muted className="num hidden @3xl:table-cell">
                      {f.date(m.lastPurchaseDate)}
                    </Td>
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
    </>
  );
}
