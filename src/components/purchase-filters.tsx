"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { Input, Select } from "./form-kit";
import { buttonClass, cx } from "./ui";

type Option = { id: string; name: string };

/** Filters live in the URL, so a filtered view can be bookmarked or shared. */
export function PurchaseFilters({ products, suppliers }: { products: Option[]; suppliers: Option[] }) {
  const router = useRouter();
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const hasFilters = ["q", "product", "supplier", "from", "to"].some((k) => params.get(k));

  return (
    <div className={cx("mb-4 flex flex-wrap items-end gap-2 transition-opacity", pending && "opacity-70")}>
      <label className="relative min-w-[220px] flex-1">
        <span className="sr-only">{t("Search")}</span>
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4" />
        <Input
          value={q}
          placeholder={t("Search product, SKU, supplier, invoice…")}
          className="pl-8"
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => update("q", v.trim()), 250);
          }}
        />
      </label>
      <label className="w-[190px]">
        <span className="sr-only">{t("Product")}</span>
        <Select value={params.get("product") ?? ""} onChange={(e) => update("product", e.target.value)}>
          <option value="">{t("All products")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="w-[170px]">
        <span className="sr-only">{t("Supplier")}</span>
        <Select value={params.get("supplier") ?? ""} onChange={(e) => update("supplier", e.target.value)}>
          <option value="">{t("All suppliers")}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex items-center gap-1.5">
        <label>
          <span className="sr-only">{t("From date")}</span>
          <Input type="date" value={params.get("from") ?? ""} onChange={(e) => update("from", e.target.value)} className="w-[140px]" />
        </label>
        <span className="text-ink-4">–</span>
        <label>
          <span className="sr-only">{t("To date")}</span>
          <Input type="date" value={params.get("to") ?? ""} onChange={(e) => update("to", e.target.value)} className="w-[140px]" />
        </label>
      </div>
      {hasFilters && (
        <button
          type="button"
          className={buttonClass("ghost")}
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X size={14} /> {t("Clear")}
        </button>
      )}
    </div>
  );
}
