"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Boxes,
  Building2,
  ClipboardPaste,
  Clock,
  FileText,
  Lightbulb,
  PenLine,
  Plus,
  ReceiptText,
  Search,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { Msg } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import type { SearchKind, SearchResult } from "@/lib/search";
import { track } from "@/lib/track";
import { useEntry, type Entry } from "../entry/context";
import { cx } from "../ui";
import { readRecent, type RecentItem } from "./recent";

interface Item {
  key: string;
  /** Recently viewed: marked with a clock. */
  recent?: boolean;
  group: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  run: () => void;
}

const KIND: Record<SearchKind, { group: Msg; icon: LucideIcon }> = {
  product: { group: "Products", icon: Boxes },
  supplier: { group: "Suppliers", icon: Building2 },
  quote: { group: "Quotes", icon: FileText },
  purchase: { group: "Purchases", icon: ReceiptText },
  opportunity: { group: "Opportunities", icon: Lightbulb },
};

/**
 * Search and commands in one place (Ctrl/Cmd + K). Typing finds products,
 * suppliers, quotes, purchases and opportunities; with nothing typed it
 * offers the common actions and what was opened recently.
 */
export function CommandBar() {
  const router = useRouter();
  const t = useT();
  const { open: openEntry } = useEntry();
  const dialog = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  const show = () => {
    setQuery("");
    setResults([]);
    setActive(0);
    setRecent(readRecent());
    setIsOpen(true);
    track("command_opened");
  };
  const hide = () => setIsOpen(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (isOpen && !d.open) d.showModal();
    if (!isOpen && d.open) d.close();
  }, [isOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialog.current?.open) hide();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search as you type, dropping answers that arrive late.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const json = (await res.json()) as { results: SearchResult[] };
        setResults(json.results);
        setActive(0);
      } catch {
        // Aborted by the next keystroke, or offline: keep what is shown.
      } finally {
        setSearching(false);
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => router.push(href);
    const add = (entry: Entry) => () => openEntry(entry);
    const group = t("Actions");
    const actions: Item[] = [
      { key: "a-purchase", group, title: t("Add purchase"), icon: Plus, run: add({ kind: "purchase" }) },
      { key: "a-quote", group, title: t("Add quote"), icon: Plus, run: add({ kind: "quote" }) },
      { key: "a-quick", group, title: t("Quick add — write a purchase in words"), icon: PenLine, run: add({ kind: "quick" }) },
      { key: "a-paste", group, title: t("Paste rows from Excel"), icon: ClipboardPaste, run: add({ kind: "paste" }) },
      { key: "a-import", group, title: t("Import invoices, quotes or spreadsheets"), icon: Upload, run: go("/import") },
      { key: "a-compare", group, title: t("Compare suppliers"), icon: ArrowLeftRight, run: go("/compare") },
      { key: "a-product", group, title: t("Add product"), icon: Plus, run: add({ kind: "product" }) },
      { key: "a-supplier", group, title: t("Add supplier"), icon: Plus, run: add({ kind: "supplier" }) },
    ];
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      return [
        ...recent.map<Item>((r) => ({ key: `r-${r.id}`, recent: true, group: t("Recently viewed"), title: r.title, icon: r.kind === "product" ? Boxes : Building2, run: go(r.href) })),
        ...actions.slice(0, recent.length ? 5 : 8),
      ];
    }
    return [
      ...results.map<Item>((r) => ({
        key: `${r.kind}-${r.id}`,
        group: t(KIND[r.kind].group),
        title: r.title,
        subtitle: r.subtitle,
        icon: KIND[r.kind].icon,
        run: () => {
          track("search_result_opened", { kind: r.kind });
          router.push(r.href);
        },
      })),
      ...actions.filter((a) => q.split(/\s+/).every((w) => a.title.toLowerCase().includes(w))),
    ];
  }, [query, results, recent, router, openEntry, t]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    hide();
    item.run();
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-rule-strong bg-well px-2.5 text-left text-[13.5px] text-ink-3 transition-colors hover:border-ink/25 focus-visible:outline-2 focus-visible:outline-ledger sm:max-w-[420px]"
      >
        <Search size={14} className="shrink-0 text-ink-4" />
        <span className="min-w-0 flex-1 truncate">{t("Search products, suppliers, quotes…")}</span>
        <kbd className="hidden rounded border border-rule-strong px-1.5 font-sans text-[11px] text-ink-4 sm:block">Ctrl K</kbd>
      </button>

      <dialog
        ref={dialog}
        onClose={hide}
        onClick={(e) => {
          if (e.target === dialog.current) hide();
        }}
        aria-label={t("Search and commands")}
        className="command mx-auto mt-[12vh] mb-auto max-h-[70vh] w-[calc(100%-24px)] max-w-[600px] overflow-hidden rounded-xl bg-canvas p-0 text-ink shadow-[0_0_0_1px_rgba(17,17,19,.08),0_16px_48px_-12px_rgba(17,17,19,.3)]"
      >
        {isOpen && (
          <div className="flex max-h-[70vh] flex-col">
            <div className="flex items-center gap-2.5 border-b border-rule px-4">
              <Search size={15} className="shrink-0 text-ink-4" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  if (e.target.value.trim().length < 2) setResults([]);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => (items.length ? (a + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    run(items[active]);
                  }
                }}
                placeholder={t("Search products, suppliers, quotes…")}
                aria-label={t("Search")}
                className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-4"
              />
              {searching && <span className="size-3.5 animate-spin rounded-full border-2 border-ledger/25 border-t-ledger" aria-label={t("Searching…")} />}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto py-1.5" role="listbox" aria-label={t("Results")}>
              {items.length === 0 && (
                <li className="px-4 py-6 text-center text-[13.5px] text-ink-3">{searching ? t("Searching…") : t("Nothing found for “{query}”.", { query: query.trim() })}</li>
              )}
              {items.map((item, i) => {
                const Icon = item.icon;
                const first = i === 0 || items[i - 1].group !== item.group;
                return (
                  <li key={item.key} role="presentation">
                    {first && <div className="px-4 pt-2 pb-1 text-[11.5px] font-medium tracking-[0.04em] text-ink-4 uppercase">{item.group}</div>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => run(item)}
                      className={cx("flex w-full items-center gap-3 px-4 py-2 text-left", i === active && "bg-wash")}
                    >
                      <Icon size={15} strokeWidth={1.75} className="shrink-0 text-ink-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{item.title}</span>
                        {item.subtitle && <span className="block truncate text-[12.5px] text-ink-3">{item.subtitle}</span>}
                      </span>
                      {item.recent && <Clock size={13} className="shrink-0 text-ink-4" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="hidden items-center gap-4 border-t border-rule bg-well px-4 py-2 text-[11.5px] text-ink-4 sm:flex">
              <span>{t("↑ ↓ to move")}</span>
              <span>{t("Enter to open")}</span>
              <span>{t("Esc to close")}</span>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
