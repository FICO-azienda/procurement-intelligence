import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { getDb } from "@/db";
import { importItems } from "@/db/schema";
import { fileKindLabel } from "@/components/import/labels";
import { ImportReadyButton, IssueIcon, MatchGroupsPanel, QueueLineActions } from "@/components/import/review";
import { ButtonLink, Empty, PageHeader } from "@/components/ui";
import { getDataset } from "@/lib/data";
import * as f from "@/lib/format";
import { buildGroups } from "@/lib/import/groups";
import type { MatchResult } from "@/lib/import/match";
import type { CurrentData, Issue } from "@/lib/import/types";
import { inArray } from "drizzle-orm";
import { listSessions } from "@/server/imports";

export const metadata: Metadata = { title: "Review" };

/** Issues handled by the supplier/product panels instead of per line. */
const MATCH_CODES = new Set(["supplier_probable", "supplier_unmatched", "product_probable", "product_unmatched"]);

export default async function ReviewPage() {
  await connection();
  const db = await getDb();
  const sessions = (await listSessions(db, 200)).filter((s) => s.status === "needs_review");
  const items = sessions.length
    ? await db.select().from(importItems).where(inArray(importItems.sessionId, sessions.map((s) => s.id)))
    : [];
  const data = await getDataset();

  const blocks = sessions
    .map((s) => {
      const own = items.filter((i) => i.sessionId === s.id);
      const attention = own.filter((i) => i.status === "attention");
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
      );
      const supplierGroups = groups.suppliers.filter((g) => g.state !== "matched");
      const productGroups = groups.products.filter((g) => g.state !== "matched");
      // Lines whose problem isn't (only) an unresolved supplier/product.
      const lineIssues = attention
        .map((i) => ({ item: i, issues: (i.issues as Issue[]).filter((x) => x.severity !== "info" && !MATCH_CODES.has(x.code)) }))
        .filter((x) => x.issues.length > 0);
      return {
        session: s,
        ready: own.filter((i) => i.status === "ready").length,
        attention: attention.length,
        supplierGroups,
        productGroups,
        lineIssues,
        decisions: supplierGroups.length + productGroups.length + lineIssues.length,
      };
    })
    .filter((b) => b.attention > 0 || b.ready > 0);

  const total = blocks.reduce((s, b) => s + b.decisions, 0);

  return (
    <>
      <PageHeader
        title="Review"
        meta={
          total > 0
            ? `${total} ${total === 1 ? "item needs" : "items need"} review. Everything else has already been imported or is ready.`
            : "Doubtful data from imports lands here, so one problem never blocks a whole file."
        }
      />

      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title="Nothing to review"
            body="New imports with uncertain suppliers, products or prices will appear here."
            action={
              <ButtonLink href="/import" variant="primary">
                Import data
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <div className="space-y-8">
          {blocks.map((b) => (
            <section key={b.session.id}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/import/${b.session.id}`} className="text-[15px] font-semibold hover:text-ledger">
                    {b.session.filename}
                  </Link>
                  <div className="text-[12.5px] text-ink-3">
                    {fileKindLabel(b.session.fileType, b.session.sourceType)} · uploaded {b.session.uploadedAt.toLocaleDateString("it-IT")} ·{" "}
                    {b.attention} need attention{b.ready > 0 ? ` · ${b.ready} ready` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {b.ready > 0 && <ImportReadyButton sessionId={b.session.id} ready={b.ready} />}
                  <ButtonLink href={`/import/${b.session.id}`} size="sm">
                    Open import <ArrowRight size={13} />
                  </ButtonLink>
                </div>
              </div>

              <div className="space-y-4">
                {b.supplierGroups.length > 0 && (
                  <MatchGroupsPanel sessionId={b.session.id} kind="supplier" groups={b.supplierGroups} options={data.suppliers.map(({ id, name }) => ({ id, name }))} />
                )}
                {b.productGroups.length > 0 && (
                  <MatchGroupsPanel
                    sessionId={b.session.id}
                    kind="product"
                    groups={b.productGroups}
                    options={data.products.map(({ id, name, sku }) => ({ id, name: `${name} · ${sku}` }))}
                  />
                )}
                {b.lineIssues.length > 0 && (
                  <section className="rounded-lg border border-rule">
                    <h2 className="px-5 pt-4 pb-3 text-[14px] font-semibold">Lines to check</h2>
                    <ul className="border-t border-rule">
                      {b.lineIssues.map(({ item, issues }) => {
                        const d = item.data as CurrentData;
                        return (
                          <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-5 py-3 last:border-b-0">
                            <div className="min-w-[260px] flex-1">
                              <div className="text-[13px] font-medium">
                                {d.productName ?? d.description ?? "Line"}{" "}
                                <span className="font-normal text-ink-3">
                                  · line {item.line}
                                  {d.invoiceReference ? ` · ${d.invoiceReference}` : ""}
                                  {d.date ? ` · ${f.date(d.date)}` : ""}
                                </span>
                              </div>
                              <ul className="mt-1 space-y-0.5">
                                {issues.map((x, i) => (
                                  <li key={i} className="flex items-start gap-1.5 text-[12.5px]">
                                    <span className="mt-px">
                                      <IssueIcon issue={x} size={13} />
                                    </span>
                                    {x.message}
                                    {x.code === "price_increase" && x.data?.annualImpact != null && Number(x.data.annualImpact) > 0 && (
                                      <span className="text-ink-3"> · +{f.money(Number(x.data.annualImpact))}/year</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <QueueLineActions sessionId={b.session.id} itemId={item.id} issues={issues} />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
