import Link from "next/link";
import type { Metadata } from "next";
import { DataReadinessPill } from "@/components/dataset/product-data";
import { ButtonLink, Crumbs, Empty, ExportLink, PageHeader, Table, Td, Th, rowClass } from "@/components/ui";
import { getT } from "@/lib/data";
import { DATASET_CONFIG, FIELDS } from "@/lib/dataset/fields";
import { dataReadiness, type ProductProfile } from "@/lib/dataset/profile";
import * as f from "@/lib/format";
import type { T } from "@/lib/i18n";
import { getPriorityDataset } from "@/server/product-data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Product data") };
}

/** What a product still needs, in a few words: the first missing fields, or the estimates to confirm. */
function gap(p: ProductProfile, t: T): string {
  if (p.missing.length === 1) return t("{field} missing", { field: t(FIELDS[p.missing[0]].label) });
  if (p.missing.length > 1) return t("{n} missing: {fields}", { n: p.missing.length, fields: p.missing.slice(0, 2).map((k) => t(FIELDS[k].label).toLowerCase()).join(", ") + (p.missing.length > 2 ? "…" : "") });
  if (p.toConfirm.length) return t.n(p.toConfirm.length, "{n} estimate to confirm", "{n} estimates to confirm");
  return t("Complete");
}

/**
 * The procurement product dataset of the products that make up most of the
 * spend (the existing Pareto, in its order): what is known about each, what
 * is estimated, what is missing — and the short round that completes the
 * five largest first.
 */
export default async function ProductDataPage() {
  const [{ rows, total }, t] = await Promise.all([getPriorityDataset(), getT()]);
  if (!rows.length) {
    return (
      <>
        <PageHeader eyebrow={<Crumbs items={[{ href: "/products", label: t("Products") }]} />} title={t("Product data")} />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty title={t("No priority products yet")} body={t("Import your invoices first: the products that make up most of your spend will appear here.")} action={<ButtonLink href="/import" variant="primary">{t("Import invoices")}</ButtonLink>} />
        </div>
      </>
    );
  }
  const top = rows.filter((r) => r.top);
  const open = top.filter((r) => r.profile.missing.length || r.profile.toConfirm.length);
  const share = (n: number) => (total > 0 ? n / total : 0);

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/products", label: t("Products") }]} />}
        title={t("Product data")}
        meta={t("The products that make up most of your spend: what is already known about each, what the software estimated, and what is still missing.")}
        actions={<ExportLink href="/export/product-dataset">{t("Export the dataset")}</ExportLink>}
      />

      <section className="mb-5 rounded-xl border border-ledger/25">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 bg-ledger-wash/40 px-5 py-4 sm:px-6">
          <div className="min-w-[240px] flex-1">
            <h2 className="text-[15.5px] font-semibold">{t("Complete the Top {n} product data", { n: top.length })}</h2>
            <p className="mt-0.5 max-w-[78ch] text-[13px] text-ink-2">
              {open.length
                ? t("The {n} largest products by spend first. Everything already in your invoices, quotes and records is filled in: only what is missing or estimated is asked.", { n: top.length })
                : t("The {n} largest products have every important field known and confirmed.", { n: top.length })}
            </p>
          </div>
          {open.length > 0 && (
            <ButtonLink href={`/products/${open[0].intel.product.id}?complete=1&review=1#product-data`} variant="primary">
              {t("Review missing data")}
            </ButtonLink>
          )}
        </div>
        <ol className="divide-y divide-rule">
          {top.map((r) => (
            <li key={r.intel.product.id} className="relative flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-well sm:px-6">
              <span className="num w-5 text-[13px] text-ink-3">{r.rank}</span>
              <Link href={`/products/${r.intel.product.id}?complete=1&review=1#product-data`} className="stretched min-w-[200px] flex-1 text-[13.5px] font-medium">
                {r.intel.product.name}
              </Link>
              <DataReadinessPill level={dataReadiness(r.profile)} />
              <span className="min-w-[220px] text-[12.5px] text-ink-2">{gap(r.profile, t)}</span>
              <span className="num w-[90px] text-right text-[12.5px] text-ink-3">{t("{known}/{total} fields", { known: r.profile.counts.importantKnown, total: r.profile.counts.important })}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="rounded-lg border border-rule">
        <div className="px-5 py-3.5 sm:px-6">
          <h2 className="text-[14px] font-semibold">{t("Priority products")}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">{t("{n} products, {pct}% of your product spend — the existing Pareto, largest first.", { n: rows.length, pct: Math.round(share(rows.reduce((s, r) => s + r.intel.metrics.annualSpend, 0)) * 100) })}</p>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>{t("Product")}</Th>
              <Th align="right">{t("Spend")}</Th>
              <Th className="hidden @3xl:table-cell" align="right">{t("% of spend")}</Th>
              <Th className="hidden @2xl:table-cell">{t("Data readiness")}</Th>
              <Th>{t("Sourcing|readiness")}</Th>
              <Th className="hidden @2xl:table-cell">{t("True cost")}</Th>
              <Th className="hidden @4xl:table-cell">{t("Important missing data")}</Th>
              <Th className="hidden @5xl:table-cell">{t("Next action")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.intel.product.id} className={rowClass(true)}>
                <Td className="max-w-[260px] whitespace-normal!">
                  <Link href={`/products/${r.intel.product.id}#product-data`} className="stretched font-medium">
                    {r.intel.product.name}
                  </Link>
                  {r.top && <div className="text-[11.5px] font-medium text-ledger">{t("Top {n}", { n: DATASET_CONFIG.topProducts })}</div>}
                </Td>
                <Td align="right" className="font-medium">
                  {f.moneyApprox(r.intel.metrics.annualSpend)}
                </Td>
                <Td align="right" className="hidden @3xl:table-cell">
                  {f.number(share(r.intel.metrics.annualSpend) * 100, 1)}%
                </Td>
                <Td className="hidden @2xl:table-cell">
                  <span className="inline-flex items-center gap-2">
                    <DataReadinessPill level={dataReadiness(r.profile)} />
                    <span className="num text-[12px] text-ink-3">
                      {r.profile.counts.importantKnown}/{r.profile.counts.important}
                    </span>
                  </span>
                </Td>
                <Td>
                  <DataReadinessPill level={r.profile.readiness.sourcing.level} />
                </Td>
                <Td className="hidden @2xl:table-cell">
                  <DataReadinessPill level={r.profile.readiness.true_cost.level} />
                </Td>
                <Td className="hidden max-w-[240px] whitespace-normal! text-[12.5px] text-ink-2 @4xl:table-cell">{r.profile.missing.length ? r.profile.missing.slice(0, 3).map((k) => t(FIELDS[k].label)).join(", ") + (r.profile.missing.length > 3 ? ` ${t("and {n} more", { n: r.profile.missing.length - 3 })}` : "") : <span className="text-ink-4">—</span>}</Td>
                <Td className="hidden max-w-[260px] whitespace-normal! text-[12.5px] text-ink-2 @5xl:table-cell">{r.profile.next.label}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <p className="mt-3 max-w-[90ch] text-[12px] text-ink-4">
        {t("Sourcing: enough to ask a new supplier for a useful quote (neutral name, specification, unit, volume, delivery country). True cost: enough to compare an offer with what you pay today, transport and payment terms included. One does not wait for the other.")}
      </p>
    </>
  );
}
