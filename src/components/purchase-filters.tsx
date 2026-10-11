"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { NO_SELECTION, resolve, type CategoryTree, type Selection } from "@/lib/catalog/tree";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { ProductCategoryPicker } from "./catalog/category-picker";
import { Input, Select } from "./form-kit";
import { cx } from "./ui";

type Option = { id: string; name: string };

/** How many categories are one click away above the table: the largest; the others are in the picker. */
const QUICK = 6;

/**
 * Filters live in the URL, so a filtered view can be bookmarked or shared.
 * Each one is its own: choosing a category never touches the supplier or the
 * dates, and clearing the product filters leaves the others as they are.
 */
export function PurchaseFilters({ tree, suppliers }: { tree: CategoryTree; suppliers: Option[] }) {
  const router = useRouter();
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [picking, setPicking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const inUrl = useMemo<Selection>(() => ({ category: params.get("category"), subcategory: params.get("subcategory"), product: params.get("product") }), [params]);
  // The choice shows at once, while the table behind it is being read again.
  const [selection, setSelection] = useOptimistic(inUrl);
  const resolved = useMemo(() => resolve(tree, selection, t), [tree, selection, t]);

  function go(next: URLSearchParams, before?: () => void) {
    const query = next.toString();
    startTransition(() => {
      before?.();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }
  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    go(next);
  }
  function pick(choice: Selection) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of [["category", choice.category], ["subcategory", choice.subcategory], ["product", choice.product]] as const) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    go(next, () => setSelection(choice));
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  const clearSearch = () => {
    setQ("");
    update("q", "");
  };
  const supplier = suppliers.find((s) => s.id === params.get("supplier"));
  const from = params.get("from");
  const to = params.get("to");
  const at = resolved.selection;
  const chips: { key: string; label: string; title?: string; remove: () => void }[] = [
    ...(params.get("q") ? [{ key: "q", label: `“${params.get("q")}”`, title: t("Search"), remove: clearSearch }] : []),
    // A level taken off takes the ones under it with it: a subcategory is of its category, a product of both.
    ...(resolved.path[0] && at.category ? [{ key: "category", label: resolved.path[0], title: t("Category"), remove: () => pick(NO_SELECTION) }] : []),
    ...(resolved.path[1] && at.subcategory ? [{ key: "subcategory", label: resolved.path[1], title: t("Subcategory"), remove: () => pick({ category: at.category, subcategory: null, product: null }) }] : []),
    ...(at.product ? [{ key: "product", label: resolved.product?.name ?? t("A product no longer on file"), title: t("Product"), remove: () => pick({ category: at.category, subcategory: at.subcategory, product: null }) }] : []),
    ...(supplier ? [{ key: "supplier", label: supplier.name, title: t("Supplier"), remove: () => update("supplier", "") }] : []),
    ...(from ? [{ key: "from", label: t("from {date}", { date: f.date(from) }), remove: () => update("from", "") }] : []),
    ...(to ? [{ key: "to", label: t("to {date}", { date: f.date(to) }), remove: () => update("to", "") }] : []),
  ];

  const main = tree.categories.filter((c) => c.group === "category");
  const first = main.slice(0, QUICK);
  // The category chosen is always among them, wherever it comes in the order.
  const quick = resolved.category && !first.includes(resolved.category) ? [...first, resolved.category] : first;
  const more = tree.categories.length > quick.length;
  const tab = (key: string | null, name: string) => {
    const current = (at.category ?? null) === key;
    return (
      <button
        key={key ?? "all"}
        type="button"
        aria-pressed={current}
        onClick={() => pick(key ? { category: key, subcategory: null, product: null } : NO_SELECTION)}
        className={cx(
          "-mb-px shrink-0 border-b-2 px-0.5 pb-2 text-[13px] whitespace-nowrap transition-colors focus-visible:text-ledger focus-visible:outline-none",
          current ? "border-ledger font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
        )}
      >
        {name}
      </button>
    );
  };

  return (
    <div className={cx("mb-3 transition-opacity", pending && "opacity-80")}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(260px,380px)]">
        <label className="relative block">
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
        <ProductCategoryPicker tree={tree} value={selection} onChange={pick} open={picking} onOpenChange={setPicking} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="w-full sm:w-[260px]">
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
            <Input type="date" value={from ?? ""} onChange={(e) => update("from", e.target.value)} className="w-[140px]" />
          </label>
          <span className="text-ink-4">–</span>
          <label>
            <span className="sr-only">{t("To date")}</span>
            <Input type="date" value={to ?? ""} onChange={(e) => update("to", e.target.value)} className="w-[140px]" />
          </label>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span key={chip.key} title={chip.title} className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-rule-strong bg-canvas pr-1 pl-2.5 text-[12.5px] text-ink-2">
              <span className="max-w-[260px] truncate">{chip.label}</span>
              <button type="button" aria-label={t("Remove the filter “{name}”", { name: chip.label })} className="grid size-5 place-items-center rounded-full text-ink-3 hover:bg-wash hover:text-ink" onClick={chip.remove}>
                <X size={12} />
              </button>
            </span>
          ))}
          {chips.length > 1 && (
            <button
              type="button"
              className="ml-1 text-[12.5px] font-medium text-ink-3 hover:text-ink hover:underline"
              onClick={() => {
                setQ("");
                go(new URLSearchParams(), () => setSelection(NO_SELECTION));
              }}
            >
              {t("Clear filters")}
            </button>
          )}
        </div>
      )}

      {quick.length > 1 && (
        <div className="no-scrollbar mt-3 flex items-end gap-5 overflow-x-auto border-b border-rule">
          {tab(null, t("All"))}
          {quick.map((c) => tab(c.key, c.name))}
          {more && (
            <button type="button" onClick={() => setPicking(true)} className="-mb-px inline-flex shrink-0 items-center gap-1 border-b-2 border-transparent px-0.5 pb-2 text-[13px] text-ink-3 hover:text-ink">
              {t("More|categories")} <ChevronDown size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
