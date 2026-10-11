import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { SupplierActions } from "@/components/markets/directory";
import { Crumbs, PageHeader, Section, cx } from "@/components/ui";
import { getDb } from "@/db";
import { catalogueTree } from "@/lib/catalog/tree";
import { countryName, flagOf } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { CONTINENT_LABEL, INTENDED_USE_LABEL, PRODUCT_TYPE_LABEL, RELIABILITY_LABEL, ROLE_LABEL, SOURCE_LEVEL_LABEL, STATUS_LABEL, STATUS_MEANING, TECHNOLOGY_LABEL, continentOf, marketOf } from "@/lib/markets/types";
import { getCategoryTree } from "@/server/categories";
import { RFQ_LABEL, readDirectory } from "@/server/markets";
import { marketSuppliers } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function generateMetadata({ params }: PageProps<"/sourcing/directory/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [row] = await (await getDb()).select({ name: marketSuppliers.name }).from(marketSuppliers).where(eq(marketSuppliers.id, id));
  return { title: row?.name ?? (await getT())("Supplier directory") };
}

/** One company of a directory: who it is, what its pages say it makes, how to reach it, and what is still not known. */
export default async function DirectorySupplierPage({ params }: PageProps<"/sourcing/directory/[id]">) {
  await connection();
  const { id } = await params;
  const [db, t] = await Promise.all([getDb(), getT()]);
  const [row] = await db.select({ market: marketSuppliers.market }).from(marketSuppliers).where(eq(marketSuppliers.id, id));
  if (!row) notFound();
  const s = (await readDirectory(db, row.market)).find((x) => x.id === id)!;
  const market = marketOf(s.market);
  const tree = catalogueTree(await getCategoryTree());
  const p = s.profile;
  const continent = continentOf(s.country);
  const missing = <span className="text-[11.5px] font-medium tracking-wide text-caution">MISSING</span>;
  const link = (url: string | null | undefined, label?: string) =>
    url ? (
      <a href={url} target="_blank" rel="noreferrer" className="break-all text-ledger hover:underline">
        {label ?? url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </a>
    ) : (
      missing
    );
  const row2 = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-[minmax(120px,180px)_minmax(0,1fr)] gap-3 border-t border-rule py-2 text-[13.5px] first:border-t-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0">{value == null || value === "" ? missing : value}</dd>
    </div>
  );
  const labels = (keys: string[], table: Record<string, Parameters<typeof t>[0]>) => (keys.length ? keys.map((k) => (table[k] ? t(table[k]) : k)).join(", ") : null);

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/sourcing", label: t("Market") }, { href: "/sourcing/directory", label: market ? t(market.label) : t("Supplier directory") }]} />}
        title={s.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{[s.country ? `${flagOf(s.country) ?? ""} ${countryName(s.country, t.locale)}`.trim() : null, s.city].filter(Boolean).join(" · ")}</span>
            <span>{t(ROLE_LABEL[s.role])}</span>
            <span title={t(STATUS_MEANING[s.status])} className="inline-flex h-[22px] items-center rounded-full bg-ledger-wash px-2 text-[12px] font-medium text-ledger">{t(STATUS_LABEL[s.status])}</span>
            {s.links.current && <span className="font-medium text-ink">{t("your supplier today")}</span>}
          </span>
        }
      />
      <p className="mb-6 max-w-[820px] text-[13px] text-ink-3">{t("Found by research on {date}: this is what its pages say, not an offer and not a recommendation. What they do not say is marked as missing.", { date: s.checkedAt ? f.date(s.checkedAt) : "—" })}</p>

      <div className="grid gap-4 @4xl:grid-cols-2">
        <Section title={t("Who it is")}>
          <dl>
            {row2(t("Company"), s.name)}
            {row2(t("Trade name"), s.tradeName)}
            {row2(t("Country"), s.country ? `${countryName(s.country, t.locale)}${continent ? ` · ${t(CONTINENT_LABEL[continent])}` : ""}` : null)}
            {row2(t("City"), s.city)}
            {row2(t("Address"), p.address)}
            {row2(t("Website"), link(s.website))}
            {row2(t("Registration"), p.registration)}
          </dl>
        </Section>
        <Section title={t("How to reach it")}>
          <dl>
            {row2(t("Email"), s.email ? <a href={`mailto:${s.email}`} className="text-ledger hover:underline">{s.email}</a> : null)}
            {row2(t("Phone"), s.phone)}
            {row2(t("Contact name"), p.contactName)}
            {row2(t("Contact page"), link(p.contactUrl))}
            {row2(t("Languages"), p.languages)}
          </dl>
        </Section>
        <Section title={t("What it makes")}>
          <dl>
            {row2(t("What it is"), `${t(ROLE_LABEL[s.role])}${p.oem ? ` · ${t("makes to a drawing (OEM)")}` : ""}`)}
            {row2(t("Kind of container"), labels(s.productTypes, PRODUCT_TYPE_LABEL))}
            {row2(t("Materials"), s.materials.join(", "))}
            {row2(t("Technology"), labels(s.technologies, TECHNOLOGY_LABEL))}
            {row2(t("Products, as its page says"), p.products)}
            {row2(t("Sizes"), p.sizes)}
            {row2(t("Colours"), p.colours)}
            {row2(t("Declared capacity"), p.capacity)}
            {row2(t("Catalogue"), link(p.catalogUrl))}
          </dl>
        </Section>
        <Section title={t("Conditions and safety")}>
          <dl>
            {row2(t("Minimum order"), p.moq)}
            {row2(t("Samples"), p.samples)}
            {row2(t("Customisation"), p.customisation)}
            {row2(t("Delivery times"), p.leadTime)}
            {row2(t("Shipping"), p.export)}
            {row2(t("Intended use"), p.intendedUse ? t(INTENDED_USE_LABEL[p.intendedUse]) : <span className="font-medium text-caution">{t("Technical validation required")}</span>)}
            {row2(t("Safety documents"), p.safety)}
          </dl>
          <p className="mt-3 text-[12.5px] text-ink-3">{t("A container sold for candles is not for that reason safe with your wax: a material certificate says nothing of the finished candle. An empty container, one for a candle already made, one made to receive hot wax and an outer support are four different things, and only a burn test on the finished candle settles it.")}</p>
        </Section>
      </div>

      <Section className="mt-4" title={t("Evidence")}>
        <dl>
          {row2(t("What the page shows"), p.evidence)}
          {row2(t("Evidence page"), link(s.evidenceUrl))}
          {row2(t("Kind of source"), t(SOURCE_LEVEL_LABEL[s.sourceLevel as keyof typeof SOURCE_LEVEL_LABEL] ?? "Another source"))}
          {row2(t("Reliability"), p.reliability ? t(RELIABILITY_LABEL[p.reliability]) : null)}
          {row2(t("Last checked"), s.checkedAt ? f.date(s.checkedAt) : null)}
          {row2(t("Doubts to clear"), p.doubts ? <span className="text-caution">{p.doubts}</span> : t("None noted"))}
          {p.notes && row2(t("Notes"), p.notes)}
        </dl>
      </Section>

      <Section className="mt-4" title={t("In your records")}>
        <dl className="mb-4">
          {row2(t("Request status"), t(RFQ_LABEL[s.links.rfq]))}
          {row2(
            t("Candidate for"),
            s.links.candidateFor.length ? (
              <span className={cx("flex flex-wrap gap-x-3 gap-y-1")}>
                {s.links.candidateFor.map((c) => (
                  <Link key={c.productId} href={`/sourcing/${c.productId}`} className="text-ledger hover:underline">{c.name}</Link>
                ))}
              </span>
            ) : (
              t("No product yet")
            ),
          )}
        </dl>
        <SupplierActions id={s.id} status={s.status} tree={tree} />
      </Section>
    </>
  );
}
