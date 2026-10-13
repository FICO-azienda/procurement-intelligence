import Link from "next/link";
import type { Metadata } from "next";
import { BundleTable, CurrentSuppliers, LimitsForm, ObjectiveCards, ScenarioDetail, SpecialistList, TodayPortfolio } from "@/components/portfolio/strategy";
import { ButtonLink, Empty, PageHeader, Section, buttonClass, cx } from "@/components/ui";
import { getT } from "@/lib/data";
import { OBJECTIVE_LABEL, PORTFOLIO_CONFIG, type Objective } from "@/lib/portfolio/config";
import { sourcingMix } from "@/lib/portfolio/engine";
import { readStrategyParams, strategyHref } from "@/lib/portfolio/params";
import { getPortfolioScope } from "@/server/portfolio";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Sourcing strategy") };
}

/**
 * Sourcing strategy: for the products that weigh most, today's mix of
 * suppliers and the mixes that would do better on one thing or another —
 * cost, bundles, specialists, quality, delivery, risk, cash — each with what
 * it gains and what it gives up. Worked out fresh from what is on file;
 * nothing here is stored and nothing changes a supplier.
 */
export default async function StrategyPage({ searchParams }: PageProps<"/strategy">) {
  const params = readStrategyParams(await searchParams);
  const [scope, t] = await Promise.all([getPortfolioScope(params.top), getT()]);
  const products = scope.input.products;
  if (!products.length) {
    return (
      <>
        <PageHeader title={t("Sourcing strategy")} />
        <div className="rounded-lg border border-dashed border-rule-strong">
          <Empty title={t("No purchases to start from yet")} body={t("Import your invoices first: the products that make up most of your spend will appear here.")} action={<ButtonLink href="/import" variant="primary">{t("Import invoices")}</ButtonLink>} />
        </div>
      </>
    );
  }
  const portfolio = sourcingMix(scope.input, { constraints: params.constraints, custom: params.custom }, t);
  const asked = params.goal && portfolio.scenarios.some((s) => s.objective === params.goal) ? params.goal : null;
  const selected: Objective = asked ?? portfolio.suggested?.objective ?? "total_value";
  const scenario = portfolio.scenarios.find((s) => s.objective === selected)!;
  const rounds = PORTFOLIO_CONFIG.rounds.filter((n, i) => i === 0 || scope.priority > PORTFOLIO_CONFIG.rounds[i - 1]);

  return (
    <>
      <PageHeader
        title={t("Sourcing strategy")}
        meta={
          scope.input.scopeShare != null
            ? t("No supplier is the right one for everything: which mix is right for what you want to obtain? For the {n} products that weigh most — {pct}% of your catalogue spend.", { n: products.length, pct: Math.round(scope.input.scopeShare * 100) })
            : t("No supplier is the right one for everything: which mix is right for what you want to obtain?")
        }
        actions={
          rounds.length > 1 ? (
            <div className="flex items-center gap-1" role="group" aria-label={t("How many products")}>
              {rounds.map((n) => (
                <Link key={n} href={strategyHref(params, { top: n })} aria-current={n === params.top ? "true" : undefined} className={cx(buttonClass(n === params.top ? "primary" : "secondary", "sm"))}>
                  {t("Top {n}", { n: Math.min(n, scope.priority) })}
                </Link>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="mb-6">
        <TodayPortfolio portfolio={portfolio} products={products} t={t} />
      </div>

      <Section className="mb-6" title={portfolio.suggested ? t("Where to start: {objective}", { objective: t(OBJECTIVE_LABEL[portfolio.suggested.objective].label) }) : t("Where to start")}>
        {portfolio.suggested ? (
          <p className="text-[13.5px] text-ink-2">
            {portfolio.suggested.why} {t("A mix to examine, not a decision: nothing here changes a supplier.")}{" "}
            <Link href={`${strategyHref(params, { goal: portfolio.suggested.objective })}#mix`} className="text-ledger hover:underline">
              {t("See it")} →
            </Link>
          </p>
        ) : (
          <>
            <p className="text-[13.5px] text-ink-2">{t("Nothing on file supports a mix different from today's: a product can only be given to a supplier with a real price for you, and no other supplier has one yet. What can be done now:")}</p>
            {portfolio.next.length > 0 && (
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[13.5px] text-ink-2">
                {portfolio.next.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink href="/sourcing" variant="primary" size="sm">
                {t("Prepare the requests for quotation")}
              </ButtonLink>
              <ButtonLink href="/products/data" size="sm">
                {t("Complete the product data")}
              </ButtonLink>
            </div>
          </>
        )}
      </Section>

      <ObjectiveCards portfolio={portfolio} params={params} selected={selected} total={products.length} t={t} />
      <ScenarioDetail s={scenario} portfolio={portfolio} total={products.length} t={t} />
      <CurrentSuppliers items={portfolio.bySupplier} t={t} />
      <BundleTable bundles={portfolio.bundles} total={products.length} t={t} />
      <SpecialistList items={portfolio.specialists} t={t} />
      <LimitsForm params={params} products={products} portfolio={portfolio} selected={selected} t={t} />

      {scope.leftOut.length > 0 && <p className="mb-3 text-[12.5px] text-ink-3">{t("Left out, with no price paid or no quantity on file: {names}.", { names: scope.leftOut.map((p) => p.name).join(", ") })}</p>}
      <p className="text-[12.5px] text-ink-3">{t("Worked out from your own invoices, offers and research: private to your account. An advantage shown here is an estimate at the prices on file — theoretical, to validate or validated — and becomes a saving only on an invoice.")}</p>
    </>
  );
}
