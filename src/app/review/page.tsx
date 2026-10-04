import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { importItems } from "@/db/schema";
import { ImportAllButton, IssueIcon, MatchDecision, QueueLineActions } from "@/components/import/review";
import { OneAtATime } from "@/components/import/stepper";
import { ButtonLink, Crumbs, Empty, PageHeader } from "@/components/ui";
import { getDataset, getT } from "@/lib/data";
import * as f from "@/lib/format";
import { said } from "@/lib/i18n";
import { buildGroups } from "@/lib/import/groups";
import type { MatchResult } from "@/lib/import/match";
import type { CurrentData, Issue } from "@/lib/import/types";
import { inbox, listSessions } from "@/server/imports";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Review|noun") };
}

/** Problems answered by the supplier/product questions, not line by line. */
const MATCH_CODES = new Set(["supplier_probable", "supplier_unmatched", "product_probable", "product_unmatched"]);

/**
 * Everything the imports could not decide alone, as simple questions: one
 * card, one decision, a couple of buttons. Lines that are fine never show up.
 */
export default async function ReviewPage() {
  await connection();
  const db = await getDb();
  const sessions = (await listSessions(db, 200)).filter((s) => s.status === "needs_review");
  const items = sessions.length ? await db.select().from(importItems).where(inArray(importItems.sessionId, sessions.map((s) => s.id))) : [];
  const [data, box, t] = await Promise.all([getDataset(), inbox(db), getT()]);
  const supplierOptions = data.suppliers.map(({ id, name }) => ({ id, name }));
  const productOptions = data.products.map(({ id, name, sku }) => ({ id, name: `${name} · ${sku}` }));

  const blocks = sessions
    .map((s) => {
      const own = items.filter((i) => i.sessionId === s.id);
      const groups = buildGroups(
        own.map((i) => ({
          data: i.data as CurrentData,
          status: i.status,
          supplierId: i.supplierId,
          supplierMatch: i.supplierMatch as MatchResult | null,
          supplierResolution: i.supplierResolution,
          productId: i.productId,
          productMatch: i.productMatch as MatchResult | null,
          productResolution: i.productResolution,
        })),
        data,
        t,
      );
      const supplierGroups = groups.suppliers.filter((g) => g.state !== "matched");
      // Products nobody knows yet are not asked one by one: the import analyses them together.
      const productGroups = groups.products.filter((g) => g.state === "suggested");
      const toAnalyse = groups.products.filter((g) => g.state === "unknown").length;
      // Lines whose problem isn't (only) an unresolved supplier or product.
      const lineIssues = own
        .filter((i) => i.status === "attention")
        .map((i) => ({ item: i, issues: (i.issues as Issue[]).filter((x) => x.severity !== "info" && !MATCH_CODES.has(x.code)) }))
        .filter((x) => x.issues.length > 0);
      return { session: s, supplierGroups, productGroups, toAnalyse, lineIssues, decisions: supplierGroups.length + productGroups.length + lineIssues.length + (toAnalyse > 0 ? 1 : 0) };
    })
    .filter((b) => b.decisions > 0);

  const total = blocks.reduce((s, b) => s + b.decisions, 0);

  // What is ready, said the way the user thinks of it: "ABC Srl (42 lines)".
  const ready = items.filter((i) => i.status === "ready");
  const tally = (names: (string | undefined)[]) => {
    const counts = new Map<string, number>();
    for (const n of names) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return [...sorted.slice(0, 3).map(([n, c]) => `${n} (${t.n(c, "{n} line", "{n} lines")})`), ...(sorted.length > 3 ? [t("{n} more", { n: sorted.length - 3 })] : [])];
  };
  const readyBy = {
    suppliers: tally(ready.map((i) => data.suppliers.find((x) => x.id === i.supplierId)?.name)),
    products: tally(ready.map((i) => data.products.find((x) => x.id === i.productId)?.name)),
  };

  return (
    <>
      <PageHeader
        eyebrow={<Crumbs items={[{ href: "/import", label: t("Import|nav") }]} />}
        title={total > 0 ? t.n(total, "{n} question to answer", "{n} questions to answer") : t("Nothing to review")}
        meta={total > 0 ? t("Where we were not sure, we ask instead of guessing. Each answer is remembered for next time.") : undefined}
      />

      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title={t("All clear")}
            body={
              box.ready > 0
                ? t.n(box.ready, "{n} line is ready to be imported.", "{n} lines are ready to be imported.")
                : t("When an import has a supplier, a product or a price we are not sure about, the question appears here.")
            }
            action={
              box.ready > 0 ? (
                <ImportAllButton ready={box.ready} primary />
              ) : (
                <ButtonLink href="/import" variant="primary">
                  {t("Import files")}
                </ButtonLink>
              )
            }
          />
        </div>
      ) : (
        <div className="mx-auto max-w-[720px]">
          <OneAtATime
            items={blocks.flatMap((b) => [
              ...b.supplierGroups.map((g) => ({
                key: `${b.session.id}:s:${g.key}`,
                from: b.session.filename,
                node: <MatchDecision sessionId={b.session.id} kind="supplier" group={g} options={supplierOptions} />,
              })),
              ...(b.toAnalyse > 0
                ? [
                    {
                      key: `${b.session.id}:analysis`,
                      from: b.session.filename,
                      node: (
                        <article className="rounded-lg border border-rule bg-canvas px-5 py-4">
                          <div className="text-[14px] font-semibold">{t.n(b.toAnalyse, "{n} product description is new", "{n} product descriptions are new")}</div>
                          <p className="mt-1 text-[13.5px] text-ink-2">{t("We put together the ones that are the same product and classified services and other spend. Confirm them all at once, and decide only the doubtful cases.")}</p>
                          <div className="mt-3">
                            <ButtonLink href={`/import/${b.session.id}#analysis`} variant="primary">
                              {t("Open the analysis")}
                            </ButtonLink>
                          </div>
                        </article>
                      ),
                    },
                  ]
                : []),
              ...b.productGroups.map((g) => ({
                key: `${b.session.id}:p:${g.key}`,
                from: b.session.filename,
                node: <MatchDecision sessionId={b.session.id} kind="product" group={g} options={productOptions} />,
              })),
              ...b.lineIssues.map(({ item, issues }) => {
                const d = item.data as CurrentData;
                const duplicate = issues.some((x) => x.code === "duplicate" || x.code === "duplicate_in_file");
                return {
                  key: item.id,
                  from: b.session.filename,
                  node: (
                    <article className="rounded-lg border border-rule bg-canvas px-5 py-4">
                      <div className="text-[14px] font-semibold">{duplicate ? t("This looks like a line you already have") : t("Is this line right?")}</div>
                      <div className="mt-1 text-[13.5px]">
                        <span className="font-medium">{d.productName ?? d.description ?? t("Line")}</span>
                        <span className="text-ink-3">
                          {d.quantity != null && ` · ${f.number(d.quantity)} ${d.unit ?? d.unitRaw ?? ""}`}
                          {d.unitPrice != null && ` ${t("at {price}", { price: f.price(d.unitPrice, d.currency ?? "EUR") })}`}
                          {d.date ? ` · ${f.date(d.date)}` : ""}
                          {d.invoiceReference ? ` · ${d.invoiceReference}` : ""}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {issues.map((x, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[13px] text-ink-2">
                            <span className="mt-0.5">
                              <IssueIcon issue={x} size={13} />
                            </span>
                            <span>
                              {said(t, x)}
                              {x.code === "price_increase" && x.data?.annualImpact != null && Number(x.data.annualImpact) > 0 && (
                                <span className="text-ink-3"> · {t("about +{amount} a year at your volumes", { amount: f.moneyApprox(Number(x.data.annualImpact)) })}</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3.5">
                        <QueueLineActions sessionId={b.session.id} itemId={item.id} issues={issues} />
                      </div>
                    </article>
                  ),
                };
              }),
            ])}
          />

          {/* What needs no answer: ready, and importable in one go */}
          {box.ready > 0 && (
            <section aria-label={t("Ready lines")} className="mt-6 rounded-lg border border-rule px-5 py-4">
              <div className="text-[14px] font-semibold">{t.n(box.ready, "{n} line is ready to be imported", "{n} lines are ready to be imported")}</div>
              <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
                {readyBy.suppliers.length > 0 && (
                  <li>
                    <span className="text-ink-3">{t("Suppliers")}:</span> {readyBy.suppliers.join(" · ")}
                  </li>
                )}
                {readyBy.products.length > 0 && (
                  <li>
                    <span className="text-ink-3">{t("Products")}:</span> {readyBy.products.join(" · ")}
                  </li>
                )}
              </ul>
              <div className="mt-3.5 flex flex-wrap items-center gap-3">
                <ImportAllButton ready={box.ready} primary />
                <Link href="/import" className="text-[13px] font-medium text-ledger hover:underline">
                  {t("See the files")}
                </Link>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
