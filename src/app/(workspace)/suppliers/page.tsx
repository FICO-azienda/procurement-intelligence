import Link from "next/link";
import type { Metadata } from "next";
import { SupplierDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { DuplicateSuggestion, type DuplicateVM } from "@/components/suppliers/resolution";
import { ButtonLink, Delta, Disclosure, Empty, ExportLink, PageHeader, Section, SupplierStatusBadge, Table, Td, Th, rowClass } from "@/components/ui";
import { getDb } from "@/db";
import { countryName } from "@/lib/countries";
import { KIND_LABEL } from "@/lib/catalog/kinds";
import { getDataset, getIntel, getSpend, getT } from "@/lib/data";
import * as f from "@/lib/format";
import { explain } from "@/lib/intel/explain";
import type { SupplierMatch } from "@/lib/suppliers/resolve";
import { readResolution } from "@/server/suppliers";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Suppliers") };
}

export default async function SuppliersPage() {
  const [data, intel, spend, t] = await Promise.all([getDataset(), getIntel(), getSpend(), getT()]);
  const EXPLAIN = explain(t);
  const rows = [...intel.suppliers].sort((a, b) => b.metrics.annualSpend - a.metrics.annualSpend || a.supplier.name.localeCompare(b.supplier.name));
  // Records that may be the same company under two names: for the user to merge or keep apart.
  const resolution = await readResolution(await getDb(), t);
  const record = (id: string) => {
    const r = resolution.names.get(id)!;
    return { id, name: r.name, detail: [r.vatNumber ? t("VAT {vat}", { vat: r.vatNumber }) : t("no VAT number"), countryName(r.country, t.locale), t.n(r.records, "{n} line", "{n} lines")].filter(Boolean).join(" · ") };
  };
  const pair = (m: SupplierMatch): DuplicateVM => ({ keep: record(m.keep), merge: record(m.merge), why: m.why, confidence: m.confidence, conflicts: m.conflicts });

  return (
    <>
      <PageHeader title={t("Suppliers")} meta={t("Who you buy from, and who has given you a quote.")} actions={rows.length > 0 ? <ExportLink href="/export/suppliers" className="px-1" /> : undefined} />
      {resolution.suggestions.length > 0 && (
        <Section className="mb-5" title={t("These suppliers may be the same company")} description={t("Merging reads one record as the other: both stay on file with their invoices, and it can be undone.")} flush>
          <ul className="border-t border-rule">
            {resolution.suggestions.map((m) => (
              <DuplicateSuggestion key={`${m.keep}|${m.merge}`} pair={pair(m)} />
            ))}
          </ul>
        </Section>
      )}
      {resolution.weak.length > 0 && (
        <Disclosure className="mb-5" title={t("Similar names")} description={t.n(resolution.weak.length, "{n} pair, probably two companies: merge only if you know they are one", "{n} pairs, probably different companies: merge only if you know they are one")} flush>
          <ul>
            {resolution.weak.map((m) => (
              <DuplicateSuggestion key={`${m.keep}|${m.merge}`} pair={pair(m)} />
            ))}
          </ul>
        </Disclosure>
      )}
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
