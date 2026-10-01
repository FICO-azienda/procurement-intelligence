import { describe, expect, it } from "vitest";
import { matchProduct, matchSupplier, type MatchContext } from "./index";

const ctx: MatchContext = {
  suppliers: [
    { id: "abc", name: "ABC Srl", vatNumber: "IT01234567890" },
    { id: "rossi", name: "Vetreria Rossi", vatNumber: null },
    { id: "def", name: "DEF Srl", vatNumber: null },
    { id: "tw", name: "Turkish Wax Ltd", vatNumber: null },
  ],
  supplierAliases: [],
  products: [
    { id: "par", sku: "PAR-5860", name: "Paraffina 58/60", description: "Paraffina fully refined in pastiglie, punto di fusione 58–60 °C." },
    { id: "gls", sku: "GLS-300", name: "Vetro Trasparente 300 ml", description: "Bicchiere in vetro trasparente per candela, 300 ml." },
    { id: "wck", sku: "WCK-120", name: "Stoppino Cotone 120 mm", description: null },
    { id: "frg", sku: "FRG-INC", name: "Fragranza Incenso", description: null },
    { id: "box", sku: "BOX-HC", name: "Scatola Home Collection", description: null },
  ],
  productAliases: [],
  supplierProducts: [{ supplierId: "rossi", productId: "gls", supplierSku: "VR-8821", supplierProductName: "Bicchiere 300 cc trasparente" }],
};

describe("matchSupplier", () => {
  it("exact on same name or VAT", () => {
    expect(matchSupplier({ name: "abc srl" }, ctx)).toMatchObject({ status: "exact", id: "abc" });
    expect(matchSupplier({ name: "Something else", vat: "01234567890" }, ctx)).toMatchObject({ status: "exact", id: "abc" });
  });

  it("probable when only the legal form differs (asks for confirmation)", () => {
    expect(matchSupplier({ name: "ABC S.r.l." }, ctx)).toMatchObject({ status: "probable", id: "abc", confidence: 0.92 });
  });

  it("exact after the user confirmed an alias", () => {
    const learned = { ...ctx, supplierAliases: [{ supplierId: "abc", normalized: "abc" }] };
    expect(matchSupplier({ name: "ABC S.r.l." }, learned)).toMatchObject({ status: "exact", id: "abc" });
  });

  it("no match for an unknown supplier", () => {
    expect(matchSupplier({ name: "Cartotecnica Veneta Srl" }, ctx).status).toBe("none");
  });
});

describe("matchProduct", () => {
  it("exact by SKU and supplier code", () => {
    expect(matchProduct({ sku: "par5860" }, null, ctx)).toMatchObject({ status: "exact", id: "par" });
    expect(matchProduct({ supplierSku: "VR 8821" }, "rossi", ctx)).toMatchObject({ status: "exact", id: "gls" });
  });

  it("exact on the same normalized name", () => {
    expect(matchProduct({ name: "PARAFFINA 58-60" }, null, ctx)).toMatchObject({ status: "exact", id: "par" });
  });

  it.each([
    ["PARAFFINA RAFFINATA 58-60"],
    ["Paraffin Wax 58/60"],
    ["PAR 5860"],
  ])("suggests Paraffina 58/60 for %s", (name) => {
    const m = matchProduct({ name }, "abc", ctx);
    expect(m.status).toBe("probable");
    expect(m.id).toBe("par");
    expect(m.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not match a different size", () => {
    expect(matchProduct({ name: "Glass Jar Green 500 ml" }, null, ctx).status).toBe("none");
    expect(matchProduct({ name: "Paraffina 52/54" }, null, ctx).status).toBe("none");
  });

  it("does not match unrelated words that share a number", () => {
    expect(matchProduct({ name: "GLASS JAR 300 CLEAR" }, null, ctx).status).toBe("none");
  });

  it("learns from confirmed aliases", () => {
    const learned = { ...ctx, productAliases: [{ productId: "par", normalized: "paraffin wax 58 60" }] };
    expect(matchProduct({ name: "PARAFFIN WAX 58/60" }, null, learned)).toMatchObject({ status: "exact", id: "par" });
  });
});
