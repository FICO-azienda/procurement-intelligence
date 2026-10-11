/**
 * Finding a product while typing: by name, by code, by any way a document
 * wrote it, with capitals, accents and a wrong letter forgiven — and numbers
 * never read with a digit wrong.
 */
import { describe, expect, it } from "vitest";
import { editDistance, findNames, findProducts, type Findable } from "./find";

const ITEMS: Findable[] = [
  { id: "p5254", name: "Paraffin 52/54", code: "PRP026", terms: ["PARAFFINA ACME 52/54 (XXF)"], spend: 400 },
  { id: "p5860", name: "Paraffin 58/60", code: "PRP030", terms: ["PARAFFINA ACME 58/60"], spend: 90 },
  { id: "blend", name: "Wax blend 14581", code: null, terms: ["WAX ACME 14581 (FXF)"], spend: 30 },
  { id: "natural", name: "Natural Wax N.2", code: "CNP026A", terms: [], spend: 3 },
  { id: "glass", name: "Glass ASSO 100", code: null, terms: ["BICCH. ASSO100 CL 10"], spend: 3 },
  { id: "tumbler", name: "Bicchiere City 185", code: null, terms: [], spend: 1 },
  { id: "wick", name: "Braided wick TG 1206", code: "PFTRTG1206", terms: ["* TRECCIOLINO TG 1206"], spend: 1 },
  { id: "wick2", name: "Braided wick TG 1506", code: "PFTRTG1506", terms: [], spend: 1 },
  { id: "lc1", name: "Container LC 1 TR", code: null, terms: ["ART. LC1 TR. Contenitori"], spend: 9 },
  { id: "label", name: "Étiquette café 50x70", code: null, terms: [], spend: 2 },
  { id: "holder", name: "Candle holders", code: null, terms: ["CONTENITORI PER CERI"], spend: 0 },
];
const ids = (query: string) => findProducts(ITEMS, query).map((x) => x.item.id);

describe("finding a product", () => {
  it("nothing typed finds nothing", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
  });

  it("finds a grade as written, and only that grade", () => {
    expect(ids("52/54")).toEqual(["p5254"]);
    expect(ids("52 54")).toEqual(["p5254"]);
    expect(ids("58/60")).toEqual(["p5860"]);
  });

  it("never reads a number with a digit wrong", () => {
    expect(ids("53/54")).toEqual([]);
    expect(ids("14582")).toEqual([]);
  });

  it("capitals and accents do not matter", () => {
    expect(ids("PARAFFIN 52")).toEqual(["p5254"]);
    expect(ids("etiquette cafe")).toEqual(["label"]);
  });

  it("finds by the beginning of a word, as it is typed", () => {
    expect(ids("paraf")).toEqual(["p5254", "p5860"]);
    expect(ids("brai tg 15")).toEqual(["wick2"]);
  });

  it("finds a product by how an invoice wrote it, and says so", () => {
    const found = findProducts(ITEMS, "wax");
    expect(found.map((x) => x.item.id)).toEqual(["blend", "natural"]);
    expect(found.every((x) => x.via === null)).toBe(true);
    const billed = findProducts(ITEMS, "trecciolino")[0];
    expect(billed.item.id).toBe("wick");
    expect(billed.via).toBe("* TRECCIOLINO TG 1206");
  });

  it("puts what is in the name before what is only in a document", () => {
    // "paraffina" is how the invoices write both paraffins; nothing is called that.
    expect(ids("acme")).toEqual(["p5254", "p5860", "blend"]);
    expect(findProducts(ITEMS, "contenitori")[0].item.id).toBe("lc1");
  });

  it("finds by the supplier's code, whole or from its beginning", () => {
    expect(ids("CNP026A")).toEqual(["natural"]);
    expect(findProducts(ITEMS, "cnp026a")[0].via).toBe("CNP026A");
    expect(ids("pftrtg15")).toEqual(["wick2"]);
  });

  it("reads a word a document cut short", () => {
    expect(ids("bicchiere")).toEqual(["tumbler", "glass"]);
  });

  it("written together or apart, it is the same", () => {
    expect(ids("tg1206")).toEqual(["wick"]);
    expect(ids("lc1")).toEqual(["lc1"]);
    expect(ids("lc 1")).toEqual(["lc1"]);
  });

  it("forgives a wrong letter, a missing one, two swapped", () => {
    expect(ids("parafin")).toEqual(["p5254", "p5860"]);
    expect(ids("parrafin")).toEqual(["p5254", "p5860"]);
    expect(ids("braidde")).toEqual(["wick", "wick2"]);
  });

  it("shows what is found as typed, and guesses only when nothing is", () => {
    // "wick" is a word of two names: "wack"-like guesses are not added to them.
    expect(ids("wick")).toEqual(["wick", "wick2"]);
    // Nothing is called "wicc": the nearest words are offered.
    expect(ids("wicc")).toEqual(["wick", "wick2"]);
  });

  it("every word typed must be found", () => {
    expect(ids("paraffin 1206")).toEqual([]);
    expect(ids("zzz")).toEqual([]);
  });

  it("between equals, the one bought most comes first", () => {
    expect(ids("paraffin")).toEqual(["p5254", "p5860"]);
  });
});

describe("naming a category", () => {
  const nodes = [{ name: "Waxes and paraffin" }, { name: "Packaging" }, { name: "Labels and printing" }, { name: "Paraffin" }];
  const names = (query: string) => findNames(nodes, query).map((n) => n.name);

  it("by the beginning of its words, or nearly", () => {
    expect(names("pack")).toEqual(["Packaging"]);
    expect(names("paraf")).toEqual(["Paraffin", "Waxes and paraffin"]);
    expect(names("labells")).toEqual(["Labels and printing"]);
  });

  it("not by letters in the middle of a word", () => {
    expect(names("aging")).toEqual([]);
    expect(names("")).toEqual([]);
  });
});

describe("letters apart", () => {
  it("counts changes, additions, omissions and swaps", () => {
    expect(editDistance("paraffin", "paraffin")).toBe(0);
    expect(editDistance("parafin", "paraffin")).toBe(1);
    expect(editDistance("paraffni", "paraffin")).toBe(1);
    expect(editDistance("box", "bag")).toBe(2);
  });

  it("gives up early on words that are far apart", () => {
    expect(editDistance("wick", "container", 2)).toBe(3);
  });
});
