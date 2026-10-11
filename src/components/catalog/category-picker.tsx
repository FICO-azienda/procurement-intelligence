"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronDown, ChevronRight, FolderTree, Search, X } from "lucide-react";
import { findNames, findProducts } from "@/lib/catalog/find";
import { NO_SELECTION, NO_SUB_KEY, allProducts, productsOf, resolve, type CategoryTree, type Selection, type TreeCategory, type TreeProduct, type TreeSub } from "@/lib/catalog/tree";
import { useT } from "@/lib/i18n/client";
import { cx } from "../ui";

/**
 * Category › subcategory › product, in one control: the categories on the
 * left, the subcategories and the products of the one chosen on the right,
 * and a search box that finds a product by any way it is written.
 *
 * `filter` — a category or a subcategory is a choice in itself, applied as
 * soon as it is clicked; a product is one more step, never a required one.
 * `product` — the levels are only the way to a product, which is what is
 * chosen.
 *
 * The list shows eight products and scrolls for the rest, whatever their
 * number: the control never grows down the page. On a phone it opens as a
 * sheet from the bottom, one level at a time.
 */
export interface ProductCategoryPickerProps {
  tree: CategoryTree;
  value: Selection;
  onChange: (next: Selection) => void;
  mode?: "filter" | "product";
  /** Opened from outside (a "More" link next to quick categories), when given. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** What the button says while nothing is chosen. */
  placeholder?: string;
  className?: string;
}

/** A product row is 44px high: eight of them are in view, the others scroll. */
const ROW = 44;
const HEAD = 44;
const BODY = HEAD + 8 * ROW;
const WIDTH = 680;
const GAP = 6;
const EDGE = 12;

type Option =
  | { kind: "category"; category: TreeCategory }
  | { kind: "sub"; category: TreeCategory; sub: TreeSub }
  | { kind: "product"; product: TreeProduct; category: TreeCategory; sub: TreeSub | null; via: string | null };

const NARROW = "(max-width: 639px)";
const subscribeNarrow = (notify: () => void) => {
  const media = window.matchMedia(NARROW);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

const row = "flex w-full items-center gap-2 rounded-md px-2.5 text-left text-[13.5px] transition-colors focus-visible:outline-none";

export function ProductCategoryPicker({ tree, value, onChange, mode = "filter", open: controlled, onOpenChange, placeholder, className }: ProductCategoryPickerProps) {
  const t = useT();
  const listId = useId();
  const narrow = useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false);
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const [query, setQuery] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  const [active, setActive] = useState(-1);
  /** Where the panes are, when it is not where the value is: walking the levels to a product, or one level up on a phone. */
  const [walk, setWalk] = useState<{ category: string | null; sub: string | null } | null>(null);
  const [stage, setStage] = useState<"categories" | "products">("categories");
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const resolved = useMemo(() => resolve(tree, value, t), [tree, value, t]);
  const at = walk ?? { category: resolved.selection.category, sub: resolved.selection.subcategory };
  const category = tree.categories.find((c) => c.key === at.category) ?? null;
  const sub = category?.subs.find((s) => s.key === at.sub) ?? null;
  const chosen = !!(value.category || value.subcategory || value.product);

  const places = useMemo(() => {
    const map = new Map<string, { category: TreeCategory; sub: TreeSub | null }>();
    for (const c of tree.categories) {
      for (const p of c.direct) map.set(p.id, { category: c, sub: null });
      for (const s of c.subs) for (const p of s.products) map.set(p.id, { category: c, sub: s });
    }
    return map;
  }, [tree]);

  const typed = query.trim();
  const scoped = !!category && !everywhere;
  const options = useMemo<Option[]>(() => {
    const largest = (a: TreeProduct, b: TreeProduct) => b.spend - a.spend || a.name.localeCompare(b.name, undefined, { numeric: true });
    const asOption = (product: TreeProduct, via: string | null = null): Option => ({ kind: "product", product, via, ...places.get(product.id)! });
    // What is compared and negotiated comes before transport, services and the rest of the spend, which is found after it.
    const apart = (p: TreeProduct) => Number(places.get(p.id)!.category.group !== "category");
    if (!typed) {
      if (!category) return [...allProducts(tree)].sort((a, b) => apart(a) - apart(b) || largest(a, b)).map((p) => asOption(p));
      const shown = at.sub === NO_SUB_KEY ? category.direct : sub ? sub.products : productsOf(category);
      return [...shown].sort(largest).map((p) => asOption(p));
    }
    const within = !category || everywhere ? allProducts(tree) : at.sub === NO_SUB_KEY ? category.direct : sub ? sub.products : productsOf(category);
    const named: Option[] = scoped
      ? []
      : [
          ...findNames(tree.categories, typed).map((c): Option => ({ kind: "category", category: c })),
          ...findNames(tree.categories.flatMap((c) => c.subs.map((s) => ({ name: s.name, category: c, sub: s }))), typed).map((x): Option => ({ kind: "sub", category: x.category, sub: x.sub })),
        ].slice(0, 3);
    const found = findProducts(within, typed);
    return [...named, ...[...found.filter((x) => !apart(x.item)), ...found.filter((x) => apart(x.item))].map((x) => asOption(x.item, x.via))];
  }, [tree, places, category, sub, at.sub, typed, everywhere, scoped]);
  const elsewhere = useMemo(() => (typed && scoped && !options.length ? findProducts(allProducts(tree), typed).length : 0), [tree, typed, scoped, options.length]);

  const setOpen = useCallback(
    (next: boolean) => {
      setInner(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(
    (refocus = true) => {
      setOpen(false);
      if (refocus) trigger.current?.focus();
    },
    [setOpen],
  );

  // Every opening starts clean: no words typed, the panes where the value is.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setEverywhere(false);
      setActive(-1);
      setWalk(null);
      setStage(resolved.category ? "products" : "categories");
    }
  }

  // Under the button, inside the window: moved to the left or above when there is no room.
  const position = useCallback(() => {
    const anchor = root.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(WIDTH, window.innerWidth - 2 * EDGE);
    const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - width - EDGE));
    const below = window.innerHeight - anchor.bottom - GAP - EDGE;
    const above = anchor.top - GAP - EDGE;
    if (below >= 360 || below >= above) setPlace({ left, width, top: anchor.bottom + GAP, maxHeight: Math.max(below, 240) });
    else setPlace({ left, width, bottom: window.innerHeight - anchor.top + GAP, maxHeight: Math.max(above, 240) });
  }, []);
  useLayoutEffect(() => {
    if (!open || narrow) return;
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, narrow, position]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) close(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open, close]);

  // On a desk the words go where they are typed, as soon as the panel is there.
  const placed = !!place;
  useEffect(() => {
    if (open && !narrow && placed) search.current?.focus();
  }, [open, narrow, placed]);
  // On a phone the sheet covers the page: the page behind does not scroll with it.
  useEffect(() => {
    if (!open || !narrow) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open, narrow]);

  useEffect(() => {
    // At once, not eased: with the arrow key held down the highlight must never run ahead of what is in view.
    if (open && active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [open, active, listId]);

  const go = (next: { category: string | null; sub: string | null }) => {
    setQuery("");
    setEverywhere(false);
    setActive(-1);
    if (mode === "filter") {
      setWalk(null);
      onChange({ category: next.category, subcategory: next.sub, product: null });
    } else setWalk(next);
  };
  const choose = (option: Option) => {
    if (option.kind === "category") {
      go({ category: option.category.key, sub: null });
      setStage("products");
    } else if (option.kind === "sub") {
      go({ category: option.category.key, sub: option.sub.key });
      setStage("products");
    } else {
      onChange({ category: option.category.key, subcategory: option.sub?.key ?? null, product: option.product.id });
      close();
    }
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % options.length : (a <= 0 ? options.length : a) - 1));
    } else if (e.key === "Enter") {
      const option = options[active >= 0 ? active : typed ? 0 : -1];
      if (option) {
        e.preventDefault();
        choose(option);
      }
    } else if (e.key === "ArrowLeft" && !query) {
      panel.current?.querySelector<HTMLElement>("[data-level='category'][aria-current='true']")?.focus();
    }
  };
  /** Up and down along the categories, right into the products. */
  const onLevelKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      search.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-level='category']")];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const pickAll = () => {
    go({ category: null, sub: null });
    setStage("products");
  };
  const searchEverywhere = () => {
    setEverywhere(true);
    setActive(0);
    search.current?.focus();
  };

  // ---------------- The pieces ----------------

  const searchBox = (
    <label className="relative block">
      <span className="sr-only">{t("Search a product…")}</span>
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
      <input
        ref={search}
        type="text"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={query}
        placeholder={t("Search a product…")}
        className="h-10 w-full rounded-md border border-rule-strong bg-well pr-9 pl-9 text-[14px] text-ink transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-ink-4 hover:border-ink/25 focus:border-ledger focus:bg-canvas focus:ring-3 focus:ring-ledger/15 focus:outline-none"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(e.target.value.trim() ? 0 : -1);
        }}
        onKeyDown={onSearchKey}
      />
      {query && (
        <button
          type="button"
          aria-label={t("Clear the search")}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-ink-3 hover:bg-wash hover:text-ink"
          onClick={() => {
            setQuery("");
            setActive(-1);
            search.current?.focus();
          }}
        >
          <X size={14} />
        </button>
      )}
    </label>
  );

  const scope = (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-rule px-3 py-2 text-[12.5px] text-ink-3" style={{ minHeight: HEAD }}>
      <span>{!category || everywhere ? t("Results in all products") : t("Results in “{name}”", { name: sub?.name ?? category.name })}</span>
      {category && (
        <button
          type="button"
          className="font-medium text-ledger hover:underline"
          onClick={() => {
            setEverywhere((x) => !x);
            setActive(0);
            search.current?.focus();
          }}
        >
          {everywhere ? t("Only in “{name}”", { name: sub?.name ?? category.name }) : t("Search all products")}
        </button>
      )}
    </div>
  );

  const levelRow = (key: string | null, name: string, count: number, current: boolean, onPick: () => void, more: boolean) => (
    <button
      key={key ?? "all"}
      type="button"
      data-level="category"
      aria-current={current || undefined}
      onClick={onPick}
      className={cx(row, narrow ? "h-12" : "h-8", current ? "bg-ledger-wash font-medium text-ledger" : "text-ink hover:bg-wash focus-visible:bg-wash")}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className={cx("num shrink-0 text-[12px]", current ? "text-ledger/80" : "text-ink-3")}>{count}</span>
      {more && <ChevronRight size={15} className="shrink-0 text-ink-4" />}
    </button>
  );

  const groups = [tree.categories.filter((c) => c.group === "category"), tree.categories.filter((c) => c.group !== "category")];
  const levels = (
    <nav aria-label={t("Categories")} onKeyDown={onLevelKey} className="flex flex-col gap-0.5">
      {levelRow(null, t("All products"), tree.count, !category, pickAll, false)}
      {groups.map((group, i) =>
        group.length ? (
          <div key={i} className={cx("flex flex-col gap-0.5", i > 0 && "mt-1.5 border-t border-rule pt-1.5")}>
            {group.map((c) =>
              levelRow(
                c.key,
                c.name,
                c.count,
                category?.key === c.key,
                () => {
                  go({ category: c.key, sub: null });
                  setStage("products");
                },
                narrow,
              ),
            )}
          </div>
        ) : null,
      )}
    </nav>
  );

  const pill = (key: string | null, name: string, count: number) => {
    const current = (at.sub ?? null) === key;
    return (
      <button
        key={key ?? "all"}
        type="button"
        aria-pressed={current}
        onClick={() => go({ category: category!.key, sub: key })}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors focus-visible:ring-3 focus-visible:ring-ledger/15 focus-visible:outline-none",
          narrow ? "h-8" : "h-7",
          current ? "border-ledger/30 bg-ledger-wash font-medium text-ledger" : "border-rule-strong text-ink-2 hover:border-ink/25 hover:bg-wash",
        )}
      >
        {name}
        <span className={cx("num text-[11.5px]", current ? "text-ledger/80" : "text-ink-3")}>{count}</span>
      </button>
    );
  };

  const head = typed ? scope : category ? (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-rule px-3 py-2" style={{ minHeight: HEAD }}>
      {category.subs.length || category.direct.length ? (
        <>
          {pill(null, t("All|subcategories"), category.count)}
          {category.subs.map((s) => pill(s.key, s.name, s.products.length))}
          {category.subs.length > 0 && category.direct.length > 0 && pill(NO_SUB_KEY, t("No subcategory"), category.direct.length)}
        </>
      ) : (
        <span className="text-[12.5px] text-ink-3">{category.name}</span>
      )}
    </div>
  ) : (
    <div className="flex shrink-0 items-center border-b border-rule px-3 text-[12.5px] text-ink-3" style={{ minHeight: HEAD }}>
      {t("Every product, the most bought first")}
    </div>
  );

  const optionRow = (option: Option, index: number) => {
    const on = index === active;
    const base = cx(row, "cursor-pointer", on ? "bg-wash" : "hover:bg-wash");
    if (option.kind !== "product") {
      const isSub = option.kind === "sub";
      return (
        <li key={`${option.kind}-${option.category.key}-${isSub ? option.sub.key : ""}`} id={`${listId}-${index}`} role="option" aria-selected={false} style={{ height: ROW }} className={base} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>
          <FolderTree size={15} strokeWidth={1.75} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{isSub ? option.sub.name : option.category.name}</span>
            <span className="block truncate text-[12px] text-ink-3">{isSub ? t("Subcategory of {name}", { name: option.category.name }) : t("Category")}</span>
          </span>
          <span className="num shrink-0 text-[12px] text-ink-3">{isSub ? option.sub.products.length : option.category.count}</span>
        </li>
      );
    }
    const p = option.product;
    const picked = value.product === p.id;
    // While searching everywhere, where the product is filed tells two of the same name apart; inside a category, who sells it does.
    const where = typed && !scoped ? [option.category.name, option.sub?.name].filter(Boolean).join(" › ") : null;
    const details = [where ?? p.supplier, p.unit, option.via ? t("written “{text}”", { text: option.via }) : p.code].filter(Boolean).join(" · ");
    return (
      <li key={p.id} id={`${listId}-${index}`} role="option" aria-selected={picked} style={{ height: ROW }} className={cx(base, picked && "text-ledger")} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.name}</span>
          <span className={cx("block truncate text-[12px]", picked ? "text-ledger/80" : "text-ink-3")}>{details}</span>
        </span>
        {picked && <Check size={15} className="shrink-0" />}
      </li>
    );
  };

  const empty = typed ? (
    <div className="px-4 py-8 text-center text-[13px] text-ink-3">
      <p>{t("No product found. Try another name or code.")}</p>
      {elsewhere > 0 && (
        <button type="button" className="mt-2 font-medium text-ledger hover:underline" onClick={searchEverywhere}>
          {t.n(elsewhere, "Search all products ({n} result)", "Search all products ({n} results)")}
        </button>
      )}
    </div>
  ) : (
    <div className="px-4 py-8 text-center text-[13px] text-ink-3">{t("No products in this category")}</div>
  );

  const list = (
    <ul id={listId} role="listbox" aria-label={t("Products")} className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5" onMouseLeave={() => setActive(typed ? active : -1)}>
      {options.length ? options.map(optionRow) : <li role="presentation">{empty}</li>}
    </ul>
  );

  const shownProducts = options.filter((o) => o.kind === "product").length;
  const foot = (done: ReactNode) => (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-rule px-3 py-2 text-[12px] text-ink-3">
      <span className="num">{t.n(shownProducts, "{n} product", "{n} products")}</span>
      <span className="flex items-center gap-3">
        {mode === "filter" && chosen && (
          <button type="button" className="font-medium text-ink-2 hover:text-ink hover:underline" onClick={() => {
              go({ category: null, sub: null });
              setStage("categories");
            }}>
            {t("Clear product filters")}
          </button>
        )}
        {done}
      </span>
    </div>
  );

  const desktop = place && (
    <div
      ref={panel}
      role="dialog"
      aria-label={t("Categories and products")}
      className="pop-in fixed z-50 flex flex-col overflow-hidden rounded-xl border border-rule-strong bg-canvas shadow-[0_16px_40px_-12px_rgba(17,17,19,.28)]"
      style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
    >
      <div className="shrink-0 border-b border-rule p-2.5">
        {searchBox}
      </div>
      <div className="flex min-h-0 shrink" style={{ height: BODY }}>
        <div className="thin-scroll w-[224px] shrink-0 overflow-y-auto overscroll-contain border-r border-rule p-1.5">{levels}</div>
        <div className="flex min-w-0 flex-1 flex-col">
          {head}
          {list}
        </div>
      </div>
      {foot(null)}
    </div>
  );

  const showLevels = stage === "categories" && !typed;
  const mobile = (
    <div className="fixed inset-0 z-50">
      <div className="fade-in absolute inset-0 bg-ink/30" onClick={() => close(false)} />
      <div ref={panel} role="dialog" aria-modal aria-label={t("Categories and products")} className="sheet-up absolute inset-x-0 bottom-0 flex h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-canvas shadow-[0_-12px_32px_-12px_rgba(17,17,19,.3)]">
        <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
          {showLevels ? (
            <span className="size-10" />
          ) : (
            <button type="button" aria-label={t("Back")} className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-wash" onClick={() => {
                setQuery("");
                setActive(-1);
                setStage("categories");
              }}>
              <ArrowLeft size={18} />
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-center text-[14.5px] font-semibold">{showLevels || typed ? t("Categories and products") : (category?.name ?? t("All products"))}</span>
          <button type="button" aria-label={t("Close")} className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-wash" onClick={() => close(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="shrink-0 px-3 pt-1 pb-2.5">
          {searchBox}
          </div>
        {showLevels ? (
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto border-t border-rule p-2">{levels}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col border-t border-rule">
            {head}
            {list}
          </div>
        )}
        {foot(
          <button type="button" className="rounded-md bg-ledger px-3.5 py-1.5 text-[13px] font-medium text-white" onClick={() => close(false)}>
            {t("Done")}
          </button>,
        )}
      </div>
    </div>
  );

  const label = resolved.path.length ? resolved.path : null;
  return (
    <div ref={root} className={cx("relative", className)}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label ? label.join(" › ") : undefined}
        onClick={() => setOpen(!open)}
        className={cx(
          "flex h-9 w-full items-center gap-2 rounded-md border bg-well pr-8 pl-2.5 text-left text-[13.5px] transition-[border-color,box-shadow,background-color] duration-150",
          "hover:border-ink/25 focus-visible:border-ledger focus-visible:bg-canvas focus-visible:ring-3 focus-visible:ring-ledger/15 focus-visible:outline-none",
          open ? "border-ledger bg-canvas ring-3 ring-ledger/15" : label ? "border-ledger/40" : "border-rule-strong",
        )}
      >
        <FolderTree size={15} strokeWidth={1.75} className={cx("shrink-0", label ? "text-ledger" : "text-ink-3")} />
        {label ? (
          <span className="flex min-w-0 flex-1 items-baseline">
            {label.length > 1 && <span className="min-w-0 shrink truncate text-ink-3">{label.slice(0, -1).join(" › ")}</span>}
            {label.length > 1 && <span className="shrink-0 px-1 text-ink-4">›</span>}
            <span className={cx("truncate font-medium text-ink", label.length > 1 ? "max-w-[70%] shrink-0" : "min-w-0")}>{label[label.length - 1]}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-ink">{placeholder ?? t("Categories and products")}</span>
        )}
      </button>
      {label && mode === "filter" ? (
        <button
          type="button"
          aria-label={t("Clear product filters")}
          title={t("Clear product filters")}
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded text-ink-3 hover:bg-wash hover:text-ink"
          onClick={() => {
            onChange(NO_SELECTION);
            if (open) close();
          }}
        >
          <X size={14} />
        </button>
      ) : (
        <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-3" />
      )}
      {open && typeof document !== "undefined" && createPortal(narrow ? mobile : desktop, document.body)}
    </div>
  );
}
