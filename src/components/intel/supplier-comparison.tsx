import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import type { ProductData, QuoteData } from "@/lib/analytics";
import { countryName, flagOf } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import type { ComparisonRow } from "@/lib/intel/comparison";
import type { CompareColumn } from "@/lib/intel/decision";
import { explain } from "@/lib/intel/explain";
import { COMPARABILITY_LABEL, KIND_LABEL } from "@/lib/intel/labels";
import { formatSpecs } from "@/lib/validation";
import { QuoteDialog } from "../dialogs";
import { Hint } from "../hint";
import { SourceTag } from "../import/labels";
import { Basis, Delta, Empty, cx } from "../ui";
import { ConfidenceBadge } from "./badges";
import { OfferDialog } from "./controls";

/** The reminder that travels with every price comparison. */
export async function PriceOnlyNotice({ className }: { className?: string }) {
  const t = await getT();
  return (
    <p className={cx("flex items-start gap-2 rounded-lg bg-caution-wash px-4 py-3 text-[13px] text-ink-2", className)}>
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-caution" aria-hidden />
      <span>
        <span className="font-semibold text-ink">{t("Prices only.")}</span> {t("Transport, duties, exchange rate, stock and quality are not included yet: a lower price is not necessarily a lower cost.")}
      </span>
    </p>
  );
}

const cell = "border-b border-rule px-4 py-2.5 align-top";

/**
 * Suppliers side by side, like comparing flights: one column each, the same
 * few rows. What each is best at is stated as a fact; no winner is named —
 * the buyer decides. The rest is under "More details".
 */
export async function SupplierComparison({ product, columns, rows, quotes }: { product: ProductData; columns: CompareColumn[]; rows: ComparisonRow[]; quotes: QuoteData[] }) {
  const t = await getT();
  const EXPLAIN = explain(t);
  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-rule-strong">
        <Empty title={t("No prices on record yet")} body={t("Add a purchase or a quote for this product to start comparing suppliers.")} action={<QuoteDialog defaultProductId={product.id} trigger={{ label: t("Add quote"), variant: "primary" }} />} />
      </div>
    );
  }
  const unit = product.unit;
  const tone = (c: CompareColumn) => (c.isCurrent ? "bg-well" : "bg-canvas");
  const none = <span className="text-ink-4">—</span>;
  const line = (label: React.ReactNode, render: (c: CompareColumn) => React.ReactNode, last = false) => (
    <tr>
      <th scope="row" className={cx(cell, "sticky left-0 z-[1] w-[150px] min-w-[130px] bg-canvas text-left text-[13px] font-normal text-ink-3", last && "border-b-0")}>
        {label}
      </th>
      {columns.map((c) => (
        <td key={c.supplierId} className={cx(cell, "num border-l", tone(c), last && "border-b-0")}>
          {render(c)}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-rule">
      <table className="w-full border-separate border-spacing-0 text-[13.5px]" style={{ minWidth: 150 + columns.length * 190 }}>
        <thead>
          <tr>
            <th className={cx(cell, "sticky left-0 z-[1] bg-canvas text-left text-[12px] font-medium text-ink-3")}>{t("Supplier")}</th>
            {columns.map((c) => (
              <th key={c.supplierId} scope="col" className={cx(cell, "border-l text-left font-normal", tone(c))}>
                <div className="flex items-center gap-2">
                  {flagOf(c.country) && (
                    <span aria-hidden className="text-[18px] leading-none">
                      {flagOf(c.country)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <Link href={`/suppliers/${c.supplierId}`} className="block truncate text-[14px] font-semibold hover:underline">
                      {c.supplierName}
                    </Link>
                    <span className="block text-[12px] text-ink-3">{countryName(c.country, t.locale) ?? t("Country not set")}</span>
                  </span>
                </div>
                <div className="mt-2 flex min-h-[20px] flex-wrap gap-1">
                  {c.isCurrent && <span className="inline-flex h-[20px] items-center rounded-full bg-ink px-2 text-[11.5px] font-medium text-white">{t("You buy here")}</span>}
                  {c.highlights.map((h) => (
                    <span key={h} className="inline-flex h-[20px] items-center rounded-full bg-ledger-wash px-2 text-[11.5px] font-medium text-ledger">
                      {h}
                    </span>
                  ))}
                  {c.setAside && <span className="inline-flex h-[20px] items-center rounded-full bg-wash px-2 text-[11.5px] font-medium text-ink-3">{t("Set aside by you")}</span>}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {line(t("Quoted price"), (c) => (
            <>
              <span className="text-[19px] leading-none font-semibold tracking-[-0.02em]">
                {c.priceEUR != null ? f.priceShort(c.priceEUR) : f.price(c.quotedPrice, c.currency)}
                <span className="text-[12.5px] font-medium text-ink-3">/{unit}</span>
              </span>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] font-normal">
                <Basis>{t(KIND_LABEL[c.kind])}</Basis>
                {c.isCurrent ? <span className="text-ink-3">{t("what you pay")}</span> : c.notComparableReason ? <span className="text-caution">{t("can't be compared yet")}</span> : <Delta value={c.differencePct} />}
              </div>
            </>
          ))}
          {line(
            <span className="inline-flex items-center gap-1.5">
              {t("Estimated total cost")} <Hint text={EXPLAIN.trueCost} />
            </span>,
            () => <span className="text-ink-4">{t("Not estimated yet")}</span>,
          )}
          {line(t("Minimum order"), (c) => (c.moq != null ? f.quantity(c.moq, unit) : none))}
          {line(t("Lead time"), (c) => (c.leadTimeDays != null ? f.days(c.leadTimeDays, t) : none))}
          {line(t("Payment"), (c) => (c.paymentTermsDays != null ? f.paymentTerms(c.paymentTermsDays, t) : none))}
          {line(t("Quality"), () => <span className="text-ink-4">{t("Not tracked yet")}</span>)}
          {line(t("Potential saving"), (c) =>
            c.potentialSaving != null && !c.setAside ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">{t("{amount}/yr", { amount: f.moneyApprox(c.potentialSaving) })}</span>
                <ConfidenceBadge level={c.confidence} />
              </span>
            ) : (
              none
            ),
          )}
          {line(t("To check"), (c) => {
            const warns = c.flags.filter((x) => x.tone === "warn" && x.key !== "quality");
            if (c.notComparableReason) return <span className="text-[12.5px] font-normal text-caution">{c.notComparableReason}</span>;
            if (c.isCurrent) return none;
            if (!warns.length)
              return (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-normal text-ink-3">
                  <Check size={12} strokeWidth={2.25} className="text-down" aria-hidden /> {t("Nothing on the offer itself")}
                </span>
              );
            return (
              <ul className="space-y-1 text-[12.5px] font-normal">
                {warns.slice(0, 3).map((x) => (
                  <li key={x.key} className="flex items-start gap-1.5 text-caution">
                    <AlertTriangle size={12} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden /> {x.label}
                  </li>
                ))}
              </ul>
            );
          })}
          {line(
            t("Details"),
            (c) => {
              const row = rows.find((r) => r.supplier.id === c.supplierId);
              const quote = row?.kind === "quote" ? quotes.find((q) => q.id === row.recordId) : undefined;
              return (
                <details className="group text-[12.5px] font-normal">
                  <summary className="cursor-pointer list-none font-medium text-ledger select-none hover:underline [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">{t("Show")}</span>
                    <span className="hidden group-open:inline">{t("Hide")}</span>
                  </summary>
                  <div className="mt-2 space-y-1 text-ink-2">
                    {c.currency !== "EUR" && (
                      <div>{t("As quoted: {price}", { price: `${f.price(c.quotedPrice, c.currency)}/${unit}` })}</div>
                    )}
                    <div>{t(c.kind === "quote" ? "Quoted on {date}" : "Paid on {date}", { date: f.date(c.date) })}</div>
                    {c.incoterm && <div>Incoterm {c.incoterm}</div>}
                    {row?.source && (
                      <div>
                        <SourceTag source={row.source} doc={row.sourceDoc} />
                      </div>
                    )}
                    {!c.isCurrent &&
                      c.flags
                        .filter((x) => x.tone === "ok")
                        .map((x) => (
                          <div key={x.key} className="flex items-start gap-1.5 text-ink-3">
                            <Check size={12} strokeWidth={2.25} className="mt-0.5 shrink-0 text-down" aria-hidden /> {x.label}
                          </div>
                        ))}
                    {row && !c.isCurrent && row.comparabilityReasons.length > 0 && <div className="text-ink-3">{row.comparabilityReasons.join(" · ")}</div>}
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      {quote && <QuoteDialog quote={quote} trigger={{ label: t("Edit quote"), size: "sm", variant: "ghost" }} />}
                      {row && !c.isCurrent && (
                        <OfferDialog
                          supplierId={c.supplierId}
                          supplierName={c.supplierName}
                          productId={product.id}
                          productName={product.name}
                          productSpecs={formatSpecs(product.specs)}
                          override={row.link?.comparabilityOverride ?? null}
                          note={row.link?.comparabilityNote ?? ""}
                          specs={formatSpecs(row.link?.specs)}
                          computed={row.overridden ? t("overridden by you") : t(COMPARABILITY_LABEL[row.comparability]).toLowerCase()}
                        />
                      )}
                      {c.opportunityKey && (
                        <Link href={`/opportunities/${c.opportunityKey}`} className="px-2 font-medium text-ledger hover:underline">
                          {t("What's missing")}
                        </Link>
                      )}
                    </div>
                  </div>
                </details>
              );
            },
            true,
          )}
        </tbody>
      </table>
    </div>
  );
}
