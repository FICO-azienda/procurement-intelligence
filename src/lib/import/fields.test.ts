import { describe, expect, it } from "vitest";
import { inferByContent, isConfidentMapping, proposeMapping } from "./fields";

const headers = (n: number) => Array.from({ length: n }, (_, i) => `Column ${i + 1}`);
const empty = (n: number) => Object.fromEntries(headers(n).map((h) => [h, null]));

describe("columns without names", () => {
  it("date, two names, quantity and price", () => {
    const rows = [
      ["15/09/26", "ABC Srl", "Paraffina", "2000", "1,58"],
      ["16/09/26", "Rossi", "Vetro", "6000", "1,18"],
    ];
    expect(Object.values(inferByContent(headers(5), rows, empty(5)))).toEqual(["purchase_date", "supplier_name", "product_name", "quantity", "unit_price"]);
  });

  it("three numbers where one is the product of the others: quantity, price, total", () => {
    const rows = [
      ["Paraffina", "ABC Srl", "1,58", "2000", "3160", "kg", "EUR", "2026-09-15"],
      ["Vetro", "Rossi", "1,18", "6000", "7080", "pz", "EUR", "2026-09-16"],
    ];
    const m = inferByContent(headers(8), rows, empty(8), { suppliers: ["ABC Srl", "Vetreria Rossi"], products: ["Paraffina 58/60"] });
    expect(m).toEqual({
      "Column 1": "product_name", // known product names decide, whatever the order
      "Column 2": "supplier_name",
      "Column 3": "unit_price",
      "Column 4": "quantity",
      "Column 5": "total",
      "Column 6": "unit",
      "Column 7": "currency",
      "Column 8": "purchase_date",
    });
  });

  it("when a price is larger than the quantity, whole numbers are still the quantity", () => {
    const rows = [
      ["01/09/2026", "Mobili Srl", "Bancale", "2", "480,50"],
      ["02/09/2026", "Mobili Srl", "Scaffale", "3", "1.250,75"],
    ];
    const m = inferByContent(headers(5), rows, empty(5));
    expect(m["Column 4"]).toBe("quantity");
    expect(m["Column 5"]).toBe("unit_price");
  });

  it("keeps what the headers already explained and leaves a lone number alone", () => {
    const h = ["Data", "Chi", "Cosa", "Cifra"];
    const rows = [["15/09/2026", "ABC Srl", "Paraffina", "1,58"]];
    const m = inferByContent(h, rows, proposeMapping(h, rows));
    expect(m).toEqual({ Data: "purchase_date", Chi: "supplier_name", Cosa: "product_name", Cifra: null });
  });
});

describe("skipping the column screen", () => {
  it("only when every needed column has a name we know exactly", () => {
    const known = proposeMapping(["Data", "Fornitore", "Prodotto", "Quantità", "Prezzo unitario"]);
    expect(isConfidentMapping(known, "purchase")).toBe(true);
    // "Data consegna prevista" contains "data" but is not the purchase date for sure.
    const loose = proposeMapping(["Data fattura emissione", "Fornitore", "Prodotto", "Quantità", "Prezzo unitario"]);
    expect(isConfidentMapping(loose, "purchase")).toBe(false);
    // A needed column is missing.
    expect(isConfidentMapping(proposeMapping(["Data", "Fornitore", "Prodotto", "Prezzo unitario"]), "purchase")).toBe(false);
  });
});
