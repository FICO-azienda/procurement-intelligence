import { describe, expect, it } from "vitest";
import { parseSpecs, formatSpecs } from "../validation";
import { comparisonCsv, opportunitiesCsv, productsCsv, toCsv } from "./csv";
import { analyze } from "./engine";
import { filterProducts, quickFilters } from "./filters";
import { dataset, product, purchase, quote, supplier } from "./fixtures";

const AS_OF = "2026-10-01";

function portfolio() {
  const a = supplier({ name: "Alpha" });
  const b = supplier({ name: "Beta" });
  const up = product({ name: "Rising", category: "Wax", currentSupplierId: a.id });
  const down = product({ name: "Falling", category: "Glass", currentSupplierId: b.id });
  const flat = product({ name: "Flat", category: "Glass", currentSupplierId: a.id });
  const none = product({ name: "Empty", category: null });
  const purchases = [
    purchase({ productId: up.id, supplierId: a.id, date: "2026-01-10", quantity: 10000, unitPrice: 1.0 }),
    purchase({ productId: up.id, supplierId: a.id, date: "2026-09-10", quantity: 10000, unitPrice: 1.2 }),
    purchase({ productId: down.id, supplierId: b.id, date: "2026-02-10", quantity: 100, unitPrice: 5 }),
    purchase({ productId: down.id, supplierId: b.id, date: "2026-08-10", quantity: 100, unitPrice: 4.5 }),
    purchase({ productId: flat.id, supplierId: a.id, date: "2026-03-10", quantity: 10, unitPrice: 2 }),
    purchase({ productId: flat.id, supplierId: b.id, date: "2026-09-20", quantity: 10, unitPrice: 2 }),
  ];
  const quotes = [quote({ productId: up.id, supplierId: b.id, date: "2026-09-20", unitPrice: 1.1, moq: 5000 })];
  const data = dataset({ suppliers: [a, b], products: [up, down, flat, none], purchases, quotes });
  return { a, b, up, down, flat, none, data, intel: analyze(data, [], [], AS_OF) };
}

describe("product filters", () => {
  const { intel, a, up, down, flat, none } = portfolio();
  const names = (q: Parameters<typeof filterProducts>[1]) => filterProducts(intel.products, q).map((p) => p.product.name);

  it("answers the quick questions", () => {
    expect(names({ filters: ["up-moderate"] })).toEqual(["Rising"]);
    expect(names({ filters: ["up-high"] })).toEqual(["Rising"]);
    expect(names({ filters: ["down"] })).toEqual(["Falling"]);
    expect(names({ filters: ["saving"] })).toEqual(["Rising"]);
    expect(names({ filters: ["recent-quote"] })).toEqual(["Rising"]);
    expect(names({ filters: ["single-source"] }).sort()).toEqual(["Falling", "Rising"]);
    expect(names({ filters: ["multi-supplier"] }).sort()).toEqual(["Flat", "Rising"]);
    // "Flat" was last bought from its current supplier 205 days ago: its price needs a look.
    expect(names({ filters: ["review"] }).sort()).toEqual(["Empty", "Flat"]);
    expect(names({ filters: ["up-moderate", "down"] })).toEqual([]); // filters combine with AND
  });

  it("filters by supplier, category and text", () => {
    expect(names({ category: "glass" }).sort()).toEqual(["Falling", "Flat"]);
    expect(names({ search: "ris" })).toEqual(["Rising"]);
    expect(names({ supplierId: a.id }).sort()).toEqual(["Flat", "Rising"]);
  });

  it("sorts, with missing values last", () => {
    expect(names({ sort: "spend" })[0]).toBe("Rising");
    expect(names({ sort: "change" })).toEqual(["Rising", "Falling", "Empty", "Flat"]);
    expect(names({ sort: "saving" })[0]).toBe("Rising");
    expect(names({ sort: "name" })).toEqual(["Empty", "Falling", "Flat", "Rising"]);
    expect(names({ sort: "last" }).at(-1)).toBe("Empty");
  });

  it("labels quick filters from the config", () => {
    expect(quickFilters({ ...intel.config, alerts: { moderate: 7, high: 15, critical: 30 } })[0].label).toBe("Up >7%");
  });

  it("uses every product exactly once in the totals", () => {
    expect(intel.products.map((p) => p.product.id).sort()).toEqual([up.id, down.id, flat.id, none.id].sort());
  });
});

describe("CSV export", () => {
  it("writes Italian-Excel CSV: BOM, semicolons, decimal commas, quoted text", () => {
    const csv = toCsv(["Name", "Price"], [["A; B", 1.5], ['He said "hi"', null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"A; B";1,5');
    expect(csv).toContain('"He said ""hi""";');
  });

  it("exports products, opportunities and comparisons from the engine", () => {
    const { intel, data } = portfolio();
    const products = productsCsv(intel, data).split("\r\n");
    expect(products).toHaveLength(1 + 4 + 1);
    expect(products.find((l) => l.startsWith("Rising"))).toContain(";1,2;10/09/2026;1;20;");
    expect(opportunitiesCsv(intel, data)).toContain("Lower quote");
    const rising = intel.products.find((p) => p.product.name === "Rising")!;
    expect(comparisonCsv(rising).split("\r\n")[1]).toContain("Alpha;Italy;Current;purchase;1,2;EUR;1,2");
  });
});

describe("specifications", () => {
  it("parses name: value lines and ignores the rest", () => {
    expect(parseSpecs("capacity: 300 ml\nnot a spec\n weight : 210 g \n")).toEqual({ capacity: "300 ml", weight: "210 g" });
    expect(parseSpecs("")).toBeNull();
    expect(formatSpecs({ capacity: "300 ml", weight: "210 g" })).toBe("capacity: 300 ml\nweight: 210 g");
  });
});
