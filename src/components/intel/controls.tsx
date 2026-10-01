"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { reviewPrice, saveOffer, setOpportunityStatus, type SimpleResult } from "@/app/actions";
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from "@/lib/intel/statuses";
import type { Comparability } from "@/lib/intel/comparison";
import { Field, Select, Sheet, Textarea, useSheet } from "../form-kit";
import { buttonClass } from "../ui";
import { OPPORTUNITY_STATUS_LABEL } from "./badges";

function useSave() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<SimpleResult>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        after?.();
        router.refresh();
      }
    });
  return { pending, error, run };
}

/** The user's judgement on one supplier's offer: comparable or not, and its specifications. */
export function OfferDialog({
  supplierId,
  supplierName,
  productId,
  productName,
  productSpecs,
  override,
  note,
  specs,
  computed,
}: {
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  productSpecs: string;
  override: Comparability | null;
  note: string;
  specs: string;
  /** What the rules say without the user's decision. */
  computed: string;
}) {
  const sheet = useSheet();
  return (
    <>
      <button
        type="button"
        onClick={sheet.show}
        aria-label={`Comparability and specifications of ${supplierName}'s offer`}
        title="Comparability and specifications"
        className="grid size-7 place-items-center rounded-md text-ink-4 transition-colors hover:bg-wash hover:text-ink"
      >
        <SlidersHorizontal size={13} />
      </button>
      <Sheet open={sheet.open} onClose={sheet.hide} title={`${supplierName} — offer for ${productName}`} description="Tell the system whether this offer can be compared with what you buy today.">
        <OfferForm key={sheet.version} {...{ supplierId, productId, productSpecs, override, note, specs, computed }} close={sheet.hide} />
      </Sheet>
    </>
  );
}

function OfferForm({
  supplierId,
  productId,
  productSpecs,
  override,
  note,
  specs,
  computed,
  close,
}: {
  supplierId: string;
  productId: string;
  productSpecs: string;
  override: Comparability | null;
  note: string;
  specs: string;
  computed: string;
  close: () => void;
}) {
  const { pending, error, run } = useSave();
  const [comparability, setComparability] = useState<"auto" | Comparability>(override ?? "auto");
  const [n, setNote] = useState(note);
  const [s, setSpecs] = useState(specs);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6">
        <Field label="Comparability" hint={`Automatic rules currently say: ${computed}`}>
          <Select value={comparability} onChange={(e) => setComparability(e.target.value as "auto" | Comparability)}>
            <option value="auto">Automatic (use the rules)</option>
            <option value="comparable">Comparable</option>
            <option value="partial">Partially comparable</option>
            <option value="not">Not comparable</option>
          </Select>
        </Field>
        <Field label="Reason" hint="Shown next to the offer, e.g. “Different grade” or “Sample approved”.">
          <Textarea value={n} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <Field label="This supplier's specifications" hint="One per line, as name: value. Compared with the product's specifications below.">
          <Textarea value={s} onChange={(e) => setSpecs(e.target.value)} rows={5} placeholder={"weight: 180 g\ncapacity: 300 ml"} className="font-mono text-[12.5px]" />
        </Field>
        <div className="rounded-md bg-well px-3 py-2 text-[12.5px]">
          <div className="mb-1 font-medium text-ink-2">Your product&apos;s specifications</div>
          {productSpecs ? <pre className="font-mono text-[12px] whitespace-pre-wrap text-ink-2">{productSpecs}</pre> : <span className="text-ink-3">None recorded. Add them with Edit on the product.</span>}
        </div>
        {error && <div className="text-[12.5px] text-up">{error}</div>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" onClick={close} className={buttonClass("ghost")}>
          Cancel
        </button>
        <button type="button" disabled={pending} className={buttonClass("primary")} onClick={() => run(() => saveOffer(supplierId, productId, { comparability, note: n, specs: s }), close)}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Confirm / exclude a price flagged as a possible data anomaly. Correct = edit the purchase. */
export function OutlierActions({ purchaseId }: { purchaseId: string }) {
  const { pending, error, run } = useSave();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} className={buttonClass("secondary", "sm")} onClick={() => run(() => reviewPrice(purchaseId, "confirmed"))}>
        Price is correct
      </button>
      <button type="button" disabled={pending} className={buttonClass("ghost", "sm")} onClick={() => run(() => reviewPrice(purchaseId, "excluded"))}>
        Exclude from analysis
      </button>
      {error && <span className="text-[12px] text-up">{error}</span>}
    </span>
  );
}

export function RestorePriceButton({ purchaseId }: { purchaseId: string }) {
  const { pending, run } = useSave();
  return (
    <button type="button" disabled={pending} className="text-[12px] font-medium text-ledger hover:underline" onClick={() => run(() => reviewPrice(purchaseId, null))}>
      Include again
    </button>
  );
}

export function OpportunityStatusSelect({ opportunityKey, status, size = "md" }: { opportunityKey: string; status: OpportunityStatus; size?: "sm" | "md" }) {
  const { pending, error, run } = useSave();
  return (
    <span className="relative z-10 inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <span className={size === "sm" ? "w-[128px]" : "w-[150px]"}>
        <Select
          value={status}
          disabled={pending}
          aria-label="Status"
          className={size === "sm" ? "h-7 text-[12.5px]" : ""}
          onChange={(e) => run(() => setOpportunityStatus(opportunityKey, e.target.value as OpportunityStatus))}
        >
          {OPPORTUNITY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {OPPORTUNITY_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </span>
      {error && <span className="text-[12px] text-up">{error}</span>}
    </span>
  );
}

/** Free note on an opportunity (what was agreed, why it was rejected…). */
export function OpportunityNote({ opportunityKey, status, note }: { opportunityKey: string; status: OpportunityStatus; note: string }) {
  const { pending, error, run } = useSave();
  const [value, setValue] = useState(note);
  const [saved, setSaved] = useState(false);
  return (
    <div>
      <Textarea
        value={value}
        rows={3}
        placeholder="What was discussed, agreed or decided…"
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || value === note}
          className={buttonClass("secondary", "sm")}
          onClick={() => run(() => setOpportunityStatus(opportunityKey, status, value.trim() || null), () => setSaved(true))}
        >
          {pending ? "Saving…" : "Save note"}
        </button>
        {saved && <span className="text-[12px] text-down">Saved</span>}
        {error && <span className="text-[12px] text-up">{error}</span>}
      </div>
    </div>
  );
}
