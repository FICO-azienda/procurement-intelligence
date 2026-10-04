"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Boxes, Building2, ClipboardPaste, FileText, PenLine, Plus, ReceiptText, Upload, type LucideIcon } from "lucide-react";
import type { Msg } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useEntry, type Entry } from "../entry/context";
import { buttonClass } from "../ui";

const ITEMS: { label: Msg; hint: Msg; icon: LucideIcon; entry: Entry }[] = [
  { label: "Purchase", hint: "What you bought, at what price", icon: ReceiptText, entry: { kind: "purchase" } },
  { label: "Quote", hint: "A price a supplier offered", icon: FileText, entry: { kind: "quote" } },
  { label: "Product", hint: "Something you buy", icon: Boxes, entry: { kind: "product" } },
  { label: "Supplier", hint: "A company you buy from", icon: Building2, entry: { kind: "supplier" } },
];

const FAST: { label: Msg; hint: Msg; icon: LucideIcon; entry: Entry }[] = [
  { label: "Quick add", hint: "Write a purchase in your own words", icon: PenLine, entry: { kind: "quick" } },
  { label: "Paste from Excel", hint: "Copy rows, paste, check", icon: ClipboardPaste, entry: { kind: "paste" } },
];

/** The one place to add anything. */
export function AddMenu() {
  const { open } = useEntry();
  const t = useT();
  const [shown, setShown] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shown) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setShown(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setShown(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [shown]);

  const row = "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-wash focus-visible:bg-wash focus-visible:outline-none";
  const pick = (entry: Entry) => {
    setShown(false);
    open(entry);
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown((s) => !s)} className={buttonClass("primary")}>
        <Plus size={15} strokeWidth={2.25} className="-ml-0.5" /> {t("Add")}
      </button>
      {shown && (
        <div role="menu" className="absolute top-[calc(100%+6px)] right-0 z-40 w-[290px] rounded-lg border border-rule-strong bg-canvas p-1.5 shadow-[0_12px_32px_-8px_rgba(17,17,19,.25)]">
          {ITEMS.map(({ label, hint, icon: Icon, entry }) => (
            <button key={label} type="button" role="menuitem" className={row} onClick={() => pick(entry)}>
              <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" />
              <span>
                <span className="block text-[13.5px] font-medium">{t(label)}</span>
                <span className="block text-[12px] text-ink-3">{t(hint)}</span>
              </span>
            </button>
          ))}
          <div className="my-1.5 border-t border-rule" />
          {FAST.map(({ label, hint, icon: Icon, entry }) => (
            <button key={label} type="button" role="menuitem" className={row} onClick={() => pick(entry)}>
              <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" />
              <span>
                <span className="block text-[13.5px] font-medium">{t(label)}</span>
                <span className="block text-[12px] text-ink-3">{t(hint)}</span>
              </span>
            </button>
          ))}
          <Link href="/import" role="menuitem" className={row} onClick={() => setShown(false)}>
            <Upload size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" />
            <span>
              <span className="block text-[13.5px] font-medium">{t("Import files")}</span>
              <span className="block text-[12px] text-ink-3">{t("Invoices, quotes, spreadsheets")}</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
