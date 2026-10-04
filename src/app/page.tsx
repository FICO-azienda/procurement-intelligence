import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Check, ClipboardPaste, Coins, FileText, FileUp, PenLine, ReceiptText, ShieldAlert, Target, Upload, type LucideIcon } from "lucide-react";
import { getDb } from "@/db";
import { EntryButton, PurchaseDialog, QuoteDialog } from "@/components/dialogs";
import { Hint } from "@/components/hint";
import { ButtonLink, cx } from "@/components/ui";
import { TIME_ZONE } from "@/lib/config";
import { getDataset, getOverview, getSettings, getSpend, getT } from "@/lib/data";
import * as f from "@/lib/format";
import type { Msg, T } from "@/lib/i18n";
import { DATA_GAPS, DECISION_STATUS, isDataGap, type PurchasingOverview } from "@/lib/intel/decision";
import { explain } from "@/lib/intel/explain";
import { ago, recentActivity } from "@/server/activity";
import { attentionCount, inbox } from "@/server/imports";

function greeting(): Msg {
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: TIME_ZONE }));
  return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * The home page answers five questions in ten seconds: how much we spend,
 * where we could save, what needs attention, what changed, what to do next.
 * Everything else is one click away, not on this page.
 */
export default async function OverviewPage() {
  const [data, ov, company, spend, t] = await Promise.all([getDataset(), getOverview(), getSettings(), getSpend(), getT()]);
  const EXPLAIN = explain(t);
  const db = await getDb();
  const [toReview, waiting, activity] = await Promise.all([attentionCount(db), inbox(db), recentActivity(db, 4, t)]);
  const tot = ov.totals;
  const gaps = DATA_GAPS.reduce((n, s) => n + tot.byStatus[s], 0);
  const firstName = company.userName?.split(/\s+/)[0];

  if (data.products.length === 0) return <FirstSteps t={t} waiting={waiting.files.length} toReview={toReview} suppliers={data.suppliers.length} company={company.companyName} configured={company.configured} />;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.022em]">
          {t(greeting())}
          {firstName && `, ${firstName}`}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink-3">{t("Here is where your purchasing stands — last 12 months, as of {date}.", { date: f.date(ov.asOf) })}</p>
      </header>

      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0">
          {/* Four numbers */}
          <section aria-label={t("Key figures")} className="mb-6 grid grid-cols-1 gap-3 @lg:grid-cols-2 @4xl:grid-cols-4">
            <Figure
              t={t}
              href="/report"
              icon={Coins}
              tone="info"
              label={t("Annual spend")}
              hint={EXPLAIN.annualSpend}
              value={f.money(Math.round(tot.annualSpend))}
              note={spend.other !== 0 ? t("on catalogue products · {total} with all other spend", { total: f.money(Math.round(spend.total)) }) : undefined}
            />
            <Figure
              t={t}
              href="/opportunities"
              icon={Target}
              tone="good"
              label={t("Potential savings")}
              hint={EXPLAIN.potentialTotal}
              value={tot.potentialSavings > 0 ? f.moneyApprox(tot.potentialSavings) : "—"}
              note={tot.potentialSavings > 0 ? t("{amount} high-confidence", { amount: f.moneyApprox(tot.highConfidenceSavings) }) : t("Needs quotes to compare with")}
            />
            <Figure t={t} href="/products?status=review,action" icon={AlertTriangle} tone="review" label={t("Products to review")} hint={EXPLAIN.decisionStatus} value={String(tot.productsToReview)} />
            <Figure t={t} href="/products?view=single-source" icon={ShieldAlert} tone="risk" label={t("Supplier risks")} hint={EXPLAIN.supplyRisk} value={String(ov.supplyRisks.length)} />
          </section>

          <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <TopActions ov={ov} t={t} />

            {/* Recent changes */}
            <section aria-labelledby="changes" className="rounded-lg border border-rule">
              <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
                <h2 id="changes" className="flex items-center gap-1.5 text-[14px] font-semibold">
                  {t("Recent changes")} <Hint text={EXPLAIN.recentChanges} />
                </h2>
                <Link href="/products?sort=change" className="text-[13px] font-medium text-ledger hover:underline">
                  {t("See all")}
                </Link>
              </div>
              {ov.recentChanges.length === 0 ? (
                <p className="border-t border-rule px-5 py-6 text-[13.5px] text-ink-3">{t("No price changes or new quotes in the last 30 days.")}</p>
              ) : (
                <ul>
                  {ov.recentChanges.slice(0, 4).map((c, i) => (
                    <li key={i} className="border-t border-rule transition-colors hover:bg-well">
                      <Link href={c.kind === "quote" ? `/compare?product=${c.productId}` : `/products/${c.productId}`} className="flex items-center gap-3 px-5 py-3">
                        <span className={cx("grid size-8 shrink-0 place-items-center rounded-full", c.kind === "quote" ? "bg-ledger-wash text-ledger" : c.pct != null && c.pct > 0 ? "bg-up-wash text-up" : "bg-down-wash text-down")} aria-hidden>
                          {c.kind === "quote" ? <FileText size={15} strokeWidth={1.75} /> : c.pct != null && c.pct > 0 ? <ArrowUpRight size={16} strokeWidth={2} /> : <ArrowDownRight size={16} strokeWidth={2} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{c.productName}</span>
                          <span className="block truncate text-[12.5px] text-ink-3">
                            {c.pct != null ? t("{text} {pct}", { text: c.text, pct: f.pct(c.pct).replace(/^[+−]/, "") }) : c.text}
                          </span>
                        </span>
                        <span className="num shrink-0 text-[12px] text-ink-3">{c.daysAgo === 0 ? t("today") : t.n(c.daysAgo, "{n} day ago", "{n} days ago")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        {/* How complete the picture is, and what was done lately */}
        <aside className="grid grid-cols-1 content-start gap-6 @2xl:grid-cols-2 @5xl:grid-cols-1">
          <section aria-labelledby="data" className="rounded-lg border border-rule p-5">
            <h2 id="data" className="text-[14px] font-semibold">{t("Data status")}</h2>
            <div className="mt-3 flex items-center gap-4">
              <Ring t={t} value={tot.productsJudged} of={tot.productsTotal} />
              <ul className="space-y-1 text-[13px]">
                <Tick>{t.n(data.suppliers.length, "{n} supplier", "{n} suppliers")}</Tick>
                <Tick>{t.n(tot.productsTotal, "{n} product", "{n} products")}</Tick>
                {spend.items.length > 0 && <Tick>{t.n(spend.items.length, "{n} item of other spend", "{n} items of other spend")}</Tick>}
                <Tick>{t.n(data.purchases.length, "{n} purchase", "{n} purchases")}</Tick>
                {toReview > 0 && <Tick warn>{t("{n} to review", { n: toReview })}</Tick>}
              </ul>
            </div>
            <p className="mt-3 text-[12.5px] text-ink-3">
              {t("{judged} of {total} products have something to be compared with.", { judged: tot.productsJudged, total: tot.productsTotal })}
              {tot.productsTotal > tot.productsJudged && ` ${t("The others need a quote from another supplier, or a recent purchase.")}`}
            </p>
            {(toReview > 0 || waiting.ready > 0 || waiting.needColumns > 0) && (
              <ButtonLink href={toReview > 0 ? "/review" : "/import"} variant="primary" size="sm" className="mt-3 w-full">
                {toReview > 0 ? t.n(toReview, "Answer {n} question", "Answer {n} questions") : waiting.needColumns > 0 ? t("Check the columns") : t.n(waiting.ready, "Import {n} ready line", "Import {n} ready lines")}
              </ButtonLink>
            )}
            {tot.byStatus.needs_classification > 0 && (
              <ButtonLink href="/products/review" variant={toReview > 0 || waiting.ready > 0 || waiting.needColumns > 0 ? "secondary" : "primary"} size="sm" className="mt-2 w-full">
                {t.n(tot.byStatus.needs_classification, "Confirm what {n} product is", "Confirm what {n} products are")}
              </ButtonLink>
            )}
            {toReview === 0 && waiting.ready === 0 && waiting.needColumns === 0 && tot.byStatus.needs_classification === 0 && gaps > 0 && (
              <ButtonLink href="/products?status=needs_cost,needs_history,needs_alternative" size="sm" className="mt-3 w-full">
                {t("Complete missing data")}
              </ButtonLink>
            )}
          </section>

          <section aria-labelledby="activity" className="rounded-lg border border-rule">
            <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
              <h2 id="activity" className="text-[14px] font-semibold">{t("Recent activity")}</h2>
              <Link href="/import" className="text-[13px] font-medium text-ledger hover:underline">
                {t("Imports")}
              </Link>
            </div>
            {activity.length === 0 ? (
              <p className="border-t border-rule px-5 py-5 text-[13px] text-ink-3">{t("Nothing yet. What you import or add by hand shows up here.")}</p>
            ) : (
              <ul>
                {activity.map((a) => {
                  const Icon = a.kind === "import" ? Upload : a.kind === "quote" ? FileText : ReceiptText;
                  return (
                    <li key={a.href + a.at.getTime()} className="border-t border-rule transition-colors hover:bg-well">
                      <Link href={a.href} className="flex items-center gap-3 px-5 py-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-down-wash text-down" aria-hidden>
                          <Icon size={15} strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium">{a.title}</span>
                          <span className="block truncate text-[12px] text-ink-3">
                            {a.detail} · {ago(a.at, undefined, t)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <p className="mt-6 text-[13px] text-ink-3">
        {t("Want the whole picture?")}{" "}
        <Link href="/report" className="inline-flex items-center gap-1 font-medium text-ledger hover:underline">
          {t("Full review, product by product")} <ArrowRight size={13} />
        </Link>
      </p>
    </>
  );
}

/** The few things worth doing first: what, why, how much, and the button that takes you there. */
function TopActions({ ov, t }: { ov: PurchasingOverview; t: T }) {
  return (
    <section aria-labelledby="todo" className="rounded-lg border border-rule">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <h2 id="todo" className="text-[14px] font-semibold">
          {ov.checkFirst.length > 1 ? t("Top {n} things to do", { n: ov.checkFirst.length }) : t("Top thing to do")}
        </h2>
        <Link href="/products" className="text-[13px] font-medium text-ledger hover:underline">
          {t("All products")}
        </Link>
      </div>
      {ov.checkFirst.length === 0 ? (
        <p className="border-t border-rule px-5 py-6 text-[13.5px] text-ink-3">{t("Nothing needs your attention right now. Prices look in line with the quotes you have.")}</p>
      ) : (
        <ol>
          {ov.checkFirst.map((c, i) => (
            <li key={c.productId} className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-rule px-5 py-4">
              <span className="num grid size-8 shrink-0 place-items-center rounded-full bg-wash text-[13.5px] font-semibold text-ink-2">{i + 1}</span>
              <div className="min-w-[180px] flex-1">
                <Link href={`/products/${c.productId}`} className="text-[14.5px] font-semibold tracking-[-0.01em] hover:underline">
                  {c.productName}
                </Link>
                <div className="mt-0.5 text-[13px] text-ink-2">{c.action.label}</div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  {c.impact != null ? (
                    <>
                      {c.impactKind === "saving" ? t("Potential saving") : t("Cost of the increase")}:{" "}
                      <span className={cx("num font-semibold", c.impactKind === "saving" ? "text-ink" : "text-up")}>{t("{amount}/year", { amount: f.moneyApprox(c.impact) })}</span>
                    </>
                  ) : (
                    c.reason
                  )}
                </div>
              </div>
              {c.pct != null ? (
                <span className={cx("num inline-flex h-6 items-center rounded-full px-2 text-[12.5px] font-semibold", c.impactKind === "saving" ? "bg-down-wash text-down" : "bg-up-wash text-up")}>{f.pct(c.pct, 0)}</span>
              ) : (
                isDataGap(c.status) && <span className="inline-flex h-6 items-center rounded-full bg-ledger-wash px-2 text-[12px] font-medium text-ledger">{t(DECISION_STATUS[c.status].label)}</span>
              )}
              <div className="w-[150px] shrink-0 text-right">
                {c.step.target === "quote" ? (
                  <QuoteDialog defaultProductId={c.productId} trigger={{ label: t(c.step.label), size: "sm", plain: true }} />
                ) : c.step.target === "purchase" ? (
                  <PurchaseDialog defaultProductId={c.productId} trigger={{ label: t(c.step.label), size: "sm", plain: true }} />
                ) : (
                  <ButtonLink href={c.step.target === "compare" ? `/compare?product=${c.productId}` : `/products/${c.productId}`} size="sm">
                    {t(c.step.label)}
                  </ButtonLink>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const TONE = {
  info: "bg-ledger-wash text-ledger",
  good: "bg-down-wash text-down",
  review: "bg-caution-wash text-caution",
  risk: "bg-up-wash text-up",
} as const;

function Figure({ t, href, icon: Icon, tone, label, hint, value, note }: { t: T; href: string; icon: LucideIcon; tone: keyof typeof TONE; label: string; hint?: string; value: string; note?: string }) {
  return (
    <div className="relative flex items-center gap-3.5 rounded-lg border border-rule bg-canvas p-4 transition-colors hover:border-rule-strong hover:bg-well">
      <Link href={href} className="absolute inset-0 rounded-lg" aria-label={t("{label}: open details", { label })} />
      <span className={cx("grid size-11 shrink-0 place-items-center rounded-full", TONE[tone])} aria-hidden>
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <div className="num text-[22px] leading-none font-semibold tracking-[-0.02em]">{value}</div>
        <div className="mt-1.5 text-[12.5px] leading-snug text-ink-2">
          {label} {hint && <Hint text={hint} />}
        </div>
        {note && <div className="text-[11.5px] leading-snug text-ink-3">{note}</div>}
      </div>
    </div>
  );
}

/** How much of the catalogue can be judged — a real ratio, not a score. */
function Ring({ t, value, of }: { t: T; value: number; of: number }) {
  const share = of > 0 ? value / of : 0;
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-[76px] shrink-0" role="img" aria-label={t("{value} of {total} products can be compared", { value, total: of })}>
      <svg viewBox="0 0 76 76" className="size-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" className="stroke-wash" />
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * share} ${c}`} className="stroke-down" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <span>
          <span className="num block text-[17px] font-semibold">
            {value}/{of}
          </span>
          <span className="mt-0.5 block text-[10px] text-ink-3">{t("products")}</span>
        </span>
      </div>
    </div>
  );
}

function Tick({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <li className="flex items-center gap-1.5">
      {warn ? <AlertTriangle size={13} className="text-caution" aria-hidden /> : <Check size={13} strokeWidth={2.5} className="text-down" aria-hidden />}
      <span className={warn ? "font-medium text-caution" : "text-ink-2"}>{children}</span>
    </li>
  );
}

/**
 * No data yet: no zeros, no empty charts. One thing to do, three ways to do
 * it, and where that leads.
 */
function FirstSteps({ t, waiting, toReview, suppliers, company, configured }: { t: T; waiting: number; toReview: number; suppliers: number; company: string; configured: boolean }) {
  const steps: { done: boolean; label: string; detail?: string; href?: string }[] = [
    { done: configured, label: t("Tell us about your company"), detail: configured ? company : t("Name, country, VAT number — one minute"), href: "/settings" },
    { done: waiting > 0 || suppliers > 0, label: t("Add your purchasing data"), detail: waiting > 0 ? t.n(waiting, "{n} file uploaded", "{n} files uploaded") : t("Invoices, spreadsheets or quotes") },
    { done: waiting > 0 && toReview === 0, label: t("Check what we recognised"), detail: toReview > 0 ? t("{n} to review", { n: toReview }) : t("A quick yes or no where we are not sure") },
    { done: false, label: t("See your first purchasing overview"), detail: t("What you pay, how prices moved, where to look") },
  ];
  return (
    <div className="mx-auto max-w-[720px] py-6">
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">{t("Start by adding your purchasing data")}</h1>
      <p className="mt-2 max-w-[56ch] text-[15px] leading-relaxed text-ink-2">
        {t("Upload invoices or a spreadsheet and you get your first analysis: what you buy, what you pay, and which prices moved. Most people see it in a few minutes.")}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href="/import" className="group rounded-lg border border-ledger bg-ledger p-4 text-white transition-colors hover:bg-ledger/90">
          <FileUp size={18} strokeWidth={1.75} />
          <div className="mt-3 text-[14px] font-semibold">{t("Upload files")}</div>
          <div className="mt-0.5 text-[12.5px] text-white/70">{t("Invoices and quotes as PDF, or Excel and CSV")}</div>
        </Link>
        <div className="rounded-lg border border-rule p-4">
          <ClipboardPaste size={18} strokeWidth={1.75} className="text-ink-3" />
          <div className="mt-3 text-[14px] font-semibold">{t("Paste from Excel")}</div>
          <div className="mt-0.5 mb-3 text-[12.5px] text-ink-3">{t("Copy the rows, paste them, check")}</div>
          <EntryButton kind="paste" label={t("Paste rows")} size="sm" />
        </div>
        <div className="rounded-lg border border-rule p-4">
          <PenLine size={18} strokeWidth={1.75} className="text-ink-3" />
          <div className="mt-3 text-[14px] font-semibold">{t("Add by hand")}</div>
          <div className="mt-0.5 mb-3 text-[12.5px] text-ink-3">{t("One purchase at a time, five fields")}</div>
          <PurchaseDialog trigger={{ label: t("Add a purchase"), size: "sm" }} />
        </div>
      </div>

      <ol className="mt-8 space-y-2.5 border-t border-rule pt-5 text-[13.5px]">
        {steps.map((s) => (
          <li key={s.label} className="flex items-baseline gap-2.5">
            <span className={cx("w-4 shrink-0 text-center", s.done ? "text-down" : "text-ink-4")} aria-hidden>
              {s.done ? "✓" : "○"}
            </span>
            {s.href && !s.done ? (
              <Link href={s.href} className="font-medium text-ledger hover:underline">
                {s.label}
              </Link>
            ) : (
              <span className={s.done ? "text-ink-2" : "font-medium"}>{s.label}</span>
            )}
            {s.detail && <span className="text-ink-3">{s.detail}</span>}
          </li>
        ))}
      </ol>
      <div className="mt-6">
        <ButtonLink href="/import#data" variant="ghost" size="sm">
          {t("Or load the demo data to look around")}
        </ButtonLink>
      </div>
    </div>
  );
}
