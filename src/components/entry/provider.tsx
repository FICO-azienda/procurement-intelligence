"use client";

import { usePathname } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Msg } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { track } from "@/lib/track";
import { Sheet } from "../form-kit";
import { cx } from "../ui";
import { EntryContext, type Entry, type ProductOpt, type SupplierOpt } from "./context";
import { PasteForm, ProductForm, PurchaseForm, QuickAddForm, QuoteForm, SupplierForm } from "./forms";

const TITLE: Record<Entry["kind"], [add: Msg, edit: Msg, description?: Msg]> = {
  purchase: ["Add purchase", "Edit purchase", "What you bought, from whom, at what price."],
  quote: ["Add quote", "Edit quote", "A price a supplier offered you."],
  product: ["Add product", "Edit product", "A material or component you buy."],
  supplier: ["Add supplier", "Edit supplier"],
  quick: ["Quick add", "Quick add", "Write the purchase the way you would say it."],
  paste: ["Paste from Excel", "Paste from Excel", "Bring rows in without saving a file."],
};

/**
 * The one entry panel of the app. Any button, anywhere, opens it through
 * `useEntry().open(...)`: the option lists live here once instead of being
 * sent along with every button.
 */
export function EntryProvider({ products, suppliers, categories, children }: { products: ProductOpt[]; suppliers: SupplierOpt[]; categories: string[]; children: ReactNode }) {
  const t = useT();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [version, setVersion] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [extraProducts, setExtraProducts] = useState<ProductOpt[]>([]);
  const [extraSuppliers, setExtraSuppliers] = useState<SupplierOpt[]>([]);

  const open = useCallback((e: Entry) => {
    track("add_opened", { kind: e.kind });
    setEntry(e);
    setVersion((v) => v + 1);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  // Saving a new product or supplier lands on its page: the panel has done its job.
  const pathname = usePathname();
  const [at, setAt] = useState(pathname);
  if (at !== pathname) {
    setAt(pathname);
    setIsOpen(false);
  }

  // Records created on the fly stay selectable until the refreshed page data includes them.
  const allProducts = useMemo(() => [...products, ...extraProducts.filter((x) => !products.some((p) => p.id === x.id))], [products, extraProducts]);
  const allSuppliers = useMemo(() => [...suppliers, ...extraSuppliers.filter((x) => !suppliers.some((s) => s.id === x.id))], [suppliers, extraSuppliers]);

  const api = useMemo(
    () => ({
      open,
      close,
      products: allProducts,
      suppliers: allSuppliers,
      categories,
      addProduct: (p: ProductOpt) => setExtraProducts((list) => [...list, p]),
      addSupplier: (s: SupplierOpt) => setExtraSuppliers((list) => [...list, s]),
    }),
    [open, close, allProducts, allSuppliers, categories],
  );

  const editing = !!entry && ((entry.kind === "purchase" && !!entry.purchase) || (entry.kind === "quote" && !!entry.quote) || (entry.kind === "product" && !!entry.product) || (entry.kind === "supplier" && !!entry.supplier));
  // A new purchase can be typed, written in words or pasted: three ways into the same panel.
  const purchaseWays = !!entry && !editing && (entry.kind === "purchase" || entry.kind === "quick" || entry.kind === "paste");
  const title = entry ? t(purchaseWays ? "Add purchase" : TITLE[entry.kind][editing ? 1 : 0]) : "";
  const description = entry ? TITLE[entry.kind][2] : undefined;
  const tabs = purchaseWays ? (
    <div role="tablist" aria-label={t("How to add")} className="mx-6 mb-4 flex gap-1 rounded-lg bg-wash p-1">
      {(
        [
          ["purchase", "Manual"],
          ["quick", "In words"],
          ["paste", "Paste from Excel"],
        ] as const satisfies readonly (readonly [string, Msg])[]
      ).map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          role="tab"
          aria-selected={entry.kind === kind}
          onClick={() => entry.kind !== kind && open({ kind })}
          className={cx(
            "h-8 flex-1 rounded-md px-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ledger",
            entry.kind === kind ? "bg-canvas text-ink shadow-[0_1px_2px_rgba(17,17,19,.12)]" : "text-ink-3 hover:text-ink",
          )}
        >
          {t(label)}
        </button>
      ))}
    </div>
  ) : undefined;

  return (
    <EntryContext.Provider value={api}>
      {children}
      <Sheet open={isOpen} onClose={close} title={title} description={description ? t(description) : undefined} wide={purchaseWays || (entry?.kind === "purchase" && editing)} tabs={tabs}>
        {entry?.kind === "purchase" && <PurchaseForm key={version} purchase={entry.purchase} defaultProductId={entry.productId} defaultSupplierId={entry.supplierId} prefill={entry.prefill} close={close} />}
        {entry?.kind === "quote" && <QuoteForm key={version} quote={entry.quote} defaultProductId={entry.productId} defaultSupplierId={entry.supplierId} close={close} />}
        {entry?.kind === "product" && <ProductForm key={version} product={entry.product} deleteNote={entry.deleteNote} close={close} />}
        {entry?.kind === "supplier" && <SupplierForm key={version} supplier={entry.supplier} deleteNote={entry.deleteNote} close={close} />}
        {entry?.kind === "quick" && <QuickAddForm key={version} close={close} />}
        {entry?.kind === "paste" && <PasteForm key={version} close={close} />}
      </Sheet>
    </EntryContext.Provider>
  );
}
