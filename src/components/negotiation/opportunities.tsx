import Link from "next/link";
import { Section, Table, Td, Th } from "@/components/ui";
import * as f from "@/lib/format";
import type { T } from "@/lib/i18n";
import { LEVEL_LABEL } from "@/lib/negotiation/engine";
import type { ProductNegotiation } from "@/lib/negotiation/input";
import { rangeOf } from "./card";

/**
 * Negotiation opportunities next to the others: the products where the
 * evidence on file supports a target below what is paid. Always theoretical
 * here — an estimate of the software. It becomes a validated opportunity only
 * through a real quote and its true cost, and a saving only on an invoice.
 */
export function NegotiationOpportunities({ items, t, className }: { items: ProductNegotiation[]; t: T; className?: string }) {
  const rows = items.filter((n) => n.status === "range" && n.upside).sort((a, b) => (b.upside!.annual ?? 0) - (a.upside!.annual ?? 0) || a.name.localeCompare(b.name));
  if (!rows.length) return null;
  return (
    <Section className={className} title={t("Negotiation opportunities")} description={t("Where the evidence on file supports a target below what you pay. Estimates of the software: theoretical until a real quote confirms them, never a saving.")} flush>
      <Table>
        <thead>
          <tr>
            <Th>{t("Product")}</Th>
            <Th align="right">{t("Current price")}</Th>
            <Th align="right" className="hidden @2xl:table-cell">
              {t("Estimated achievable range")}
            </Th>
            <Th align="right">{t("Suggested target")}</Th>
            <Th align="right">{t("Potential negotiation upside")}</Th>
            <Th className="hidden @xl:table-cell">{t("Confidence")}</Th>
            <Th>{t("Status")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.productId}>
              <Td className="whitespace-normal!">
                <Link href={`/products/${n.productId}#negotiation`} className="font-medium hover:underline">
                  {n.name}
                </Link>
              </Td>
              <Td align="right">{`${f.price(n.current)}/${n.unit}`}</Td>
              <Td align="right" className="hidden @2xl:table-cell">
                {rangeOf(n.range!.low, n.range!.high, n.unit)}
              </Td>
              <Td align="right" className="font-medium">{`${f.price(n.target)}/${n.unit}`}</Td>
              <Td align="right">{n.upside!.annual != null ? t("about {amount} a year", { amount: f.moneyApprox(n.upside!.annual) }) : `${f.price(n.upside!.perUnit)}/${n.unit}`}</Td>
              <Td className="hidden @xl:table-cell">{t(LEVEL_LABEL[n.confidence!])}</Td>
              <Td>
                <span className="inline-flex h-[20px] items-center rounded-full bg-caution-wash px-2 text-[11.5px] font-medium text-caution">{t("Theoretical")}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}
