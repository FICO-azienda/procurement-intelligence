import Link from "next/link";
import * as f from "@/lib/format";
import type { T } from "@/lib/i18n";
import { SHORTFALL_LABEL } from "@/lib/replies/offers";
import { daysLeft, type PendingOffers } from "@/lib/replies/pending";
import { ButtonLink, Section } from "../ui";

/**
 * The offers received for a product that are still to verify, where a buyer
 * looks for alternatives (Compare, the market page): each with its price as
 * quoted and what it still lacks — never set against the price paid, never
 * in a range. The product's page has the full list and the actions.
 */
export function PendingOffersSection({ t, pending, productId, today, className }: { t: T; pending: PendingOffers; productId: string; today: string; className?: string }) {
  const shown = pending.toVerify.slice(0, 8);
  return (
    <Section
      className={className}
      flush
      title={t.n(pending.toVerify.length, "{n} offer received, still to verify", "{n} offers received, still to verify")}
      description={t("Quoted to you by companies that answered your requests. None is compared with what you pay until it is linked to this product, validated by a person and its cost to your plant is complete.")}
      actions={<ButtonLink href={`/products/${productId}#offers`}>{t("See the offers received")}</ButtonLink>}
    >
      <ul>
        {shown.map((o) => {
          const left = o.validUntil ? daysLeft(o.validUntil, today) : null;
          return (
            <li key={o.offerId} className="grid gap-x-4 gap-y-0.5 border-t border-rule px-5 py-2.5 text-[13px] @2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="min-w-0">
                <Link href={`/sourcing/replies/offers/${o.offerId}`} className="font-medium hover:text-ledger">
                  {o.company}
                </Link>
                <div className="truncate text-[12px] text-ink-3">{o.product}</div>
              </div>
              <div className="num text-ink-2">
                {o.quoted}
                {o.quantity != null && <span className="text-ink-3"> · {f.quantity(o.quantity, o.unit)}</span>}
                <div className={left != null && left <= 7 ? "text-[12px] font-medium text-caution" : "text-[12px] text-ink-3"}>
                  {o.validUntil ? (left === 0 ? t("Expires today") : t("Valid until {date}", { date: f.date(o.validUntil) })) : t("Validity not stated")}
                </div>
              </div>
              <div className="text-[12.5px] text-ink-3">{o.shortfalls.map((s) => t(SHORTFALL_LABEL[s])).join(" · ")}</div>
            </li>
          );
        })}
      </ul>
      {pending.toVerify.length > shown.length && (
        <p className="border-t border-rule px-5 py-2.5 text-[12.5px] text-ink-3">{t.n(pending.toVerify.length - shown.length, "…and {n} more on the product's page.", "…and {n} more on the product's page.")}</p>
      )}
    </Section>
  );
}
