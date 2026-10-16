import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { CompanyPairDecision } from "@/components/companies/companies";
import { Crumbs, Empty, PageHeader, Section, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDb } from "@/db";
import { ROLE_LABEL, roleChips } from "@/lib/companies/labels";
import { ROLE_KINDS, type RoleKind } from "@/lib/companies/plan";
import { countryName } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { MATCH_CONFIDENCE_LABEL } from "@/lib/suppliers/resolve";
import { readCompanies, syncCompanies, type CompanySummary } from "@/server/companies";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Companies") };
}

const PAGE = 50;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Every company the app knows, once, with the parts it plays. A company is not a supplier because it is listed here:
 * its roles say what it is to the buyer. What may be one company twice is proposed, never merged by itself.
 */
export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  await connection();
  const sp = await searchParams;
  const db = await getDb();
  await syncCompanies(db);
  const t = await getT();
  const { companies, proposals } = await readCompanies(db, t);
  const role = ROLE_KINDS.find((k) => k === one(sp.role)) ?? null;
  const q = one(sp.q).trim().toLowerCase();
  const rows = companies.filter((c) => (!role || c.roles[role] > 0) && (!q || [c.name, ...c.otherNames, c.vatNumber ?? "", c.domain ?? ""].join(" ").toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(one(sp.page)) || 1)));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const href = (over: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ role, q: q || null, page: null, ...over })) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/companies?${s}` : "/companies";
  };
  const counted = (k: RoleKind) => companies.filter((c) => c.roles[k] > 0).length;
  const name = (id: string, fallback: string) => companies.find((c) => c.id === id)?.name ?? fallback;

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/suppliers", label: t("Suppliers") }]} />}
        title={t("Companies")}
        meta={t("Every company the app knows, once: who you buy from, the candidates, the companies of the market directories, those that answered your requests and those registered on the portal.")}
      />

      {proposals.length > 0 && (
        <Section className="mb-5" title={t.n(proposals.length, "{n} pair may be one company", "{n} pairs may be one company")} description={t("Proposed for a shared site or the same name: nothing is merged until you say so, and a merge can be taken back.")} flush>
          <ul className="border-t border-rule">
            {proposals.slice(0, 12).map((p) => (
              <li key={`${p.a}|${p.b}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-rule px-5 py-3 last:border-b-0">
                <div className="min-w-[240px] flex-1 text-[13.5px]">
                  <Link href={`/companies/${p.a}`} className="font-medium hover:text-ledger">
                    {name(p.a, p.names[0])}
                  </Link>
                  <span className="text-ink-3"> · </span>
                  <Link href={`/companies/${p.b}`} className="font-medium hover:text-ledger">
                    {name(p.b, p.names[1])}
                  </Link>
                  <div className="mt-0.5 text-[12.5px] text-ink-3">
                    {t(MATCH_CONFIDENCE_LABEL[p.confidence])} · {p.why}
                  </div>
                </div>
                <CompanyPairDecision a={p.a} b={p.b} />
              </li>
            ))}
          </ul>
          {proposals.length > 12 && <p className="border-t border-rule px-5 py-2.5 text-[12.5px] text-ink-3">{t.n(proposals.length - 12, "…and {n} more: each company's page shows its own.", "…and {n} more: each company's page shows its own.")}</p>}
        </Section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <Link href={href({ role: null })} className={cx("rounded-full px-3 py-1", !role ? "bg-night text-white" : "bg-wash text-ink-2 hover:bg-rule")}>
          {t("All")} · {companies.length}
        </Link>
        {ROLE_KINDS.filter((k) => counted(k) > 0).map((k) => (
          <Link key={k} href={href({ role: k })} className={cx("rounded-full px-3 py-1", role === k ? "bg-night text-white" : "bg-wash text-ink-2 hover:bg-rule")}>
            {t(ROLE_LABEL[k])} · {counted(k)}
          </Link>
        ))}
        <form action="/companies" className="ml-auto">
          {role && <input type="hidden" name="role" value={role} />}
          <input name="q" defaultValue={q} placeholder={t("Name, VAT number or site")} aria-label={t("Search the companies")} className="h-8 w-[240px] rounded-md border border-rule-strong bg-canvas px-2.5 text-[13px]" />
        </form>
      </div>

      <div className="rounded-lg border border-rule">
        {rows.length === 0 ? (
          <Empty title={companies.length ? t("No company matches these filters") : t("No company on file yet")} body={companies.length ? undefined : t("Companies appear by themselves from invoices, research, market directories and replies.")} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="border-t-0">{t("Company")}</Th>
                  <Th className="border-t-0">{t("What it is to you")}</Th>
                  <Th className="hidden border-t-0 @2xl:table-cell" align="right">
                    {t("Spend, last 12 months")}
                  </Th>
                  <Th className="hidden border-t-0 @3xl:table-cell" align="right">
                    {t("Contacts")}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c: CompanySummary) => (
                  <tr key={c.id} className={rowClass(true)}>
                    <Td className="py-2.5">
                      <Link href={`/companies/${c.id}`} className="stretched font-medium">
                        {c.name}
                      </Link>
                      <div className="text-[12px] text-ink-3">{[countryName(c.country, t.locale), c.vatNumber ? t("VAT {vat}", { vat: c.vatNumber }) : null, c.domain].filter(Boolean).join(" · ") || t("Country not set")}</div>
                    </Td>
                    <Td className="text-[12.5px] text-ink-2">{roleChips(t, c.roles).join(" · ") || "—"}</Td>
                    <Td align="right" className="hidden font-medium @2xl:table-cell">
                      {c.spend > 0 ? f.money(Math.round(c.spend)) : <span className="font-normal text-ink-4">—</span>}
                    </Td>
                    <Td align="right" muted className="hidden @3xl:table-cell">
                      {c.contacts || "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-well px-5 py-3 text-[13px] text-ink-3">
              <span>{t.n(rows.length, "{n} company", "{n} companies")}</span>
              {pages > 1 && (
                <nav aria-label={t("Pages")} className="flex items-center gap-2">
                  {page > 1 && (
                    <Link href={href({ page: String(page - 1) })} className="font-medium text-ledger hover:underline">
                      ← {t("Previous")}
                    </Link>
                  )}
                  <span className="num">{t("page {page} of {pages}", { page, pages })}</span>
                  {page < pages && (
                    <Link href={href({ page: String(page + 1) })} className="font-medium text-ledger hover:underline">
                      {t("Next|page")} →
                    </Link>
                  )}
                </nav>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
