import type { Dataset } from "./analytics";

/** Small option lists for forms and filters. */
export function lookups(data: Dataset) {
  return {
    productOptions: data.products.map(({ id, name, sku, unit, currentSupplierId }) => ({
      id,
      name,
      sku,
      unit,
      currentSupplierId,
    })),
    supplierOptions: data.suppliers.map(({ id, name }) => ({ id, name })),
    categories: [...new Set(data.products.map((p) => p.category).filter((c): c is string => !!c))].sort(),
    supplierName: (id: string | null | undefined) => data.suppliers.find((s) => s.id === id)?.name ?? "—",
    supplier: (id: string | null | undefined) => data.suppliers.find((s) => s.id === id),
    product: (id: string | null | undefined) => data.products.find((p) => p.id === id),
  };
}

export function plural(n: number, one: string, many = one + "s") {
  return `${n.toLocaleString("it-IT", { useGrouping: "always" })} ${n === 1 ? one : many}`;
}
