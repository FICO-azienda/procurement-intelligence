import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PurchaseDialog, QuoteDialog, SupplierDialog } from "@/components/dialogs";
import {
  Basis,
  Delta,
  Empty,
  PageHeader,
  Section,
  Sku,
  SupplierStatusBadge,
  Table,
  Td,
  Th,
  rowClass,
} from "@/components/ui";
import { basePrice, isPriced, priceChange, supplierMetrics, supplierOrderStats, todayISO } from "@/lib/analytics";
import { getDataset, getLearning } from "@/lib/data";
import { SourceTag } from "@/components/import/labels";
import * as f from "@/lib/format";
import { lookups, plural } from "@/lib/lookups";

export async function generateMetadata({ params }: PageProps<"/suppliers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const data = await getDataset();
  return { title: data.suppliers.find((s) => s.id === id)?.name ?? "Supplier" };
}

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  const [data, learning] = await Promise.all([getDataset(), getLearning()]);
  const supplier = data.suppliers.find((s) => s.id === id);
  if (!supplier) notFound();

  const asOf = todayISO();
  const l = lookups(data);
  const m = supplierMetrics(supplier, data, asOf);
  const stats = supplierOrderStats(supplier.id, data.purchases, asOf);
  const aliases = learning.supplierAliases.filter((a) => a.supplierId === supplier.id);
  const own = data.purchases
    .filter((p) => p.supplierId === supplier.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const ownQuotes = data.quotes
    .filter((q) => q.supplierId === supplier.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const supplied = m.productIds
    .map((pid) => {
      const product = l.product(pid)!;
      const fromSupplier = own.filter((p) => p.productId === pid);
      return { product, change: priceChange(fromSupplier, asOf), count: fromSupplier.length };
    })
    .filter((r) => r.product)
    .sort((a, b) => a.product.name.localeCompare(b.product.name));
  const changes = supplied.filter((r) => r.change.changePct != null);
  const common = { products: l.productOptions, suppliers: l.supplierOptions };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/suppliers" className="hover:text-ink">
            Suppliers
          </Link>
        }
        title={supplier.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{[supplier.city, supplier.country].filter(Boolean).join(", ") || "—"}</span>
            <SupplierStatusBadge status={m.status} />
          </span>
        }
        actions={
          <>
            <SupplierDialog
              supplier={supplier}
              deleteNote={`Also deletes ${plural(own.length, "purchase")} and ${plural(ownQuotes.length, "quote")}.`}
              trigger={{ label: "Edit" }}
            />
            <QuoteDialog {...common} defaultSupplierId={supplier.id} trigger={{ label: "Add quote" }} />
            <PurchaseDialog {...common} defaultSupplierId={supplier.id} trigger={{ label: "Add purchase", variant: "primary" }} />
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Section title="Details">
          <dl className="divide-y divide-rule text-[13px]">
            <Row label="Country">{supplier.country ?? "—"}</Row>
            <Row label="VAT number">{supplier.vatNumber ?? "—"}</Row>
            <Row label="Contact">{supplier.contactName ?? "—"}</Row>
            <Row label="Email">
              {supplier.email ? (
                <a href={`mailto:${supplier.email}`} className="text-ledger hover:underline">
                  {supplier.email}
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Phone">{supplier.phone ?? "—"}</Row>
            <Row label="Payment terms">{f.paymentTerms(supplier.paymentTermsDays)}</Row>
            <Row label="Typical lead time">{f.days(supplier.defaultLeadTimeDays)}</Row>
            <Row label="Currency">{supplier.currency}</Row>
          </dl>
          {supplier.notes && <p className="mt-3 text-[12.5px] text-ink-3">{supplier.notes}</p>}
          {aliases.length > 0 && (
            <div className="mt-3 text-[12.5px] text-ink-3">
              Also written as: <span className="text-ink-2">{aliases.map((a) => a.alias).join(" · ")}</span>
            </div>
          )}
        </Section>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-3 lg:grid-rows-[auto_auto_auto_1fr]">
          <Figure label="Annual spend" value={f.money(m.annualSpend)} note="Last 12 months, paid" />
          <Figure label="Purchases" value={String(stats.purchasesLast12m)} note={`lines in 12 months · ${stats.ordersLast12m} orders`} />
          <Figure label="Orders YTD" value={String(stats.ordersYtd)} note={`invoices in ${asOf.slice(0, 4)}`} />
          <Figure label="Average order" value={f.money(stats.averageOrderValue)} note="12-month spend ÷ orders" small />
          <Figure label="Products" value={String(m.productIds.length)} note={`${m.quotedProductIds.length} with quotes`} />
          <Figure
            label="Price increases"
            value={String(stats.priceIncreases)}
            note="products up in 12 months"
            tone={stats.priceIncreases > 0 ? "up" : undefined}
          />
          <div className="bg-canvas px-5 py-3.5 sm:col-span-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <span className="text-[12px] font-medium tracking-[0.02em] text-ink-3 uppercase">Last invoice</span>
              {stats.lastInvoice ? (
                <>
                  <span className="font-medium">{stats.lastInvoice.reference ?? "No number"}</span>
                  <span className="num text-ink-3">{f.date(stats.lastInvoice.date)}</span>
                  <SourceTag source={stats.lastInvoice.purchase.source} doc={stats.lastInvoice.purchase.sourceDoc} />
                </>
              ) : (
                <span className="text-ink-3">None yet</span>
              )}
            </div>
          </div>
          <div className="bg-canvas p-5 sm:col-span-3">
            <div className="mb-3 text-[12px] font-medium tracking-[0.02em] text-ink-3 uppercase">Price changes</div>
            {changes.length === 0 ? (
              <p className="text-[13px] text-ink-3">Needs at least two purchases of the same product.</p>
            ) : (
              <ul className="space-y-2.5">
                {changes.map(({ product, change }) => (
                  <li key={product.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13.5px]">
                    <Link href={`/products/${product.id}`} className="min-w-0 flex-1 font-medium hover:text-ledger">
                      {product.name}
                    </Link>
                    <span className="num text-ink-3">
                      {f.month(change.referenceDate)} {f.price(change.referencePrice)}
                    </span>
                    <span className="text-ink-4">→</span>
                    <span className="num">
                      <span className="text-ink-3">{f.month(change.currentDate)}</span>{" "}
                      <span className="font-medium">{f.price(change.currentPrice)}</span>
                    </span>
                    <Delta value={change.changePct} className="w-20 justify-end" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Section title="Products supplied" description="Current price = last price paid to this supplier" flush>
        {supplied.length === 0 ? (
          <Empty title="Nothing bought yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>SKU</Th>
                <Th align="right">Current price</Th>
                <Th align="right">12M change</Th>
                <Th align="right">Purchases</Th>
                <Th>Last purchase</Th>
              </tr>
            </thead>
            <tbody>
              {supplied.map(({ product, change, count }) => (
                <tr key={product.id} className={rowClass(true)}>
                  <Td className="font-medium">
                    <Link href={`/products/${product.id}`} className="stretched">
                      {product.name}
                    </Link>
                  </Td>
                  <Td>
                    <Sku>{product.sku}</Sku>
                  </Td>
                  <Td align="right" className="font-medium">
                    {change.currentPrice != null ? `${f.price(change.currentPrice)}/${product.unit}` : "—"}
                  </Td>
                  <Td align="right">
                    <Delta value={change.changePct} className="justify-end" />
                  </Td>
                  <Td align="right" muted>{count}</Td>
                  <Td muted className="num">{f.date(change.currentDate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section className="mt-6" title="Purchase history" description={plural(own.length, "purchase")} flush>
        {own.length === 0 ? (
          <Empty title="No purchases from this supplier" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Product</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Unit price</Th>
                <Th align="right">Total</Th>
                <Th>Invoice</Th>
                <Th>Source</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {own.map((p) => (
                <tr key={p.id} className={rowClass()}>
                  <Td className="num">{f.date(p.date)}</Td>
                  <Td>
                    <Link href={`/products/${p.productId}`} className="hover:text-ledger">
                      {l.product(p.productId)?.name}
                    </Link>
                  </Td>
                  <Td align="right">{f.quantity(p.quantity, p.unit)}</Td>
                  <Td align="right" className="font-medium">{f.price(p.unitPrice, p.currency)}</Td>
                  <Td align="right">{f.money(p.totalAmount, p.currency)}</Td>
                  <Td muted>{p.invoiceReference ?? "—"}</Td>
                  <Td>
                    <SourceTag source={p.source} doc={p.sourceDoc} />
                  </Td>
                  <Td>
                    <PurchaseDialog {...common} purchase={p} trigger={{ label: "Edit purchase", iconOnly: true }} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section className="mt-6" title="Quotes" description="Offers and price lists received from this supplier" flush>
        {ownQuotes.length === 0 ? (
          <Empty title="No quotes recorded" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Product</Th>
                <Th align="right">Quoted price</Th>
                <Th align="right">MOQ</Th>
                <Th align="right">Lead time</Th>
                <Th>Payment</Th>
                <Th>Incoterm</Th>
                <Th>Valid until</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {ownQuotes.map((q) => {
                const product = l.product(q.productId);
                return (
                  <tr key={q.id} className={rowClass()}>
                    <Td className="num">{f.date(q.date)}</Td>
                    <Td>{product?.name}</Td>
                    <Td align="right" className="font-medium">
                      {f.price(q.unitPrice, q.currency)}
                      {q.currency !== "EUR" && isPriced(q) && <span className="ml-1 text-ink-3">({f.price(basePrice(q))})</span>}
                    </Td>
                    <Td align="right" muted>{q.moq != null ? f.quantity(q.moq, product?.unit) : "—"}</Td>
                    <Td align="right" muted>{f.days(q.leadTimeDays)}</Td>
                    <Td muted>{f.paymentTerms(q.paymentTermsDays)}</Td>
                    <Td>{q.incoterm ? <Basis>{q.incoterm}</Basis> : "—"}</Td>
                    <Td muted className="num">{f.date(q.validUntil)}</Td>
                    <Td>
                      <QuoteDialog {...common} quote={q} trigger={{ label: "Edit quote", iconOnly: true }} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>
    </>
  );
}

function Figure({ label, value, note, small, tone }: { label: string; value: string; note?: string; small?: boolean; tone?: "up" }) {
  return (
    <div className="bg-canvas p-5">
      <div className="mb-2 text-[12px] font-medium tracking-[0.02em] text-ink-3 uppercase">{label}</div>
      <div className={`num leading-none font-semibold tracking-[-0.02em] ${small ? "text-[20px]" : "text-[24px]"} ${tone === "up" ? "text-up" : ""}`}>{value}</div>
      {note && <div className="mt-2 text-[12.5px] text-ink-3">{note}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}
