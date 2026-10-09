/**
 * One supplier, one day, two prices: two products — in the catalogue, in the
 * proposals and in an import. Mock suppliers and products, used only here.
 */
import { describe, expect, it } from "vitest";
import { keepApart } from "../import/match/apart";
import type { MatchResult } from "../import/match";
import { boughtSameDay, pairKey } from "./apart";
import { macroGroups, type MacroItem } from "./macro";
import { mapCatalogue, type MapInput } from "./mapper";
import { proposeProducts, type CatalogLine } from "./propose";

const line = (productId: string, date: string, price: number, supplierId = "mock") => ({ productId, supplierId, date, price });

describe("what an invoice says about two similar names", () => {
  it("billed by one supplier on one day at two prices: two products", () => {
    const found = boughtSameDay([line("a", "2026-07-31", 0.1423), line("b", "2026-07-31", 0.1543)]);
    expect(found.get(pairKey("a", "b"))).toEqual({ date: "2026-07-31", low: 0.1423, high: 0.1543, different: true });
  });

  it("the same price, another day or another supplier prove nothing of the kind", () => {
    expect(boughtSameDay([line("a", "2026-07-31", 0.0752), line("b", "2026-07-31", 0.0752)]).get(pairKey("a", "b"))).toMatchObject({ different: false });
    // One price written with more decimals is one price.
    expect(boughtSameDay([line("a", "2026-07-31", 0.0943), line("b", "2026-07-31", 0.094309)]).get(pairKey("a", "b"))).toMatchObject({ different: false });
    expect(boughtSameDay([line("a", "2026-06-30", 0.14), line("b", "2026-07-31", 0.15)]).size).toBe(0);
    expect(boughtSameDay([line("a", "2026-07-31", 0.14), line("b", "2026-07-31", 0.15, "other")]).size).toBe(0);
  });

  it("one day at different prices is enough, whatever the other days say", () => {
    const found = boughtSameDay([line("a", "2026-06-30", 0.14), line("b", "2026-06-30", 0.15), line("a", "2026-07-31", 0.15), line("b", "2026-07-31", 0.15)]);
    expect(found.get(pairKey("a", "b"))).toMatchObject({ date: "2026-06-30", different: true });
  });
});

describe("in the catalogue", () => {
  let k = 0;
  const mock = { id: "mock", name: "Mock Plast Srl" };
  const p = (name: string, price: number, date: string): MapInput => ({ id: `a${++k}`, name, kind: "component", unit: "pcs", mapped: false, category: null, subcategory: null, family: null, variant: null, suppliers: [mock], aliases: [{ text: name, supplierId: mock.id, supplierSku: null, ean: null }], spend: 100, price, days: [{ supplierId: mock.id, date, price }] });

  it("two names that would pass for one product are not proposed as one", () => {
    // The same words in another order: a possible duplicate — unless the supplier billed both on one day at two prices.
    expect(mapCatalogue([p("CONT LC TR 30", 0.075, "2026-07-31"), p("LC TR CONTENITORE 30 CL", 0.075, "2026-07-31")]).duplicates).toHaveLength(1);
    expect(mapCatalogue([p("CONT LC TR 30", 0.075, "2026-06-30"), p("LC TR CONTENITORE 30 CL", 0.082, "2026-07-31")]).duplicates).toHaveLength(1);
    expect(mapCatalogue([p("CONT LC TR 30", 0.075, "2026-07-31"), p("LC TR CONTENITORE 30 CL", 0.082, "2026-07-31")]).duplicates).toEqual([]);
  });

  it("they can be versions of one product, never the same one: merging is not offered", () => {
    const item = (id: string, name: string, price: number): MacroItem => ({ id, name, family: "Contenitori per ceri", scope: "mock|pcs|containers", supplierId: "mock", supplierName: "Mock Plast Srl", unit: "pcs", price, spend: 100 });
    const items = [item("base", "Contenitori per ceri LAMPADE", 0.1423), item("tr", "Contenitori per ceri LAMPADE TR", 0.1543)];
    const [free] = macroGroups(items);
    expect(free).toMatchObject({ mergeable: true, sameDay: null });
    const [g] = macroGroups(items, { sameDay: boughtSameDay([line("base", "2026-07-31", 0.1423), line("tr", "2026-07-31", 0.1543)]) });
    expect(g).toMatchObject({ mergeable: false, suggestion: "variants", sameDay: { different: true } });
    expect(g.reason).toMatch(/same day at different prices \(31\/07\/2026/);
    // At one price they are still two lines the supplier wrote: said, and merging stays the user's call.
    const [same] = macroGroups([item("x", "Contenitori per ceri LC", 0.0752), item("y", "Contenitori per ceri LC TR", 0.0752)], { sameDay: boughtSameDay([line("x", "2026-07-31", 0.0752), line("y", "2026-07-31", 0.0752)]) });
    expect(same).toMatchObject({ mergeable: true, suggestion: "variants" });
    expect(same.reason).toMatch(/separate lines on the same day/);
  });
});

describe("in an import", () => {
  const match = (status: MatchResult["status"], reason: MatchResult["reason"]): MatchResult => ({ status, id: "lampade", confidence: status === "exact" ? 1 : 0.9, reason, alternatives: [] });
  const row = (description: string, unitPrice: number, m: MatchResult, extra: { date?: string; productResolution?: string | null } = {}) => ({
    supplierId: "mock",
    productId: m.status === "exact" ? m.id : null,
    productMatch: m,
    productResolution: extra.productResolution === undefined ? (m.status === "exact" ? "auto" : null) : extra.productResolution,
    data: { date: extra.date ?? "2026-07-31", unitPrice, description },
  });
  const known = match("exact", "Recognised from a previous confirmation");
  const alike = match("probable", "Looks like a product you already have: the same thing in the same grade, described with other words");

  it("a line that only resembles a product does not join it at another price on the same day", () => {
    const [a, b] = keepApart([row("LAMPADE Contenitori per ceri", 0.1423, known), row("LAMPADE TR. Contenitori per ceri", 0.1543, alike)]);
    expect(a).toMatchObject({ productId: "lampade" });
    expect(b).toMatchObject({ productId: null, productMatch: { status: "none", reason: expect.stringContaining("two lines at two prices are two products") } });
  });

  it("the same price, another day, the same description or the user's own choice are left alone", () => {
    const untouched = (rows: ReturnType<typeof row>[]) => expect(keepApart(rows)).toEqual(rows);
    untouched([row("LAMPADE Contenitori per ceri", 0.1423, known), row("LAMPADE TR. Contenitori per ceri", 0.1423, alike)]);
    untouched([row("LAMPADE Contenitori per ceri", 0.1423, known), row("LAMPADE TR. Contenitori per ceri", 0.1543, alike, { date: "2026-08-31" })]);
    untouched([row("LAMPADE Contenitori per ceri", 0.1423, known), row("LAMPADE Contenitori per ceri", 0.15, known)]);
    untouched([row("LAMPADE Contenitori per ceri", 0.1423, known), row("LAMPADE TR. Contenitori per ceri", 0.1543, known, { productResolution: "existing" })]);
  });

  it("new descriptions billed on one day at two prices are never put together as one new product", () => {
    let n = 0;
    const l = (text: string, unitPrice: number, date: string): CatalogLine => ({ id: String(++n), supplierId: "mock", supplierName: "Mock Plast Srl", text, supplierSku: "LAMP", unit: "pcs", unitPrice, amount: 100, date });
    // The same supplier code and the same sizes would make them one product for sure.
    expect(proposeProducts([l("Contenitori LAMPADE", 0.1423, "2026-06-30"), l("Contenitori LAMPADE TR", 0.1423, "2026-07-31")]).confident).toHaveLength(1);
    const apart = proposeProducts([l("Contenitori LAMPADE", 0.1423, "2026-07-31"), l("Contenitori LAMPADE TR", 0.1543, "2026-07-31")]);
    expect(apart.confident).toHaveLength(2);
    expect(apart.questions).toEqual([]);
  });
});
