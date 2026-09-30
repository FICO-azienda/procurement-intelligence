import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { ProductDialog, PurchaseDialog, QuoteDialog } from "@/components/dialogs";
import { PriceChart } from "@/components/price-chart";
import {
  Basis,
  ButtonLink,
  Delta,
  Empty,
  Label,
  PageHeader,
  Section,
  Sku,
  StatusBadge,
  Table,
  Td,
  Th,
  cx,
  rowClass,
} from "@/components/ui";
import {
  basePrice,
  compareRows,
  currentSupplierId,
  pctChange,
  productMetrics,
  supplierTermsFor,
  todayISO,
} from "@/lib/analytics";
import { getDataset } from "@/lib/data";
import * as f from "@/lib/format";
import { lookups, plural } from "@/lib/lookups";

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const { id } = await params;
  const data = await getDataset();
  return { title: data.products.find((p) => p.id === id)?.name ?? "Product" };
}

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const { id } = await params;
  const data = await getDataset();
  const product = data.products.find((p) => p.id === id);
  if (!product) notFound();

  const asOf = todayISO();
  const l = lookups(data);
  const m = productMetrics(product, data.purchases, asOf);
  const supplier = l.supplier(currentSupplierId(product, m));
  const terms = supplier ? supplierTermsFor(supplier, data.quotes, product.id) : null;
  const history = data.purchases
    .filter((p) => p.productId === product.id)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const productQuotes = data.quotes.filter((q) => q.productId === product.id);
  const alternatives = compareRows(product, data, asOf);
  const lastFromSupplier = supplier
    ? history.filter((p) => p.supplierId === supplier.id).at(-1)
    : undefined;

  const common = { products: l.productOptions, suppliers: l.supplierOptions };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/products" className="hover:text-ink">
            Products
          </Link>
        }
        title={product.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              SKU <Sku>{product.sku}</Sku>
            </span>
            <span>Category: <span className="text-ink-2">{product.category ?? "—"}</span></span>
            <span>Unit: <span className="text-ink-2">{product.unit}</span></span>
            <StatusBadge status={m.status} title={m.statusReason} />
          </span>
        }
        actions={
          <>
            <ProductDialog
              product={product}
              suppliers={l.supplierOptions}
              categories={l.categories}
              deleteNote={`Also deletes ${plural(history.length, "purchase")} and ${plural(productQuotes.length, "quote")}.`}
              trigger={{ label: "Edit" }}
            />
            <QuoteDialog {...common} defaultProductId={product.id} trigger={{ label: "Add quote" }} />
            <PurchaseDialog {...common} defaultProductId={product.id} trigger={{ label: "Add purchase", variant: "primary" }} />
          </>
        }
      />

      {/* Four key figures */}
      <div className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Current price">
          <div className="num text-[28px] leading-none font-semibold tracking-[-0.02em]">
            {f.price(m.currentPrice)}
            {m.currentPrice != null && <span className="text-[15px] font-medium text-ink-3">/{product.unit}</span>}
          </div>
          <FigureNote>
            {m.currentDate ? (
              <>
                <Basis>Paid</Basis> {f.date(m.currentDate)}
              </>
            ) : (
              "No purchases yet"
            )}
          </FigureNote>
        </Figure>

        <Figure label="12M change">
          <Delta value={m.changePct} className="text-[28px] leading-none font-semibold tracking-[-0.02em] [&_svg]:size-5" />
          <FigureNote>
            {m.referencePrice != null ? (
              <span className="num">
                from {f.price(m.referencePrice)} · {f.month(m.referenceDate)}
              </span>
            ) : (
              "Needs at least two purchases"
            )}
          </FigureNote>
        </Figure>

        <Figure label="Annual spend">
          <div className="num text-[28px] leading-none font-semibold tracking-[-0.02em]">{f.money(m.annualSpend)}</div>
          <FigureNote>
            {m.annualQuantity > 0 ? (
              <span className="num">
                {f.quantity(m.annualQuantity, product.unit)} · at today&apos;s price {f.money(m.spendAtCurrentPrice)}
              </span>
            ) : (
              "No purchases in the last 12 months"
            )}
          </FigureNote>
        </Figure>

        <Figure label="Current supplier">
          {supplier ? (
            <Link
              href={`/suppliers/${supplier.id}`}
              className="text-[20px] leading-tight font-semibold tracking-[-0.015em] hover:text-ledger"
            >
              {supplier.name}
            </Link>
          ) : (
            <div className="text-[20px] font-semibold text-ink-3">Not set</div>
          )}
          <FigureNote>{supplier?.country ?? "—"}</FigureNote>
        </Figure>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <Section
          title="Price history"
          description={`Unit price paid per ${product.unit}, every purchase`}
          actions={
            m.previousPrice != null && (
              <span className="text-[12.5px] text-ink-3">
                Last change{" "}
                <Delta value={pctChange(m.previousPrice, m.currentPrice)} /> on {f.date(m.currentDate)}
              </span>
            )
          }
        >
          <PriceChart
            points={history.map((p) => ({
              date: p.date,
              price: basePrice(p),
              supplier: l.supplierName(p.supplierId),
              quantity: p.quantity,
              unit: product.unit,
            }))}
          />
        </Section>

        <Section title="Current supplier">
          {supplier && terms ? (
            <>
              <Link href={`/suppliers/${supplier.id}`} className="text-[15px] font-semibold hover:text-ledger">
                {supplier.name}
              </Link>
              <dl className="mt-3 divide-y divide-rule text-[13px]">
                <Row label="Country">{supplier.country ?? "—"}</Row>
                <Row label="Current price">
                  {lastFromSupplier ? (
                    <span className="num font-medium">
                      {f.price(basePrice(lastFromSupplier))}/{product.unit}
                    </span>
                  ) : (
                    "—"
                  )}
                </Row>
                <Row label="MOQ">{terms.moq != null ? f.quantity(terms.moq, product.unit) : "—"}</Row>
                <Row label="Lead time">{f.days(terms.leadTimeDays)}</Row>
                <Row label="Payment terms">{f.paymentTerms(terms.paymentTermsDays)}</Row>
                <Row label="Last purchase">{f.date(lastFromSupplier?.date)}</Row>
              </dl>
              {terms.fromDefaults && (
                <p className="mt-3 text-[12px] text-ink-4">
                  Terms are the supplier&apos;s defaults. Add a quote to record product-specific MOQ and terms.
                </p>
              )}
            </>
          ) : (
            <Empty title="No supplier yet" body="Set a current supplier or add a purchase." />
          )}
        </Section>
      </div>

      <Section
        className="mt-6"
        title="Purchase history"
        description={plural(history.length, "purchase")}
        flush
        actions={
          <Link href={`/purchases?product=${product.id}`} className="text-[13px] font-medium text-ledger hover:underline">
            Open in Purchases
          </Link>
        }
      >
        {history.length === 0 ? (
          <Empty title="No purchases yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Supplier</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Unit price</Th>
                <Th align="right">Freight</Th>
                <Th align="right">Total</Th>
                <Th>Currency</Th>
                <Th>Invoice</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {[...history].reverse().map((p) => (
                <tr key={p.id} className={rowClass()}>
                  <Td className="num">{f.date(p.date)}</Td>
                  <Td>{l.supplierName(p.supplierId)}</Td>
                  <Td align="right">{f.quantity(p.quantity, p.unit)}</Td>
                  <Td align="right" className="font-medium">{f.price(p.unitPrice, p.currency)}</Td>
                  <Td align="right" muted>{p.freightCost ? f.money(p.freightCost, p.currency) : "—"}</Td>
                  <Td align="right">{f.money(p.totalAmount, p.currency)}</Td>
                  <Td muted>{p.currency}</Td>
                  <Td muted>{p.invoiceReference ?? "—"}</Td>
                  <Td>
                    <PurchaseDialog {...common} purchase={p} trigger={{ label: "Edit purchase", iconOnly: true }} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <Section
        className="mt-6"
        title="Supplier alternatives"
        description="Quoted prices — landed cost not calculated yet"
        flush
        actions={
          <ButtonLink href={`/compare?product=${product.id}`} size="sm">
            Compare <ArrowRight size={13} />
          </ButtonLink>
        }
      >
        {alternatives.length === 0 ? (
          <Empty title="No quotes yet" body="Add quotes from current or alternative suppliers to compare them." />
        ) : (
          <ul className="border-t border-rule">
            {alternatives.map((row) => (
              <li
                key={row.supplier.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-rule px-5 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px_130px_110px]"
              >
                <div className="min-w-0">
                  <Link href={`/suppliers/${row.supplier.id}`} className="font-medium hover:text-ledger">
                    {row.supplier.name}
                  </Link>
                  <div className="text-[12.5px] text-ink-3">{row.supplier.country ?? "—"}</div>
                </div>
                <div className="num text-right font-medium">{f.price(row.price)}</div>
                <div className="hidden sm:block">
                  <Basis tone={row.priceBasis === "quote" ? "neutral" : "muted"}>
                    {row.priceBasis === "quote"
                      ? `Quoted${row.quote?.incoterm ? " · " + row.quote.incoterm : ""}`
                      : row.priceBasis === "last-paid"
                        ? "Last paid"
                        : "No price"}
                  </Basis>
                </div>
                <div className="hidden text-right sm:block">
                  <span
                    className={cx(
                      "inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium",
                      row.isCurrent ? "bg-ink text-white" : "bg-wash text-ink-2",
                    )}
                  >
                    {row.isCurrent ? "Current" : "Alternative"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-rule px-5 py-3 text-[12px] text-ink-3">
          Quoted prices only. Freight, duties, FX, quality, MOQ and payment terms can change the real cost — no
          alternative is ranked as cheaper until landed cost is calculated.
        </p>
      </Section>

      {(product.description || product.technicalSpecifications) && (
        <Section className="mt-6" title="Specifications">
          <div className="grid gap-6 sm:grid-cols-2">
            {product.description && (
              <div>
                <Label>Description</Label>
                <p className="mt-1 text-[13.5px] text-ink-2">{product.description}</p>
              </div>
            )}
            {product.technicalSpecifications && (
              <div>
                <Label>Technical specifications</Label>
                <p className="mt-1 text-[13.5px] whitespace-pre-line text-ink-2">{product.technicalSpecifications}</p>
              </div>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-canvas p-5">
      <div className="mb-2.5 text-[12px] font-medium tracking-[0.02em] text-ink-3 uppercase">{label}</div>
      {children}
    </div>
  );
}

function FigureNote({ children }: { children: React.ReactNode }) {
  return <div className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-ink-3">{children}</div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}
