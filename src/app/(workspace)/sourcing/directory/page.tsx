import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { DirectoryFilters, DirectoryImport } from "@/components/markets/directory";
import { Crumbs, Disclosure, Empty, ExportLink, PageHeader, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDb } from "@/db";
import { countryKey, countryName, flagOf } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { PAGE_SIZE, facets, filterSuppliers, pageOf } from "@/lib/markets/filter";
import { DEPTH_LABEL, MARKETS, PRODUCT_TYPE_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_MEANING, TECHNOLOGY_LABEL, marketOf, statusRank, type MarketStatus } from "@/lib/markets/types";
import { RFQ_LABEL, countryCoverage, readDirectory, readMarketResearch, readReferences, summary } from "@/server/markets";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Supplier directory") };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const MISSING = "MISSING";

const tone = (status: MarketStatus) =>
  statusRank(status) >= statusRank("technical_match_to_review") ? "bg-ledger-wash text-ledger" : statusRank(status) >= statusRank("manufacturer_confirmed") ? "bg-down-wash text-down" : status === "evidence_found" ? "bg-caution-wash text-caution" : "bg-wash text-ink-2";

/**
 * A market directory: the companies of the world that make one kind of thing,
 * found by research and kept with their sources. A list to search and narrow,
 * never a list of suppliers: a company becomes a candidate on the user's click.
 */
export default async function DirectoryPage({ searchParams }: PageProps<"/sourcing/directory">) {
  await connection();
  const sp = await searchParams;
  const market = marketOf(one(sp.market)) ?? MARKETS[0];
  const [db, t] = await Promise.all([getDb(), getT()]);
  const [rows, logs, references] = await Promise.all([readDirectory(db, market.key), readMarketResearch(db, market.key), readReferences(db, market.key, t)]);
  const query = Object.fromEntries(["q", "continent", "country", "role", "material", "type", "technology", "status", "email", "match", "rfq"].map((k) => [k, one(sp[k]) || null]));
  const found = filterSuppliers(rows, query);
  const { rows: shown, page, pages } = pageOf(found, Number(one(sp.page)) || 1);
  const all = facets(rows);
  const sum = summary(rows);
  // The countries offered are those of the continent chosen: a short list, never the whole world.
  const inContinent = query.continent ? facets(filterSuppliers(rows, { continent: query.continent })).countries : all.countries;
  const coverage = countryCoverage(logs);
  const leads = logs.flatMap((l) => l.coverage.leads);
  const gaps = [...new Set(logs.flatMap((l) => l.coverage.gaps))];
  const href = (p: number) => `/sourcing/directory?${new URLSearchParams({ ...Object.fromEntries(Object.entries(query).filter(([, v]) => v) as [string, string][]), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
  const missing = (v: unknown) => (v == null || v === "" ? <span className="text-[11.5px] font-medium tracking-wide text-caution">{MISSING}</span> : String(v));

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/sourcing", label: t("Market") }]} />}
        title={t("{market}: suppliers of the world", { market: t(market.label) })}
        meta={t(market.about)}
        actions={rows.length > 0 ? <ExportLink href={`/export/market/${market.key}`}>{t("Export to Excel")}</ExportLink> : undefined}
      />

      {rows.length === 0 ? (
        <div className="mb-6 rounded-lg border border-dashed border-rule-strong">
          <Empty title={t("No company in this directory yet")} body={t("A directory is filled by research: each company with the page that shows it. Load a research file below to start.")} />
        </div>
      ) : (
        <>
          <p className="mb-1 text-[14px]">
            <span className="font-semibold">{t.n(sum.total, "{n} company found", "{n} companies found")}</span>
            <span className="text-ink-2">
              {" · "}
              {t("{makers} manufacturers with evidence · {oem} that make to a drawing · {distributors} distributors · {contact} with a public email · {countries} countries", { makers: sum.makers, oem: sum.oem, distributors: sum.distributors, contact: sum.withContact, countries: sum.countries.length })}
            </span>
          </p>
          <p className="mb-5 max-w-[860px] text-[13px] text-ink-3">
            {t("Found by research, not asked: none of them is a supplier, and none is shown outside this account. The list is what the searches made so far brought, not every maker in the world — the coverage below says which countries were searched and how deeply.")}
          </p>

          <Suspense>
            <DirectoryFilters facets={all} countries={inContinent} />
          </Suspense>

          <div className="rounded-lg border border-rule">
            {found.length === 0 ? (
              <Empty title={t("No company matches these filters")} action={<Link href="/sourcing/directory" className="text-[13px] font-medium text-ledger hover:underline">{t("Clear filters")}</Link>} />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th className="border-t-0">{t("Company")}</Th>
                      <Th className="hidden border-t-0 @2xl:table-cell">{t("What it is")}</Th>
                      <Th className="hidden border-t-0 @4xl:table-cell">{t("What it makes")}</Th>
                      <Th className="border-t-0">{t("Research status")}</Th>
                      <Th className="hidden border-t-0 @3xl:table-cell">{t("Contact")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => (
                      <tr key={s.id} className={cx(rowClass(true), "row-link")}>
                        <Td className="max-w-[300px] whitespace-normal!">
                          <Link href={`/sourcing/directory/${s.id}`} className="stretched font-medium hover:text-ledger">
                            {s.name}
                          </Link>
                          <div className="text-[12px] text-ink-3">
                            {[s.country ? `${flagOf(s.country) ?? ""} ${countryName(s.country, t.locale)}`.trim() : null, s.city].filter(Boolean).join(" · ")}
                            {s.links.current && <span className="ml-1.5 font-medium text-ink-2">· {t("your supplier today")}</span>}
                          </div>
                        </Td>
                        <Td className="hidden @2xl:table-cell">{t(ROLE_LABEL[s.role])}</Td>
                        <Td className="hidden max-w-[320px] whitespace-normal! @4xl:table-cell">
                          <div className="text-[13px]">{s.productTypes.map((x) => t(PRODUCT_TYPE_LABEL[x as keyof typeof PRODUCT_TYPE_LABEL] ?? "Not known")).join(", ") || missing(null)}</div>
                          <div className="text-[12px] text-ink-3">{[...s.materials, ...s.technologies.map((x) => t(TECHNOLOGY_LABEL[x as keyof typeof TECHNOLOGY_LABEL] ?? "Not known"))].join(" · ")}</div>
                        </Td>
                        <Td>
                          <span title={t(STATUS_MEANING[s.status])} className={cx("inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-medium whitespace-nowrap", tone(s.status))}>
                            {t(STATUS_LABEL[s.status])}
                          </span>
                          {s.links.rfq !== "none" && <div className="mt-0.5 text-[12px] text-ink-3">{t(RFQ_LABEL[s.links.rfq])}</div>}
                        </Td>
                        <Td className="hidden max-w-[220px] @3xl:table-cell">
                          <span className="block truncate text-[13px]">{s.email ?? (s.phone ? s.phone : missing(null))}</span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-well px-5 py-3 text-[13px]">
                  <span className="text-ink-3">
                    {found.length > PAGE_SIZE ? t("{from}–{to} of {n} companies", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, found.length), n: found.length }) : t.n(found.length, "{n} company", "{n} companies")}
                  </span>
                  {pages > 1 && (
                    <span className="flex items-center gap-3">
                      {page > 1 && <Link href={href(page - 1)} scroll={false} className="font-medium text-ledger hover:underline">{t("Previous")}</Link>}
                      <span className="num text-ink-3">{t("Page {page} of {pages}", { page, pages })}</span>
                      {page < pages && <Link href={href(page + 1)} scroll={false} className="font-medium text-ledger hover:underline">{t("Next|page")}</Link>}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {coverage.length > 0 && (
        <Disclosure className="mt-6" title={t("What the research covered")} description={t("{deep} countries searched in depth, {first} with a first search, {none} with nothing found, {todo} still to search", { deep: coverage.filter((c) => c.depth === "deep").length, first: coverage.filter((c) => c.depth === "preliminary").length, none: coverage.filter((c) => c.depth === "none_found").length, todo: coverage.filter((c) => c.depth === "todo").length })} flush>
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Country")}</Th>
                <Th className="border-t-0">{t("State")}</Th>
                <Th className="border-t-0" align="right">{t("Companies on file")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell">{t("Searches and sources")}</Th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((c) => (
                <tr key={c.country} className="align-top">
                  <Td className="font-medium">{countryName(c.country, t.locale)}</Td>
                  <Td>{t(DEPTH_LABEL[c.depth])}</Td>
                  <Td align="right" className="num">{rows.filter((s) => countryKey(s.country) === countryKey(c.country)).length}</Td>
                  <Td className="hidden max-w-[520px] whitespace-normal! text-[12.5px] text-ink-2 @2xl:table-cell">
                    {c.note && <div className="text-ink">{c.note}</div>}
                    {c.queries.length > 0 && <div>{c.queries.join(" · ")}</div>}
                    {c.sources.length > 0 && <div className="text-ink-3">{c.sources.join(" · ")}</div>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(gaps.length > 0 || leads.length > 0) && (
            <div className="grid gap-5 border-t border-rule px-5 py-4 text-[13px] @3xl:grid-cols-2">
              {gaps.length > 0 && (
                <div>
                  <div className="mb-1.5 font-semibold">{t("Still open")}</div>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-ink-2">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
                </div>
              )}
              {leads.length > 0 && (
                <div>
                  <div className="mb-1.5 font-semibold">{t.n(leads.length, "{n} name met and not verified yet", "{n} names met and not verified yet")}</div>
                  <ul className="flex flex-col gap-1 text-ink-2">
                    {leads.map((l) => (
                      <li key={`${l.name}|${l.where}`}>
                        <span className="font-medium text-ink">{l.name}</span>
                        {l.country && ` (${countryName(l.country, t.locale)})`} — {l.why ?? ""} <span className="text-ink-3">{l.where}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Disclosure>
      )}

      {references.length > 0 && (
        <Disclosure className="mt-3" title={t("Your products in this market")} description={t.n(references.length, "{n} product on file, with what is known of it and what is missing", "{n} products on file, with what is known of them and what is missing")} flush>
          <p className="border-b border-rule px-5 py-3 text-[13px] text-ink-2">
            {t("A supplier is compared on material, sizes and capacity. What the invoices do not say is marked as missing and is never filled in: two containers are not the same because they look alike. Write the specification on each product's page.")}
          </p>
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Product")}</Th>
                <Th className="hidden border-t-0 @3xl:table-cell">{t("Supplier")}</Th>
                <Th className="border-t-0" align="right">{t("Usual order")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Yearly quantity")}</Th>
                <Th className="border-t-0" align="right">{t("Last price")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Spend")}</Th>
                <Th className="border-t-0">{t("Material and sizes")}</Th>
              </tr>
            </thead>
            <tbody>
              {references.map((r) => (
                <tr key={r.productId} className="align-top">
                  <Td className="max-w-[280px] whitespace-normal!">
                    <Link href={`/products/${r.productId}`} className="font-medium hover:text-ledger">{r.name}</Link>
                    {r.original && <div className="truncate text-[12px] text-ink-3">{r.original}</div>}
                  </Td>
                  <Td className="hidden @3xl:table-cell">{r.supplier ?? missing(null)}</Td>
                  <Td align="right" className="num">{r.typicalOrder != null ? `${f.number(r.typicalOrder)} ${r.unit}` : missing(null)}</Td>
                  <Td align="right" className="num hidden @2xl:table-cell">
                    {r.annual != null ? f.number(Math.round(r.annual)) : missing(null)}
                    {r.annual != null && !r.annualConfirmed && <div className="text-[11.5px] text-ink-3">{t("estimate")}</div>}
                  </Td>
                  <Td align="right" className="num">{r.lastPrice != null ? f.price(r.lastPrice) : missing(null)}</Td>
                  <Td align="right" className="num hidden @2xl:table-cell">{f.money(Math.round(r.spend))}</Td>
                  <Td className="max-w-[240px] whitespace-normal! text-[12.5px]">{Object.keys(r.specs).length || r.technical ? [...Object.entries(r.specs).map(([k, v]) => `${k}: ${v}`), r.technical].filter(Boolean).join(" · ") : missing(null)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Disclosure>
      )}

      <Disclosure className="mt-3" title={t("Load a research file")} description={t("Checked first, loaded only on your confirmation")} defaultOpen={rows.length === 0}>
        <DirectoryImport />
      </Disclosure>
    </>
  );
}
