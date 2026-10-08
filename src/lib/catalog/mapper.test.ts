/**
 * Product Mapper, the pure part: names as invoices write them go in, an
 * ordered catalogue comes out — and what the rules can't tell is asked.
 */
import { describe, expect, it } from "vitest";
import { attributesOf, withoutPackNotes } from "./attributes";
import { mapCatalogue, type MapInput } from "./mapper";
import { matchesWords, parseProductQuery } from "./query";
import { categorize } from "./taxonomy";

let n = 0;
const SER = { id: "ser", name: "SER S.p.A." };
const ERRE = { id: "erre", name: "ERREPLAST SRL" };
const MONTE = { id: "monte", name: "Monterosa Zelandi Srl" };
const BOX = { id: "box", name: "EUROSCATOLA SPA" };
const SCREEN = { id: "screen", name: "SPECIAL SCREEN SRL" };
const BIANCHI = { id: "bianchi", name: "Cereria Bianchi" };

function p(name: string, supplier: { id: string; name: string }, extra: Partial<MapInput> & { sku?: string; ean?: string } = {}): MapInput {
  const { sku, ean, ...rest } = extra;
  return {
    id: `p${++n}`,
    name,
    kind: "direct_material",
    unit: "pcs",
    mapped: false,
    category: null,
    subcategory: null,
    family: null,
    variant: null,
    suppliers: [supplier],
    aliases: [{ text: name.toUpperCase(), supplierId: supplier.id, supplierSku: sku ?? null, ean: ean ?? null }],
    spend: 100,
    price: 1,
    ...rest,
  };
}

const of = (analysis: ReturnType<typeof mapCatalogue>, product: MapInput) => analysis.products.find((m) => m.productId === product.id)!;

describe("what a name says", () => {
  it("finds the category from the words, the first known word deciding", () => {
    expect(categorize("PARAFFINA SER 52/54 (XXF)")).toMatchObject({ category: { key: "wax" }, sub: { key: "paraffin" } });
    expect(categorize("Cera per Stoppini CTJW")?.sub.key).toBe("wax");
    expect(categorize("Scat. Americana C12")?.sub.key).toBe("cardboard");
    // The container is not what was bought.
    expect(categorize("Scatole di carboncini")?.sub.key).toBe("church");
    expect(categorize("Cartoni da n. 50.000 fermagli metallici")?.sub.key).toBe("wick_holder");
    // Plain "carta" could be anything: only packaging papers are packaging.
    expect(categorize("40x40 - 50T Carta patinata + vernice")).toBeNull();
    expect(categorize("50x70 - Best Choice - Articolo 60T")).toBeNull();
  });

  it("reads sizes, diameters, capacities and materials only where the pattern is clear", () => {
    expect(attributesOf("Scatola Americana C12 - F.TO 420X310X240")).toContainEqual({ key: "size", value: "420 x 310 x 240" });
    expect(attributesOf("Candela Liturgica Altare Ø 22x400 mm 3200pz.")).toEqual(expect.arrayContaining([{ key: "size", value: "Ø 22 x 400 mm" }, { key: "pack", value: "3200" }]));
    expect(attributesOf("Fondelli diam.60")).toContainEqual({ key: "diameter", value: "60" });
    expect(attributesOf("Nightlight D38MM 50PZ Bianco in Policarbonato")).toEqual(expect.arrayContaining([{ key: "diameter", value: "38 mm" }, { key: "colour", value: "bianco" }, { key: "material", value: "policarbonato" }]));
    expect(attributesOf("6 BT.CC.1000 Vino")).toContainEqual({ key: "capacity", value: "1000 cc" });
    // "TR", "BIA", "XXF" could mean anything: nothing is read into them.
    expect(attributesOf("ART. LC TR. Contenitori per ceri")).toEqual([]);
  });

  it("tells a packing note from a size", () => {
    expect(withoutPackNotes("Candela Liturgica Altare Ø 35x200 mm 60 pz. x scat")).toBe("Candela Liturgica Altare Ø 35x200 mm");
    expect(withoutPackNotes("Particola sottile Ø 35 mm (2 cart. da 70 conf. cad.)")).toBe("Particola sottile Ø 35 mm");
    expect(withoutPackNotes("51 CT 6 BT.CC.1000 Vino Liquoroso")).toBe("6 BT.CC.1000 Vino Liquoroso");
  });
});

describe("a readable catalogue from invoice names", () => {
  const paraffin = p("Paraffina SER 52/54 (XXF)", SER, { unit: "kg", spend: 400_000, sku: "PRP026" });
  const tg1204 = p("Trecciolino TG 1204", MONTE, { kind: "component", unit: "kg", sku: "PFTRTG1204" });
  const tg1206 = p("Trecciolino TG 1206", MONTE, { kind: "component", unit: "kg", sku: "PFTRTG1206" });
  const st = p("Trecciolino ST 18/08", MONTE, { kind: "component", unit: "kg", sku: "PFTRST1808" });
  const woodA = p("Stoppino Legno NF (0.76) 19.1 X 65", MONTE, { kind: "component" });
  const woodB = p("Stoppino Legno NF (0.76) 15.9 x 128", MONTE, { kind: "component" });
  const woodC = p("Legno NF (0.76) 19.1X128 MM", MONTE, { kind: "component" });
  const lc = p("ART. LC TR. Contenitori per ceri", ERRE, { kind: "component", spend: 16_000 });
  const c50 = p("ART.50/2 Contenitori x ceri", ERRE, { kind: "component" });
  const typo = p("ART. 60 L TR. Contenitoroi per ceri", ERRE, { kind: "component" });
  const auto = p("ART. 10.50 Autoest. BIA", ERRE, { kind: "component" });
  const c12 = p("Scatola Americana C12 - F.TO 420X310X240 - Americana - dim.mm 420 x 310 x 240", BOX, { kind: "packaging" });
  const c5 = p("Scat. Americana C5 - F.TO 399X329X219 - Scatola - dim.mm 399 x 329 x 219", BOX, { kind: "packaging" });
  const c5a = p("SC. Americana C5A - F.TO 399X329X219 - Americana - dim.mm 399 x 329 x 219", BOX, { kind: "packaging" });
  const a = mapCatalogue([paraffin, tg1204, tg1206, st, woodA, woodB, woodC, lc, c50, typo, auto, c12, c5, c5a]);

  it("names the product, not the supplier, and keeps every number", () => {
    // Who sold it (SER) and how it calls it (XXF, PRP026) are kept apart from what it is.
    expect(of(a, paraffin)).toMatchObject({ name: "Paraffina 52/54", category: "Waxes and paraffin", subcategory: "Paraffin", level: "high", family: null, supplierTerms: ["SER"], supplierCodes: ["XXF", "PRP026"], identity: "named", group: "confident" });
    expect(of(a, paraffin).originals).toEqual(["Paraffina SER 52/54 (XXF)"]);
  });

  it("puts the sizes of one article in a family, each one a variant — never a duplicate", () => {
    expect(of(a, tg1204)).toMatchObject({ name: "Trecciolino TG 1204", family: "Trecciolino", variant: "TG 1204", subcategory: "Wicks", level: "high" });
    expect(of(a, st)).toMatchObject({ family: "Trecciolino", variant: "ST 18/08" });
    expect(a.duplicates).toEqual([]);
    expect(a.families.find((x) => x.name === "Trecciolino")?.productIds).toHaveLength(3);
  });

  it("moves an article code after the noun, and writes the noun the way the range writes it", () => {
    // Only the supplier's article code tells these apart: the code stays, and the user is asked once for the whole range.
    expect(of(a, lc)).toMatchObject({ name: "Contenitori per ceri LC TR", family: "Contenitori per ceri", variant: "LC TR", level: "medium", identity: "supplier_code", supplierCodes: ["LC TR"], group: "review" });
    expect(of(a, c50).name).toBe("Contenitori per ceri 50/2");
    expect(of(a, typo).name).toBe("Contenitori per ceri 60 L TR");
  });

  it("drops what an export prints twice, and writes abbreviations out", () => {
    expect(of(a, c12)).toMatchObject({ name: "Scatola americana C12 - 420x310x240", family: "Scatola americana", variant: "C12 420x310x240" });
    expect(of(a, c5).name).toBe("Scatola americana C5 - 399x329x219");
    // C5 and C5A are two articles, however alike.
    expect(of(a, c5a).name).toBe("Scatola americana C5A - 399x329x219");
  });

  it("reads a name with no noun from its supplier's range — as a proposal to look at, not a certainty", () => {
    expect(of(a, woodC)).toMatchObject({ name: "Stoppino legno NF (0.76) 19.1x128 MM", family: "Stoppino legno", subcategory: "Wicks", level: "medium", by: "supplier" });
    expect(of(a, auto)).toMatchObject({ name: "Contenitori per ceri 10.50 Autoest. BIA", family: "Contenitori per ceri", level: "medium" });
    expect(a.cards.map((c) => [c.type, c.supplierName, c.productIds.length])).toEqual([
      ["check", "ERREPLAST SRL", 3],
      ["check", "ERREPLAST SRL", 1],
      ["check", "Monterosa Zelandi Srl", 1],
    ]);
  });

  it("says how much is sure, and where the money is", () => {
    expect(a.totals).toMatchObject({ analysed: 14, confirmed: 0, high: 9, medium: 5, low: 0, review: 5, groups: { done: 0, confident: 9, review: 5, unclassified: 0 } });
    expect(a.pareto.map((x) => x.products)).toEqual([1, 1, 1]);
    expect(a.products[0].productId).toBe(paraffin.id);
  });
});

describe("a supplier's code in front of the name", () => {
  const citro = p("TL 10 15 A 1 1 P 18 CC 12 Tealight 18x12 Citronella", SER, { unit: "box", spend: 9000 });
  const best = p("TL 10 15 A 1 0 P 30 CC 12 Best Choice 30X12", SER, { unit: "box", spend: 20_000 });
  const plain = p("TL 10 15 A 1 0 P 30 CC 12 Best Choice 30X12 bis", SER, { unit: "box" });
  const a = mapCatalogue([citro, best, plain]);

  it("is left out of the name, and what the product is comes from the description that says it", () => {
    expect(of(a, citro)).toMatchObject({ name: "Tealight 18x12 Citronella", level: "medium", by: "words" });
    expect(of(a, best)).toMatchObject({ name: "Tealight Best Choice 30x12", subcategory: "Tealights and nightlights", level: "medium", by: "code" });
    expect(of(a, plain).name).toBe("Tealight Best Choice 30x12 bis");
  });

  it("comes back when two products would end up with the same name", () => {
    const twinA = p("TL 10 15 A 1 0 P 30 CC 12 Tealight Rosso", SER, { unit: "box" });
    const twinB = p("TL 10 15 A 1 1 P 50 CC 6 Tealight Rosso", SER, { unit: "box" });
    const b = mapCatalogue([twinA, twinB]);
    expect(of(b, twinA).name).not.toBe(of(b, twinB).name);
    expect(of(b, twinA).name).toContain("P 30 CC 12");
  });
});

describe("what nobody can tell", () => {
  const l1 = p("50x70 - Best Choice - Articolo 60T", SCREEN, { kind: "packaging", spend: 1000 });
  const l2 = p("55x55 - Madonna del Frassino", SCREEN, { kind: "packaging", spend: 600 });
  const service = p("Manutenzione impianto colaggio", ERRE, { kind: "component", spend: 300 });

  it("is asked once per supplier, the largest spend first — never guessed", () => {
    const a = mapCatalogue([l1, l2, service]);
    expect(of(a, l1)).toMatchObject({ level: "low", category: null, name: "50x70 - Best Choice - Articolo 60T" });
    expect(a.cards).toMatchObject([
      { type: "classify", supplierName: "SPECIAL SCREEN SRL", productIds: [l1.id, l2.id], spend: 1600, kind: null },
      { type: "classify", supplierName: "ERREPLAST SRL", kind: "service" },
    ]);
    expect(a.totals).toMatchObject({ high: 0, low: 3, review: 3, reviewSpend: 1900 });
  });

  it("takes the user's answer for the whole group: a category, a family, and a noun in front of a bare size", () => {
    const a = mapCatalogue([l1, l2, service], { answers: new Map([[l1.id, "label"], [l2.id, "label"], [service.id, "service"]]) });
    expect(of(a, l1)).toMatchObject({ name: "Label 50x70 - Best Choice - Articolo 60T", category: "Labels and printing", subcategory: "Labels", family: "Labels", level: "high", by: "user", kind: "packaging" });
    expect(of(a, l2).name).toBe("Label 55x55 - Madonna del Frassino");
    expect(of(a, service)).toMatchObject({ kind: "service", category: null, level: "high" });
    expect(a.cards).toEqual([]);
  });
});

describe("the same product written twice", () => {
  const a60 = p("Candela Liturgica Altare Ø 35x200 mm 60 pz. x scat", BIANCHI, { unit: "kg", price: 4.25, sku: "CLA", spend: 240 });
  const a240 = p("Candela Liturgica Altare Ø 35x200 mm 240 pz.", BIANCHI, { unit: "kg", price: 4.25, sku: "CLA", spend: 170 });
  const other = p("Candela Liturgica Altare Ø 25x160 mm 240 pz.", BIANCHI, { unit: "kg", price: 4.25, sku: "CLA" });
  const third = p("Candela Liturgica Altare Ø 40x600 mm 36pz.", BIANCHI, { unit: "kg", price: 4.25, sku: "CLA" });

  it("is proposed when only the packing note differs — a different size never is", () => {
    const a = mapCatalogue([a60, a240, other, third]);
    expect(a.duplicates).toMatchObject([{ productIds: [a60.id, a240.id], level: "possible", suggestion: "merge", proposedName: "Candela liturgica altare Ø 35x200 mm", spend: 410 }]);
    // They wait for the user's decision: not in the bulk confirmation, not in the cards.
    expect(a.totals).toMatchObject({ high: 2, inDuplicates: 2, review: 0 });
  });

  it("is not asked again once the user said they are two products", () => {
    const a = mapCatalogue([a60, a240, other, third], { separated: [[a240.id, a60.id]] });
    expect(a.duplicates).toEqual([]);
    expect(a.totals.high).toBe(4);
  });

  it("is sure with the same article code and the same sizes, or the same barcode", () => {
    const x = p("Film estensibile 23 my", BOX, { kind: "packaging", sku: "FE23" });
    const y = p("Film estens. trasparente 23 MY", BOX, { kind: "packaging", sku: "FE-23" });
    const z = p("Nastro adesivo 50x66", BOX, { kind: "packaging", ean: "8001234567890" });
    const w = p("Nastro avana 50x66 mt", MONTE, { kind: "packaging", ean: "8001234567890" });
    const a = mapCatalogue([x, y, z, w]);
    expect(a.duplicates.map((d) => [d.level, d.reason])).toEqual(expect.arrayContaining([["high", "Same supplier code, same sizes"], ["high", "Same barcode"]]));
  });

  it("does not merge on a price or a unit that differ, nor on names alone", () => {
    // "CLA" is on the whole range here: it says nothing about two of them being one.
    const dear = { ...a240, id: "dear", price: 6 };
    expect(mapCatalogue([a60, dear, other, third]).duplicates).toEqual([]);
    const pieces = { ...a240, id: "pieces", unit: "pcs" };
    expect(mapCatalogue([a60, pieces, other, third]).duplicates).toEqual([]);
    // A code of their own and the same sizes: worth asking, with no suggestion when the price differs.
    expect(mapCatalogue([a60, dear]).duplicates).toMatchObject([{ level: "possible", suggestion: null }]);
    const s1 = p("Fiammetta PP Bianca", ERRE, { kind: "component" });
    const s2 = p("Fiammetta PP Rossa", ERRE, { kind: "component" });
    expect(mapCatalogue([s1, s2]).duplicates).toEqual([]);
  });
});

describe("what the user already confirmed", () => {
  it("is left as it is, and new products join the families that exist", () => {
    const done = p("Trecciolino TG 1204", MONTE, { kind: "component", mapped: true, category: "Stoppini e accessori", subcategory: "Stoppini", family: "Trecciolino", variant: "TG 1204" });
    const renamed = p("Cera microcristallina speciale", SER, { mapped: true, category: "La mia categoria", subcategory: null });
    const fresh = p("TRECCIOLINO TG 1506", MONTE, { kind: "component" });
    const a = mapCatalogue([done, renamed, fresh]);
    expect(of(a, done)).toMatchObject({ mapped: true, name: "Trecciolino TG 1204", category: "Stoppini e accessori", by: "stored" });
    expect(of(a, renamed)).toMatchObject({ mapped: true, category: "La mia categoria" });
    expect(a.totals).toMatchObject({ analysed: 3, confirmed: 2, high: 1 });
    expect(of(a, fresh)).toMatchObject({ level: "high", subcategory: "Wicks" });
  });

  it("leaves out what is not a product to compare", () => {
    const a = mapCatalogue([p("Trasporto", SER, { kind: "logistics" }), p("Paraffina 58/60", SER)]);
    expect(a.totals.analysed).toBe(1);
  });
});

describe("80/20", () => {
  it("counts how many products, largest first, make up half, 80% and 90% of the spend", () => {
    const spends = [500, 300, 100, 50, 50];
    const a = mapCatalogue(spends.map((spend, i) => p(`Paraffina ${50 + i}/${52 + i}`, SER, { spend })));
    expect(a.pareto).toEqual([
      { share: 0.5, products: 1, reached: 0.5 },
      { share: 0.8, products: 2, reached: 0.8 },
      { share: 0.9, products: 3, reached: 0.9 },
    ]);
    expect(mapCatalogue([]).pareto.map((x) => x.products)).toEqual([0, 0, 0]);
  });
});

describe("the search box", () => {
  const suppliers = [SER, MONTE, { id: "vetro", name: "VETRO DUE s.r.l." }];
  const q = (text: string) => parseProductQuery(text, suppliers, (x) => `€${x}`);

  it("understands a supplier, a spend threshold and single sourcing", () => {
    expect(q("prodotti SER")).toMatchObject({ supplierIds: ["ser"], words: [], understood: ["Supplier: SER S.p.A."] });
    expect(q("prodotti sopra €10k")).toMatchObject({ minSpend: 10_000, words: [], understood: ["Spend over €10000"] });
    expect(q("over 10,000")).toMatchObject({ minSpend: 10_000 });
    expect(q("sotto 2,5k")).toMatchObject({ maxSpend: 2500 });
    expect(q("prodotti con unico fornitore")).toMatchObject({ singleSource: true, words: [] });
    expect(q("paraffina SER sopra 100.000")).toMatchObject({ supplierIds: ["ser"], minSpend: 100_000, words: ["paraffin"] });
  });

  it("finds a word in any of its forms, and keeps a kind of product apart from a supplier's name", () => {
    expect(q("stoppini").words).toEqual(["stoppin"]);
    expect(matchesWords(q("stoppini").words, "Stoppino legno NF 19.1x128")).toBe(true);
    expect(matchesWords(q("stoppini").words, "Trecciolino TG 1204", "Stoppini")).toBe(true);
    expect(matchesWords(q("stoppini").words, "Paraffina 52/54")).toBe(false);
    // "vetro" is what one buys, even if a supplier is called Vetro Due.
    expect(q("vetro")).toMatchObject({ supplierIds: [], words: ["vetr"] });
    expect(q("")).toMatchObject({ words: [], understood: [] });
  });
});
