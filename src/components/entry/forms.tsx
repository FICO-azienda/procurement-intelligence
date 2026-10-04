"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import {
  deleteProduct,
  deletePurchase,
  deleteQuote,
  deleteSupplier,
  interpretPurchase,
  quickCreateProduct,
  quickCreateSupplier,
  saveProduct,
  savePurchase,
  saveQuote,
  saveSupplier,
  type FormState,
} from "@/app/actions";
import { uploadPasted } from "@/app/import/actions";
import type { ProductData, PurchaseData, QuoteData, SupplierData } from "@/lib/analytics";
import { todayISO } from "@/lib/analytics";
import { countrySuggestions } from "@/lib/countries";
import { purchasePreview, quoteGapPct } from "@/lib/entry";
import * as f from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/client";
import { parseNumber } from "@/lib/parse";
import { track, type UxEvent } from "@/lib/track";
import { formatSpecs } from "@/lib/validation";
import { Combo, DeleteButton, Field, FormError, Grid, Input, MoreDetails, Select, SheetForm, SubmitButton, Textarea, toInput } from "../form-kit";
import { Delta, buttonClass, cx } from "../ui";
import { useEntry, type PurchasePrefill } from "./context";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CNY", "TRY", "PLN", "INR", "JPY"];
const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const UNITS = ["kg", "g", "t", "pcs", "l", "ml", "m", "m²", "box", "roll", "pallet"];

const initial: FormState = { ok: false };

/** Closes the panel once after each successful save. */
function useSaved(state: FormState, close: () => void, event: UxEvent) {
  useEffect(() => {
    if (!state.ok) return;
    track(event);
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at]);
}

function Footer({ pending, onCancel, submitLabel, del }: { pending: boolean; onCancel: () => void; submitLabel: string; del?: ReactNode }) {
  const t = useT();
  return (
    <>
      <div className="min-w-0 flex-1">{del}</div>
      <button type="button" onClick={onCancel} className={buttonClass("ghost")}>
        {t("Cancel")}
      </button>
      <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
    </>
  );
}

/** An input with its unit or currency written inside, on the right. */
function Affixed({ affix, children }: { affix?: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      {affix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[12.5px] text-ink-3">{affix}</span>}
    </div>
  );
}

// ======================= Created on the fly =======================

/**
 * "Supplier not found → Create": three fields, right where the user is. The
 * purchase or quote being entered stays open and gets the new record selected.
 */
function InlineCreate({ kind, name, onCreated, onCancel }: { kind: "supplier" | "product"; name: string; onCreated: (id: string) => void; onCancel: () => void }) {
  const { addSupplier, addProduct, categories } = useEntry();
  const t = useT();
  const [v, setV] = useState({ name, country: "", email: "", unit: "", category: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  const create = () =>
    startTransition(async () => {
      setError(null);
      if (kind === "supplier") {
        const res = await quickCreateSupplier({ name: v.name, country: v.country, email: v.email });
        if (!res.ok) return setError(res.error);
        addSupplier({ id: res.id, name: res.name, country: v.country.trim() || null, currency: "EUR", paymentTermsDays: null, leadTimeDays: null });
        track("created_inline", { kind });
        onCreated(res.id);
      } else {
        const res = await quickCreateProduct({ name: v.name, unit: v.unit, category: v.category });
        if (!res.ok) return setError(res.error);
        addProduct({
          id: res.id,
          name: res.name,
          sku: "",
          unit: res.unit ?? v.unit,
          category: v.category.trim() || null,
          currentSupplierId: null,
          lastPrice: null,
          lastPriceDate: null,
          lastSupplierId: null,
          annualQuantity: 0,
        });
        track("created_inline", { kind });
        onCreated(res.id);
      }
    });
  // Enter inside this box creates the record; it must not save or move on in the outer form.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    create();
  };

  return (
    <div className="rounded-lg border border-ledger/30 bg-ledger-wash/50 p-3 sm:col-span-2" onKeyDown={onKeyDown}>
      <div className="mb-2.5 text-[12.5px] font-medium text-ink-2">{kind === "supplier" ? t("New supplier") : t("New product")}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("Name")} required className="sm:col-span-2">
          <Input value={v.name} onChange={set("name")} autoFocus />
        </Field>
        {kind === "supplier" ? (
          <>
            <Field label={t("Country")} required>
              <Input value={v.country} onChange={set("country")} list="entry-countries" placeholder={t("Italy")} />
            </Field>
            <Field label={t("Email")} hint={t("Optional")}>
              <Input value={v.email} onChange={set("email")} type="email" />
            </Field>
          </>
        ) : (
          <>
            <Field label={t("Unit you buy it in")} required>
              <Select value={v.unit} onChange={set("unit")}>
                <option value="">{t("Choose…")}</option>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("Category")} hint={t("Optional")}>
              <Input value={v.category} onChange={set("category")} list="entry-categories" placeholder={categories[0] ?? t("Wax")} />
            </Field>
          </>
        )}
      </div>
      {error && <div className="mt-2 text-[12.5px] text-up">{error}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonClass("ghost", "sm")}>
          {t("Cancel")}
        </button>
        <button type="button" disabled={pending} onClick={create} className={buttonClass("primary", "sm")}>
          {pending ? t("Creating…") : kind === "supplier" ? t("Create supplier") : t("Create product")}
        </button>
      </div>
    </div>
  );
}

function Datalists() {
  const { categories, suppliers } = useEntry();
  const locale = useLocale();
  const countries = [...new Set([...suppliers.map((s) => s.country).filter((c): c is string => !!c), ...countrySuggestions(locale)])];
  return (
    <>
      <datalist id="entry-countries">
        {countries.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="entry-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

/** Supplier + product pickers shared by purchases and quotes, with create-on-the-fly. */
function Parties({
  supplierId,
  productId,
  setSupplier,
  setProduct,
  errors,
  supplierText,
  productText,
  focus,
}: {
  supplierId: string;
  productId: string;
  setSupplier: (id: string) => void;
  setProduct: (id: string) => void;
  errors: Record<string, string>;
  supplierText?: string | null;
  productText?: string | null;
  focus: "supplier" | "product" | null;
}) {
  const { suppliers, products } = useEntry();
  const t = useT();
  const [creating, setCreating] = useState<{ kind: "supplier" | "product"; name: string } | null>(null);
  return (
    <>
      <Field label={t("Supplier")} required error={errors.supplierId} className="sm:col-span-2">
        <Combo
          name="supplierId"
          value={supplierId}
          onChange={setSupplier}
          options={suppliers.map((s) => ({ id: s.id, label: s.name, hint: s.country ?? undefined }))}
          placeholder={t("Type a supplier name…")}
          invalid={!!errors.supplierId}
          createNoun="supplier"
          initialText={supplierText ?? ""}
          autoFocus={focus === "supplier"}
          onCreate={(name) => setCreating({ kind: "supplier", name })}
        />
      </Field>
      {creating?.kind === "supplier" && (
        <InlineCreate
          kind="supplier"
          name={creating.name}
          onCancel={() => setCreating(null)}
          onCreated={(id) => {
            setSupplier(id);
            setCreating(null);
          }}
        />
      )}
      <Field label={t("Product")} required error={errors.productId} className="sm:col-span-2">
        <Combo
          name="productId"
          value={productId}
          onChange={setProduct}
          options={products.map((p) => ({ id: p.id, label: p.name, hint: p.sku || undefined }))}
          placeholder={t("Type a product name or code…")}
          invalid={!!errors.productId}
          createNoun="product"
          initialText={productText ?? ""}
          autoFocus={focus === "product"}
          onCreate={(name) => setCreating({ kind: "product", name })}
        />
      </Field>
      {creating?.kind === "product" && (
        <InlineCreate
          kind="product"
          name={creating.name}
          onCancel={() => setCreating(null)}
          onCreated={(id) => {
            setProduct(id);
            setCreating(null);
          }}
        />
      )}
      <Datalists />
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-3">{label}</dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}

// ======================= Purchase =======================

export function PurchaseForm({
  purchase,
  defaultProductId,
  defaultSupplierId,
  prefill,
  close,
}: {
  purchase?: PurchaseData;
  defaultProductId?: string;
  defaultSupplierId?: string;
  prefill?: PurchasePrefill;
  close: () => void;
}) {
  const { products, suppliers } = useEntry();
  const t = useT();
  const [state, action, pending] = useActionState(savePurchase, initial);
  useSaved(state, close, "purchase_saved");
  const e = state.fieldErrors ?? {};

  const startProduct = purchase?.productId ?? defaultProductId ?? "";
  // The product's usual supplier — unless the sentence named one we don't know yet.
  const startSupplier = purchase?.supplierId ?? defaultSupplierId ?? (prefill?.supplierText ? "" : products.find((p) => p.id === startProduct)?.currentSupplierId) ?? "";
  const [productId, setProductId] = useState(startProduct);
  const [supplierId, setSupplierId] = useState(startSupplier);
  const [quantity, setQuantity] = useState(toInput(purchase?.quantity ?? prefill?.quantity));
  const [unitPrice, setUnitPrice] = useState(toInput(purchase?.unitPrice ?? prefill?.unitPrice));
  const [freight, setFreight] = useState(toInput(purchase?.freightCost || null));
  const [other, setOther] = useState(toInput(purchase?.otherCosts || null));
  const [fx, setFx] = useState(toInput(purchase?.fxRate));
  // The supplier's invoicing currency, unless the user (or the document) says otherwise.
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(purchase?.currency ?? prefill?.currency ?? null);

  const product = products.find((p) => p.id === productId);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const currency = chosenCurrency ?? supplier?.currency ?? "EUR";
  const foreign = currency !== "EUR";

  const preview = purchasePreview({
    quantity: parseNumber(quantity),
    unitPrice: parseNumber(unitPrice),
    fxRate: foreign ? parseNumber(fx) : 1,
    freight: parseNumber(freight),
    otherCosts: parseNumber(other),
    // Editing a purchase: comparing it with itself would say nothing.
    previousPrice: purchase ? null : (product?.lastPrice ?? null),
    annualQuantity: product?.annualQuantity ?? 0,
  });
  const previousFrom = product?.lastSupplierId && product.lastSupplierId !== supplierId ? suppliers.find((s) => s.id === product.lastSupplierId)?.name : null;
  const extras = !!(purchase && (purchase.freightCost || purchase.otherCosts || purchase.invoiceReference || purchase.notes));

  return (
    <SheetForm
      action={action}
      footer={
        <Footer
          pending={pending}
          onCancel={close}
          submitLabel={purchase ? t("Save changes") : t("Save purchase")}
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
      {prefill && <ReadFromSentence notes={prefill.notes ?? []} />}
      {purchase && <input type="hidden" name="id" value={purchase.id} />}
      <input type="hidden" name="currency" value={currency} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid grid-cols-2 content-start gap-x-3 gap-y-4 [&>*]:col-span-2">
          <Parties
            supplierId={supplierId}
            productId={productId}
            errors={e}
            supplierText={prefill?.supplierText}
            productText={prefill?.productText}
            focus={purchase || prefill ? null : !supplierId ? "supplier" : !productId ? "product" : null}
            setSupplier={setSupplierId}
            setProduct={(id) => {
              setProductId(id);
              // The product's usual supplier, when none is chosen yet.
              const next = products.find((p) => p.id === id);
              if (!purchase && !supplierId && next?.currentSupplierId) setSupplierId(next.currentSupplierId);
            }}
          />
          <Field label={t("Date")} required error={e.date}>
            <Input name="date" type="date" defaultValue={purchase?.date ?? prefill?.date ?? todayISO()} aria-invalid={!!e.date} />
          </Field>
          <Field label={t("Quantity")} required error={e.quantity} className="col-span-1!">
            <Affixed affix={product?.unit}>
              <Input name="quantity" inputMode="decimal" autoFocus={!!startProduct && !!startSupplier && !purchase} value={quantity} onChange={(ev) => setQuantity(ev.target.value)} placeholder="2000" aria-invalid={!!e.quantity} className="pr-12" />
            </Affixed>
          </Field>
          <Field label={t("Unit price")} required error={e.unitPrice} className="col-span-1!">
            <Affixed affix={currency}>
              <Input name="unitPrice" inputMode="decimal" value={unitPrice} onChange={(ev) => setUnitPrice(ev.target.value)} placeholder="1,58" aria-invalid={!!e.unitPrice} className="pr-12" />
            </Affixed>
          </Field>
        </div>

        {/* Nothing here is typed: it is worked out from the fields beside it. */}
        <aside className="self-start rounded-lg bg-wash px-4 py-3.5" aria-live="polite">
          <div className="text-[12.5px] font-semibold">{t("Summary")}</div>
          <dl className="mt-2.5 space-y-2 text-[13px]">
            <Line label={t("Total")}>
              <span className="text-[17px] font-semibold">{preview.total != null ? f.money(preview.total, currency) : "—"}</span>
            </Line>
            {!purchase && (
              <Line label={t("Last price")}>
                {product?.lastPrice != null ? (
                  <span title={`${f.date(product.lastPriceDate)}${previousFrom ? ` · ${previousFrom}` : ""}`}>
                    {f.priceShort(product.lastPrice)}
                    <span className="text-ink-3">/{product.unit}</span>
                  </span>
                ) : (
                  "—"
                )}
              </Line>
            )}
            {!purchase && (
              <Line label={t("Change")}>{preview.changePct != null ? <Delta value={preview.changePct} className="justify-end" /> : "—"}</Line>
            )}
            {!purchase && (
              <Line label={t("Yearly impact")}>
                {preview.annualImpact != null ? (
                  <span className={cx("font-medium", preview.annualImpact > 0 ? "text-up" : "text-down")}>
                    {preview.annualImpact > 0 ? "+" : "−"}
                    {f.moneyApprox(Math.abs(preview.annualImpact))}
                  </span>
                ) : (
                  "—"
                )}
              </Line>
            )}
          </dl>
          {!purchase && product && (
            <p className="mt-2.5 text-[11.5px] leading-snug text-ink-3">
              {product.lastPrice == null
                ? t("First purchase of this product: it sets the price to compare with from now on.")
                : previousFrom
                  ? t("Last price paid on {date} to {supplier}.", { date: f.date(product.lastPriceDate), supplier: previousFrom })
                  : t("Last price paid on {date}.", { date: f.date(product.lastPriceDate) })}
            </p>
          )}
        </aside>
      </div>

      <MoreDetails summary={t("currency, freight, invoice number, notes")} defaultOpen={extras || foreign}>
        <Grid>
          <Field label={t("Currency")} hint={supplier && !chosenCurrency ? t("{supplier} invoices in {currency}", { supplier: supplier.name, currency: supplier.currency }) : undefined}>
            <Select value={currency} onChange={(ev) => setChosenCurrency(ev.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          {foreign ? (
            <Field label={t("Exchange rate (EUR per 1 {currency})", { currency })} error={e.fxRate} hint={t("On the invoice date. Without it, this purchase stays out of the EUR totals.")}>
              <Input name="fxRate" inputMode="decimal" value={fx} onChange={(ev) => setFx(ev.target.value)} placeholder="0,92" aria-invalid={!!e.fxRate} />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field label={t("Freight")} error={e.freightCost} hint={t("If charged on the invoice")}>
            <Input name="freightCost" inputMode="decimal" value={freight} onChange={(ev) => setFreight(ev.target.value)} placeholder="0" aria-invalid={!!e.freightCost} />
          </Field>
          <Field label={t("Other costs")} error={e.otherCosts} hint={t("Customs, handling, surcharges")}>
            <Input name="otherCosts" inputMode="decimal" value={other} onChange={(ev) => setOther(ev.target.value)} placeholder="0" aria-invalid={!!e.otherCosts} />
          </Field>
          <Field label={t("Invoice number")} error={e.invoiceReference} className="sm:col-span-2">
            <Input name="invoiceReference" defaultValue={purchase?.invoiceReference ?? ""} placeholder="FT 2026/0142" />
          </Field>
          <Field label={t("Notes")} className="sm:col-span-2">
            <Textarea name="notes" defaultValue={purchase?.notes ?? ""} rows={2} />
          </Field>
        </Grid>
      </MoreDetails>
    </SheetForm>
  );
}

function ReadFromSentence({ notes }: { notes: string[] }) {
  const t = useT();
  return (
    <div className="mb-4 rounded-lg border border-ledger/25 bg-ledger-wash/60 px-3.5 py-3 text-[13px]">
      <div className="flex items-center gap-1.5 font-medium">
        <Sparkles size={14} className="text-ledger" /> {t("Review before saving")}
      </div>
      <p className="mt-0.5 text-ink-2">{t("This is what we read from your sentence. Nothing is saved until you press Save.")}</p>
      {notes.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-ink-2">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ======================= Quote =======================

export function QuoteForm({ quote, defaultProductId, defaultSupplierId, close }: { quote?: QuoteData; defaultProductId?: string; defaultSupplierId?: string; close: () => void }) {
  const { products, suppliers } = useEntry();
  const t = useT();
  const [state, action, pending] = useActionState(saveQuote, initial);
  useSaved(state, close, "quote_saved");
  const e = state.fieldErrors ?? {};
  const [productId, setProductId] = useState(quote?.productId ?? defaultProductId ?? "");
  const [supplierId, setSupplierId] = useState(quote?.supplierId ?? defaultSupplierId ?? "");
  const [unitPrice, setUnitPrice] = useState(toInput(quote?.unitPrice));
  const [fx, setFx] = useState(toInput(quote?.fxRate));
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(quote?.currency ?? null);
  const product = products.find((p) => p.id === productId);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const currency = chosenCurrency ?? supplier?.currency ?? "EUR";
  const foreign = currency !== "EUR";
  const price = parseNumber(unitPrice);
  const rate = foreign ? parseNumber(fx) : 1;
  const gap = quoteGapPct(price != null && rate != null ? price * rate : null, product?.lastPrice ?? null);
  const sameSupplier = !!product && product.lastSupplierId === supplierId;
  const extras = !!(quote && (quote.moq != null || quote.leadTimeDays != null || quote.paymentTermsDays != null || quote.incoterm || quote.validUntil || quote.quantity != null || quote.notes));

  return (
    <SheetForm
      action={action}
      footer={
        <Footer
          pending={pending}
          onCancel={close}
          submitLabel={quote ? t("Save changes") : t("Save quote")}
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
      <input type="hidden" name="currency" value={currency} />
      <Grid>
        <Parties supplierId={supplierId} productId={productId} setSupplier={setSupplierId} setProduct={setProductId} errors={e} focus={quote ? null : !supplierId ? "supplier" : !productId ? "product" : null} />
        <Field label={product ? t("Quoted price per {unit}", { unit: product.unit }) : t("Quoted price")} required error={e.unitPrice}>
          <Affixed affix={currency}>
            <Input name="unitPrice" inputMode="decimal" autoFocus={!!productId && !!supplierId && !quote} value={unitPrice} onChange={(ev) => setUnitPrice(ev.target.value)} placeholder="1,49" aria-invalid={!!e.unitPrice} className="pr-12" />
          </Affixed>
        </Field>
        <Field label={t("Quote date")} required error={e.date}>
          <Input name="date" type="date" defaultValue={quote?.date ?? todayISO()} aria-invalid={!!e.date} />
        </Field>
      </Grid>

      {product?.lastPrice != null && !sameSupplier && (
        <dl className="mt-4 space-y-1 rounded-lg bg-wash px-3.5 py-3 text-[13px]" aria-live="polite">
          <Line label={t("You pay today")}>
            {f.priceShort(product.lastPrice)}/{product.unit}
          </Line>
          {gap != null && (
            <Line label={t("This quote")}>
              <Delta value={gap} className="justify-end" />
            </Line>
          )}
          <div className="pt-0.5 text-[12px] text-ink-3">{t("Price only: transport, duties and payment terms are compared on the product page.")}</div>
        </dl>
      )}

      <MoreDetails summary={t("minimum order, lead time, payment, validity")} defaultOpen={extras || foreign}>
        <Grid>
          <Field label={t("Currency")} hint={supplier && !chosenCurrency ? t("{supplier} invoices in {currency}", { supplier: supplier.name, currency: supplier.currency }) : undefined}>
            <Select value={currency} onChange={(ev) => setChosenCurrency(ev.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          {foreign ? (
            <Field label={t("Exchange rate (EUR per 1 {currency})", { currency })} error={e.fxRate} hint={t("Without it, the quote can't be compared.")}>
              <Input name="fxRate" inputMode="decimal" value={fx} onChange={(ev) => setFx(ev.target.value)} placeholder="0,92" aria-invalid={!!e.fxRate} />
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field label={t("Minimum order (MOQ)")} error={e.moq}>
            <Affixed affix={product?.unit}>
              <Input name="moq" inputMode="decimal" defaultValue={toInput(quote?.moq)} placeholder="1000" aria-invalid={!!e.moq} className="pr-12" />
            </Affixed>
          </Field>
          <Field label={t("Lead time")} error={e.leadTimeDays}>
            <Affixed affix={t("days")}>
              <Input name="leadTimeDays" inputMode="numeric" defaultValue={toInput(quote?.leadTimeDays)} placeholder={supplier?.leadTimeDays != null ? t("{n} (their usual)", { n: supplier.leadTimeDays }) : "14"} aria-invalid={!!e.leadTimeDays} className="pr-12" />
            </Affixed>
          </Field>
          <Field label={t("Payment terms")} error={e.paymentTermsDays} hint={t("0 = payment in advance")}>
            <Affixed affix={t("days")}>
              <Input name="paymentTermsDays" inputMode="numeric" defaultValue={toInput(quote?.paymentTermsDays)} placeholder={supplier?.paymentTermsDays != null ? t("{n} (their usual)", { n: supplier.paymentTermsDays }) : "60"} aria-invalid={!!e.paymentTermsDays} className="pr-12" />
            </Affixed>
          </Field>
          <Field label="Incoterm" error={e.incoterm} hint={t("Tells whether transport is included")}>
            <Select name="incoterm" defaultValue={quote?.incoterm ?? ""}>
              <option value="">—</option>
              {INCOTERMS.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("Valid until")} error={e.validUntil}>
            <Input name="validUntil" type="date" defaultValue={quote?.validUntil ?? ""} aria-invalid={!!e.validUntil} />
          </Field>
          <Field label={t("Quoted quantity")} error={e.quantity} hint={t("If the price depends on volume")}>
            <Input name="quantity" inputMode="decimal" defaultValue={toInput(quote?.quantity)} aria-invalid={!!e.quantity} />
          </Field>
          <Field label={t("Notes")} className="sm:col-span-2">
            <Textarea name="notes" defaultValue={quote?.notes ?? ""} rows={2} />
          </Field>
        </Grid>
      </MoreDetails>
    </SheetForm>
  );
}

// ======================= Product =======================

export function ProductForm({ product, deleteNote, close }: { product?: ProductData; deleteNote?: string; close: () => void }) {
  const { suppliers } = useEntry();
  const t = useT();
  const [state, action, pending] = useActionState(saveProduct, initial);
  useSaved(state, close, "product_saved");
  const e = state.fieldErrors ?? {};
  const units = product && !UNITS.includes(product.unit) ? [product.unit, ...UNITS] : UNITS;
  return (
    <SheetForm
      action={action}
      footer={<Footer pending={pending} onCancel={close} submitLabel={product ? t("Save changes") : t("Add product")} del={product && <DeleteButton note={deleteNote} onConfirm={() => deleteProduct(product.id)} />} />}
    >
      <FormError message={state.error} />
      {product && <input type="hidden" name="id" value={product.id} />}
      <Grid>
        <Field label={t("Product name")} required error={e.name} className="sm:col-span-2">
          <Input name="name" defaultValue={product?.name} placeholder="Paraffina 58/60" aria-invalid={!!e.name} autoFocus />
        </Field>
        <Field label={t("Category")} error={e.category}>
          <Input name="category" list="entry-categories" defaultValue={product?.category ?? ""} placeholder={t("Wax")} />
        </Field>
        <Field label={t("Unit")} required error={e.unit} hint={t("How you buy and price it")}>
          <Select name="unit" defaultValue={product?.unit ?? ""} aria-invalid={!!e.unit}>
            <option value="">{t("Choose…")}</option>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </Field>
      </Grid>
      <Datalists />
      <MoreDetails summary={t("your code, usual supplier, specifications")} defaultOpen={!!(product && (product.description || product.specs || product.technicalSpecifications))}>
        <Grid>
          <Field label={t("Your code (SKU)")} error={e.sku} hint={product ? undefined : t("Leave empty and we make one from the name")}>
            <Input name="sku" defaultValue={product?.sku} placeholder="PAR-5860" className="font-mono uppercase" aria-invalid={!!e.sku} />
          </Field>
          <Field label={t("Usual supplier")} error={e.currentSupplierId} hint={t("Set by your first purchase if left empty")}>
            <Select name="currentSupplierId" defaultValue={product?.currentSupplierId ?? ""}>
              <option value="">{t("— None yet —")}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Description")} className="sm:col-span-2">
            <Textarea name="description" defaultValue={product?.description ?? ""} rows={2} />
          </Field>
          <Field label={t("Specifications")} className="sm:col-span-2" hint={t("One per line, as name: value. Used to spot differences between suppliers' offers.")}>
            <Textarea name="specs" defaultValue={formatSpecs(product?.specs)} rows={4} placeholder={t("capacity: 300 ml\nweight: 210 g\nmaterial: glass")} className="font-mono text-[12.5px]" />
          </Field>
          <Field label={t("Technical notes")} className="sm:col-span-2" hint={t("Grade, certifications, anything else")}>
            <Textarea name="technicalSpecifications" defaultValue={product?.technicalSpecifications ?? ""} rows={2} />
          </Field>
        </Grid>
      </MoreDetails>
    </SheetForm>
  );
}

// ======================= Supplier =======================

export function SupplierForm({ supplier, deleteNote, close }: { supplier?: SupplierData; deleteNote?: string; close: () => void }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveSupplier, initial);
  useSaved(state, close, "supplier_saved");
  const e = state.fieldErrors ?? {};
  const extras = !!(supplier && (supplier.city || supplier.contactName || supplier.email || supplier.phone || supplier.website || supplier.notes));
  return (
    <SheetForm
      action={action}
      footer={<Footer pending={pending} onCancel={close} submitLabel={supplier ? t("Save changes") : t("Add supplier")} del={supplier && <DeleteButton note={deleteNote} onConfirm={() => deleteSupplier(supplier.id)} />} />}
    >
      <FormError message={state.error} />
      {supplier && <input type="hidden" name="id" value={supplier.id} />}
      <Grid>
        <Field label={t("Supplier name")} required error={e.name} className="sm:col-span-2">
          <Input name="name" defaultValue={supplier?.name} aria-invalid={!!e.name} autoFocus />
        </Field>
        <Field label={t("Country")} required={!supplier} error={e.country} className="sm:col-span-2">
          <Input name="country" list="entry-countries" defaultValue={supplier?.country ?? ""} placeholder={t("Italy")} aria-invalid={!!e.country} />
        </Field>
      </Grid>
      <Datalists />
      <MoreDetails summary={t("contacts, payment terms, lead time, currency")} defaultOpen={extras}>
        <Grid>
          <Field label={t("Email")} error={e.email}>
            <Input name="email" type="email" defaultValue={supplier?.email ?? ""} aria-invalid={!!e.email} />
          </Field>
          <Field label={t("Website")} error={e.website}>
            <Input name="website" defaultValue={supplier?.website ?? ""} />
          </Field>
          <Field label={t("Payment terms")} error={e.paymentTermsDays} hint={t("0 = payment in advance")}>
            <Affixed affix={t("days")}>
              <Input name="paymentTermsDays" inputMode="numeric" defaultValue={toInput(supplier?.paymentTermsDays)} placeholder="60" aria-invalid={!!e.paymentTermsDays} className="pr-12" />
            </Affixed>
          </Field>
          <Field label={t("Usual lead time")} error={e.defaultLeadTimeDays}>
            <Affixed affix={t("days")}>
              <Input name="defaultLeadTimeDays" inputMode="numeric" defaultValue={toInput(supplier?.defaultLeadTimeDays)} placeholder="14" aria-invalid={!!e.defaultLeadTimeDays} className="pr-12" />
            </Affixed>
          </Field>
          <Field label={t("Invoices in")} error={e.currency}>
            <Select name="currency" defaultValue={supplier?.currency ?? "EUR"}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("City")} error={e.city}>
            <Input name="city" defaultValue={supplier?.city ?? ""} />
          </Field>
          <Field label={t("Contact person")} error={e.contactName}>
            <Input name="contactName" defaultValue={supplier?.contactName ?? ""} />
          </Field>
          <Field label={t("Phone")} error={e.phone}>
            <Input name="phone" defaultValue={supplier?.phone ?? ""} />
          </Field>
          <Field label={t("Notes")} className="sm:col-span-2">
            <Textarea name="notes" defaultValue={supplier?.notes ?? ""} rows={2} />
          </Field>
        </Grid>
      </MoreDetails>
    </SheetForm>
  );
}

// ======================= Quick add =======================

/** A purchase in the user's own words. Read by rules, then reviewed in the normal form. */
export function QuickAddForm({ close }: { close: () => void }) {
  const { open } = useEntry();
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const read = () =>
    startTransition(async () => {
      setError(null);
      if (!text.trim()) return setError(t("Write what you bought, from whom and at what price."));
      try {
        const p = await interpretPurchase(text);
        track("quick_add_read", { matchedSupplier: !!p.supplierId, matchedProduct: !!p.productId });
        open({
          kind: "purchase",
          supplierId: p.supplierId ?? undefined,
          productId: p.productId ?? undefined,
          prefill: { quantity: p.quantity, unitPrice: p.unitPrice, currency: p.currency, date: p.date, supplierText: p.supplierText, productText: p.productText, notes: p.notes },
        });
      } catch {
        setError(t("We couldn't read that. Try again, or use the normal form."));
      }
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <Field label={t("What did you buy?")}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                read();
              }
            }}
            rows={3}
            autoFocus
            placeholder={t("Bought 2000 kg of paraffin from ABC at 1.58 €/kg on 28 September")}
          />
        </Field>
        <p className="mt-2 text-[12.5px] text-ink-3">{t("Say the quantity, the product, the supplier, the price and the date — in Italian or English. You check everything before it is saved.")}</p>
        {error && <div className="mt-3 text-[13px] text-up">{error}</div>}
      </div>
      <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">
        <button type="button" onClick={() => open({ kind: "paste" })} className={buttonClass("ghost")}>
          {t("Paste rows from Excel instead")}
        </button>
        <div className="flex-1" />
        <button type="button" onClick={close} className={buttonClass("ghost")}>
          {t("Cancel")}
        </button>
        <button type="button" disabled={pending} onClick={read} className={buttonClass("primary")}>
          {pending ? t("Reading…") : t("Review|verb")}
        </button>
      </div>
    </div>
  );
}

// ======================= Paste from Excel =======================

export function PasteForm({ close }: { close: () => void }) {
  const router = useRouter();
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const go = () =>
    startTransition(async () => {
      setError(null);
      track("paste_started", { rows });
      const res = await uploadPasted(text);
      if (res.error || !res.sessionId) return setError(res.error ?? t("We couldn't read the pasted rows."));
      close();
      router.push(`/import/${res.sessionId}`);
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <Field label={t("Rows copied from your spreadsheet")}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            autoFocus
            wrap="off"
            className="font-mono text-[12.5px] whitespace-pre"
            placeholder={"15/09/26\tABC Srl\tParaffina 58/60\t2000\t1,58\n22/09/26\tVetreria Rossi\tVetro 300 ml\t6000\t1,18"}
          />
        </Field>
        <p className="mt-2 text-[12.5px] text-ink-3">
          {t("Select the rows in Excel, copy, and paste here — with or without the header row. We work out which column is the date, the supplier, the product, the quantity and the price; you check before anything is saved.")}
        </p>
        {error && <div className="mt-3 text-[13px] text-up">{error}</div>}
      </div>
      <div className="flex items-center gap-2 border-t border-rule bg-well px-6 py-3">
        <span className="min-w-0 flex-1 text-[12.5px] text-ink-3">{rows > 0 ? t.n(rows, "{n} row", "{n} rows") : ""}</span>
        <button type="button" onClick={close} className={buttonClass("ghost")}>
          {t("Cancel")}
        </button>
        <button type="button" disabled={pending || rows === 0} onClick={go} className={buttonClass("primary")}>
          {pending ? t("Reading…") : t("Preview import")}
        </button>
      </div>
    </div>
  );
}
