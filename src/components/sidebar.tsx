"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowLeftRight, Boxes, Building2, ChevronDown, ClipboardCheck, Globe, Home, Lightbulb, ReceiptText, Settings, Upload, type LucideIcon } from "lucide-react";
import { APP_SHORT_NAME } from "@/lib/config";
import type { Msg } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

interface NavItem {
  href: string;
  label: Msg;
  icon: LucideIcon;
  /** Other paths that belong to this section. */
  also?: string[];
}

const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/products", label: "Products", icon: Boxes },
  { href: "/suppliers", label: "Suppliers", icon: Building2 },
  { href: "/compare", label: "Compare", icon: ArrowLeftRight },
  { href: "/sourcing", label: "Market|nav", icon: Globe },
  { href: "/import", label: "Import|nav", icon: Upload, also: ["/review"] },
  { href: "/opportunities", label: "Opportunities", icon: Lightbulb },
];

/** Used less often: one click further away. */
const MORE: NavItem[] = [
  { href: "/purchases", label: "Purchases", icon: ReceiptText },
  { href: "/report", label: "Reports", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, item: NavItem) {
  const under = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  return under(item.href) || !!item.also?.some(under);
}

function NavLink({ item, badge }: { item: NavItem; badge?: number }) {
  const pathname = usePathname();
  const t = useT();
  const active = isActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`group flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-white/70 ${
        active ? "bg-ledger font-medium text-white" : "text-white/70 hover:bg-night-2 hover:text-white"
      }`}
    >
      <Icon size={15} strokeWidth={1.75} className={active ? "text-white" : "text-white/50 group-hover:text-white/80"} />
      {t(item.label)}
      {badge ? (
        <span className="num ml-auto rounded-full bg-white px-1.5 text-[11.5px] font-semibold text-caution" aria-label={t("{n} to review", { n: badge })}>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar({ reviewCount = 0, company }: { reviewCount?: number; company: string }) {
  const pathname = usePathname();
  const t = useT();
  const inMore = MORE.some((m) => isActive(pathname, m));
  const [moreOpen, setMoreOpen] = useState(true);
  const showMore = moreOpen || inMore;
  return (
    <aside className="z-20 bg-night text-white md:sticky md:top-0 md:h-dvh print:hidden">
      <div className="flex h-full flex-col md:px-3 md:py-5">
        <Link href="/" className="flex items-center gap-2.5 px-4 pt-4 pb-3 md:px-2.5 md:pt-0 md:pb-6">
          <span aria-hidden className="grid size-7 place-items-center rounded-[7px] bg-ledger text-[11px] font-semibold tracking-tight text-white">
            PI
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[14px] font-semibold tracking-[-0.01em]">{APP_SHORT_NAME}</span>
            <span className="block truncate text-[12px] text-white/55">{company}</span>
          </span>
        </Link>

        <nav aria-label={t("Main")} className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] md:flex-1 md:flex-col md:overflow-visible md:px-0 md:pb-0">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} badge={item.href === "/import" ? reviewCount : undefined} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={showMore}
            className="mt-4 hidden h-7 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium tracking-[0.06em] text-white/45 uppercase transition-colors hover:text-white/80 md:flex"
          >
            {t("More")}
            <ChevronDown size={13} strokeWidth={2} className={`transition-transform duration-150 ${showMore ? "" : "-rotate-90"}`} />
          </button>
          {/* On a phone the row scrolls sideways: everything stays one swipe away. */}
          <div className={`gap-1 md:flex-col ${showMore ? "flex" : "flex md:hidden"}`}>
            {MORE.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </div>
        </nav>
      </div>
    </aside>
  );
}
