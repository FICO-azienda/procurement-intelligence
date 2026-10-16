import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AttachInvoiceOriginal } from "@/components/invoices";
import { Crumbs, PageHeader, Section, Table, Td, Th } from "@/components/ui";
import { getDb } from "@/db";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { readInvoice } from "@/server/invoices";

export async function generateMetadata({ params }: PageProps<"/purchases/invoices/[id]">): Promise<Metadata> {
  await connection();
  const { id } = await params;
  const inv = await readInvoice(await getDb(), id);
  return { title: inv ? `${inv.number} · ${inv.supplier.name}` : (await getT())("Invoices") };
}

/** One invoice: its lines as they were imported, its total worked out from them, and its original. */
export default async function InvoicePage({ params }: PageProps<"/purchases/invoices/[id]">) {
  await connection();
  const { id } = await params;
  const db = await getDb();
  const inv = await readInvoice(db, id);
  if (!inv) notFound();
  const t = await getT();
  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/purchases", label: t("Purchases") }, { href: "/purchases/invoices", label: t("Invoices") }]} />}
        title={t("Invoice {number}", { number: inv.number })}
        meta={
          <span className="flex flex-wrap gap-x-3">
            <Link href={`/suppliers/${inv.supplier.id}`} className="font-medium text-ledger hover:underline">
              {inv.supplier.name}
            </Link>
            <span className="num">{f.date(inv.date)}</span>
            <span>{t.n(inv.lines, "{n} line", "{n} lines")}</span>
          </span>
        }
      />
      <Section className="mb-5" title={t("The original")} description={t("The document the invoice was read from. Kept as a copy: as private as the data itself.")}>
        {inv.document ? (
          <a href={`/documents/${inv.document.id}`} className="text-[13.5px] font-medium text-ledger hover:underline">
            {inv.document.filename}
          </a>
        ) : (
          <div className="space-y-2">
            <p className="text-[13px] text-ink-3">{t("Not on file: its lines came from a file that is not the invoice itself, or were written by hand.")}</p>
            <AttachInvoiceOriginal invoiceId={inv.id} />
          </div>
        )}
      </Section>
      <Section title={t("Lines")} flush>
        <Table>
          <thead>
            <tr>
              <Th className="border-t-0">#</Th>
              <Th className="border-t-0">{t("Product")}</Th>
              <Th className="border-t-0" align="right">
                {t("Quantity")}
              </Th>
              <Th className="border-t-0" align="right">
                {t("Unit price")}
              </Th>
              <Th className="border-t-0" align="right">
                {t("Total")}
              </Th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((x) => (
              <tr key={x.id}>
                <Td muted className="num">
                  {x.line ?? "—"}
                </Td>
                <Td className="max-w-[320px] whitespace-normal!">
                  <Link href={`/products/${x.productId}`} className="font-medium hover:text-ledger">
                    {x.product}
                  </Link>
                  {x.description && x.description !== x.product && <div className="text-[12px] text-ink-3">{x.description}</div>}
                </Td>
                <Td align="right">
                  {f.number(x.quantity)} <span className="text-ink-3">{x.unit}</span>
                </Td>
                <Td align="right">{f.price(x.unitPrice, x.currency)}</Td>
                <Td align="right">{f.money(x.total, x.currency)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="flex justify-end gap-3 border-t border-rule bg-well px-5 py-3 text-[13px]">
          <span className="text-ink-3">{t("Total")}</span>
          <span className="num font-semibold">{f.money(inv.total)}</span>
          {inv.unpriced > 0 && <span className="text-caution">{t("{n} in other currencies not included (no exchange rate)", { n: inv.unpriced })}</span>}
        </div>
      </Section>
    </>
  );
}
