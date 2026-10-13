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

describe("a supplier's code is not an identity by itself", () => {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const shared: MatchContext = {
    suppliers: [
      { id: "plast", name: "Mock Plast Srl", vatNumber: null },
      { id: "other", name: "Mock Altro Srl", vatNumber: null },
    ],
    supplierAliases: [],
    products: [
      { id: "c1050", sku: "CNT-1050", name: "Contenitori per ceri 10.50", description: null, kind: "component" },
      { id: "c152", sku: "CNT-152", name: "Contenitori per ceri 15/2", description: null, kind: "component" },
      { id: "par", sku: "PAR-5254", name: "Paraffina 52/54", description: null, kind: "direct_material" },
      { id: "mine", sku: "MY-1", name: "Fondelli diam 60", description: null, kind: "component" },
    ],
    // One code, "CNT", for the whole range: what the real invoices of a supplier look like.
    productAliases: [
      { productId: "c1050", normalized: key("CONTENITORI PER CERI 10.50"), supplierId: "plast", alias: "CONTENITORI PER CERI 10.50", supplierSku: "CNT" },
      { productId: "c152", normalized: key("CONTENITORI PER CERI 15/2"), supplierId: "plast", alias: "CONTENITORI PER CERI 15/2", supplierSku: "CNT" },
      { productId: "par", normalized: key("PARAFFINA 52/54"), supplierId: "plast", alias: "PARAFFINA 52/54", supplierSku: "PRF" },
    ],
    supplierProducts: [
      { supplierId: "plast", productId: "c1050", supplierSku: "CNT", supplierProductName: "CONTENITORI PER CERI 10.50" },
      { supplierId: "plast", productId: "c152", supplierSku: "CNT", supplierProductName: "CONTENITORI PER CERI 15/2" },
      { supplierId: "plast", productId: "par", supplierSku: "PRF", supplierProductName: "PARAFFINA 52/54" },
    ],
  };

  it("under a code shared by several products, the description decides which one", () => {
    expect(matchProduct({ supplierSku: "CNT", description: "CONTENITORI PER CERI 15/2" }, "plast", shared)).toMatchObject({ status: "exact", id: "c152" });
    expect(matchProduct({ supplierSku: "CNT", description: "CONTENITORI PER CERI 10.50" }, "plast", shared)).toMatchObject({ status: "exact", id: "c1050" });
  });

  it("a size none of them has is never filed under the first product with that code", () => {
    const m = matchProduct({ supplierSku: "CNT", description: "CONTENITORI PER CERI 20/2" }, "plast", shared);
    expect(m.status).toBe("none");
    expect(m.id).toBeNull();
    // It is shown next to the products that share the code: a new one of that range, for the user to say.
    expect(m.related?.map((r) => r.id).sort()).toEqual(["c1050", "c152"]);
  });

  it("the same size written with other words is proposed, not decided", () => {
    expect(matchProduct({ supplierSku: "CNT", description: "Contenitore cero 15/2 neutro" }, "plast", shared)).toMatchObject({ status: "probable", id: "c152" });
  });

  it("a code that names one product still asks when the description states another grade", () => {
    expect(matchProduct({ supplierSku: "PRF", description: "PARAFFINA 52/54" }, "plast", shared)).toMatchObject({ status: "exact", id: "par" });
    expect(matchProduct({ supplierSku: "PRF", description: "PARAFFINA 56/58" }, "plast", shared)).toMatchObject({ status: "probable", id: "par", confidence: 0.6 });
  });
});

describe("the same words from another supplier", () => {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const world: MatchContext = {
    suppliers: [
      { id: "ser", name: "Mock Cere Spa", vatNumber: null },
      { id: "new", name: "Mock Nuovo Srl", vatNumber: null },
    ],
    supplierAliases: [],
    products: [
      { id: "par", sku: "PAR-5254", name: "Paraffina 52/54", description: null, kind: "direct_material" },
      { id: "own", sku: "OWN-1", name: "Stoppino cerato 30 mm", description: null, kind: "component" },
    ],
    productAliases: [{ productId: "par", normalized: key("PARAFFINA 52/54"), supplierId: "ser", alias: "PARAFFINA 52/54" }],
    supplierProducts: [{ supplierId: "ser", productId: "par", supplierSku: null, supplierProductName: "PARAFFINA 52/54" }],
  };

  it("are the product when its own supplier writes them", () => {
    expect(matchProduct({ description: "Paraffina 52/54" }, "ser", world)).toMatchObject({ status: "exact", id: "par" });
  });

  it("are a proposal to confirm when someone else writes them: an article of another supplier is never filed by itself", () => {
    expect(matchProduct({ description: "Paraffina 52/54" }, "new", world)).toMatchObject({ status: "probable", id: "par" });
    expect(matchProduct({ description: "Paraffina 52/54" }, null, world)).toMatchObject({ status: "probable", id: "par" });
  });

  it("are the product when nobody sells it yet: the user's own entry is known by its name", () => {
    expect(matchProduct({ description: "Stoppino cerato 30 mm" }, "new", world)).toMatchObject({ status: "exact", id: "own" });
  });
});

describe("a product of the same kind that is not the same product", () => {
  const world: MatchContext = {
    suppliers: [{ id: "ser", name: "Mock Cere Spa", vatNumber: null }],
    supplierAliases: [],
    products: [{ id: "par", sku: "PAR-5254", name: "Paraffina 52/54", description: null, kind: "direct_material" }],
    productAliases: [],
    supplierProducts: [{ supplierId: "ser", productId: "par", supplierSku: null, supplierProductName: "PARAFFINA 52/54" }],
  };

  it("another grade is no match, and is shown next to its family", () => {
    const m = matchProduct({ description: "Paraffina 54/56" }, "ser", world);
    expect(m.status).toBe("none");
    expect(m.related).toEqual([{ id: "par", confidence: 0, reason: "Same kind of product, another grade or size" }]);
  });

  it("no grade at all is no match either, and says what it could belong with", () => {
    const m = matchProduct({ description: "Paraffina" }, "ser", world);
    expect(m.status).toBe("none");
    expect(m.related?.[0]).toMatchObject({ id: "par", reason: "Same kind of product" });
  });

  it("something of another kind is next to nothing", () => {
    expect(matchProduct({ description: "Etichetta adesiva 30x40" }, "ser", world).related).toBeUndefined();
  });
});
