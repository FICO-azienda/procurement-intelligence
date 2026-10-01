"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  Boxes,
  Building2,
  CalendarDays,
  Inbox,
  ReceiptText,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { APP_SHORT_NAME, COMPANY_NAME } from "@/lib/config";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Today", icon: CalendarDays },
  { href: "/products", label: "Products", icon: Boxes },
  { href: "/suppliers", label: "Suppliers", icon: Building2 },
  { href: "/purchases", label: "Purchases", icon: ReceiptText },
  { href: "/compare", label: "Compare", icon: ArrowLeftRight },
];

const DATA_NAV = [
  { href: "/import", label: "Import", icon: Upload },
  { href: "/review", label: "Review", icon: Inbox },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ href, label, icon: Icon, badge }: { href: string; label: string; icon: LucideIcon; badge?: number }) {
  const pathname = usePathname();
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors duration-150 ${
        active
          ? "bg-wash font-medium text-ink"
          : "text-ink-2 hover:bg-wash hover:text-ink"
      }`}
    >
      <Icon
        size={15}
        strokeWidth={1.75}
        className={active ? "text-ledger" : "text-ink-4 group-hover:text-ink-3"}
      />
      {label}
      {badge ? (
        <span className="num ml-auto rounded-full bg-caution-wash px-1.5 text-[11.5px] font-semibold text-caution" aria-label={`${badge} to review`}>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar({ reviewCount = 0 }: { reviewCount?: number }) {
  return (
    <aside className="sticky top-0 z-20 border-b border-rule bg-canvas md:h-dvh md:border-r md:border-b-0">
      <div className="flex h-full flex-col md:px-3 md:py-5">
        <Link href="/" className="flex items-center gap-2.5 px-4 pt-4 pb-3 md:px-2.5 md:pt-0 md:pb-6">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-[6px] bg-ink text-[11px] font-semibold tracking-tight text-white"
          >
            PI
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13.5px] font-semibold tracking-[-0.01em]">
              {APP_SHORT_NAME}
            </span>
            <span className="block truncate text-[12px] text-ink-3">{COMPANY_NAME}</span>
          </span>
        </Link>

        <nav
          aria-label="Main"
          className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] md:flex-1 md:flex-col md:overflow-visible md:px-0 md:pb-0"
        >
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
          <div className="mx-1 hidden border-t border-rule md:my-2 md:block" />
          {DATA_NAV.map((item) => (
            <NavLink key={item.href} {...item} badge={item.href === "/review" ? reviewCount : undefined} />
          ))}
        </nav>
      </div>
    </aside>
  );
}
