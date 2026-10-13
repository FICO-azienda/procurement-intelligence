import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PortalLanguage, PortalNav } from "@/components/orders/portal";
import { getDb } from "@/db";
import { APP_NAME } from "@/lib/config";
import { membershipsOf } from "@/server/auth";
import { pendingCount } from "@/server/orders";
import { directOrderOn, getOutsideT, supplierPrincipal } from "@/server/session";

/** The supplier portal's frame. While Direct Order is switched off there is no portal at all. */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  if (!(await directOrderOn())) notFound();
  const [who, t] = await Promise.all([supplierPrincipal(), getOutsideT()]);
  const db = await getDb();
  const [pending, companies] = who ? await Promise.all([pendingCount(db, who), who.userId ? membershipsOf(db, who.userId, "supplier") : []]) : [0, []];
  return (
    <div className="min-h-dvh">
      <header className="bg-night text-white">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <Link href="/portal" className="flex items-center gap-2.5">
              <span aria-hidden className="grid size-7 place-items-center rounded-[7px] bg-ledger text-[11px] font-semibold tracking-tight">
                PI
              </span>
              <span className="leading-tight">
                <span className="block text-[14px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
                <span className="block text-[12px] text-white/55">{t("Supplier portal")}</span>
              </span>
            </Link>
            <span className="ml-auto">
              <PortalLanguage />
            </span>
          </div>
          {who && <PortalNav company={who.orgName} user={who.name} pending={pending} companies={companies} />}
        </div>
      </header>
      <main className="@container mx-auto max-w-[1100px] px-4 pt-6 pb-16 sm:px-8">{children}</main>
    </div>
  );
}
