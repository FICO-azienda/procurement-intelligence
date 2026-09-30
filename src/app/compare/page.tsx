import Link from "next/link";
import type { Metadata } from "next";
import { Info } from "lucide-react";
import { QuoteDialog } from "@/components/dialogs";
import { ProductPicker } from "@/components/product-picker";
import { Basis, ButtonLink, Empty, PageHeader, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { compareRows, todayISO } from "@/lib/analytics";
import { getDataset } from "@/lib/data";
import * as f from "@/lib/format";
import { lookups } from "@/lib/lookups";

export const metadata: Metadata = { title: "Compare" };

/** Cost components a true comparison needs. Shown so the gap is explicit. */
const NOT_INCLUDED = ["Freight", "Insurance", "Duties", "Anti-dumping", "Broker fees", "FX", "Working capital", "Inventory", "Quality", "MOQ impact"];

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const data = await getDataset();
  const l = lookups(data);
  const asOf = todayISO();

  if (data.products.length === 0) {
    return (
      <>
        <PageHeader title="Compare" />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty title="No products yet" action={<ButtonLink href="/products">Add products</ButtonLink>} />
        </div>
      </>
    );
  }

  // Default to the product with the most quotes — the most interesting comparison.
  const requested = typeof sp.product === "string" ? sp.product : "";
  const product =
    data.products.find((p) => p.id === requested) ??
    [...data.products].sort(
      (a, b) =>
        data.quotes.filter((q) => q.productId === b.id).length -
        data.quotes.filter((q) => q.productId === a.id).length,
    )[0];
  const rows = compareRows(product, data, asOf);
  const common = { products: l.productOptions, suppliers: l.supplierOptions };

  return (
    <>
      <PageHeader
        title="Compare"
        meta="Offers from current and alternative suppliers, side by side."
        actions={<QuoteDialog {...common} defaultProductId={product.id} trigger={{ label: "Add quote", variant: "primary" }} />}
      />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <ProductPicker
          products={data.products.map(({ id, name, sku }) => ({ id, name, sku }))}
          value={product.id}
        />
        <Link href={`/products/${product.id}`} className="text-[13px] font-medium text-ledger hover:underline">
          Open product
        </Link>
      </div>

      <div className="mb-4 flex gap-3 rounded-lg border border-caution/20 bg-caution-wash px-4 py-3">
        <Info size={16} className="mt-0.5 shrink-0 text-caution" />
        <div className="text-[13px]">
          <div className="font-semibold text-ink">Quoted prices only</div>
          <p className="mt-0.5 text-ink-2">
            Freight, duties, FX, inventory costs and quality adjustments are not included yet. A lower quoted price is
            not necessarily a lower cost.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty
            title="No offers for this product yet"
            body="Record the current supplier's price list and any alternative quotes you receive."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">Supplier</Th>
                <Th className="border-t-0">Country</Th>
                <Th className="border-t-0" align="right">Quoted price</Th>
                <Th className="border-t-0">Incoterm</Th>
                <Th className="border-t-0" align="right">MOQ</Th>
                <Th className="border-t-0" align="right">Lead time</Th>
                <Th className="border-t-0">Payment</Th>
                <Th className="border-t-0">Quote date</Th>
                <Th className="border-t-0">Valid until</Th>
                <Th className="border-t-0" />
                <Th className="w-10 border-t-0" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expired = r.quote?.validUntil != null && r.quote.validUntil < asOf;
                return (
                  <tr key={r.supplier.id} className={rowClass()}>
                    <Td className="font-medium">
                      <Link href={`/suppliers/${r.supplier.id}`} className="hover:text-ledger">
                        {r.supplier.name}
                      </Link>
                    </Td>
                    <Td muted>{r.supplier.country ?? "—"}</Td>
                    <Td align="right">
                      <span className="text-[14px] font-semibold">{f.price(r.price)}</span>
                      <span className="text-ink-3">/{product.unit}</span>
                      {r.quote && r.quote.currency !== "EUR" && (
                        <div className="text-[12px] text-ink-3">{f.price(r.quote.unitPrice, r.quote.currency)}</div>
                      )}
                    </Td>
                    <Td>
                      {r.priceBasis === "last-paid" ? (
                        <Basis tone="muted">Last paid</Basis>
                      ) : r.terms.incoterm ? (
                        <Basis>{r.terms.incoterm}</Basis>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </Td>
                    <Td align="right" muted>{r.terms.moq != null ? f.number(r.terms.moq) : "—"}</Td>
                    <Td align="right" className={cx(r.terms.fromDefaults && "text-ink-3")}>
                      {r.terms.leadTimeDays != null ? `${r.terms.leadTimeDays}d` : "—"}
                    </Td>
                    <Td className={cx(r.terms.fromDefaults && "text-ink-3")}>
                      {r.terms.paymentTermsDays == null
                        ? "—"
                        : r.terms.paymentTermsDays === 0
                          ? "Advance"
                          : `${r.terms.paymentTermsDays}d`}
                    </Td>
                    <Td muted className="num">{f.date(r.quote?.date)}</Td>
                    <Td className="num">
                      <span className={expired ? "text-caution" : "text-ink-3"}>
                        {f.date(r.quote?.validUntil)}
                        {expired && " · expired"}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className={cx(
                          "inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium",
                          r.isCurrent ? "bg-ink text-white" : "bg-wash text-ink-2",
                        )}
                      >
                        {r.isCurrent ? "Current" : "Alternative"}
                      </span>
                    </Td>
                    <Td>
                      {r.quote && (
                        <QuoteDialog {...common} quote={r.quote} trigger={{ label: "Edit quote", iconOnly: true }} />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-dashed border-rule-strong px-5 py-4">
        <div className="text-[13px] font-medium">Not in this comparison yet</div>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          These will make up the true landed cost per supplier. Until then, suppliers are listed, not ranked.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {NOT_INCLUDED.map((c) => (
            <Basis key={c} tone="muted">
              {c}
            </Basis>
          ))}
        </div>
      </div>
    </>
  );
}
