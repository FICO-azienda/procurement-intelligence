/**
 * One technical engine for offers and products: how two grades stand, and what the rules may propose. Invented items.
 */
import { describe, expect, it } from "vitest";
import { articleKey, compatibilityFromMemory, linkTypeOf } from "./articles";
import { gradeFit, rangesIn, technicalRelation, type TechnicalItem } from "./technical";

const item = (name: string, over: Partial<TechnicalItem> = {}): TechnicalItem => ({ id: name, name, unit: "kg", subKey: "paraffin", ...over });

describe("two grades", () => {
  it("are read as ranges a few units apart — never a percentage or a size", () => {
    expect(rangesIn("Mock paraffin 52/54")).toEqual([[52, 54]]);
    expect(rangesIn("0,8–1% oil")).toEqual([]);
    expect(rangesIn("Container 30/2")).toEqual([]);
  });
  it("the same, overlapping, apart, contradictory or unknown", () => {
    expect(gradeFit([[52, 54]], [[52, 54]]).fit).toBe("same");
    expect(gradeFit([[52, 54]], [[52, 56]]).fit).toBe("overlap");
    expect(gradeFit([[52, 54]], [[56, 58]]).fit).toBe("apart");
    expect(gradeFit([[52, 54]], [[51, 54], [58, 62]]).fit).toBe("contradictory");
    expect(gradeFit([], [[52, 54]]).fit).toBe("unknown");
  });
});

describe("what the rules may propose", () => {
  it("56/58 against 52/54 is the same family; 52–56 against 52–54 a possible equivalent; contradictory data say nothing", () => {
    expect(technicalRelation(item("Mock paraffin 52/54"), item("Fully refined mock 56/58"))?.relation).toBe("same_family");
    expect(technicalRelation(item("Mock paraffin 52/54"), item("Mock SNOW 1500", { declared: "52–56 °C" }))?.relation).toBe("possible_equivalent");
    expect(technicalRelation(item("Mock paraffin 52/54"), item("Mock TNJ", { declared: "51–54 °C table; 58–62 °C properties" }))).toMatchObject({ relation: null, fit: "contradictory" });
  });
  it("never across kinds of thing or units that do not convert, and never 'identical' — that only an invoice or a person says", () => {
    expect(technicalRelation(item("Mock paraffin 52/54"), item("Mock wick 52/54", { subKey: "wick" }))).toBeNull();
    expect(technicalRelation(item("Mock paraffin 52/54"), item("Mock paraffin 52/54 box", { unit: "box" }))).toBeNull();
    expect(technicalRelation(item("Mock paraffin 52/54"), item("Mock paraffin 52/54", { unit: "t" }))?.relation).toBe("possible_equivalent");
    // A similar name, or the very same name, is still only a proposal to verify.
    expect(technicalRelation(item("Mock paraffin 52/54"), item("Mock paraffin 52/54"))?.relation).not.toBe("identical");
  });
});

describe("an article and what was said of it", () => {
  it("is found again by its code, else by its name read the same way", () => {
    expect(articleKey(" PRP-026 ", "Paraffina")).toBe(articleKey("prp026", "Other name"));
    expect(articleKey(null, "PARAFFINA  52/54")).toBe(articleKey(null, "paraffina 52/54"));
  });
  it("remembers a person's word, and proposes it again on a new line — never validated by the app", () => {
    expect([linkTypeOf("validated"), linkTypeOf("possible"), linkTypeOf("sample_to_test"), linkTypeOf("not_equivalent"), linkTypeOf("not_analyzed"), linkTypeOf("awaiting_specs")]).toEqual(["equivalent_validated", "possible_equivalent", "possible_equivalent", "not_equivalent", null, null]);
    expect(compatibilityFromMemory("equivalent_validated")).toBe("possible");
    expect(compatibilityFromMemory("not_equivalent")).toBe("not_equivalent");
  });
});
