/**
 * CSV → purchases. Two steps, same as every future importer (Excel, PDF
 * invoice, email): 1) build a preview with row-level validation, 2) the user
 * approves, then valid rows are written. Nothing touches the database before
 * approval.
 *
 * Accepts comma or semicolon delimiters (Italian Excel exports use ";"),
 * Italian or English headers, and Italian number/date formats.
 */
import Papa from "papaparse";
import { computeTotal, type Dataset } from "../analytics";
import { parseDate, parseNumber } from "../parse";

export const TEMPLATE_COLUMNS = [
  "date",
  "supplier",
  "supplier_country",
  "sku",
  "product",
  "category",
  "unit",
  "quantity",
  "unit_price",
  "currency",
  "fx_rate",
  "freight",
  "other_costs",
  "invoice_reference",
  "notes",
] as const;

type Column = (typeof TEMPLATE_COLUMNS)[number];

const ALIASES: Record<string, Column> = {
  data: "date",
  data_fattura: "date",
  fornitore: "supplier",
  ragione_sociale: "supplier",
  paese: "supplier_country",
  paese_fornitore: "supplier_country",
  country: "supplier_country",
  codice: "sku",
  codice_articolo: "sku",
  articolo: "product",
  prodotto: "product",
  descrizione: "product",
  product_name: "product",
  categoria: "category",
  um: "unit",
  unita: "unit",
  unita_di_misura: "unit",
  qta: "quantity",
  quantita: "quantity",
  qty: "quantity",
  prezzo: "unit_price",
  prezzo_unitario: "unit_price",
  price: "unit_price",
  valuta: "currency",
  cambio: "fx_rate",
  trasporto: "freight",
  spese_trasporto: "freight",
  altri_costi: "other_costs",
  fattura: "invoice_reference",
  numero_fattura: "invoice_reference",
  riferimento: "invoice_reference",
  invoice: "invoice_reference",
  note: "notes",
};

function normalizeHeader(h: string): string {
  const key = h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return ALIASES[key] ?? key;
}

export interface PreviewRow {
  line: number;
  date: string | null;
  supplier: string;
  sku: string;
  product: string;
  unit: string;
  quantity: number | null;
  unitPrice: number | null;
  currency: string;
  total: number | null;
  errors: string[];
  newSupplier: boolean;
  newProduct: boolean;
}

export interface ImportPlan {
  rows: PreviewRow[];
  validRows: (PreviewRow & { fxRate: number; freight: number; other: number; invoice: string | null; notes: string | null; country: string | null; category: string | null })[];
  newSuppliers: string[];
  newProducts: { sku: string; name: string; unit: string }[];
  missingColumns: string[];
  fatal?: string;
}

const slugSku = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

export function planPurchaseImport(csv: string, data: Dataset): ImportPlan {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  const headers = parsed.meta.fields ?? [];
  const required: Column[] = ["date", "supplier", "quantity", "unit_price"];
  const missingColumns: string[] = required.filter((c) => !headers.includes(c));
  if (!headers.includes("sku") && !headers.includes("product")) missingColumns.push("sku or product");

  const empty: ImportPlan = { rows: [], validRows: [], newSuppliers: [], newProducts: [], missingColumns };
  if (parsed.data.length === 0) return { ...empty, fatal: "The file has no data rows." };
  if (missingColumns.length) return { ...empty, fatal: `Missing columns: ${missingColumns.join(", ")}.` };

  const suppliersByName = new Map(data.suppliers.map((s) => [s.name.trim().toLowerCase(), s]));
  const productsBySku = new Map(data.products.map((p) => [p.sku.toUpperCase(), p]));
  const productsByName = new Map(data.products.map((p) => [p.name.trim().toLowerCase(), p]));
  const newSuppliers = new Map<string, string>();
  const newProducts = new Map<string, { sku: string; name: string; unit: string }>();

  const rows: ImportPlan["rows"] = [];
  const validRows: ImportPlan["validRows"] = [];

  parsed.data.forEach((raw, i) => {
    const errors: string[] = [];
    const get = (c: Column) => (raw[c] ?? "").toString().trim();

    const date = parseDate(get("date"));
    if (!date) errors.push(get("date") ? `Invalid date "${get("date")}"` : "Date missing");

    const supplierName = get("supplier");
    if (!supplierName) errors.push("Supplier missing");
    const existingSupplier = suppliersByName.get(supplierName.toLowerCase());

    const productName = get("product");
    let sku = get("sku").toUpperCase();
    const existingProduct =
      (sku && productsBySku.get(sku)) || (!sku && productName ? productsByName.get(productName.toLowerCase()) : undefined);
    if (existingProduct) sku = existingProduct.sku;
    if (!sku && productName) sku = slugSku(productName);
    if (!sku && !productName) errors.push("SKU or product name missing");

    let unit = get("unit") || existingProduct?.unit || newProducts.get(sku)?.unit || "";
    if (!existingProduct && !unit) errors.push("Unit missing for new product");
    if (existingProduct) unit = existingProduct.unit;

    const quantity = parseNumber(get("quantity"));
    if (quantity == null || quantity <= 0) errors.push("Quantity must be a positive number");
    const unitPrice = parseNumber(get("unit_price"));
    if (unitPrice == null || unitPrice < 0) errors.push("Unit price must be a number");

    const currency = (get("currency") || "EUR").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) errors.push(`Invalid currency "${currency}"`);
    const fxRate = currency === "EUR" ? 1 : parseNumber(get("fx_rate"));
    if (fxRate == null || fxRate <= 0) errors.push(`FX rate required for ${currency}`);
    const freight = parseNumber(get("freight")) ?? 0;
    const other = parseNumber(get("other_costs")) ?? 0;

    const total = quantity != null && unitPrice != null ? computeTotal(quantity, unitPrice, freight, other) : null;
    const row: PreviewRow = {
      line: i + 2, // header is line 1
      date,
      supplier: supplierName,
      sku,
      product: existingProduct?.name ?? productName ?? sku,
      unit,
      quantity,
      unitPrice,
      currency,
      total,
      errors,
      newSupplier: !!supplierName && !existingSupplier,
      newProduct: !!sku && !existingProduct,
    };
    rows.push(row);

    if (errors.length === 0) {
      if (row.newSupplier && !newSuppliers.has(supplierName.toLowerCase())) {
        newSuppliers.set(supplierName.toLowerCase(), supplierName);
      }
      if (row.newProduct && !newProducts.has(sku)) {
        newProducts.set(sku, { sku, name: productName || sku, unit });
      }
      validRows.push({
        ...row,
        fxRate: fxRate!,
        freight,
        other,
        invoice: get("invoice_reference") || null,
        notes: get("notes") || null,
        country: get("supplier_country") || null,
        category: get("category") || null,
      });
    }
  });

  return {
    rows,
    validRows,
    newSuppliers: [...newSuppliers.values()],
    newProducts: [...newProducts.values()],
    missingColumns: [],
  };
}
