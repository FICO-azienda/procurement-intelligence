import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { EntryButton, ProductDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { ConfidenceBadge, DecisionStatusPill } from "@/components/intel/badges";
import { ProductFilters } from "@/components/intel/product-filters";
import { ButtonLink, Delta, Disclosure, Empty, ExportLink, PageHeader, Sku, Table, Td, Th, cx, rowClass } from "@/components/ui";
import { attributesOf } from "@/lib/catalog/attributes";
import { KIND_LABEL } from "@/lib/catalog/kinds";
import { matchesWords, parseProductQuery } from "@/lib/catalog/query";
import { getDataset, getFamilies, getIntel, getLearning, getMapAnalysis, getOverview, getSpend, getT } from "@/lib/data";
import * as f from "@/lib/format";
import type { Msg } from "@/lib/i18n";
import { DECISION_STATUS, type DecisionStatus } from "@/lib/intel/decision";
import { explain } from "@/lib/intel/explain";
import { SORTS, filterProducts } from "@/lib/intel/filters";
import { lookups } from "@/lib/lookups";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Products") };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = Object.keys(DECISION_STATUS) as DecisionStatus[];
/** With fewer products than this, the whole list is short enough to be the priority view. */
const PRIORITY_FROM = 20;

/** Ready-made views: the questions a buyer asks most. */
const VIEWS = [
  { key: "high-spend", label: "High spend" },
  { key: "up-moderate", label: "Recent increases" },
  { key: "single-source", label: "Single source" },
  { key: "saving", label: "Open opportunities" },
] as const satisfies readonly { key: string; label: Msg }[];

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const sp = await searchParams;
  const [data, intel, ov, spend, learning, families, mapped, t] = await Promise.all([getDataset(), getIntel(), getOverview(), getSpend(), getLearning(), getFamilies(), getMapAnalysis(), getT()]);
  const EXPLAIN = explain(t);
  const l = lookups(data);
  const decisions = new Map(ov.products.map((d) => [d.productId, d]));

  const statuses = one(sp.status).split(",").filter((s): s is DecisionStatus => (STATUSES as string[]).includes(s));
  const view = VIEWS.find((v) => v.key === one(sp.view))?.key ?? null;
  const query = { filters: view ? [view] : [], supplierId: one(sp.supplier) || null, category: one(sp.category) || null, search: null, sort: one(sp.sort) || null };
  // The search box understands a supplier's name, "over 10k", "single source"; the rest are words to find.
  const question = parseProductQuery(one(sp.q), data.suppliers, (n) => f.money(n), t);
  const asked = !!one(sp.q).trim();
  const aliasesOf = new Map<string, string[]>();
  for (const a of learning.productAliases) aliasesOf.set(a.productId, [...(aliasesOf.get(a.productId) ?? []), a.alias]);
  const familyOf = (p: (typeof intel.products)[number]) => (p.product.familyId ? (families.get(p.product.familyId)?.name ?? null) : null);
  const answers = (p: (typeof intel.products)[number], broad: boolean) => {
    const d = decisions.get(p.product.id)!;
    if (question.minSpend != null && d.annualSpend < question.minSpend) return false;
    if (question.maxSpend != null && d.annualSpend > question.maxSpend) return false;
    if (question.singleSource && p.concentration.sourcing !== "single") return false;
    if (question.supplierIds.length && !question.supplierIds.some((id) => d.currentSupplier?.id === id || p.comparison.some((r) => r.supplier.id === id))) return false;
    return matchesWords(question.words, p.product.name, p.product.sku, broad ? p.product.category : null, p.product.subcategory, familyOf(p), p.product.variant, d.currentSupplier?.name, ...(aliasesOf.get(p.product.id) ?? []), ...attributesOf(p.product.name).map((a) => a.value));
  };
  // "stoppini" means wicks: the whole "wicks and wick parts" category only when nothing is called that.
  const listed = filterProducts(intel.products, query, intel.config);
  const narrow = listed.filter((p) => answers(p, false));
  const inView = narrow.length > 0 ? narrow : listed.filter((p) => answers(p, true));
  const filtered = statuses.length > 0 || !!view || !!query.supplierId || !!query.category || asked;
  // Priority view: where the money and the open questions are. The whole list is one click away.
  const why = (p: (typeof intel.products)[number]): Msg[] => {
    const d = decisions.get(p.product.id)!;
    return [
      ...(p.highSpend ? ["Top spend" as const] : []),
      ...(p.alert ? ["Price up" as const] : []),
      ...(d.savingMaterial ? ["Open opportunity|tag" as const] : []),
      ...(p.highSpend && p.concentration.sourcing === "single" ? ["Single source" as const] : []),
      ...(d.status === "review" && !p.alert && !d.savingMaterial ? ["To check" as const] : []),
    ];
  };
  const priorityOn = one(sp.show) !== "all" && !filtered && intel.products.length >= PRIORITY_FROM;
  const priority = intel.products.filter((p) => why(p).length > 0);
  const visible = statuses.length ? inView.filter((p) => statuses.includes(decisions.get(p.product.id)!.status)) : priorityOn ? inView.filter((p) => why(p).length > 0) : inView;
  const toMap = mapped.totals.analysed - mapped.totals.confirmed;
  const eighty = mapped.pareto.find((x) => x.share === 0.8);

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) next.set(k, v);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    return s ? `/products?${s}` : "/products";
  };
  const chip = (on: boolean, dim = false) =>
    cx(
      "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors",
      on ? "border-ink bg-ink text-white" : "border-rule-strong text-ink-2 hover:border-ink/30 hover:bg-wash",
      dim && !on && "opacity-50",
    );

  // Everything on the invoices that is not a product to compare: transport, services, utilities, office purchases.
  const otherSpend = spend.items.length > 0 && (
    <Disclosure
      title={t("Other company spend")}
      description={`${t.n(spend.items.length, "{n} item", "{n} items")} · ${f.money(Math.round(spend.other))} ${t("in 12 months")}`}
      flush
      defaultOpen={intel.products.length === 0}
      className="mt-6"
    >
      <p className="px-5 pt-3.5 text-[13px] text-ink-3">
        {t("Transport, services, utilities and office purchases count in the company's spend, but are not compared and negotiated as products: one item per supplier and kind, with every invoice line behind it.")}
      </p>
      <div className="flex flex-wrap gap-1.5 px-5 py-3">
        {spend.byKind.map((k) => (
          <span key={k.kind} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-wash px-2.5 text-[12px] text-ink-2">
            {t(KIND_LABEL[k.kind])} <span className="num font-medium text-ink">{f.money(Math.round(k.amount))}</span>
          </span>
        ))}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>{t("Item")}</Th>
            <Th className="hidden @2xl:table-cell">{t("What it is")}</Th>
            <Th className="hidden @4xl:table-cell" align="right">{t("Invoice lines")}</Th>
            <Th className="hidden @3xl:table-cell">{t("Last purchase")}</Th>
            <Th align="right">{t("Annual spend")}</Th>
          </tr>
        </thead>
        <tbody>
          {spend.items.map((i) => (
            <tr key={i.product.id} className={rowClass(true)}>
              <Td className="max-w-[420px] py-2.5 whitespace-normal!">
                <Link href={`/products/${i.product.id}`} className="stretched font-medium">
                  {i.product.name}
                </Link>
                <div className="text-[12px] text-ink-3 @2xl:hidden">{t(KIND_LABEL[i.kind])}</div>
              </Td>
              <Td muted className="hidden @2xl:table-cell">
                {t(KIND_LABEL[i.kind])}
              </Td>
              <Td align="right" muted className="num hidden @4xl:table-cell">
                {i.lines}
              </Td>
              <Td muted className="num hidden @3xl:table-cell">
                {f.date(i.lastDate)}
              </Td>
              <Td align="right" className="font-medium">
                {i.annualSpend !== 0 ? f.money(Math.round(i.annualSpend)) : <span className="font-normal text-ink-4">—</span>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Disclosure>
  );
  const companyTotal = spend.other !== 0 && (
    <p className="mb-4 text-[13px] text-ink-2">
      {t("Total company spend in 12 months:")} <span className="num font-semibold text-ink">{f.money(Math.round(spend.total))}</span> — {t("products in the catalogue")}{" "}
      <span className="num font-medium text-ink">{f.money(Math.round(spend.catalogue))}</span>, {t("other spend")} <span className="num font-medium text-ink">{f.money(Math.round(spend.other))}</span>
    </p>
  );

  if (intel.products.length === 0 && spend.items.length > 0) {
    return (
      <>
        <PageHeader title={t("Products")} meta={t("What you buy, what you pay for it, and whether it deserves a look.")} />
        {companyTotal}
        {otherSpend}
      </>
    );
  }

  if (intel.products.length === 0) {
    return (
      <>
        <PageHeader title={t("Products")} />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty
            title={t("No products yet")}
            body={t("Products appear by themselves when you import invoices or a spreadsheet. You can also add them one by one.")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/import" variant="primary">
                  {t("Import invoices")}
                </ButtonLink>
                <EntryButton kind="paste" label={t("Paste from Excel")} />
                <ProductDialog trigger={{ label: t("Add a product") }} />
              </div>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("Products")} meta={t("What you buy, what you pay for it, and whether it deserves a look.")} actions={
          <>
            <ButtonLink href="/products/data">{t("Product data")}</ButtonLink>
            <ExportLink href="/export/products" className="px-1" />
          </>
        }
      />
      {companyTotal}

      {toMap > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-ledger/25 bg-ledger-wash/50 px-5 py-4">
          <div className="min-w-[240px] flex-1">
            <div className="text-[15px] font-semibold">{t.n(toMap, "{n} product still has the name the invoice gave it", "{n} products still have the name the invoices gave them")}</div>
            <div className="mt-0.5 text-[13px] text-ink-2">
              {mapped.totals.high > 0
                ? t("We already worked out what they are: {high} can be confirmed in one click, {review} need a look.", { high: mapped.totals.high, review: mapped.totals.review + mapped.totals.inDuplicates })
                : t("These are the cases only you can decide: a few questions, the largest spend first.")}
            </div>
          </div>
          <ButtonLink href="/products/review" variant="primary">
            {t("Open the Product Mapper")}
          </ButtonLink>
        </div>
      )}

      {eighty && eighty.products > 0 && intel.products.length >= PRIORITY_FROM && (
        <p className="mb-4 text-[13px] text-ink-2">
          <span className="font-medium text-ink">
            {t.n(eighty.products, "{n} product makes up {pct}% of your product spend", "{n} products make up {pct}% of your product spend", { pct: Math.round(eighty.reached * 100) })}
          </span>
          <span className="text-ink-3">
            {" "}
            · {mapped.pareto.filter((x) => x.share !== 0.8).map((x) => t("{n} for {pct}%", { n: x.products, pct: Math.round(x.share * 100) })).join(" · ")}
          </span>
        </p>
      )}

      <nav aria-label={t("Status")} className="mb-2 flex flex-wrap items-center gap-1.5">
        {intel.products.length >= PRIORITY_FROM && (
          <Link href="/products" aria-pressed={priorityOn} scroll={false} className={chip(priorityOn)} title={t("Top spend, price increases, single-source products, open opportunities and products to check.")}>
            {t("Priority")} <span className={cx("num text-[11.5px]", priorityOn ? "text-white/60" : "text-ink-4")}>{priority.length}</span>
          </Link>
        )}
        <Link href={intel.products.length >= PRIORITY_FROM ? "/products?show=all" : "/products"} aria-pressed={!priorityOn && !filtered} scroll={false} className={chip(!priorityOn && !filtered)}>
          {t("All")} <span className={cx("num text-[11.5px]", !priorityOn && !filtered ? "text-white/60" : "text-ink-4")}>{intel.products.length}</span>
        </Link>
        {STATUSES.filter((s) => ov.totals.byStatus[s] > 0 || statuses.includes(s)).map((s) => {
          const on = statuses.length === 1 && statuses[0] === s;
          const n = ov.totals.byStatus[s];
          return (
            <Link key={s} href={href({ status: on ? null : s })} aria-pressed={on} scroll={false} title={t(DECISION_STATUS[s].meaning)} className={chip(on || (statuses.length > 1 && statuses.includes(s)), n === 0)}>
              {t(DECISION_STATUS[s].label)} <span className={cx("num text-[11.5px]", on ? "text-white/60" : "text-ink-4")}>{n}</span>
            </Link>
          );
        })}
        <Hint text={EXPLAIN.decisionStatus} label={t("What the statuses mean")} />
        <span className="mx-1 hidden h-4 border-l border-rule-strong sm:block" />
        {VIEWS.map((v) => (
          <Link key={v.key} href={href({ view: view === v.key ? null : v.key })} aria-pressed={view === v.key} scroll={false} className={chip(view === v.key)}>
            {t(v.label)}
          </Link>
        ))}
      </nav>

      <div className="mb-4">
        <Suspense>
          <ProductFilters suppliers={l.supplierOptions} categories={l.categories} sorts={SORTS} placeholder={t("Search: paraffina, a supplier, “over 10k”, “single source”…")} />
        </Suspense>
        {question.understood.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
            {t("Understood as:")}
            {question.understood.map((x) => (
              <span key={x} className="inline-flex h-6 items-center rounded-full bg-ledger-wash px-2.5 font-medium text-ledger">
                {x}
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-rule">
        {visible.length === 0 ? (
          <Empty
            title={t("No products match these filters")}
            action={
              filtered ? (
                <Link href="/products" className="text-[13px] font-medium text-ledger hover:underline">
                  {t("Clear filters")}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="border-t-0">{t("Product")}</Th>
                <Th className="hidden border-t-0 @5xl:table-cell">{t("Supplier")}</Th>
                <Th className="border-t-0" align="right">{t("You pay")}</Th>
                <Th className="hidden border-t-0 @2xl:table-cell" align="right">
                  {t("12 months")} <Hint text={EXPLAIN.change} />
                </Th>
                <Th className="border-t-0" align="right">{t("Annual spend")}</Th>
                <Th className="hidden border-t-0 @4xl:table-cell" align="right">
                  {t("Potential saving")} <Hint text={EXPLAIN.potentialSaving} />
                </Th>
                <Th className="border-t-0">{t("Status")}</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const d = decisions.get(p.product.id)!;
                return (
                  <tr key={p.product.id} className={rowClass(true)}>
                    <Td className="max-w-[280px] py-2.5 whitespace-normal!">
                      <Link href={`/products/${p.product.id}`} className="stretched font-medium">
                        {p.product.name}
                      </Link>
                      <div className="truncate text-[12px] text-ink-3">
                        {p.product.category ? [p.product.subcategory ?? p.product.category, familyOf(p)].filter(Boolean).join(" · ") : <Sku>{p.product.sku}</Sku>}
                        <span className="@5xl:hidden">{d.currentSupplier && ` · ${d.currentSupplier.name}`}</span>
                      </div>
                      {priorityOn && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {why(p).map((x) => (
                            <span key={x} className="inline-flex h-[18px] items-center rounded-full bg-wash px-1.5 text-[11px] text-ink-2">
                              {t(x)}
                            </span>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td className="hidden @5xl:table-cell">{d.currentSupplier?.name ?? "—"}</Td>
                    <Td align="right" className="font-medium">
                      {d.currentPrice != null ? (
                        <>
                          {f.priceShort(d.currentPrice)}
                          <span className="font-normal text-ink-3">/{d.unit}</span>
                        </>
                      ) : (
                        <span className="font-normal text-ink-4">—</span>
                      )}
                    </Td>
                    <Td align="right" className="hidden @2xl:table-cell">
                      <Delta value={d.priceTrend.pct} className="justify-end" />
                    </Td>
                    <Td align="right" className="font-medium">
                      {d.annualSpend > 0 ? f.money(Math.round(d.annualSpend)) : <span className="font-normal text-ink-4">—</span>}
                    </Td>
                    <Td align="right" className="hidden @4xl:table-cell">
                      {d.savingMaterial ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="font-medium">{t("{amount}/yr", { amount: f.moneyApprox(d.potentialSaving) })}</span>
                          <ConfidenceBadge level={d.savingConfidence} />
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <DecisionStatusPill status={d.status} />
                        {d.supplyRisk.level === "high" && (
                          <span className="hidden text-[12px] text-caution @5xl:inline" title={d.supplyRisk.detail}>
                            {t("Single source")}
                          </span>
                        )}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
      <p className="mt-3 text-[12px] text-ink-4">
        {t("{shown} of {total} products · potential savings compare prices only.", { shown: visible.length, total: intel.products.length })}
        {priorityOn && (
          <>
            {" "}
            <Link href="/products?show=all" className="font-medium text-ledger hover:underline">
              {t("Show all products")}
            </Link>
          </>
        )}
      </p>
      {otherSpend}
    </>
  );
}
