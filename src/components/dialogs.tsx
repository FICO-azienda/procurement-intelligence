"use client";

/**
 * Buttons that open the app's entry panel (see entry/provider.tsx). They carry
 * only what the form should start from — a record to edit, a product or
 * supplier to preselect — never the option lists.
 */
import { Pencil, Plus } from "lucide-react";
import type { ProductData, PurchaseData, QuoteData, SupplierData } from "@/lib/analytics";
import { useT } from "@/lib/i18n/client";
import { useEntry, type Entry } from "./entry/context";
import { buttonClass, type Variant } from "./ui";

export type Trigger = { label?: string; variant?: Variant; size?: "sm" | "md"; iconOnly?: boolean; plain?: boolean };

function TriggerButton({ trigger, editing, entry }: { trigger?: Trigger; editing: boolean; entry: Entry }) {
  const { open } = useEntry();
  const t = useT();
  const label = trigger?.label ?? (editing ? t("Edit") : t("Add"));
  if (trigger?.iconOnly) {
    return (
      <button
        type="button"
        onClick={() => open(entry)}
        aria-label={label}
        title={label}
        className="relative z-10 grid size-7 place-items-center rounded-md text-ink-4 transition-colors hover:bg-wash hover:text-ink"
      >
        <Pencil size={13} />
      </button>
    );
  }
  const Icon = editing ? Pencil : Plus;
  return (
    <button type="button" onClick={() => open(entry)} className={buttonClass(trigger?.variant ?? "secondary", trigger?.size)}>
      {!trigger?.plain && <Icon size={14} strokeWidth={2} className="-ml-0.5" />}
      {label}
    </button>
  );
}

export function ProductDialog({ product, deleteNote, trigger }: { product?: ProductData; deleteNote?: string; trigger?: Trigger }) {
  return <TriggerButton trigger={trigger} editing={!!product} entry={{ kind: "product", product, deleteNote }} />;
}

export function SupplierDialog({ supplier, deleteNote, trigger }: { supplier?: SupplierData; deleteNote?: string; trigger?: Trigger }) {
  return <TriggerButton trigger={trigger} editing={!!supplier} entry={{ kind: "supplier", supplier, deleteNote }} />;
}

export function PurchaseDialog({ purchase, defaultProductId, defaultSupplierId, trigger }: { purchase?: PurchaseData; defaultProductId?: string; defaultSupplierId?: string; trigger?: Trigger }) {
  return <TriggerButton trigger={trigger} editing={!!purchase} entry={{ kind: "purchase", purchase, productId: defaultProductId, supplierId: defaultSupplierId }} />;
}

export function QuoteDialog({ quote, defaultProductId, defaultSupplierId, trigger }: { quote?: QuoteData; defaultProductId?: string; defaultSupplierId?: string; trigger?: Trigger }) {
  return <TriggerButton trigger={trigger} editing={!!quote} entry={{ kind: "quote", quote, productId: defaultProductId, supplierId: defaultSupplierId }} />;
}

/** Opens Quick add or Paste from Excel. */
export function EntryButton({ kind, label, variant = "secondary", size }: { kind: "quick" | "paste"; label: string; variant?: Variant; size?: "sm" | "md" }) {
  const { open } = useEntry();
  return (
    <button type="button" onClick={() => open({ kind })} className={buttonClass(variant, size)}>
      {label}
    </button>
  );
}
