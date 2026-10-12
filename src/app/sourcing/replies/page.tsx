import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ReplyStatusPills } from "@/components/replies/pills";
import { ReplyImportPanel } from "@/components/replies/replies";
import { Crumbs, Empty, PageHeader, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { getDb } from "@/db";
import { countryName, flagOf } from "@/lib/countries";
import { getT } from "@/lib/data";
import * as f from "@/lib/format";
import { REPLY_STATUSES, REPLY_STATUS_LABEL, isReplyStatus, priorityRank, statusesOf } from "@/lib/replies/types";
import { readReplies } from "@/server/replies";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Replies to requests for quotation") };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const chip = (on: boolean) =>
  cx(
    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ledger/15 focus-visible:outline-none",
    on ? "border-ledger/30 bg-ledger-wash font-medium text-ledger" : "border-rule-strong text-ink-2 hover:border-ink/25 hover:bg-wash",
  );

/**
 * The companies that answered a request for quotation: one row per
 * conversation, the ones to act on first. A list to work from — who stated a
 * price, who needs something more, who said no — never a ranking of prices.
 */
export default async function RepliesPage({ searchParams }: PageProps<"/sourcing/replies">) {
  await connection();
  const sp = await searchParams;
  const [db, t] = await Promise.all([getDb(), getT()]);
  const companies = await readReplies(db, t);
  const rows = companies.flatMap((c) => c.threads.map((thread) => ({ company: c, thread, statuses: statusesOf(thread) })));
  const status = isReplyStatus(one(sp.status)) ? one(sp.status) : "";
  const category = one(sp.category);
  const shown = rows
    .filter((r) => (!status || r.statuses.includes(status as (typeof REPLY_STATUSES)[number])) && (!category || r.thread.categories.includes(category)))
    .sort((a, b) => REPLY_STATUSES.indexOf(a.thread.status) - REPLY_STATUSES.indexOf(b.thread.status) || priorityRank(a.thread.priority) - priorityRank(b.thread.priority) || a.company.name.localeCompare(b.company.name));
  const categories = [...new Set(rows.flatMap((r) => r.thread.categories))].sort((a, b) => a.localeCompare(b));
  const offers = rows.reduce((n, r) => n + r.thread.offers.length, 0);
  const validated = rows.reduce((n, r) => n + r.thread.offers.filter((o) => o.validation === "validated").length, 0);
  const href = (next: { status?: string; category?: string }) => {
    const q = new URLSearchParams(Object.entries({ status, category, ...next }).filter(([, v]) => v) as [string, string][]).toString();
    return q ? `/sourcing/replies?${q}` : "/sourcing/replies";
  };

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/sourcing", label: t("Market") }]} />}
        title={t("Replies to requests for quotation")}
        meta={t("The companies that answered your requests: what each said, the prices it stated, what is still missing and what to do next. A company here is not one of your suppliers, and a price stated is not yet an offer you can compare.")}
      />

      {companies.length === 0 ? (
        <div className="mb-6 rounded-lg border border-dashed border-rule-strong">
          <Empty title={t("No reply on file yet")} body={t("Replies are loaded from a file that lists the companies that answered and the prices they stated. Check a file below to start: nothing is loaded until you confirm.")} />
        </div>
      ) : (
        <>
          <p className="mb-4 text-[13.5px] text-ink-2">
            {t.n(companies.length, "{n} company answered", "{n} companies answered")}
            {" · "}
            {t.n(offers, "{n} price stated", "{n} prices stated")}
            {" · "}
            {validated === 0 ? t("none technically validated yet") : t.n(validated, "{n} technically validated", "{n} technically validated")}
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Link href={href({ status: "" })} scroll={false} className={chip(!status)}>
              {t("All")} <span className="num text-[11.5px] opacity-70">{rows.length}</span>
            </Link>
            {REPLY_STATUSES.map((s) => {
              const n = rows.filter((r) => r.statuses.includes(s)).length;
              return n > 0 ? (
                <Link key={s} href={href({ status: status === s ? "" : s })} scroll={false} className={chip(status === s)}>
                  {t(REPLY_STATUS_LABEL[s])} <span className="num text-[11.5px] opacity-70">{n}</span>
                </Link>
              ) : null;
            })}
          </div>
          {categories.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {categories.map((c) => (
                <Link key={c} href={href({ category: category === c ? "" : c })} scroll={false} className={chip(category === c)}>
                  {c} <span className="num text-[11.5px] opacity-70">{rows.filter((r) => r.thread.categories.includes(c)).length}</span>
                </Link>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-rule bg-canvas">
            {shown.length === 0 ? (
              <Empty title={t("No reply matches these filters")} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="border-t-0">{t("Company")}</Th>
                    <Th className="hidden border-t-0 @3xl:table-cell">{t("Category")}</Th>
                    <Th className="border-t-0">{t("Status")}</Th>
                    <Th className="hidden border-t-0 @2xl:table-cell" align="right">{t("Prices stated")}</Th>
                    <Th className="hidden border-t-0 @4xl:table-cell">{t("Next action")}</Th>
                    <Th className="hidden border-t-0 @3xl:table-cell">{t("Priority")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ company: c, thread, statuses }) => (
                    <tr key={thread.id} className={cx(rowClass(true), "align-top")}>
                      <Td className="max-w-[300px] whitespace-normal!">
                        <Link href={`/sourcing/replies/${c.id}`} className="font-medium hover:text-ledger">
                          {c.name}
                        </Link>
                        <div className="text-[12px] text-ink-3">{[c.country ? `${flagOf(c.country) ?? ""} ${countryName(c.country, t.locale)}`.trim() : null, c.companyType].filter(Boolean).join(" · ")}</div>
                      </Td>
                      <Td className="hidden @3xl:table-cell">{thread.categories.join(", ")}</Td>
                      <Td className="whitespace-normal!">
                        <ReplyStatusPills statuses={statuses} t={t} />
                        {/* On a narrow page the column of the next action is not shown: it is said here instead. */}
                        {thread.nextAction && <div className="mt-1 max-w-[420px] text-[12.5px] text-ink-2 @4xl:hidden">{thread.nextAction}</div>}
                      </Td>
                      <Td align="right" className="num hidden @2xl:table-cell">
                        {thread.offers.length || "—"}
                        {thread.offers.some((o) => o.validUntil) && <div className="text-[11.5px] text-ink-3">{t("until {date}", { date: f.date(thread.offers.map((o) => o.validUntil).filter(Boolean).sort()[0]) })}</div>}
                      </Td>
                      <Td className="hidden max-w-[360px] whitespace-normal! text-[13px] text-ink-2 @4xl:table-cell">{thread.nextAction ?? "—"}</Td>
                      <Td className="hidden @3xl:table-cell">{thread.priority ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="border-t border-rule bg-well px-5 py-3 text-[12.5px] text-ink-3">
              {t("Prices are kept as each company wrote them — its own product, currency and delivery terms. They are not ranked, converted or averaged here.")}
            </div>
          </div>
        </>
      )}

      <ReplyImportPanel startOpen={companies.length === 0} />
    </>
  );
}
