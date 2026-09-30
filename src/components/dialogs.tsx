"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  deleteProduct,
  deletePurchase,
  deleteQuote,
  deleteSupplier,
  saveProduct,
  savePurchase,
  saveQuote,
  saveSupplier,
  type FormState,
} from "@/app/actions";
import type { ProductData, PurchaseData, QuoteData, SupplierData } from "@/lib/analytics";
import { computeTotal, todayISO } from "@/lib/analytics";
import { money } from "@/lib/format";
import { parseNumber } from "@/lib/parse";
import {
  DeleteButton,
  Field,
  FormError,
  Grid,
  Input,
  Select,
  Sheet,
  SheetForm,
  SubmitButton,
  Textarea,
  toInput,
  useSheet,
} from "./form-kit";
import { buttonClass, type Variant } from "./ui";

export type ProductOption = Pick<ProductData, "id" | "name" | "sku" | "unit" | "currentSupplierId">;
export type SupplierOption = Pick<SupplierData, "id" | "name">;

type Trigger = { label?: string; variant?: Variant; size?: "sm" | "md"; iconOnly?: boolean };

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CNY", "TRY", "PLN", "INR", "JPY"];
const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const UNITS = ["kg", "g", "t", "pcs", "l", "ml", "m", "m²", "box", "roll"];

const initial: FormState = { ok: false };

function TriggerButton({ trigger, editing, onClick }: { trigger?: Trigger; editing: boolean; onClick: () => void }) {
  const label = trigger?.label ?? (editing ? "Edit" : "Add");
  if (trigger?.iconOnly) {
    return (
      <button
        type="button"
        onClick={onClick}
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
    <button type="button" onClick={onClick} className={buttonClass(trigger?.variant ?? "secondary", trigger?.size)}>
      <Icon size={14} strokeWidth={2} className="-ml-0.5" />
      {label}
    </button>
  );
}

/** Closes the sheet once after each successful save. */
function useCloseOnSuccess(state: FormState, close: () => void) {
  useEffect(() => {
    if (state.ok) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at]);
}

function Footer({
  pending,
  onCancel,
  submitLabel,
  del,
}: {
  pending: boolean;
  onCancel: () => void;
  submitLabel: string;
  del?: ReactNode;
}) {
  return (
    <>
      <div className="min-w-0 flex-1">{del}</div>
      <button type="button" onClick={onCancel} className={buttonClass("ghost")}>
        Cancel
      </button>
      <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
    </>
  );
}

// ======================= Product =======================

export function ProductDialog({
  product,
  suppliers,
  categories,
  deleteNote,
  trigger,
}: {
  product?: ProductData;
  suppliers: SupplierOption[];
  categories: string[];
  deleteNote?: string;
  trigger?: Trigger;
}) {
  const sheet = useSheet();
  return (
    <>
      <TriggerButton trigger={trigger} editing={!!product} onClick={sheet.show} />
      <Sheet
        open={sheet.open}
        onClose={sheet.hide}
        title={product ? "Edit product" : "Add product"}
        description="A material or component you buy."
      >
        <ProductForm
          key={sheet.version}
          product={product}
          suppliers={suppliers}
          categories={categories}
          deleteNote={deleteNote}
          close={sheet.hide}
        />
      </Sheet>
    </>
  );
}

function ProductForm({
  product,
  suppliers,
  categories,
  deleteNote,
  close,
}: {
  product?: ProductData;
  suppliers: SupplierOption[];
  categories: string[];
  deleteNote?: string;
  close: () => void;
}) {
  const [state, action, pending] = useActionState(saveProduct, initial);
  useCloseOnSuccess(state, close);
  const e = state.fieldErrors ?? {};
  return (
    <SheetForm
      action={action}
      footer={
        <Footer
          pending={pending}
          onCancel={close}
          submitLabel={product ? "Save changes" : "Add product"}
          del={product && <DeleteButton note={deleteNote} onConfirm={() => deleteProduct(product.id)} />}
        />
      }
    >
      <FormError message={state.error} />
      {product && <input type="hidden" name="id" value={product.id} />}
      <Grid>
        <Field label="Name" required error={e.name} className="sm:col-span-2">
          <Input name="name" defaultValue={product?.name} placeholder="Paraffina 58/60" aria-invalid={!!e.name} autoFocus />
        </Field>
        <Field label="SKU / code" required error={e.sku}>
          <Input name="sku" defaultValue={product?.sku} placeholder="PAR-5860" className="font-mono uppercase" aria-invalid={!!e.sku} />
        </Field>
        <Field label="Unit of measure" required error={e.unit} hint="Unit used for prices and quantities">
          <Input name="unit" list="unit-options" defaultValue={product?.unit} placeholder="kg" aria-invalid={!!e.unit} />
          <datalist id="unit-options">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label="Category" error={e.category}>
          <Input name="category" list="category-options" defaultValue={product?.category ?? ""} placeholder="Wax" />
          <datalist id="category-options">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Current supplier" error={e.currentSupplierId}>
          <Select name="currentSupplierId" defaultValue={product?.currentSupplierId ?? ""}>
            <option value="">— None yet —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea name="description" defaultValue={product?.description ?? ""} rows={2} />
        </Field>
        <Field label="Technical specifications" className="sm:col-span-2" hint="Grade, dimensions, certifications — anything a supplier must match.">
          <Textarea name="technicalSpecifications" defaultValue={product?.technicalSpecifications ?? ""} rows={3} />
        </Field>
      </Grid>
    </SheetForm>
  );
}

// ======================= Supplier =======================

export function SupplierDialog({
  supplier,
  deleteNote,
  trigger,
}: {
  supplier?: SupplierData;
  deleteNote?: string;
  trigger?: Trigger;
}) {
  const sheet = useSheet();
  return (
    <>
      <TriggerButton trigger={trigger} editing={!!supplier} onClick={sheet.show} />
      <Sheet open={sheet.open} onClose={sheet.hide} title={supplier ? "Edit supplier" : "Add supplier"}>
        <SupplierForm key={sheet.version} supplier={supplier} deleteNote={deleteNote} close={sheet.hide} />
      </Sheet>
    </>
  );
}

function SupplierForm({
  supplier,
  deleteNote,
  close,
}: {
  supplier?: SupplierData;
  deleteNote?: string;
  close: () => void;
}) {
  const [state, action, pending] = useActionState(saveSupplier, initial);
  useCloseOnSuccess(state, close);
  const e = state.fieldErrors ?? {};
  return (
    <SheetForm
      action={action}
      footer={
        <Footer
          pending={pending}
          onCancel={close}
          submitLabel={supplier ? "Save changes" : "Add supplier"}
          del={supplier && <DeleteButton note={deleteNote} onConfirm={() => deleteSupplier(supplier.id)} />}
        />
      }
    >
      <FormError message={state.error} />
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      <Grid>
        <Field label="Company name" required error={e.name} className="sm:col-span-2">
          <Input name="name" defaultValue={supplier?.name} aria-invalid={!!e.name} autoFocus />
        </Field>
        <Field label="Country" error={e.country}>
          <Input name="country" defaultValue={supplier?.country ?? ""} placeholder="Italy" />
        </Field>
        <Field label="City" error={e.city}>
          <Input name="city" defaultValue={supplier?.city ?? ""} />
        </Field>
        <Field label="Contact person" error={e.contactName}>
          <Input name="contactName" defaultValue={supplier?.contactName ?? ""} />
        </Field>
        <Field label="Email" error={e.email}>
          <Input name="email" type="email" defaultValue={supplier?.email ?? ""} aria-invalid={!!e.email} />
        </Field>
        <Field label="Phone" error={e.phone}>
          <Input name="phone" defaultValue={supplier?.phone ?? ""} />
        </Field>
        <Field label="Website" error={e.website}>
          <Input name="website" defaultValue={supplier?.website ?? ""} />
        </Field>
        <Field label="Payment terms (days)" error={e.paymentTermsDays} hint="0 = payment in advance">
          <Input name="paymentTermsDays" inputMode="numeric" defaultValue={toInput(supplier?.paymentTermsDays)} placeholder="60" aria-invalid={!!e.paymentTermsDays} />
        </Field>
        <Field label="Typical lead time (days)" error={e.defaultLeadTimeDays}>
          <Input name="defaultLeadTimeDays" inputMode="numeric" defaultValue={toInput(supplier?.defaultLeadTimeDays)} placeholder="14" aria-invalid={!!e.defaultLeadTimeDays} />
        </Field>
        <Field label="Invoicing currency" error={e.currency}>
          <Select name="currency" defaultValue={supplier?.currency ?? "EUR"}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea name="notes" defaultValue={supplier?.notes ?? ""} rows={2} />
        </Field>
      </Grid>
    </SheetForm>
  );
}

// ======================= Purchase =======================

export function PurchaseDialog({
  purchase,
  products,
  suppliers,
  defaultProductId,
  defaultSupplierId,
  trigger,
}: {
  purchase?: PurchaseData;
  products: ProductOption[];
  suppliers: SupplierOption[];
  defaultProductId?: string;
  defaultSupplierId?: string;
  trigger?: Trigger;
}) {
  const sheet = useSheet();
  return (
    <>
      <TriggerButton trigger={trigger} editing={!!purchase} onClick={sheet.show} />
      <Sheet
        open={sheet.open}
        onClose={sheet.hide}
        title={purchase ? "Edit purchase" : "Add purchase"}
        description="One invoice line: what you bought, from whom, at what price."
      >
        <PurchaseForm
          key={sheet.version}
          purchase={purchase}
          products={products}
          suppliers={suppliers}
          defaultProductId={defaultProductId}
          defaultSupplierId={defaultSupplierId}
          close={sheet.hide}
        />
      </Sheet>
    </>
  );
}

function PurchaseForm({
  purchase,
  products,
  suppliers,
  defaultProductId,
  defaultSupplierId,
  close,
}: {
  purchase?: PurchaseData;
  products: ProductOption[];
  suppliers: SupplierOption[];
  defaultProductId?: string;
  defaultSupplierId?: string;
  close: () => void;
}) {
  const [state, action, pending] = useActionState(savePurchase, initial);
  useCloseOnSuccess(state, close);
  const e = state.fieldErrors ?? {};

  const initialProduct = purchase?.productId ?? defaultProductId ?? "";
  const [productId, setProductId] = useState(initialProduct);
  const [supplierId, setSupplierId] = useState(
    purchase?.supplierId ??
      defaultSupplierId ??
      products.find((p) => p.id === initialProduct)?.currentSupplierId ??
      "",
  );
  const [quantity, setQuantity] = useState(toInput(purchase?.quantity));
  const [unitPrice, setUnitPrice] = useState(toInput(purchase?.unitPrice));
  const [freight, setFreight] = useState(toInput(purchase?.freightCost || null));
  const [other, setOther] = useState(toInput(purchase?.otherCosts || null));
  const [currency, setCurrency] = useState(purchase?.currency ?? "EUR");

  const product = products.find((p) => p.id === productId);
  const q = parseNumber(quantity);
  const up = parseNumber(unitPrice);
  const total =
    q != null && up != null ? computeTotal(q, up, parseNumber(freight) ?? 0, parseNumber(other) ?? 0) : null;

  return (
    <SheetForm
      action={action}
      footer={
        <Footer
          pending={pending}
          onCancel={close}
          submitLabel={purchase ? "Save changes" : "Add purchase"}
          del={
            purchase && (
              <DeleteButton
                onConfirm={async () => {
                  await deletePurchase(purchase.id);
                  close();
                }}
              />
            )
          }
        />
      }
    >
      <FormError message={state.error} />
      {purchase && <input type="hidden" name="id" value={purchase.id} />}
      <Grid>
        <Field label="Product" required error={e.productId} className="sm:col-span-2">
          <Select
            name="productId"
            value={productId}
            aria-invalid={!!e.productId}
            onChange={(ev) => {
              setProductId(ev.target.value);
              const next = products.find((p) => p.id === ev.target.value);
              if (!purchase && next?.currentSupplierId) setSupplierId(next.currentSupplierId);
            }}
          >
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.sku}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier" required error={e.supplierId}>
          <Select name="supplierId" value={supplierId} onChange={(ev) => setSupplierId(ev.target.value)} aria-invalid={!!e.supplierId}>
            <option value="">Select a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" required error={e.date}>
          <Input name="date" type="date" defaultValue={purchase?.date ?? todayISO()} aria-invalid={!!e.date} />
        </Field>
        <Field label={`Quantity${product ? ` (${product.unit})` : ""}`} required error={e.quantity}>
          <Input name="quantity" inputMode="decimal" autoFocus={!!initialProduct} value={quantity} onChange={(ev) => setQuantity(ev.target.value)} placeholder="2000" aria-invalid={!!e.quantity} />
        </Field>
        <Field label={`Unit price${product ? ` (per ${product.unit})` : ""}`} required error={e.unitPrice}>
          <Input name="unitPrice" inputMode="decimal" value={unitPrice} onChange={(ev) => setUnitPrice(ev.target.value)} placeholder="1,58" aria-invalid={!!e.unitPrice} />
        </Field>
        <Field label="Currency" error={e.currency}>
          <Select name="currency" value={currency} onChange={(ev) => setCurrency(ev.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        {currency !== "EUR" ? (
          <Field label={`FX rate (EUR per 1 ${currency})`} required error={e.fxRate} hint="As on the invoice date">
            <Input name="fxRate" inputMode="decimal" defaultValue={toInput(purchase?.fxRate)} placeholder="0,92" aria-invalid={!!e.fxRate} />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Freight" error={e.freightCost}>
          <Input name="freightCost" inputMode="decimal" value={freight} onChange={(ev) => setFreight(ev.target.value)} placeholder="0" aria-invalid={!!e.freightCost} />
        </Field>
        <Field label="Other costs" error={e.otherCosts} hint="Customs, handling, surcharges…">
          <Input name="otherCosts" inputMode="decimal" value={other} onChange={(ev) => setOther(ev.target.value)} placeholder="0" aria-invalid={!!e.otherCosts} />
        </Field>
        <Field label="Invoice / reference" error={e.invoiceReference}>
          <Input name="invoiceReference" defaultValue={purchase?.invoiceReference ?? ""} placeholder="FT 2026/0142" />
        </Field>
        <div className="flex flex-col justify-end">
          <div className="rounded-md bg-wash px-3 py-2">
            <div className="text-[12px] text-ink-3">Total</div>
            <div className="num text-[16px] font-semibold">{total != null ? money(total, currency) : "—"}</div>
          </div>
        </div>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea name="notes" defaultValue={purchase?.notes ?? ""} rows={2} />
        </Field>
      </Grid>
    </SheetForm>
  );
}

// ======================= Quote =======================

export function QuoteDialog({
  quote,
  products,
  suppliers,
  defaultProductId,
  defaultSupplierId,
  trigger,
}: {
  quote?: QuoteData;
  products: ProductOption[];
  suppliers: SupplierOption[];
  defaultProductId?: string;
  defaultSupplierId?: string;
  trigger?: Trigger;
}) {
  const sheet = useSheet();
  return (
    <>
      <TriggerButton trigger={trigger} editing={!!quote} onClick={sheet.show} />
      <Sheet
        open={sheet.open}
        onClose={sheet.hide}
        title={quote ? "Edit quote" : "Add quote"}
        description="An offer or price list from a supplier — current or alternative."
      >
        <QuoteForm
          key={sheet.version}
          quote={quote}
          products={products}
          suppliers={suppliers}
          defaultProductId={defaultProductId}
          defaultSupplierId={defaultSupplierId}
          close={sheet.hide}
        />
      </Sheet>
    </>
  );
}

function QuoteForm({
  quote,
  products,
  suppliers,
  defaultProductId,
  defaultSupplierId,
  close,
}: {
  quote?: QuoteData;
  products: ProductOption[];
  suppliers: SupplierOption[];
  defaultProductId?: string;
  defaultSupplierId?: string;
  close: () => void;
}) {
  const [state, action, pending] = useActionState(saveQuote, initial);
  useCloseOnSuccess(state, close);
  const e = state.fieldErrors ?? {};
  const [productId, setProductId] = useState(quote?.productId ?? defaultProductId ?? "");
  const [currency, setCurrency] = useState(quote?.currency ?? "EUR");
  const product = products.find((p) => p.id === productId);

  return (
    <SheetForm
      action={action}
      footer={
        <Footer
          pending={pending}
          onCancel={close}
          submitLabel={quote ? "Save changes" : "Add quote"}
          del={
            quote && (
              <DeleteButton
                onConfirm={async () => {
                  await deleteQuote(quote.id);
                  close();
                }}
              />
            )
          }
        />
      }
    >
      <FormError message={state.error} />
      {quote && <input type="hidden" name="id" value={quote.id} />}
      <Grid>
        <Field label="Product" required error={e.productId} className="sm:col-span-2">
          <Select name="productId" value={productId} onChange={(ev) => setProductId(ev.target.value)} aria-invalid={!!e.productId}>
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.sku}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier" required error={e.supplierId}>
          <Select name="supplierId" defaultValue={quote?.supplierId ?? defaultSupplierId ?? ""} aria-invalid={!!e.supplierId}>
            <option value="">Select a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quote date" required error={e.date}>
          <Input name="date" type="date" defaultValue={quote?.date ?? todayISO()} aria-invalid={!!e.date} />
        </Field>
        <Field label={`Quoted unit price${product ? ` (per ${product.unit})` : ""}`} required error={e.unitPrice}>
          <Input name="unitPrice" inputMode="decimal" autoFocus={!!(quote?.productId ?? defaultProductId)} defaultValue={toInput(quote?.unitPrice)} placeholder="1,49" aria-invalid={!!e.unitPrice} />
        </Field>
        <Field label="Currency" error={e.currency}>
          <Select name="currency" value={currency} onChange={(ev) => setCurrency(ev.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        {currency !== "EUR" && (
          <Field label={`FX rate (EUR per 1 ${currency})`} required error={e.fxRate} className="sm:col-span-2">
            <Input name="fxRate" inputMode="decimal" defaultValue={toInput(quote?.fxRate)} placeholder="0,92" aria-invalid={!!e.fxRate} />
          </Field>
        )}
        <Field label={`MOQ${product ? ` (${product.unit})` : ""}`} error={e.moq}>
          <Input name="moq" inputMode="decimal" defaultValue={toInput(quote?.moq)} placeholder="1000" aria-invalid={!!e.moq} />
        </Field>
        <Field label="Lead time (days)" error={e.leadTimeDays}>
          <Input name="leadTimeDays" inputMode="numeric" defaultValue={toInput(quote?.leadTimeDays)} placeholder="14" aria-invalid={!!e.leadTimeDays} />
        </Field>
        <Field label="Payment terms (days)" error={e.paymentTermsDays} hint="0 = payment in advance">
          <Input name="paymentTermsDays" inputMode="numeric" defaultValue={toInput(quote?.paymentTermsDays)} placeholder="60" aria-invalid={!!e.paymentTermsDays} />
        </Field>
        <Field label="Incoterm" error={e.incoterm} hint="Tells whether transport is included">
          <Select name="incoterm" defaultValue={quote?.incoterm ?? ""}>
            <option value="">—</option>
            {INCOTERMS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </Select>
        </Field>
        <Field label="Valid until" error={e.validUntil}>
          <Input name="validUntil" type="date" defaultValue={quote?.validUntil ?? ""} aria-invalid={!!e.validUntil} />
        </Field>
        <Field label="Quoted quantity" error={e.quantity} hint="If the price depends on volume">
          <Input name="quantity" inputMode="decimal" defaultValue={toInput(quote?.quantity)} aria-invalid={!!e.quantity} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea name="notes" defaultValue={quote?.notes ?? ""} rows={2} />
        </Field>
      </Grid>
    </SheetForm>
  );
}

