/**
 * What the user did lately — imports and records added by hand — for the
 * "Recent activity" list on the home page. Demo records are not activity.
 */
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { importSessions, products, purchases, quotes, suppliers } from "@/db/schema";
import { en, type T } from "@/lib/i18n";

export interface Activity {
  kind: "import" | "purchase" | "quote";
  at: Date;
  title: string;
  detail: string;
  href: string;
}

export async function recentActivity(db: DB, limit = 4, t: T = en): Promise<Activity[]> {
  const [imports, bought, quoted] = await Promise.all([
    db.select().from(importSessions).where(eq(importSessions.status, "completed")).orderBy(desc(importSessions.completedAt)).limit(limit),
    db
      .select({ id: purchases.id, at: purchases.createdAt, product: products.name, supplier: suppliers.name, productId: purchases.productId })
      .from(purchases)
      .innerJoin(products, eq(purchases.productId, products.id))
      .innerJoin(suppliers, eq(purchases.supplierId, suppliers.id))
      .where(eq(purchases.source, "manual"))
      .orderBy(desc(purchases.createdAt))
      .limit(limit),
    db
      .select({ id: quotes.id, at: quotes.createdAt, product: products.name, supplier: suppliers.name, productId: quotes.productId })
      .from(quotes)
      .innerJoin(products, eq(quotes.productId, products.id))
      .innerJoin(suppliers, eq(quotes.supplierId, suppliers.id))
      .where(eq(quotes.source, "manual"))
      .orderBy(desc(quotes.createdAt))
      .limit(limit),
  ]);
  const out: Activity[] = [
    ...imports
      .filter((s) => s.completedAt && s.recordsImported > 0)
      .map((s) => ({
        kind: "import" as const,
        at: s.completedAt!,
        title: s.recordType === "quote" ? t.n(s.recordsImported, "You imported {n} quote", "You imported {n} quotes") : t.n(s.recordsImported, "You imported {n} purchase", "You imported {n} purchases"),
        detail: s.filename,
        href: `/import/${s.id}`,
      })),
    ...bought.map((p) => ({ kind: "purchase" as const, at: p.at, title: t("Purchase added"), detail: `${p.product} · ${p.supplier}`, href: `/products/${p.productId}` })),
    ...quoted.map((q) => ({ kind: "quote" as const, at: q.at, title: t("Quote added"), detail: `${q.product} · ${q.supplier}`, href: `/compare?product=${q.productId}` })),
  ];
  return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** "10 minutes ago", "2 hours ago", "3 days ago". */
export function ago(date: Date, now = new Date(), t: T = en): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t.n(minutes, "{n} minute ago", "{n} minutes ago");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t.n(hours, "{n} hour ago", "{n} hours ago");
  const days = Math.round(hours / 24);
  if (days < 30) return t.n(days, "{n} day ago", "{n} days ago");
  return date.toLocaleDateString("it-IT");
}
