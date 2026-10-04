import { describe, expect, it } from "vitest";
import { parseQuickPurchase } from "./quick-add";

const AS_OF = "2026-10-01";
const p = (s: string) => parseQuickPurchase(s, AS_OF);

describe("quick add", () => {
  it("reads the Italian example", () => {
    expect(p("Comprati 2000 kg di paraffina da ABC a 1,58€/kg il 28 settembre")).toEqual({
      quantity: 2000,
      unit: "kg",
      unitPrice: 1.58,
      currency: "EUR",
      date: "2026-09-28",
      supplierText: "ABC",
      productText: "paraffina",
    });
  });

  it("reads an English sentence", () => {
    expect(p("Bought 500 pcs of glass jars from Vetreria Rossi at 1.18 on 22/09")).toMatchObject({
      quantity: 500,
      unit: "pcs",
      unitPrice: 1.18,
      date: "2026-09-22",
      supplierText: "Vetreria Rossi",
      productText: "glass jars",
    });
  });

  it("understands thousands, symbols in front and other currencies", () => {
    expect(p("20.000 pz stoppino da Filati Italia a € 0,074 oggi")).toMatchObject({ quantity: 20000, unit: "pcs", unitPrice: 0.074, currency: "EUR", date: AS_OF, supplierText: "Filati Italia", productText: "stoppino" });
    expect(p("1000 kg wax from Turkish Wax at 1.40 USD/kg yesterday")).toMatchObject({ quantity: 1000, unitPrice: 1.4, currency: "USD", date: "2026-09-30", supplierText: "Turkish Wax", productText: "wax" });
  });

  it("a date without a year is the latest one not in the future", () => {
    expect(p("100 kg paraffina il 15 dicembre").date).toBe("2025-12-15");
    expect(p("100 kg paraffina il 3 ottobre").date).toBe("2026-10-03");
    expect(p("100 kg paraffina 15/09/2025").date).toBe("2025-09-15");
  });

  it("leaves empty what is not written", () => {
    expect(p("paraffina da ABC")).toEqual({ quantity: null, unit: null, unitPrice: null, currency: null, date: null, supplierText: "ABC", productText: "paraffina" });
    expect(p("2000 kg paraffina")).toMatchObject({ quantity: 2000, unit: "kg", unitPrice: null, supplierText: null, productText: "paraffina" });
    expect(p("")).toEqual({ quantity: null, unit: null, unitPrice: null, currency: null, date: null, supplierText: null, productText: null });
  });

  it("does not take the price for the quantity", () => {
    const r = p("paraffina da ABC a 1,58 €/kg, 2000 kg");
    expect(r.unitPrice).toBe(1.58);
    expect(r.quantity).toBe(2000);
  });
});
