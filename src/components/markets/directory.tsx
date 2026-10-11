"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { listMarketFilesAction, loadMarketFileAction, makeCandidateAction, setMarketStatusAction } from "@/app/actions";
import { countryName } from "@/lib/countries";
import type { Selection, CategoryTree } from "@/lib/catalog/tree";
import * as f from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { Facets } from "@/lib/markets/filter";
import { CONTINENT_LABEL, PRODUCT_TYPE_LABEL, ROLE_LABEL, STATUSES, STATUS_LABEL, STATUS_MEANING, TECHNOLOGY_LABEL, type Continent, type MarketStatus } from "@/lib/markets/types";
import type { MarketImport } from "@/server/markets";
import { ProductCategoryPicker } from "../catalog/category-picker";
import { Input, Select } from "../form-kit";
import { buttonClass, cx } from "../ui";

const chip = (on: boolean) =>
  cx(
    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ledger/15 focus-visible:outline-none",
    on ? "border-ledger/30 bg-ledger-wash font-medium text-ledger" : "border-rule-strong text-ink-2 hover:border-ink/25 hover:bg-wash",
  );

/**
 * The filters of a directory, kept in the page's address. Each one is its own;
 * only what is on file is offered, with how many companies it leaves — and
 * the countries are those of the continent chosen, never a list of the world.
 */
export function DirectoryFilters({ facets, countries }: { facets: Facets; countries: [string, number][] }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (change: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(change)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const query = next.toString();
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };
  const at = (key: string) => params.get(key);
  const group = (label: string, key: string, options: [value: string, text: string, count: number][]) =>
    options.length > 0 && (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 w-[104px] shrink-0 text-[12px] font-medium text-ink-3">{label}</span>
        {options.map(([value, text, count]) => (
          <button key={value} type="button" aria-pressed={at(key) === value} className={chip(at(key) === value)} onClick={() => go({ [key]: at(key) === value ? null : value })}>
            {text} <span className="num text-[11.5px] opacity-70">{count}</span>
          </button>
        ))}
      </div>
    );
  const active = ["q", "continent", "country", "role", "material", "type", "technology", "status", "email", "match", "rfq"].filter((k) => at(k));

  return (
    <div className={cx("mb-4 transition-opacity", pending && "opacity-80")}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_240px]">
        <label className="relative block">
          <span className="sr-only">{t("Search")}</span>
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-4" />
          <Input
            value={q}
            placeholder={t("Search a company, a product, a material…")}
            className="pl-8"
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => go({ q: v.trim() || null }), 250);
            }}
          />
        </label>
        <label>
          <span className="sr-only">{t("Country")}</span>
          <Select value={at("country") ?? ""} onChange={(e) => go({ country: e.target.value || null })}>
            <option value="">{at("continent") ? t("Every country of the continent") : t("Every country")}</option>
            {countries.map(([country, count]) => (
              <option key={country} value={country}>
                {countryName(country, t.locale)} ({count})
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {group(t("Continent"), "continent", facets.continents.map(([c, n]) => [c, t(CONTINENT_LABEL[c as Continent]), n]))}
        {group(t("What it is"), "role", [
          ...(facets.makers ? [["maker", t("Manufacturers"), facets.makers] as [string, string, number]] : []),
          ...(facets.oem ? [["oem", t("Make to a drawing (OEM)"), facets.oem] as [string, string, number]] : []),
          ...(facets.resellers ? [["reseller", t("Distributors"), facets.resellers] as [string, string, number]] : []),
          ...facets.roles.filter(([r]) => r === "candle_maker").map(([r, n]) => [r, t(ROLE_LABEL.candle_maker), n] as [string, string, number]),
        ])}
        {group(t("Material"), "material", facets.materials.map(([m, n]) => [m, m, n]))}
        {group(t("Kind of container"), "type", facets.types.map(([x, n]) => [x, t(PRODUCT_TYPE_LABEL[x as keyof typeof PRODUCT_TYPE_LABEL] ?? "Not known"), n]))}
        {group(t("Technology"), "technology", facets.technologies.map(([x, n]) => [x, t(TECHNOLOGY_LABEL[x as keyof typeof TECHNOLOGY_LABEL] ?? "Not known"), n]))}
        {group(t("Research status"), "status", facets.statuses.map(([x, n]) => [x, t(STATUS_LABEL[x as MarketStatus] ?? "Not known"), n]))}
        {group(t("To write to"), "email", [
          ["yes", t("With a public email"), facets.withEmail],
          ["no", t("No email found"), facets.countries.reduce((s, [, n]) => s + n, 0) - facets.withEmail],
        ])}
        {facets.matches > 0 && group(t("Your products"), "match", [["yes", t("Could match your references"), facets.matches]])}
      </div>
      {active.length > 0 && (
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-3 hover:text-ink hover:underline"
          onClick={() => {
            setQ("");
            start(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X size={12} /> {t("Clear filters")}
        </button>
      )}
    </div>
  );
}

/**
 * Research files saved on this computer, checked before anything is written:
 * what is new, what refreshes a company already on file, what could not be read.
 */
export function DirectoryImport() {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [files, setFiles] = useState<{ name: string; modified: string }[] | null>(null);
  const [checked, setChecked] = useState<{ name: string; outcome: MarketImport } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (name: string, confirm: boolean) =>
    start(async () => {
      setError(null);
      const res = await loadMarketFileAction(name, confirm);
      if (!res.ok || !res.outcome) return setError(res.error ?? t("Something went wrong."));
      setChecked({ name, outcome: res.outcome });
      if (confirm) router.refresh();
    });

  return (
    <div className="text-[13px]">
      <p className="text-ink-2">{t("A research done outside the app is kept as a file, with the countries it searched and what it left open. Check a file to see what it would add; nothing is loaded until you say so.")}</p>
      {files == null ? (
        <button type="button" className={cx(buttonClass("secondary", "sm"), "mt-3")} disabled={busy} onClick={() => start(async () => setFiles(await listMarketFilesAction()))}>
          {t("Show the files saved on this computer")}
        </button>
      ) : files.length === 0 ? (
        <p className="mt-3 text-ink-3">{t("No research file is saved on this computer.")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {files.map((file) => (
            <li key={file.name} className="flex flex-wrap items-center gap-2">
              <span className="num min-w-0 truncate font-medium">{file.name}</span>
              <span className="text-[12px] text-ink-3">{f.date(file.modified.slice(0, 10))}</span>
              <button type="button" className={buttonClass("ghost", "sm")} disabled={busy} onClick={() => run(file.name, false)}>
                {t("Check the file")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div role="alert" className="mt-3 rounded-md border border-up/25 bg-up-wash px-3 py-2 text-up">
          {error}
        </div>
      )}
      {checked && (
        <div className="mt-3 rounded-md border border-rule bg-well px-3 py-2.5">
          <div className="font-medium">
            {checked.outcome.loaded
              ? t("{file}: loaded. {added} new, {updated} refreshed.", { file: checked.name, added: checked.outcome.added.length, updated: checked.outcome.updated.length })
              : t("{file}: {added} companies not on file yet, {updated} already on file to refresh.", { file: checked.name, added: checked.outcome.added.length, updated: checked.outcome.updated.length })}
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">
            {t("{countries} countries with their coverage, {leads} names still to verify.", { countries: checked.outcome.countries, leads: checked.outcome.leads })}
            {checked.outcome.repeated.length > 0 && ` ${t("Written twice in the file, read once: {names}.", { names: checked.outcome.repeated.join(", ") })}`}
          </div>
          {checked.outcome.rejected.length > 0 && (
            <ul className="mt-1.5 text-[12.5px] text-caution">
              {checked.outcome.rejected.map((r) => (
                <li key={r.name}>{t("Not read: {name} ({reason})", { name: r.name, reason: r.reason })}</li>
              ))}
            </ul>
          )}
          {/* A file may bring no company and still say something: which countries were searched, and what was not found there. */}
          {!checked.outcome.loaded && checked.outcome.added.length + checked.outcome.updated.length + checked.outcome.countries + checked.outcome.leads > 0 && (
            <button type="button" className={cx(buttonClass("primary", "sm"), "mt-2.5")} disabled={busy} onClick={() => run(checked.name, true)}>
              {checked.outcome.added.length + checked.outcome.updated.length > 0
                ? t.n(checked.outcome.added.length + checked.outcome.updated.length, "Load {n} company into the directory", "Load {n} companies into the directory")
                : t("Load its coverage into the directory")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the user decides about one company: how far along it is, and whether it
 * becomes a candidate for one of the buyer's products. Nothing is sent to it.
 */
export function SupplierActions({ id, status, tree }: { id: string; status: MarketStatus; tree: CategoryTree }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pick, setPick] = useState<Selection>({ category: null, subcategory: null, product: null });

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, said: string) =>
    start(async () => {
      setError(null);
      setDone(null);
      const res = await action();
      if (!res.ok) return setError(res.error ?? t("Something went wrong."));
      setDone(said);
      router.refresh();
    });

  return (
    <div className={cx("flex flex-col gap-4 transition-opacity", busy && "opacity-70")}>
      <label className="block max-w-[360px]">
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{t("How far along it is")}</span>
        <Select value={status} disabled={busy} onChange={(e) => run(() => setMarketStatusAction(id, e.target.value), t("Status saved."))}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_LABEL[s])}
            </option>
          ))}
        </Select>
        <span className="mt-1 block text-[12px] text-ink-3">{t(STATUS_MEANING[status])}</span>
      </label>
      <div className="max-w-[460px]">
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{t("Make it a candidate for one of your products")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <ProductCategoryPicker tree={tree} mode="product" value={pick} onChange={setPick} placeholder={t("Choose a product…")} className="min-w-[240px] flex-1" />
          <button type="button" className={buttonClass("secondary")} disabled={busy || !pick.product} onClick={() => run(() => makeCandidateAction(id, pick.product!), t("Added among the candidates of that product: review it there."))}>
            {t("Add as a candidate")}
          </button>
        </div>
        <span className="mt-1 block text-[12px] text-ink-3">{t("It is added with the page that shows it, to review like any other candidate. It does not become a supplier, and nothing is sent to it.")}</span>
      </div>
      {error && (
        <div role="alert" className="rounded-md border border-up/25 bg-up-wash px-3 py-2 text-[13px] text-up">
          {error}
        </div>
      )}
      {done && <div className="text-[13px] text-down">{done}</div>}
    </div>
  );
}
