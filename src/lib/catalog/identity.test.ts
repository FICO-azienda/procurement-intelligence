/**
 * Who sold it is not what was bought: a description is read apart into the
 * seller's name, the seller's codes and the product — and two descriptions
 * are the same product only when they name the same thing in the same grade.
 * Mock suppliers and products, used only here.
 */
import { describe, expect, it } from "vitest";
import { productKey } from "../import/normalize/text";
import { matchProduct, type MatchContext } from "../import/match";
import { compareIdentity, identityOf, separate } from "./identity";
import { mapCatalogue, type MapInput } from "./mapper";

const SER = { names: ["SER S.p.A."] };

describe("reading a description apart", () => {
  it("the seller's name and its code are not the product", () => {
    expect(separate("Paraffina SER 52/54 (XXF)", SER)).toMatchObject({ supplierTerms: ["SER"], codes: ["XXF"], body: "Paraffina 52/54", brandKept: false });
    expect(separate("WAX SER 14581 (FXF)", SER)).toMatchObject({ supplierTerms: ["SER"], codes: ["14581", "FXF"], body: "WAX" });
    // The article code the document itself gives, written again in the description.
    expect(separate("Stoppino AB123 cotone", { names: ["Mock Wicks Srl"], skus: ["AB-123"] })).toMatchObject({ codes: ["AB123"], body: "Stoppino cotone" });
  });

  it("grades, sizes and quantities are never taken for codes", () => {
    expect(separate("Paraffina 52/54", SER).codes).toEqual([]);
    expect(separate("Etichette 12000 pz", SER)).toMatchObject({ codes: [], body: "Etichette 12000 pz" });
    expect(separate("Vaschetta 30x40 (PP)", SER)).toMatchObject({ codes: [], body: "Vaschetta 30x40 (PP)" });
    expect(separate("Candele D13 (ct.136 da kg. 9,65)", SER).codes).toEqual([]);
  });

  it("a word of the seller's name that is also a material or a product stays", () => {
    expect(separate("Vaschetta plastica 500 ml", { names: ["Plastica Veneta Srl"] })).toMatchObject({ supplierTerms: [], body: "Vaschetta plastica 500 ml" });
    expect(separate("Candele profumate 200 g", { names: ["Candele Mock Srl"] }).supplierTerms).toEqual([]);
  });

  it("a brand and its model stay as written: without the name nothing would say what it is", () => {
    expect(separate("MOCKTITE 401", { names: ["Mocktite Italia SpA"] })).toMatchObject({ brandKept: true, supplierTerms: [], body: "MOCKTITE 401" });
  });
});

describe("the same product, written by someone else", () => {
  const ours = identityOf("Paraffina SER 52/54 (XXF)", SER);

  it("the same thing in the same grade is the same product, whoever wrote it", () => {
    expect(ours).toMatchObject({ subKey: "paraffin", numbers: ["52", "54"], words: [], codes: ["XXF"] });
    expect(compareIdentity(ours, identityOf("Paraffin 52-54")).match).toBe("same");
    // The weight of the bag is packaging, not a grade.
    expect(compareIdentity(ours, identityOf("PARAFFINA RAFFINATA 52-54 KG 25", { names: ["XYZ S.r.l."] }))).toMatchObject({ match: "likely", differences: ["raffinat"] });
    expect(compareIdentity(ours, identityOf("Fully Refined Paraffin Wax 52/54")).match).toBe("likely");
  });

  it("another grade is another product of the same family — and another material is nothing alike", () => {
    expect(compareIdentity(ours, identityOf("Paraffina 56/58")).match).toBe("other_spec");
    expect(compareIdentity(ours, identityOf("Paraffina 54/56 fully refined")).match).toBe("other_spec");
    expect(compareIdentity(ours, identityOf("Cera 52/54")).match).toBe("unrelated");
    expect(compareIdentity(identityOf("WAX SER 14581 (FXF)", SER), identityOf("Wax 20991")).match).toBe("unrelated");
  });
});

describe("a new invoice", () => {
  const ctx: MatchContext = {
    suppliers: [
      { id: "ser", name: "SER S.p.A.", vatNumber: null },
      { id: "xyz", name: "XYZ S.r.l.", vatNumber: null },
    ],
    supplierAliases: [],
    products: [
      { id: "par", sku: "PAR-5254", name: "Paraffina 52/54", description: null, kind: "direct_material" },
      { id: "par58", sku: "PAR-5658", name: "Paraffina 56/58", description: null, kind: "direct_material" },
    ],
    productAliases: [{ productId: "par", normalized: productKey("PARAFFINA SER 52/54 (XXF)"), supplierId: "ser", alias: "PARAFFINA SER 52/54 (XXF)" }],
    supplierProducts: [{ supplierId: "ser", productId: "par", supplierSku: "PRP026", supplierProductName: null }],
  };

  it("from another supplier, the same product is proposed — to link or keep apart, never linked by itself", () => {
    expect(matchProduct({ name: "PARAFFINA RAFFINATA 52-54 KG 25" }, "xyz", ctx)).toMatchObject({ status: "probable", id: "par", reason: expect.stringContaining("Looks like a product you already have") });
    expect(matchProduct({ name: "Fully Refined Paraffin Wax 52/54" }, "xyz", ctx)).toMatchObject({ status: "probable", id: "par" });
    expect(matchProduct({ name: "Paraffin 52-54" }, "xyz", ctx)).toMatchObject({ status: "probable", id: "par", reason: expect.stringContaining("Same product by what it is") });
  });

  it("another grade is never suggested as the same product", () => {
    const r = matchProduct({ name: "Paraffina raffinata 54/56" }, "xyz", ctx);
    expect(r.status).toBe("none");
    expect(r.alternatives.map((a) => a.id)).toEqual([]);
    expect(matchProduct({ name: "Paraffina raffinata 56-58" }, "xyz", ctx)).toMatchObject({ status: "probable", id: "par58" });
  });

  it("the supplier's own code, learned from a description already linked, is recognised when written another way", () => {
    expect(matchProduct({ name: "PAR SER 52/54 XXF KG" }, "ser", ctx)).toMatchObject({ status: "exact", id: "par", reason: "Supplier's own code in the description" });
    // The same letters from someone else prove nothing, and the code next to another grade is not this product.
    expect(matchProduct({ name: "PAR 52/54 XXF KG" }, "xyz", ctx).status).not.toBe("exact");
    expect(matchProduct({ name: "PAR SER 56/58 XXF" }, "ser", ctx).id).not.toBe("par");
  });
});

describe("the catalogue, product by product", () => {
  let n = 0;
  const ser = { id: "ser", name: "SER S.p.A." };
  const metal = { id: "metal", name: "MOCKFORM SRL" };
  const p = (name: string, supplier: { id: string; name: string }, extra: Partial<MapInput> & { sku?: string } = {}): MapInput => {
    const { sku, ...rest } = extra;
    return { id: `i${++n}`, name, kind: "direct_material", unit: "kg", mapped: false, category: null, subcategory: null, family: null, variant: null, suppliers: [supplier], aliases: [{ text: name.toUpperCase(), supplierId: supplier.id, supplierSku: sku ?? null, ean: null }], spend: 100, price: 1, ...rest };
  };
  const paraffin = p("Paraffina SER 52/54 (XXF)", ser, { sku: "PRP026", spend: 400_000 });
  const paraffin58 = p("Paraffina SER 56/58 (XXF)", ser, { sku: "PRP027" });
  const wax = p("WAX SER 14581 (FXF)", ser, { sku: "PRP919", spend: 29_000 });
  const disc = p("F60/8N - Fondelli diam.60", metal, { kind: "component", unit: "pcs" });
  const twinA = p("G70/1A - Fondelli diam.70", metal, { kind: "component", unit: "pcs" });
  const twinB = p("G70/2B - Fondelli diam.70", metal, { kind: "component", unit: "pcs" });
  const all = [paraffin, paraffin58, wax, disc, twinA, twinB];
  const a = mapCatalogue(all);
  const of = (x: ReturnType<typeof mapCatalogue>, product: MapInput) => x.products.find((m) => m.productId === product.id)!;

  it("two grades of one material are two products of one family, never a duplicate", () => {
    expect(of(a, paraffin)).toMatchObject({ name: "Paraffina 52/54", family: "Paraffina", identity: "named", group: "confident" });
    expect(of(a, paraffin58)).toMatchObject({ name: "Paraffina 56/58", family: "Paraffina" });
    expect(a.duplicates).toEqual([]);
  });

  it("a material the words do not identify is not named and not classified: the user is offered what it could be", () => {
    expect(of(a, wax)).toMatchObject({ name: "WAX SER 14581 (FXF)", category: "Waxes and paraffin", subcategory: null, family: null, level: "low", identity: "unidentified", group: "unclassified", supplierTerms: ["SER"], supplierCodes: ["14581", "FXF", "PRP919"], options: ["paraffin", "wax_blend", "vegetable_wax"] });
    expect(of(a, wax).reason).toMatch(/not which one/);
    expect(a.cards.find((c) => c.productIds.includes(wax.id))).toMatchObject({ type: "classify", productIds: [wax.id], options: ["paraffin", "wax_blend", "vegetable_wax"] });
    expect(a.totals.groups).toMatchObject({ unclassified: 1 });
  });

  it("once the user says what it is, the word that said nothing goes and the supplier's code stays in sight", () => {
    const answered = mapCatalogue(all, { answers: new Map([[wax.id, "wax_blend"]]) });
    expect(of(answered, wax)).toMatchObject({ name: "Wax blend 14581", subcategory: "Candle wax blend", identity: "supplier_code", by: "user" });
  });

  it("the supplier's article code leaves the name when a size tells the product apart, and comes back when two names would be one", () => {
    expect(of(a, disc)).toMatchObject({ name: "Fondelli diam.60", supplierCodes: ["F60/8N"], level: "high", identity: "named" });
    expect([of(a, twinA).name, of(a, twinB).name]).toEqual(["Fondelli diam.70 G70/1A", "Fondelli diam.70 G70/2B"]);
  });
});
