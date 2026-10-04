"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";

/** "Products / Paraffina 58/60": where you are, and the way back. */
export function Crumbs({ items }: { items: { href: string; label: string }[] }) {
  const t = useT();
  return (
    <nav aria-label={t("Breadcrumb")} className="flex flex-wrap items-center gap-1.5">
      {items.map((c, i) => (
        <span key={c.href} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-4">/</span>}
          <Link href={c.href} className="hover:text-ink hover:underline">
            {c.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
