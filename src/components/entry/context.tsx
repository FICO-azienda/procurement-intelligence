"use client";

import { createContext, useContext } from "react";
import type { ProductData, PurchaseData, QuoteData, SupplierData } from "@/lib/analytics";

/** What the forms know about a product without asking: unit, usual supplier, last price. */
export interface ProductOpt {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string | null;
  currentSupplierId: string | null;
  /** Last price paid, EUR per unit. */
  lastPrice: number | null;
  lastPriceDate: string | null;
  lastSupplierId: string | null;
  /** Quantity bought in the last 12 months. */
  annualQuantity: number;
}

export interface SupplierOpt {
  id: string;
  name: string;
  country: string | null;
  currency: string;
  paymentTermsDays: number | null;
  leadTimeDays: number | null;
}

/** Values proposed for a new purchase (read from a sentence): shown for review, never saved as they are. */
export interface PurchasePrefill {
  quantity?: number | null;
  unitPrice?: number | null;
  currency?: string | null;
  date?: string | null;
  supplierText?: string | null;
  productText?: string | null;
  notes?: string[];
}

export type Entry =
  | { kind: "purchase"; purchase?: PurchaseData; productId?: string; supplierId?: string; prefill?: PurchasePrefill }
  | { kind: "quote"; quote?: QuoteData; productId?: string; supplierId?: string }
  | { kind: "product"; product?: ProductData; deleteNote?: string }
  | { kind: "supplier"; supplier?: SupplierData; deleteNote?: string }
  | { kind: "quick" }
  | { kind: "paste" };

export interface EntryApi {
  /** Opens the one entry panel of the app with the given form. */
  open: (entry: Entry) => void;
  close: () => void;
  products: ProductOpt[];
  suppliers: SupplierOpt[];
  categories: string[];
  /** Created on the fly: usable immediately, before the page data refreshes. */
  addProduct: (p: ProductOpt) => void;
  addSupplier: (s: SupplierOpt) => void;
}

export const EntryContext = createContext<EntryApi | null>(null);

export function useEntry(): EntryApi {
  const ctx = useContext(EntryContext);
  if (!ctx) throw new Error("useEntry must be used inside <EntryProvider>");
  return ctx;
}
