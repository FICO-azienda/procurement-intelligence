import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PurchaseDialog, QuoteDialog, SupplierDialog } from "@/components/dialogs";
import { Remember } from "@/components/shell/recent";
import { Basis, Crumbs, Delta, Disclosure, Empty, PageHeader, Section, SupplierStatusBadge, Table, Td, Th, rowClass } from "@/components/ui";
import { basePrice, isPriced, priceChange, supplierMetrics, supplierOrderStats, todayISO } from "@/lib/analytics";
import { countryName } from "@/lib/countries";
import { KIND_LABEL } from "@/lib/catalog/kinds";
import { getDataset, getIntel, getLearning, getSpend, getT } from "@/lib/data";
import { SourceTag } from "@/components/import/labels";
import * as f from "@/lib/format";
import { lookups } from "@/lib/lookups";

export async function generateMetadata({ params }: PageProps<"/suppliers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [data, t] = await Promise.all([getDataset(), getT()]);
  return { title: data.suppliers.find((s) => s.id === id)?.name ?? t("Supplier") };
}

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  const [data, learning, intel, spend, t] = await Promise.all([getDataset(), getLearning(), getIntel(), getSpend(), getT()]);
  const otherSpend = spend.items.filter((i) => i.supplierIds.includes(id));
  const supplier = data.suppliers.find((s) => s.id === id);
  const si = intel.suppliers.find((s) => s.supplier.id === id);
  if (!supplier || !si) notFound();

  const asOf = todayISO();
  const l = lookups(data);
  const country = countryName(supplier.country, t.locale);
  const payment = f.paymentTerms(supplier.paymentTermsDays, t);
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

  return (
    <>
      <Remember kind="supplier" id={supplier.id} title={supplier.name} />
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/suppliers", label: t("Suppliers") }]} />}
        title={supplier.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{[supplier.city, country].filter(Boolean).join(", ") || "—"}</span>
            <SupplierStatusBadge status={m.status} />
          </span>
        }
        actions={
          <>
            <SupplierDialog
              supplier={supplier}
              deleteNote={t("Also deletes {purchases} and {quotes}.", { purchases: t.n(own.length, "{n} purchase", "{n} purchases"), quotes: t.n(ownQuotes.length, "{n} quote", "{n} quotes") })}
              trigger={{ label: t("Edit"), variant: "ghost" }}
            />
            <QuoteDialog defaultSupplierId={supplier.id} trigger={{ label: t("Add quote") }} />
            <PurchaseDialog defaultSupplierId={supplier.id} trigger={{ label: t("Add purchase") }} />
          </>
        }
      />

      {/* The supplier in four numbers */}
      <section aria-label={t("Key figures")} className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-rule bg-rule xl:grid-cols-4">
        <Figure label={t("Annual spend")} value={f.money(Math.round(m.annualSpend))} note={si.spendShare > 0 ? t("{pct}% of what you buy", { pct: f.number(si.spendShare * 100, 0) }) : t("No purchases in 12 months")} />
        <Figure label={t("Products")} value={String(m.productIds.length)} note={m.quotedProductIds.length ? t("{n} with a quote on file", { n: m.quotedProductIds.length }) : t("bought from this supplier")} />
        <Figure
          label={t("Price movement")}
          value={si.priceChange.weightedPct == null ? "—" : f.pct(si.priceChange.weightedPct)}
          note={t("this year, weighted by spend")}
          tone={si.priceChange.weightedPct != null && Number(si.priceChange.weightedPct.toFixed(1)) > 0 ? "up" : undefined}
        />
        <Figure label={t("Orders")} value={String(stats.ordersLast12m)} note={stats.averageOrderValue != null ? t("{amount} on average", { amount: f.money(Math.round(stats.averageOrderValue)) }) : t("in the last 12 months")} />
      </section>

      {/* Key observations: what a buyer would point out */}
      <Section title={t("Key observations")} className="mb-6">
        <ul className="max-w-3xl list-disc space-y-1 pl-4 text-[14px] leading-relaxed text-ink-2 marker:text-ink-4">
          {si.summary.map((x) => (
            <li key={x}>{x}</li>
          ))}
          {stats.priceIncreases > 0 && (
            <li>{t.n(stats.priceIncreases, "{n} product has gone up in price over 12 months.", "{n} products have gone up in price over 12 months.")}</li>
          )}
        </ul>
      </Section>

      {(si.singleSourcedHighSpend.length > 0 || si.productsWithAlternatives.length > 0) && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section title={t("Dependency")} description={t("High-spend products bought only from this supplier")}>
            {si.singleSourcedHighSpend.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("No high-spend product depends on this supplier alone.")}</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {si.singleSourcedHighSpend.map((pid) => {
                  const pi = intel.products.find((p) => p.product.id === pid)!;
                  return (
                    <li key={pid} className="flex items-baseline justify-between gap-4">
                      <Link href={`/products/${pid}`} className="font-medium hover:text-ledger">
                        {pi.product.name}
                      </Link>
                      <span className="num text-ink-2">
                        {f.money(pi.metrics.annualSpend)} · {t("{pct}% of total spend", { pct: f.number(pi.spendShare * 100, 0) })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section title={t("Alternatives on file")} description={t("Products of this supplier with a recent quote from someone else")}>
            {si.productsWithAlternatives.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t("No recent alternative quotes for this supplier's products.")}</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {si.productsWithAlternatives.map((pid) => {
                  const pi = intel.products.find((p) => p.product.id === pid)!;
                  return (
                    <li key={pid} className="flex items-baseline justify-between gap-4">
                      <Link href={`/compare?product=${pid}`} className="font-medium hover:text-ledger">
                        {pi.product.name}
                      </Link>
                      <span className="num text-ink-2">
                        {pi.bestSaving ? t("{pct} lowest comparable quote", { pct: f.pct(-pi.bestSaving.priceDifferencePct!) }) : t("no lower comparable quote")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      )}

      <Section title={t("Products supplied")} description={t("The price is the last one paid to this supplier")} flush>
        {supplied.length === 0 ? (
          <Empty title={t("Nothing bought yet")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("Product")}</Th>
                <Th align="right">{t("Price")}</Th>
                <Th align="right">{t("12 months")}</Th>
                <Th className="hidden @2xl:table-cell" align="right">{t("Purchases")}</Th>
                <Th className="hidden @2xl:table-cell">{t("Last purchase")}</Th>
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
                  <Td align="right" className="font-medium">
                    {change.currentPrice != null ? `${f.priceShort(change.currentPrice)}/${product.unit}` : "—"}
                  </Td>
                  <Td align="right">
                    <Delta value={change.changePct} className="justify-end" />
                  </Td>
                  <Td align="right" muted className="hidden @2xl:table-cell">{count}</Td>
                  <Td muted className="num hidden @2xl:table-cell">{f.date(change.currentDate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <div className="mt-6 space-y-3">
      {otherSpend.length > 0 && (
        <Section title={t("Other company spend")} description={t("Not products to compare: counted in the spend with this supplier")} className="mb-6">
          <ul className="space-y-1.5 text-[13.5px]">
            {otherSpend.map((i) => (
              <li key={i.product.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <Link href={`/products/${i.product.id}`} className="min-w-0 font-medium hover:text-ledger">
                  {i.product.name}
                </Link>
                <span className="text-ink-3">
                  {t(KIND_LABEL[i.kind])} · {t.n(i.lines, "{n} invoice line", "{n} invoice lines")} · <span className="num font-medium text-ink">{f.money(Math.round(i.annualSpend))}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Disclosure title={t("Purchase history")} description={t.n(own.length, "{n} purchase", "{n} purchases")} flush>
        {own.length === 0 ? (
          <Empty title={t("No purchases from this supplier")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Date")}</Th>
                <Th className="border-t-0">{t("Product")}</Th>
                <Th className="border-t-0" align="right">{t("Quantity")}</Th>
                <Th className="border-t-0" align="right">{t("Unit price")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Total")}</Th>
                <Th className="hidden border-t-0 @4xl:table-cell">{t("Source")}</Th>
                <Th className="w-10 border-t-0" />
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
                  <Td align="right" className="hidden @2xl:table-cell">{f.money(p.totalAmount, p.currency)}</Td>
                  <Td className="hidden @4xl:table-cell">
                    <SourceTag source={p.source} doc={p.sourceDoc} />
                    {p.invoiceReference && <span className="ml-1.5 text-[12px] text-ink-3">{p.invoiceReference}</span>}
                  </Td>
                  <Td>
                    <PurchaseDialog purchase={p} trigger={{ label: t("Edit purchase"), iconOnly: true }} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Disclosure>

      <Disclosure title={t("Quotes")} description={ownQuotes.length ? t.n(ownQuotes.length, "{n} quote", "{n} quotes") : t("None on file")} flush>
        {ownQuotes.length === 0 ? (
          <Empty title={t("No quotes from this supplier yet")} body={t("Add one to compare their price with what you pay.")} action={<QuoteDialog defaultSupplierId={supplier.id} trigger={{ label: t("Add quote") }} />} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Date")}</Th>
                <Th className="border-t-0">{t("Product")}</Th>
                <Th className="border-t-0" align="right">{t("Quoted price")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Minimum order")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Lead time")}</Th>
                <Th className="hidden border-t-0 @4xl:table-cell">{t("Payment")}</Th>
                <Th className="hidden border-t-0 @4xl:table-cell">{t("Valid until")}</Th>
                <Th className="w-10 border-t-0" />
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
                    <Td align="right" muted className="hidden @2xl:table-cell">{q.moq != null ? f.quantity(q.moq, product?.unit) : "—"}</Td>
                    <Td align="right" muted className="hidden @2xl:table-cell">{f.days(q.leadTimeDays, t)}</Td>
                    <Td muted className="hidden @4xl:table-cell">
                      {f.paymentTerms(q.paymentTermsDays, t)} {q.incoterm && <Basis>{q.incoterm}</Basis>}
                    </Td>
                    <Td muted className="num hidden @4xl:table-cell">{f.date(q.validUntil)}</Td>
                    <Td>
                      <QuoteDialog quote={q} trigger={{ label: t("Edit quote"), iconOnly: true }} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Disclosure>

      <Disclosure title={t("Contacts and terms")} description={[country, payment !== "—" ? t("payment {terms}", { terms: payment.toLowerCase() }) : null].filter(Boolean).join(" · ")}>
        <dl className="grid grid-cols-1 gap-x-10 text-[13px] sm:grid-cols-2">
          <Row label={t("Country")}>{country ?? "—"}</Row>
          <Row label={t("City")}>{supplier.city ?? "—"}</Row>
          <Row label={t("VAT number")}>{supplier.vatNumber ?? "—"}</Row>
          <Row label={t("Contact person")}>{supplier.contactName ?? "—"}</Row>
          <Row label={t("Email")}>
            {supplier.email ? (
              <a href={`mailto:${supplier.email}`} className="text-ledger hover:underline">
                {supplier.email}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label={t("Phone")}>{supplier.phone ?? "—"}</Row>
          <Row label={t("Payment terms")}>{payment}</Row>
          <Row label={t("Usual lead time")}>{f.days(supplier.defaultLeadTimeDays, t)}</Row>
          <Row label={t("Invoices in")}>{supplier.currency}</Row>
        </dl>
        {supplier.notes && <p className="mt-3 text-[12.5px] text-ink-3">{supplier.notes}</p>}
        {aliases.length > 0 && (
          <div className="mt-3 text-[12.5px] text-ink-3">
            {t("Also written as:")} <span className="text-ink-2">{aliases.map((a) => a.alias).join(" · ")}</span>
          </div>
        )}
      </Disclosure>
      </div>

    </>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "up" }) {
  return (
    <div className="bg-canvas p-4 sm:p-5">
      <div className={`num text-[26px] leading-none font-semibold tracking-[-0.025em] ${tone === "up" ? "text-up" : ""}`}>{value}</div>
      <div className="mt-2 text-[13px] font-medium text-ink-2">{label}</div>
      {note && <div className="mt-0.5 text-[12px] text-ink-3">{note}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-rule py-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}
