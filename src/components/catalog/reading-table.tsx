import Link from "next/link";
import { Disclosure, Section, Table, Td, Th, cx } from "@/components/ui";
import * as f from "@/lib/format";
import type { T } from "@/lib/i18n";
import { GROUP_LABEL, LEVEL_LABEL, type CleanupGroup, type Mapping } from "@/lib/catalog/mapper";

/** The products that weigh most are read first: the rest of the catalogue waits one click away. */
export const CLEANUP_TOP = 18;

const pill = "inline-flex h-[20px] items-center rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap";
const TONE: Record<CleanupGroup, string> = {
  done: "bg-wash text-ink-2",
  confident: "bg-down-wash text-down",
  review: "bg-caution-wash text-caution",
  unclassified: "border border-dashed border-rule-strong text-ink-2",
};

function Rows({ rows, t }: { rows: Mapping[]; t: T }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{t("On the invoices")}</Th>
          <Th className="hidden @3xl:table-cell">{t("Supplier")}</Th>
          <Th>{t("Product, as we read it")}</Th>
          <Th className="hidden @2xl:table-cell">{t("Family and category")}</Th>
          <Th>{t("Supplier's own codes")}</Th>
          <Th>{t("Reading")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const unchanged = m.identity === "unidentified";
          return (
            <tr key={m.productId} className="align-top">
              <Td className="max-w-[260px] whitespace-normal!">
                <Link href={`/products/${m.productId}`} className="break-words text-ink-2 hover:underline">
                  {m.originals[0] ?? m.current}
                </Link>
                <div className="num text-[12px] text-ink-3">
                  {f.money(Math.round(m.spend))}
                  {m.originals.length > 1 && ` · ${t.n(m.originals.length - 1, "written {n} other way", "written {n} other ways")}`}
                </div>
                <div className="text-[12px] text-ink-3 @3xl:hidden">{m.supplierName}</div>
              </Td>
              <Td className="hidden max-w-[160px] whitespace-normal! @3xl:table-cell">{m.supplierName ?? "—"}</Td>
              <Td className="max-w-[260px] whitespace-normal!">
                {unchanged ? <span className="text-ink-3">{t("Not named yet: it is not known what it is")}</span> : <span className="font-medium break-words">{m.name}</span>}
                {m.supplierTerms.length > 0 && <div className="text-[12px] text-ink-3">{t("“{words}” is the supplier, not the product", { words: m.supplierTerms.join(" ") })}</div>}
              </Td>
              <Td className="hidden max-w-[220px] whitespace-normal! @2xl:table-cell">
                <div>{m.family ?? m.subcategory ?? "—"}</div>
                <div className="text-[12px] text-ink-3">{[m.category, m.subcategory].filter(Boolean).join(" › ") || t("No category yet")}</div>
              </Td>
              <Td className="max-w-[180px] whitespace-normal!">{m.supplierCodes.length ? <span className="num break-words">{m.supplierCodes.join(" · ")}</span> : <span className="text-ink-4">—</span>}</Td>
              <Td className="max-w-[360px] whitespace-normal!">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cx(pill, TONE[m.group])}>{t(GROUP_LABEL[m.group])}</span>
                  <span className="text-[12px] text-ink-3">{t("confidence: {level}", { level: t(LEVEL_LABEL[m.level]).toLowerCase() })}</span>
                </div>
                {m.reason && <div className="mt-1 text-[12.5px] text-ink-2">{m.reason}</div>}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/**
 * How each product was read from what the invoices wrote: who sold it and
 * how the seller calls it on one side, what the product is on the other.
 * Nothing here is written: it is what the confirmations below would write.
 */
export function ReadingTable({ rows, top, groups, t }: { rows: Mapping[]; top: number; groups: Record<CleanupGroup, number>; t: T }) {
  if (!rows.length) return null;
  const first = rows.slice(0, top);
  const rest = rows.slice(top);
  return (
    <>
      <Section
        className="mb-4"
        title={t("How we read your {n} largest products", { n: first.length })}
        description={t("{confident} safe to confirm together · {review} to look at · {unclassified} we cannot tell what they are · {done} confirmed already", { confident: groups.confident, review: groups.review, unclassified: groups.unclassified, done: groups.done })}
        flush
      >
        <Rows rows={first} t={t} />
      </Section>
      {rest.length > 0 && (
        <Disclosure className="mb-6" title={t("The rest of the catalogue")} description={t.n(rest.length, "{n} more product, read the same way", "{n} more products, read the same way")} flush>
          <Rows rows={rest} t={t} />
        </Disclosure>
      )}
    </>
  );
}
