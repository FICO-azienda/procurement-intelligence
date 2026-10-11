"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { createCategoryAction, deleteCategoryAction, moveProductsAction, moveSubcategoryAction, renameCategoryAction, reorderCategoryAction, type SimpleResult } from "@/app/actions";
import { useT } from "@/lib/i18n/client";
import { Input, Select } from "../form-kit";
import { buttonClass, cx } from "../ui";

export interface ManagedProduct {
  id: string;
  name: string;
  /** Who sells it and in what unit: enough to tell two of the same name apart. */
  detail: string;
}
export interface ManagedSub {
  /** Null: the products of the category that have no subcategory. */
  name: string | null;
  products: ManagedProduct[];
}
export interface ManagedCategory {
  name: string;
  count: number;
  subs: ManagedSub[];
}

interface Place {
  category: string;
  subcategory?: string | null;
}

const icon = "grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-wash hover:text-ink focus-visible:outline-2 focus-visible:outline-ledger disabled:pointer-events-none disabled:opacity-30";

/** A name being written: Enter keeps it, Escape leaves things as they were. */
function NameForm({ initial = "", placeholder, save, cancel, busy }: { initial?: string; placeholder: string; save: (name: string) => void; cancel: () => void; busy: boolean }) {
  const t = useT();
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save(name);
      }}
    >
      <Input autoFocus value={name} placeholder={placeholder} aria-label={placeholder} className="h-8 max-w-[320px]" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && cancel()} />
      <button type="submit" className={buttonClass("primary", "sm")} disabled={busy || !name.trim()}>
        {t("Save")}
      </button>
      <button type="button" className={buttonClass("ghost", "sm")} onClick={cancel}>
        {t("Cancel")}
      </button>
    </form>
  );
}

/**
 * The hierarchy the company files its products in, and the few things to do
 * to it: a new category, another name, a subcategory under another category,
 * products moved, the order. Purchases, prices and invoices are not here and
 * are not touched — and nothing with products in it can be deleted.
 */
export function CategoryManager({ categories, unclassified }: { categories: ManagedCategory[]; unclassified: ManagedProduct[] }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** The one name being written: a new category ("new"), a new subcategory of one, or a place being renamed. */
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const run = (action: () => Promise<SimpleResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      after?.();
      setEditing(null);
      router.refresh();
    });

  /** Leaving a name half written leaves no message behind either. */
  const cancel = () => {
    setEditing(null);
    setError(null);
  };
  const id = (place: Place) => `${place.category}|${place.subcategory ?? ""}`;
  const toggle = (key: string) => setOpen((s) => new Set(s.has(key) ? [...s].filter((k) => k !== key) : [...s, key]));
  const pick = (ids: string[], on: boolean) => setPicked((s) => new Set(on ? [...s, ...ids] : [...s].filter((k) => !ids.includes(k))));

  // Where products can go: every category, each of its subcategories, and back among the ones to classify.
  const places: { label: string; to: Place | null }[] = [
    ...categories.flatMap((c) => [{ label: c.name, to: { category: c.name } as Place }, ...c.subs.filter((s) => s.name).map((s) => ({ label: `${c.name} › ${s.name}`, to: { category: c.name, subcategory: s.name } as Place }))]),
    { label: t("To classify"), to: null },
  ];

  const products = (list: ManagedProduct[], here: string) => {
    const mine = list.filter((p) => picked.has(p.id)).map((p) => p.id);
    return (
      <div className="border-t border-rule bg-well/60 px-4 py-3">
        {list.length > 1 && (
          <label className="mb-1.5 flex items-center gap-2 text-[12.5px] text-ink-3">
            <input type="checkbox" className="size-3.5 accent-ledger" checked={mine.length === list.length} onChange={(e) => pick(list.map((p) => p.id), e.target.checked)} />
            {t("Select all")}
          </label>
        )}
        <ul className="thin-scroll max-h-[352px] overflow-y-auto">
          {list.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-[13px] hover:bg-wash">
                <input type="checkbox" className="size-3.5 shrink-0 accent-ledger" checked={picked.has(p.id)} onChange={(e) => pick([p.id], e.target.checked)} />
                <Link href={`/products/${p.id}`} className="min-w-0 truncate font-medium hover:text-ledger" onClick={(e) => e.stopPropagation()}>
                  {p.name}
                </Link>
                <span className="min-w-0 shrink-[2] truncate text-[12px] text-ink-3">{p.detail}</span>
              </label>
            </li>
          ))}
        </ul>
        {mine.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-rule pt-2.5">
            <span className="text-[12.5px] text-ink-2">{t.n(mine.length, "Move {n} product to", "Move {n} products to")}</span>
            <div className="w-full sm:w-[320px]">
              <Select
                aria-label={t("Move to…")}
                value=""
                disabled={busy}
                onChange={(e) => {
                  const target = places[Number(e.target.value)];
                  if (target) run(() => moveProductsAction(mine, target.to), () => pick(mine, false));
                }}
              >
                <option value="">{t("Choose where…")}</option>
                {places.map((x, i) => (x.label === here ? null : <option key={x.label} value={i}>{x.label}</option>))}
              </Select>
            </div>
          </div>
        )}
      </div>
    );
  };

  const rowActions = (children: ReactNode) => <span className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">{children}</span>;

  return (
    <div className={cx("transition-opacity", busy && "opacity-70")}>
      <div className="mb-4 flex min-h-8 flex-wrap items-center gap-2">
        {editing === "new" ? (
          <NameForm placeholder={t("Category name")} busy={busy} cancel={cancel} save={(name) => run(() => createCategoryAction(name))} />
        ) : (
          <button type="button" className={buttonClass("primary")} onClick={() => setEditing("new")}>
            <Plus size={15} className="-ml-0.5" /> {t("New category")}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="mb-4 rounded-md border border-up/25 bg-up-wash px-3 py-2 text-[13px] text-up">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {categories.map((c, index) => {
          const place: Place = { category: c.name };
          return (
            <section key={c.name} className="overflow-hidden rounded-lg border border-rule bg-canvas">
              <div className="group/row flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">
                {editing === id(place) ? (
                  <NameForm initial={c.name} placeholder={t("Category name")} busy={busy} cancel={cancel} save={(name) => run(() => renameCategoryAction(place, name))} />
                ) : (
                  <>
                    <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.005em]">{c.name}</h2>
                    <span className="num text-[12.5px] text-ink-3">{t.n(c.count, "{n} product", "{n} products")}</span>
                    <span className="flex-1" />
                    {rowActions(
                      <>
                        <button type="button" className={icon} aria-label={t("Move “{name}” up", { name: c.name })} title={t("Move up")} disabled={busy || index === 0} onClick={() => run(() => reorderCategoryAction(place, "up"))}>
                          <ArrowUp size={14} />
                        </button>
                        <button type="button" className={icon} aria-label={t("Move “{name}” down", { name: c.name })} title={t("Move down")} disabled={busy || index === categories.length - 1} onClick={() => run(() => reorderCategoryAction(place, "down"))}>
                          <ArrowDown size={14} />
                        </button>
                        <button type="button" className={icon} aria-label={t("Rename “{name}”", { name: c.name })} title={t("Rename")} onClick={() => setEditing(id(place))}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" className={icon} aria-label={t("New subcategory of “{name}”", { name: c.name })} title={t("New subcategory")} onClick={() => setEditing(`sub:${c.name}`)}>
                          <FolderPlus size={15} />
                        </button>
                        {c.count === 0 && (
                          <button type="button" className={icon} aria-label={t("Delete “{name}”", { name: c.name })} title={t("Delete")} disabled={busy} onClick={() => run(() => deleteCategoryAction(place))}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>,
                    )}
                  </>
                )}
              </div>

              {editing === `sub:${c.name}` && (
                <div className="flex border-t border-rule px-4 py-2 pl-9">
                  <NameForm placeholder={t("Subcategory name")} busy={busy} cancel={cancel} save={(name) => run(() => createCategoryAction(name, c.name))} />
                </div>
              )}

              {c.subs.map((s, at) => {
                const here: Place = { category: c.name, subcategory: s.name };
                const key = id(here);
                const shown = open.has(key);
                const named = s.name !== null;
                const real = c.subs.filter((x) => x.name !== null);
                return (
                  <div key={key} className="border-t border-rule">
                    <div className="group/row flex min-h-11 flex-wrap items-center gap-2 py-1.5 pr-4 pl-3">
                      {editing === key ? (
                        <div className="flex min-w-0 flex-1 pl-6">
                          <NameForm initial={s.name!} placeholder={t("Subcategory name")} busy={busy} cancel={cancel} save={(name) => run(() => renameCategoryAction(here, name))} />
                        </div>
                      ) : (
                        <>
                          <button type="button" aria-expanded={shown} disabled={!s.products.length} onClick={() => toggle(key)} className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 pl-1 text-left text-[13.5px] hover:bg-wash focus-visible:outline-2 focus-visible:outline-ledger disabled:pointer-events-none">
                            <ChevronRight size={14} className={cx("shrink-0 text-ink-4 transition-transform duration-150", shown && "rotate-90", !s.products.length && "opacity-0")} />
                            <span className={cx("min-w-0 truncate", named ? "font-medium" : "text-ink-3 italic")}>{s.name ?? t("No subcategory")}</span>
                            <span className="num shrink-0 text-[12.5px] text-ink-3">{s.products.length || t("empty")}</span>
                          </button>
                          <span className="flex-1" />
                          {named &&
                            rowActions(
                              <>
                                <button type="button" className={icon} aria-label={t("Move “{name}” up", { name: s.name! })} title={t("Move up")} disabled={busy || at === 0} onClick={() => run(() => reorderCategoryAction(here, "up"))}>
                                  <ArrowUp size={14} />
                                </button>
                                <button type="button" className={icon} aria-label={t("Move “{name}” down", { name: s.name! })} title={t("Move down")} disabled={busy || at >= real.length - 1} onClick={() => run(() => reorderCategoryAction(here, "down"))}>
                                  <ArrowDown size={14} />
                                </button>
                                <button type="button" className={icon} aria-label={t("Rename “{name}”", { name: s.name! })} title={t("Rename")} onClick={() => setEditing(key)}>
                                  <Pencil size={14} />
                                </button>
                                {categories.length > 1 && (
                                  <span className="ml-1 w-[170px]">
                                    <Select aria-label={t("Move “{name}” to another category", { name: s.name! })} value="" disabled={busy} className="h-7 text-[12.5px]" onChange={(e) => e.target.value && run(() => moveSubcategoryAction({ category: c.name, subcategory: s.name! }, e.target.value))}>
                                      <option value="">{t("Move to…")}</option>
                                      {categories.filter((x) => x.name !== c.name).map((x) => (
                                        <option key={x.name} value={x.name}>
                                          {x.name}
                                        </option>
                                      ))}
                                    </Select>
                                  </span>
                                )}
                                {s.products.length === 0 && (
                                  <button type="button" className={icon} aria-label={t("Delete “{name}”", { name: s.name! })} title={t("Delete")} disabled={busy} onClick={() => run(() => deleteCategoryAction(here))}>
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </>,
                            )}
                        </>
                      )}
                    </div>
                    {shown && s.products.length > 0 && products(s.products, named ? `${c.name} › ${s.name}` : c.name)}
                  </div>
                );
              })}
              {c.subs.length === 0 && editing !== `sub:${c.name}` && <p className="border-t border-rule px-4 py-2.5 pl-9 text-[12.5px] text-ink-3">{t("Nothing in it yet: move products here, or add a subcategory.")}</p>}
            </section>
          );
        })}

        {unclassified.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-dashed border-rule-strong bg-canvas">
            <div className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">
              <h2 className="text-[15px] font-semibold tracking-[-0.005em]">{t("To classify")}</h2>
              <span className="num text-[12.5px] text-ink-3">{t.n(unclassified.length, "{n} product", "{n} products")}</span>
              <span className="flex-1" />
              <Link href="/products/review" className="text-[13px] font-medium text-ledger hover:underline">
                {t("Open Product cleanup")}
              </Link>
            </div>
            <p className="px-4 pb-3 text-[13px] text-ink-2">{t("Products with no category yet. Product cleanup proposes one for each, to confirm there; or file them here by hand.")}</p>
            {products(unclassified, t("To classify"))}
          </section>
        )}
      </div>
    </div>
  );
}
