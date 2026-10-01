/**
 * Builders for engine tests. Deliberately generic (widgets, not candles): the
 * engine must not depend on the shape of the demo dataset.
 */
import type { Dataset, ProductData, PurchaseData, QuoteData, SupplierData } from "../analytics";
import type { SupplierLink } from "./comparison";

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

export function supplier(over: Partial<SupplierData> = {}): SupplierData {
  return {
    id: id("sup"),
    name: "Supplier",
    country: "Italy",
    city: null,
    vatNumber: null,
    contactName: null,
    email: null,
    phone: null,
    website: null,
    currency: "EUR",
    paymentTermsDays: 60,
    defaultLeadTimeDays: 14,
    notes: null,
    ...over,
  };
}

export function product(over: Partial<ProductData> = {}): ProductData {
  return {
    id: id("prod"),
    sku: id("SKU"),
    name: "Widget",
    description: null,
    category: "Parts",
    unit: "kg",
    technicalSpecifications: null,
    specs: null,
    currentSupplierId: null,
    ...over,
  };
}

export function purchase(over: Partial<PurchaseData> & Pick<PurchaseData, "productId" | "supplierId" | "date" | "quantity" | "unitPrice">): PurchaseData {
  return {
    id: id("pur"),
    unit: "kg",
    currency: "EUR",
    fxRate: 1,
    freightCost: 0,
    otherCosts: 0,
    totalAmount: over.quantity * over.unitPrice,
    invoiceReference: null,
    paymentTermsDays: null,
    incoterm: null,
    originalDescription: null,
    source: "manual",
    sourceDoc: null,
    priceReview: null,
    notes: null,
    ...over,
  };
}

export function quote(over: Partial<QuoteData> & Pick<QuoteData, "productId" | "supplierId" | "date" | "unitPrice">): QuoteData {
  return {
    id: id("quo"),
    quantity: null,
    currency: "EUR",
    fxRate: 1,
    moq: null,
    leadTimeDays: null,
    paymentTermsDays: null,
    incoterm: null,
    freightCost: null,
    validUntil: null,
    originalDescription: null,
    source: "manual",
    sourceDoc: null,
    notes: null,
    ...over,
  };
}

export function link(over: Partial<SupplierLink> & Pick<SupplierLink, "supplierId" | "productId">): SupplierLink {
  return {
    supplierSku: null,
    supplierProductName: null,
    moq: null,
    leadTimeDays: null,
    specs: null,
    comparabilityOverride: null,
    comparabilityNote: null,
    ...over,
  };
}

export function dataset(parts: Partial<Dataset>): Dataset {
  return { suppliers: [], products: [], purchases: [], quotes: [], ...parts };
}
