/**
 * Macro product and variants: articles that are versions of one product are
 * proposed together, with the evidence — and nothing is grouped on a price
 * alone or by itself. Mock suppliers and products, used only here.
 */
import { describe, expect, it } from "vitest";
import { macroGroups, nameTokens, variantOf, type MacroItem } from "./macro";
import { mapCatalogue, type MapInput } from "./mapper";

let n = 0;
const item = (name: string, price: number | null, extra: Partial<MacroItem> = {}): MacroItem => ({ id: `m${++n}`, name, family: null, scope: "mock|pcs|containers", supplierId: "mock", supplierName: "Mock Plast Srl", unit: "pcs", price, spend: 100, ...extra });
const keys = (name: string, family: string | null = null) => nameTokens(name, family).map((x) => x.key);

describe("a name, word by word", () => {
  it("is read one way however the document spaced it", () => {
    expect(keys("Contenitori per ceri 60L BLU")).toEqual(keys("Contenitori per ceri 60 L BLU"));
    expect(keys("Contenitori per ceri LC1 A B V")).toEqual(keys("Contenitori per ceri LC 1 A B V"));
    expect(keys("Contenitori per ceri 5.50BLU")).toEqual(["contenitori", "per", "ceri", "5.50", "blu"]);
    // One letter stuck to a number is the model's own name; a size stays whole.
    expect(keys("Articolo 20T 15.9x65 MM")).toEqual(["articolo", "20t", "15.9x65", "mm"]);
    expect(keys("LAMPADE TR. Contenitori per ceri", "Contenitori per ceri")).toEqual(["contenitori", "per", "ceri", "lampade", "tr"]);
  });
});

describe("versions of one product", () => {
  it("a colour or a capacity written in full: one macro product, each version its own product", () => {
    const [glass] = macroGroups([item("Vetro votivo Rosso", 0.2), item("Vetro votivo Trasparente", 0.2)]);
    expect(glass).toMatchObject({ name: "Vetro votivo", differs: "colour", differsSure: true, suggestion: "variants", confidence: "high", samePrice: true });
    expect(glass.members.map((m) => m.variant).sort()).toEqual(["Rosso", "Trasparente"]);
    const [jar] = macroGroups([item("Contenitore LC TR 30 cl", 0.07), item("Contenitore LC TR 50 cl", 0.11)]);
    expect(jar).toMatchObject({ name: "Contenitore LC TR", differs: "capacity", differsSure: true, samePrice: false });
    expect(jar.members.map((m) => m.variant).sort()).toEqual(["30 cl", "50 cl"]);
  });

  it("abbreviations are read only as far as something says: one written in full, or the same ending on other articles", () => {
    const groups = macroGroups([
      item("Contenitori per ceri 30/2", 0.072, { family: "Contenitori per ceri" }),
      item("Contenitori per ceri 30/2 TR", 0.082, { family: "Contenitori per ceri" }),
      item("Contenitori per ceri 30/2 Bi", 0.088, { family: "Contenitori per ceri" }),
      item("Contenitori per ceri 30/2 BLU", 0.094, { family: "Contenitori per ceri" }),
      item("Contenitori per ceri 50/2", 0.1, { family: "Contenitori per ceri" }),
      item("Contenitori per ceri 50/2 TR", 0.11, { family: "Contenitori per ceri" }),
      item("Contenitori per ceri 90 C", 0.17, { family: "Contenitori per ceri" }),
    ]);
    expect(groups.map((g) => g.name).sort()).toEqual(["Contenitori per ceri 30/2", "Contenitori per ceri 50/2"]);
    const [a, b] = ["Contenitori per ceri 30/2", "Contenitori per ceri 50/2"].map((name) => groups.find((g) => g.name === name)!);
    // "BLU" is a colour; TR and Bi next to it probably are: said as a reading, not as a fact.
    expect(a).toMatchObject({ differs: "colour", differsSure: false, suggestion: "variants", confidence: "medium" });
    expect(a.members.map((m) => m.variant)).toEqual(expect.arrayContaining([null, "TR", "Bi", "BLU"]));
    expect(a.reason).toMatch(/“BLU” says so/);
    // TR alone says nothing — but the supplier uses it next to a colour elsewhere.
    expect(b).toMatchObject({ differs: "colour", differsSure: false, suggestion: "variants" });
  });

  it("nothing readable and one price: the user is asked, nothing is suggested", () => {
    const [g] = macroGroups([item("Tealight Mock 30x12", 9, { unit: "box" }), item("Tealight Mock Best Choice 30x12", 9, { unit: "box" })]);
    expect(g).toMatchObject({ name: "Tealight Mock 30x12", differs: null, suggestion: null, confidence: "low", samePrice: true });
    expect(g.members.map((m) => m.variant).sort()).toEqual(["Best Choice", null].sort());
    expect(g.reason).toMatch(/only you can tell/);
  });
});

describe("what is never grouped", () => {
  it("the same price alone ties nothing: a glass and a lid are two products", () => {
    expect(macroGroups([item("Contenitore vetro 10", 0.1), item("Coperchio plastica 10", 0.1)])).toEqual([]);
  });

  it("another supplier, another unit or another family are not compared at all", () => {
    expect(macroGroups([item("Vetro votivo Rosso", 0.2), item("Vetro votivo Blu", 0.2, { scope: "other|pcs|containers", supplierId: "other" })])).toEqual([]);
    expect(macroGroups([item("Vetro votivo Rosso", 0.2), item("Vetro votivo Blu", 2.4, { scope: "mock|box|containers", unit: "box" })])).toEqual([]);
  });

  it("names that differ by more than a word or two are different products", () => {
    expect(macroGroups([item("Etichetta 65x55 Grotta di Lourdes Madonna sullo sfondo", 0.016), item("Etichetta 65x55 Grotta di Lourdes Madonna in primo piano", 0.016)])).toEqual([]);
    // What a family already says is not enough of a beginning: two sizes of a range are not asked about.
    expect(macroGroups([item("Contenitori per ceri 7.50 TR", 0.03, { family: "Contenitori per ceri" }), item("Contenitori per ceri 90 C", 0.17, { family: "Contenitori per ceri" })])).toEqual([]);
  });

  it("a price far from the others is another thing with a similar name: left out, and said", () => {
    const [g] = macroGroups([item("Contenitori LC", 0.075), item("Contenitori LC TR", 0.075), item("Contenitori LC ELET", 1.47)]);
    expect(g.members.map((m) => m.name)).toEqual(expect.arrayContaining(["Contenitori LC", "Contenitori LC TR"]));
    expect(g.members).toHaveLength(2);
    expect(g.leftOut.map((m) => m.name)).toEqual(["Contenitori LC ELET"]);
  });

  it("what the user decided is not asked again — and a new version is proposed next to the ones already filed", () => {
    const red = item("Vetro votivo Rosso", 0.2);
    const clear = item("Vetro votivo Trasparente", 0.2);
    expect(macroGroups([red, clear], { separated: new Set([[red.id, clear.id].sort().join("|")]) })).toEqual([]);
    const filed = [red, clear].map((x) => ({ ...x, family: "Vetro votivo", filed: true }));
    expect(macroGroups(filed)).toEqual([]);
    const [g] = macroGroups([...filed, item("Vetro votivo Blu", 0.2)], { separated: new Set([[red.id, clear.id].sort().join("|")]) });
    expect(g.members).toHaveLength(3);
  });

  it("what is left of a name once the macro product is taken out is the variant", () => {
    expect(variantOf("Contenitori per ceri 60L BLU", "Contenitori per ceri 60 L")).toBe("BLU");
    expect(variantOf("Vetro votivo", "Vetro votivo")).toBeNull();
  });
});

describe("one product written in several ways", () => {
  let k = 0;
  const mock = { id: "mock", name: "Mock Plast Srl" };
  const p = (name: string, price: number, extra: Partial<MapInput> = {}): MapInput => ({ id: `d${++k}`, name, kind: "component", unit: "pcs", mapped: false, category: null, subcategory: null, family: null, variant: null, suppliers: [mock], aliases: [{ text: name, supplierId: mock.id, supplierSku: null, ean: null }], spend: 100, price, ...extra });

  it("the order of the words, a unit left out and an abbreviation do not make another product", () => {
    const a = p("CONT LC TR 30", 0.075);
    const b = p("LC TR CONTENITORE 30 CL", 0.075);
    const c = p("ART. LC TR CONTENITORE 30", 0.075);
    const d = mapCatalogue([a, b, c]).duplicates;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ level: "possible", suggestion: "merge", reason: "The same words and sizes, in another order or abbreviated" });
    expect([...d[0].productIds].sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("the same numbers in another order are another size, and one more letter is another article", () => {
    expect(mapCatalogue([p("Candela altare Ø 20x500 mm 30 pz", 4.25), p("Candela altare Ø 30x500 mm 20 pz", 4.25)]).duplicates).toEqual([]);
    expect(mapCatalogue([p("Scatola americana C5 399x329x219", 0.38), p("Scatola americana C5A 399x329x219", 0.38)]).duplicates).toEqual([]);
    expect(mapCatalogue([p("Contenitore LC TR 30", 0.075), p("Contenitore LC A B V 30", 0.075)]).duplicates).toEqual([]);
  });

  it("the same words at another price are asked about, not suggested as one", () => {
    const d = mapCatalogue([p("CONT LC TR 30", 0.075), p("LC TR CONTENITORE 30 CL", 0.12)]).duplicates;
    expect(d).toMatchObject([{ suggestion: null }]);
  });
});
