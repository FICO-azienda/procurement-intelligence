import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { EntryButton, PurchaseDialog } from "@/components/dialogs";
import { PurchaseFilters } from "@/components/purchase-filters";
import { ButtonLink, Empty, PageHeader, Table, Td, Th, rowClass } from "@/components/ui";
import { baseTotal, isPriced } from "@/lib/analytics";
import { SourceTag } from "@/components/import/labels";
import { getDataset, getT } from "@/lib/data";
import * as f from "@/lib/format";
import { lookups } from "@/lib/lookups";
import { resolve } from "@/lib/catalog/tree";
import { getCategoryTree } from "@/server/categories";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Purchases") };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Rows per page: the totals and the filters read every purchase, the page shows these many. */
const PURCHASES_PAGE = 50;

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const sp = await searchParams;
  const q = one(sp.q).toLowerCase();
  const supplier = one(sp.supplier);
  const from = one(sp.from);
  const to = one(sp.to);

  const [data, tree, t] = await Promise.all([getDataset(), getCategoryTree(), getT()]);
  const l = lookups(data);
  // A category, one of its subcategories or a single product: each is a set of products, and a purchase is of one of them.
  const { productIds } = resolve(tree, { category: one(sp.category) || null, subcategory: one(sp.subcategory) || null, product: one(sp.product) || null }, t);

  const rows = data.purchases
    .filter((p) => {
      if (productIds && !productIds.has(p.productId)) return false;
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

  const total = rows.filter(isPriced).reduce((s, p) => s + baseTotal(p), 0);
  const unpriced = rows.filter((p) => !isPriced(p)).length;
  // One page of the rows is sent to the browser; the count and the total above are of all of them.
  const pages = Math.max(1, Math.ceil(rows.length / PURCHASES_PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(one(sp.page)) || 1)));
  const shown = rows.slice((page - 1) * PURCHASES_PAGE, page * PURCHASES_PAGE);
  const pageHref = (n: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "page" && one(v)) next.set(k, one(v));
    if (n > 1) next.set("page", String(n));
    const query = next.toString();
    return query ? `/purchases?${query}` : "/purchases";
  };

  return (
    <>
      <PageHeader
        title={t("Purchases")}
        meta={t("Every purchase, one line each. All prices and spend are calculated from these.")}
        actions={<ButtonLink href="/purchases/invoices">{t("Invoices")}</ButtonLink>}
      />

      <Suspense>
        <PurchaseFilters tree={tree} suppliers={l.supplierOptions} />
      </Suspense>

      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty
            title={data.purchases.length === 0 ? t("No purchases yet") : t("No purchases match these filters")}
            body={data.purchases.length === 0 ? t("Upload invoices or add your first purchase to start building a price history.") : undefined}
            action={
              data.purchases.length === 0 ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <ButtonLink href="/import" variant="primary">
                    {t("Import invoices")}
                  </ButtonLink>
                  <EntryButton kind="paste" label={t("Paste from Excel")} />
                  <PurchaseDialog trigger={{ label: t("Add manually") }} />
                </div>
              ) : (
                <Link href="/purchases" className="text-[13px] font-medium text-ledger hover:underline">
                  {t("Clear filters")}
                </Link>
              )
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="border-t-0">{t("Date")}</Th>
                  <Th className="border-t-0">{t("Product")}</Th>
                  <Th className="hidden border-t-0 @3xl:table-cell">{t("Supplier")}</Th>
                  <Th className="border-t-0" align="right">{t("Quantity")}</Th>
                  <Th className="border-t-0" align="right">{t("Unit price")}</Th>
                  <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Total")}</Th>
                  <Th className="hidden border-t-0 @4xl:table-cell">{t("Source")}</Th>
                  <Th className="w-10 border-t-0" />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const prod = l.product(p.productId);
                  return (
                    <tr key={p.id} className={rowClass()}>
                      <Td className="num">{f.date(p.date)}</Td>
                      <Td className="max-w-[260px] whitespace-normal!">
                        <Link href={`/products/${p.productId}`} className="font-medium hover:text-ledger">
                          {prod?.name}
                        </Link>
                        <div className="truncate text-[12px] text-ink-3 @3xl:hidden">{l.supplierName(p.supplierId)}</div>
                      </Td>
                      <Td className="hidden @3xl:table-cell">
                        <Link href={`/suppliers/${p.supplierId}`} className="hover:text-ledger">
                          {l.supplierName(p.supplierId)}
                        </Link>
                      </Td>
                      <Td align="right">
                        {f.number(p.quantity)} <span className="text-ink-3">{p.unit}</span>
                      </Td>
                      <Td align="right" className="font-medium">
                        {f.price(p.unitPrice, p.currency)}
                        {!isPriced(p) && <span className="ml-1.5 text-[11.5px] font-normal text-caution">{t("no exchange rate")}</span>}
                      </Td>
                      <Td align="right" className="hidden @2xl:table-cell">
                        {f.money(p.totalAmount, p.currency)}
                      </Td>
                      <Td className="hidden @4xl:table-cell">
                        <SourceTag source={p.source} doc={p.sourceDoc} />
                        {p.invoiceReference &&
                          (p.invoiceId ? (
                            <Link href={`/purchases/invoices/${p.invoiceId}`} className="ml-1.5 text-[12px] text-ledger hover:underline">
                              {p.invoiceReference}
                            </Link>
                          ) : (
                            <span className="ml-1.5 text-[12px] text-ink-3">{p.invoiceReference}</span>
                          ))}
                      </Td>
                      <Td>
                        <PurchaseDialog purchase={p} trigger={{ label: t("Edit purchase"), iconOnly: true }} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-well px-5 py-3 text-[13px]">
              <span className="text-ink-3">
                {pages > 1 ? t("{from}–{to} of {total}", { from: f.number((page - 1) * PURCHASES_PAGE + 1), to: f.number((page - 1) * PURCHASES_PAGE + shown.length), total: t.n(rows.length, "{n} purchase", "{n} purchases") }) : t.n(rows.length, "{n} purchase", "{n} purchases")}
              </span>
              {pages > 1 && (
                <nav aria-label={t("Pages")} className="flex items-center gap-1.5">
                  {page > 1 ? (
                    <Link href={pageHref(page - 1)} scroll={false} className="rounded-md px-2 py-1 font-medium text-ledger hover:bg-wash">
                      ← {t("Previous")}
                    </Link>
                  ) : (
                    <span className="px-2 py-1 text-ink-4">← {t("Previous")}</span>
                  )}
                  <span className="num px-1 text-ink-3">{t("page {page} of {pages}", { page, pages })}</span>
                  {page < pages ? (
                    <Link href={pageHref(page + 1)} scroll={false} className="rounded-md px-2 py-1 font-medium text-ledger hover:bg-wash">
                      {t("Next|page")} →
                    </Link>
                  ) : (
                    <span className="px-2 py-1 text-ink-4">{t("Next|page")} →</span>
                  )}
                </nav>
              )}
              <span>
                {unpriced > 0 && <span className="mr-3 text-caution">{t("{n} in other currencies not included (no exchange rate)", { n: unpriced })}</span>}
                <span className="text-ink-3">{t("Total")} </span>
                <span className="num font-semibold">{f.money(total)}</span>
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
