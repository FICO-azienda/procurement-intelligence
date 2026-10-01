"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "../form-kit";
import { cx } from "../ui";

/** Search, supplier, category and sort for the product list. State lives in the URL. */
export function ProductFilters({
  suppliers,
  categories,
  sorts,
  defaultSort = "spend",
  placeholder = "Search product, SKU, category…",
}: {
  suppliers: { id: string; name: string }[];
  categories: string[];
  sorts: { key: string; label: string }[];
  /** The sort that needs no URL parameter. */
  defaultSort?: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className={cx("flex flex-wrap items-center gap-2 transition-opacity print:hidden", pending && "opacity-70")}>
      <label className="relative min-w-[200px] flex-1">
        <span className="sr-only">Search products</span>
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4" />
        <Input
          value={q}
          placeholder={placeholder}
          className="pl-8"
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => update("q", v.trim()), 250);
          }}
        />
      </label>
      <label className="w-[180px]">
        <span className="sr-only">Supplier</span>
        <Select value={params.get("supplier") ?? ""} onChange={(e) => update("supplier", e.target.value)}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="w-[160px]">
        <span className="sr-only">Category</span>
        <Select value={params.get("category") ?? ""} onChange={(e) => update("category", e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
        Sort
        <span className="w-[170px]">
          <Select value={params.get("sort") ?? defaultSort} onChange={(e) => update("sort", e.target.value === defaultSort ? "" : e.target.value)}>
            {sorts.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </span>
      </label>
    </div>
  );
}
