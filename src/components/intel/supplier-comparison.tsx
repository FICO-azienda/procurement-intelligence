import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import type { QuoteData } from "@/lib/analytics";
import * as f from "@/lib/format";
import type { ProductIntel } from "@/lib/intel/engine";
import { EXPLAIN } from "@/lib/intel/explain";
import { formatSpecs } from "@/lib/validation";
import { QuoteDialog, type ProductOption, type SupplierOption } from "../dialogs";
import { Hint } from "../hint";
import { SourceTag } from "../import/labels";
import { Empty, Table, Td, Th, cx, rowClass } from "../ui";
import { AgeTag, ComparabilityBadge } from "./badges";
import { OfferDialog } from "./controls";

/** The disclaimer that must travel with every price comparison. */
export function PriceOnlyNotice({ className }: { className?: string }) {
  return (
    <div className={cx("flex gap-3 rounded-lg border border-caution/20 bg-caution-wash px-4 py-3", className)}>
      <Info size={16} className="mt-0.5 shrink-0 text-caution" />
      <div className="text-[13px]">
        <div className="font-semibold text-ink">Quoted / purchase prices only</div>
        <p className="mt-0.5 text-ink-2">
          Freight, duties, FX, inventory, quality and financial costs are not included yet. A lower price is not necessarily a lower cost.
        </p>
      </div>
    </div>
  );
}

/**
 * Every supplier with a price for the product, on the same basis. Listed —
 * current supplier first, then alphabetically — never ranked.
 */
export function SupplierComparison({
  intel,
  quotes,
  products,
  suppliers,
}: {
  intel: ProductIntel;
  quotes: QuoteData[];
  products: ProductOption[];
  suppliers: SupplierOption[];
}) {
  const { product, comparison } = intel;
  if (comparison.length === 0) {
    return <Empty title="No prices on record" body="Add a purchase or a quote to start comparing suppliers." />;
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>Supplier</Th>
          <Th>Country</Th>
          <Th align="right">Latest price</Th>
          <Th>Basis</Th>
          <Th align="right">MOQ</Th>
          <Th align="right">Lead time</Th>
          <Th>Payment</Th>
          <Th>
            Last update <Hint text={EXPLAIN.quoteAge} />
          </Th>
          <Th>Currency</Th>
          <Th align="right">
            Price difference <Hint text={EXPLAIN.priceDifference} />
          </Th>
          <Th>
            Comparability <Hint text={EXPLAIN.comparability} />
          </Th>
          <Th className="w-16" />
        </tr>
      </thead>
      <tbody>
        {comparison.map((r) => {
          const quote = r.kind === "quote" ? quotes.find((q) => q.id === r.recordId) : undefined;
          const notes = [...r.comparabilityReasons];
          return (
            <tr key={r.supplier.id} className={rowClass()}>
              <Td className="max-w-[320px] whitespace-normal! py-2.5 align-top">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/suppliers/${r.supplier.id}`} className="font-medium hover:text-ledger">
                    {r.supplier.name}
                  </Link>
                  {r.isCurrent && <span className="inline-flex h-[20px] items-center rounded-full bg-ink px-2 text-[11.5px] font-medium text-white">Current</span>}
                  {r.isLowest && <span className="inline-flex h-[20px] items-center rounded-full border border-rule-strong px-2 text-[11.5px] font-medium text-ink-2">Lowest quoted price</span>}
                </div>
                {r.specDifferences.length > 0 && (
                  <div className="mt-1 flex items-start gap-1.5 text-[12px] text-caution">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    Specification difference: {r.specDifferences.map((d) => `${d.name} ${d.theirs} (yours ${d.ours})`).join(", ")}
                  </div>
                )}
                {notes
                  .filter((n) => !n.startsWith("Specification difference"))
                  .map((n) => (
                    <div key={n} className="mt-1 text-[12px] text-ink-3">
                      {n}
                    </div>
                  ))}
              </Td>
              <Td muted className="align-top">{r.supplier.country ?? "—"}</Td>
              <Td align="right" className="align-top">
                {r.price != null ? (
                  <>
                    <span className="text-[14px] font-semibold">{r.priceEUR != null ? f.price(r.priceEUR) : f.price(r.price, r.currency ?? "EUR")}</span>
                    <span className="text-ink-3">/{product.unit}</span>
                    {r.priceEUR != null && r.currency !== "EUR" && (
                      <div className="text-[12px] text-ink-3">{f.price(r.price, r.currency ?? "EUR")} at the recorded rate</div>
                    )}
                    {r.fxRequired && <div className="text-[12px] text-caution">FX conversion required</div>}
                  </>
                ) : (
                  <span className="text-ink-4">—</span>
                )}
              </Td>
              <Td className="align-top">
                <div className="text-ink-2">{r.kind === "quote" ? "Quote" : r.kind === "purchase" ? "Purchase" : "—"}</div>
                {r.source && (
                  <div className="mt-0.5">
                    <SourceTag source={r.source} doc={r.sourceDoc} />
                    {r.reference && <span className="ml-1.5 text-[12px] text-ink-3">{r.reference}</span>}
                  </div>
                )}
              </Td>
              <Td align="right" muted className="align-top">{r.moq != null ? f.quantity(r.moq, product.unit) : "—"}</Td>
              <Td align="right" className={cx("align-top", r.termsFromDefaults && "text-ink-3")}>{r.leadTimeDays != null ? f.days(r.leadTimeDays) : "—"}</Td>
              <Td className={cx("align-top", r.termsFromDefaults && "text-ink-3")}>
                {f.paymentTerms(r.paymentTermsDays)}
                {r.incoterm && <span className="ml-1.5 font-mono text-[11px] text-ink-3">{r.incoterm}</span>}
              </Td>
              <Td className="align-top">
                <div className="num text-ink-2">{f.date(r.date)}</div>
                <div className="text-[12px]">
                  <AgeTag age={r.age} days={r.ageDays} expired={r.expired} />
                </div>
              </Td>
              <Td muted className="align-top">{r.currency ?? "—"}</Td>
              <Td align="right" className="align-top">
                {r.isCurrent ? (
                  <span className="text-ink-3">Current</span>
                ) : r.differencePct != null ? (
                  <span className="font-medium text-ink">
                    {f.pct(r.differencePct)}
                    <span className="block text-[12px] font-normal text-ink-3">
                      {r.difference! > 0 ? "+" : ""}
                      {f.price(r.difference)}/{product.unit}
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-4">—</span>
                )}
              </Td>
              <Td className="align-top">{r.isCurrent ? <span className="text-ink-4">—</span> : <ComparabilityBadge level={r.comparability} />}</Td>
              <Td className="align-top">
                <div className="flex items-center justify-end">
                  {!r.isCurrent && (
                    <OfferDialog
                      supplierId={r.supplier.id}
                      supplierName={r.supplier.name}
                      productId={product.id}
                      productName={product.name}
                      productSpecs={formatSpecs(product.specs)}
                      override={r.link?.comparabilityOverride ?? null}
                      note={r.link?.comparabilityNote ?? ""}
                      specs={formatSpecs(r.link?.specs)}
                      computed={r.overridden ? "overridden by you" : r.comparability === "comparable" ? "comparable" : r.comparability === "partial" ? "partially comparable" : "not comparable"}
                    />
                  )}
                  {quote && <QuoteDialog products={products} suppliers={suppliers} quote={quote} trigger={{ label: "Edit quote", iconOnly: true }} />}
                </div>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
