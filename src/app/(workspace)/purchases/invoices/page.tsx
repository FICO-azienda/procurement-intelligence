import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Crumbs, Empty, PageHeader, Table, Td, Th, rowClass } from "@/components/ui";
import { getDb } from "@/db";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { syncInvoices } from "@/server/articles";
import { readInvoices } from "@/server/invoices";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Invoices") };
}

const PAGE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Every supplier invoice on file, the latest first: its lines are the purchases, its total is worked out from them. */
export default async function InvoicesPage({ searchParams }: PageProps<"/purchases/invoices">) {
  await connection();
  const sp = await searchParams;
  const db = await getDb();
  await syncInvoices(db);
  const t = await getT();
  const text = one(sp.q).trim();
  const supplierId = one(sp.supplier) || null;
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  const { rows, count } = await readInvoices(db, { supplierId, text: text || null, page, size: PAGE });
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const href = (n: number) => {
    const next = new URLSearchParams();
    if (text) next.set("q", text);
    if (supplierId) next.set("supplier", supplierId);
    if (n > 1) next.set("page", String(n));
    const s = next.toString();
    return s ? `/purchases/invoices?${s}` : "/purchases/invoices";
  };
  return (
    <>
      <PageHeader eyebrow={<Crumbs items={[{ href: "/purchases", label: t("Purchases") }]} />} title={t("Invoices")} meta={t("Each supplier invoice once, with its lines and the original document when it is on file.")} />
      <form action="/purchases/invoices" className="mb-4 flex flex-wrap gap-2">
        {supplierId && <input type="hidden" name="supplier" value={supplierId} />}
        <input name="q" defaultValue={text} placeholder={t("Invoice number or supplier")} aria-label={t("Search the invoices")} className="h-9 w-[280px] rounded-md border border-rule-strong bg-canvas px-2.5 text-[13.5px]" />
      </form>
      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty title={count === 0 && !text && !supplierId ? t("No invoice on file yet") : t("No invoice matches")} body={t("An invoice appears when purchases with its number are imported.")} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="border-t-0">{t("Invoice")}</Th>
                  <Th className="border-t-0">{t("Supplier")}</Th>
                  <Th className="hidden border-t-0 @2xl:table-cell">{t("Date")}</Th>
                  <Th className="hidden border-t-0 @3xl:table-cell" align="right">
                    {t("Lines")}
                  </Th>
                  <Th className="border-t-0" align="right">
                    {t("Total")}
                  </Th>
                  <Th className="hidden border-t-0 @4xl:table-cell">{t("Original")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={rowClass(true)}>
                    <Td className="py-2.5">
                      <Link href={`/purchases/invoices/${r.id}`} className="stretched num font-medium">
                        {r.number}
                      </Link>
                    </Td>
                    <Td>{r.supplier.name}</Td>
                    <Td muted className="num hidden @2xl:table-cell">
                      {f.date(r.date)}
                    </Td>
                    <Td align="right" muted className="hidden @3xl:table-cell">
                      {r.lines}
                    </Td>
                    <Td align="right" className="font-medium">
                      {f.money(r.total)}
                      {r.unpriced > 0 && <span className="ml-1.5 text-[11.5px] font-normal text-caution">{t("{n} in other currencies not included (no exchange rate)", { n: r.unpriced })}</span>}
                    </Td>
                    <Td muted className="hidden @4xl:table-cell">
                      {r.document ? t("on file") : t("not on file")}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-well px-5 py-3 text-[13px] text-ink-3">
              <span>{t.n(count, "{n} invoice", "{n} invoices")}</span>
              {pages > 1 && (
                <nav aria-label={t("Pages")} className="flex items-center gap-2">
                  {page > 1 && (
                    <Link href={href(page - 1)} className="font-medium text-ledger hover:underline">
                      ← {t("Previous")}
                    </Link>
                  )}
                  <span className="num">{t("page {page} of {pages}", { page, pages })}</span>
                  {page < pages && (
                    <Link href={href(page + 1)} className="font-medium text-ledger hover:underline">
                      {t("Next|page")} →
                    </Link>
                  )}
                </nav>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
