import Link from "next/link";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db";
import type { ProductOpt, SupplierOpt } from "@/components/entry/context";
import { EntryProvider } from "@/components/entry/provider";
import { AddMenu } from "@/components/shell/add-menu";
import { CommandBar } from "@/components/shell/command";
import { LanguageMenu } from "@/components/shell/language";
import { Notifications, type Notice } from "@/components/shell/notifications";
import { SignOut } from "@/components/shell/sign-out";
import { StaticDemoGuard, StaticDemoView } from "@/components/shell/static-demo";
import { Sidebar } from "@/components/sidebar";
import { APP_NAME } from "@/lib/config";
import { offerNotices } from "@/lib/replies/pending";
import { readReplyDates } from "@/server/replies";
import { getDataset, getIntel, getSettings, getT } from "@/lib/data";
import { coverageOf, todayISO } from "@/lib/analytics";
import * as f from "@/lib/format";
import { I18nProvider } from "@/lib/i18n/client";
import { workspaceAccess } from "@/lib/auth/cookie";
import { DEMO_REPO, STATIC_DEMO } from "@/lib/static-demo";
import { attentionCount, inbox } from "@/server/imports";
import { pendingCount, readNotifications } from "@/server/orders";
import { directOrderOn, workspacePrincipal } from "@/server/session";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
    description: t("What you buy, what you pay, and where it is worth looking."),
  };
}

/**
 * What every page needs around it: the review badge, whether this is demo
 * data, and what the entry forms can fill in by themselves (unit, usual
 * supplier, last price, currency). Read once per request; never breaks a page.
 */
async function shell() {
  await connection();
  const t = await getT();
  try {
    const db = await getDb();
    const [data, intel, review, box, company] = await Promise.all([getDataset(), getIntel(), attentionCount(db), inbox(db), getSettings()]);
    const products: ProductOpt[] = intel.products
      .map((p) => ({
        id: p.product.id,
        name: p.product.name,
        sku: p.product.sku,
        unit: p.product.unit,
        category: p.product.category,
        currentSupplierId: p.product.currentSupplierId,
        lastPrice: p.price.current?.price ?? null,
        lastPriceDate: p.price.current?.date ?? null,
        lastSupplierId: p.price.current?.supplierId ?? null,
        annualQuantity: p.metrics.annualQuantity,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const suppliers: SupplierOpt[] = data.suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      country: s.country,
      currency: s.currency,
      paymentTermsDays: s.paymentTermsDays,
      leadTimeDays: s.defaultLeadTimeDays,
    }));
    const categories = [...new Set(data.products.map((p) => p.category).filter((c): c is string => !!c))].sort();

    // What the bell shows: things to do first, then what moved lately.
    const recent = intel.config.overview.recentDays;
    const since = new Date(Date.parse(intel.asOf) - recent * 86_400_000).toISOString().slice(0, 10);
    const increases = intel.products.filter((p) => p.price.timeline.some((e) => e.pct != null && e.pct > 0 && e.date >= since)).length;
    const newQuotes = intel.products.reduce((n, p) => n + p.comparison.filter((r) => !r.isCurrent && r.kind === "quote" && r.ageDays != null && r.ageDays <= recent).length, 0);
    const notices: Notice[] = [
      ...(review > 0 ? [{ key: "review", text: t.n(review, "{n} imported line needs your review", "{n} imported lines need your review"), href: "/review", todo: true }] : []),
      ...(box.needColumns > 0 ? [{ key: "columns", text: t.n(box.needColumns, "{n} file waiting: check the columns", "{n} files waiting: check the columns"), href: "/import", todo: true }] : []),
      ...(box.ready > 0 ? [{ key: "ready", text: t.n(box.ready, "{n} line ready to import", "{n} lines ready to import"), href: "/import", todo: true }] : []),
      ...(increases > 0 ? [{ key: "up", text: t.n(increases, "{n} price increase in the last {days} days", "{n} price increases in the last {days} days", { days: recent }), href: "/products?sort=change", todo: false }] : []),
      ...(newQuotes > 0 ? [{ key: "quotes", text: t.n(newQuotes, "{n} new quote to compare", "{n} new quotes to compare"), href: "/compare", todo: false }] : []),
      // The replies: offers ending today or soon, and the answers that came lately (lib/replies/pending.ts).
      ...offerNotices(intel.pending, new Map(intel.products.map((p) => [p.product.id, p.product.name])), intel.asOf, await readReplyDates(db), recent, t),
    ];
    // Direct Order, when it is switched on: what waits for an answer, and what the suppliers said since last time.
    let orders: { pending: number } | null = null;
    if (await directOrderOn()) {
      const who = await workspacePrincipal();
      if (who) {
        const [pending, news] = await Promise.all([pendingCount(db, who), readNotifications(db, who)]);
        const unread = news.filter((n) => !n.read).length;
        orders = { pending };
        if (pending > 0) notices.unshift({ key: "orders-todo", text: t.n(pending, "{n} order waits for your answer: the supplier proposed changes", "{n} orders wait for your answer: the suppliers proposed changes"), href: "/orders?show=open", todo: true });
        if (unread > 0) notices.push({ key: "orders-news", text: t.n(unread, "{n} new notification about your orders", "{n} new notifications about your orders"), href: "/orders", todo: false });
      }
    }
    return { t, review, products, suppliers, categories, notices, company, orders, demo: data.purchases.some((p) => p.source === "demo"), coverage: coverageOf(data.purchases, todayISO()) };
  } catch (err) {
    console.error("[shell]", err);
    return { t, review: 0, products: [], suppliers: [], categories: [], notices: [], orders: null, coverage: null, company: { companyName: "", country: null, vatNumber: null, userName: null, language: t.locale, configured: false }, demo: false };
  }
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // On a server other companies can reach, the workspace opens only to a signed-in person of the buyer — checked here
  // against the database, after the proxy checked the cookie's signature. On the company's own computer nothing is asked.
  const signIn = workspaceAccess() === "login";
  const person = signIn ? await workspacePrincipal() : null;
  if (signIn && !person) redirect("/login");
  const s = await shell();
  const t = s.t;
  // Who is at the app: the person signed in, else the name given in Settings. The company is named only once it said its name.
  const userName = person?.name ?? s.company.userName;
  const companyLabel = s.company.configured ? s.company.companyName : s.demo ? t("Demo data") : t("Your company");
  return (
    <html lang={t.locale} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">
        <I18nProvider locale={t.locale}>
        <StaticDemoGuard />
        <EntryProvider products={s.products} suppliers={s.suppliers} categories={s.categories}>
          <div className="md:grid md:min-h-dvh md:grid-cols-[216px_minmax(0,1fr)] print:block">
            <Sidebar reviewCount={s.review} company={companyLabel} orders={s.orders} />
            <main className="min-w-0">
              {s.demo && (
                <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-ledger-wash px-4 py-1.5 text-center text-[12.5px] text-ink-2 print:hidden">
                  <span>
                    <span className="font-semibold text-ledger">{t("Demo mode")}</span> {t("— these are example figures, not your company's.")}
                  </span>
                  {/* The saved demo can't import anything: it says where to run the app instead of opening an import that cannot work. */}
                  {!STATIC_DEMO ? (
                    <Link href="/import#data" className="font-medium text-ledger hover:underline">
                      {t("Start with your own data")}
                    </Link>
                  ) : DEMO_REPO ? (
                    <a href={`${DEMO_REPO}#readme`} target="_blank" rel="noreferrer" className="font-medium text-ledger hover:underline">
                      {t("Read-only copy: to use your own data, run the app (instructions)")}
                    </a>
                  ) : (
                    <span>{t("Read-only copy: to use your own data, run the app on your computer.")}</span>
                  )}
                </div>
              )}
              <div className="relative z-20 flex items-center gap-3 border-b border-rule bg-canvas/95 px-4 py-2.5 backdrop-blur sm:px-8 md:sticky md:top-0 lg:px-10 print:hidden">
                <CommandBar />
                <div className="flex-1 max-sm:hidden" />
                <AddMenu />
                <LanguageMenu />
                <Notifications notices={s.notices} />
                {/* Who is using the app: the way to Settings. */}
                <Link href="/settings" className="hidden min-w-0 items-center gap-2.5 rounded-md py-1 pr-2 pl-1 transition-colors hover:bg-wash sm:flex" aria-label={t("Company and settings")}>
                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-night text-[11px] font-semibold text-white">
                    {initials(userName || companyLabel) || "·"}
                  </span>
                  <span className="hidden min-w-0 leading-tight lg:block">
                    <span className="block max-w-[150px] truncate text-[13px] font-medium">{userName || companyLabel}</span>
                    <span className="block max-w-[150px] truncate text-[11.5px] text-ink-3">{s.demo ? t("Demo data") : userName && s.company.configured ? s.company.companyName : t("Settings")}</span>
                  </span>
                </Link>
                {signIn && <SignOut />}
              </div>
              {/* A size container: tables choose their columns from the room they really have, sidebar or not. */}
              {/* What every "last 12 months" figure really covers, said once and on every page, while the history is shorter than a year. */}
              {s.coverage?.from && !s.coverage.fullYear && !s.demo && (
                <p role="note" className="mx-auto max-w-[1200px] px-4 pt-4 text-[12.5px] text-ink-3 sm:px-8 lg:px-10 print:hidden">
                  <span className="font-medium text-ink-2">{t.n(s.coverage.months, "{n} month of invoices on file", "{n} months of invoices on file", { n: s.coverage.months })}</span>
                  {" · "}
                  {t("from {from} to {to}. Figures for the last 12 months are the sum of this period, not a year's; a yearly figure worked out from it is an estimate, and says so.", { from: f.date(s.coverage.from), to: f.date(s.coverage.to) })}
                </p>
              )}
              <div className="@container mx-auto max-w-[1200px] px-4 pt-6 pb-16 sm:px-8 md:pt-8 lg:px-10">
                {STATIC_DEMO && <StaticDemoView />}
                {children}
              </div>
            </main>
          </div>
        </EntryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
