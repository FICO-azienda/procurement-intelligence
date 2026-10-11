/**
 * A market directory: research files read strictly, companies never
 * duplicated, filters that add up. Generic companies: no buyer's data is assumed.
 */
import { describe, expect, it } from "vitest";
import { countryName } from "../countries";
import { NO_LINKS, facets, filterSuppliers, isMatch, pageOf, type Row } from "./filter";
import { continentOf, isOem, parseMarketFile, sameCompany, statusRank } from "./types";

const file = (suppliers: unknown[], more: Record<string, unknown> = {}) => JSON.stringify({ kind: "market_suppliers", market: "plastic_candle_containers", researchedAt: "2026-10-11", source: "test", suppliers, ...more });
const entry = { name: "Tube Works sp. z o.o.", country: "Poland", role: "manufacturer", status: "manufacturer_confirmed", evidenceUrl: "https://tubeworks.example/products", materials: ["PP"], technologies: ["injection"], productTypes: ["votive_container"] };

describe("a research file", () => {
  it("is read with what it states, and nothing else", () => {
    const r = parseMarketFile(file([entry]));
    expect(r.ok && r.file.suppliers[0]).toMatchObject({ name: "Tube Works sp. z o.o.", role: "manufacturer", materials: ["PP"], checkedAt: "2026-10-11" });
    expect(r.ok && r.file.suppliers[0].email).toBeUndefined();
    expect(r.ok && r.file.coverage).toEqual({ countries: [], gaps: [], leads: [] });
  });

  it("keeps no company without the page that shows it", () => {
    const r = parseMarketFile(file([{ ...entry, evidenceUrl: undefined }, entry]));
    expect(r.ok && r.file.suppliers).toHaveLength(1);
    expect(r.ok && r.file.rejected).toMatchObject([{ name: "Tube Works sp. z o.o." }]);
  });

  it("never takes from research a status only the user can record", () => {
    const r = parseMarketFile(file([{ ...entry, status: "quote_received" }, { ...entry, name: "B", status: "technically_validated" }]));
    expect(r.ok && r.file.suppliers).toHaveLength(0);
    expect(r.ok && r.file.rejected).toHaveLength(2);
  });

  it("refuses what is not a file of this kind", () => {
    expect(parseMarketFile("not json")).toEqual({ ok: false, error: "not_json" });
    expect(parseMarketFile(JSON.stringify({ candidates: [] })).ok).toBe(false);
  });

  it("carries its coverage: countries, depth, gaps and the names not verified", () => {
    const r = parseMarketFile(file([], { coverage: { countries: [{ country: "Poland", depth: "deep", queries: ["producent tub"], sources: [] }, { country: "Chile", depth: "todo" }], gaps: ["directories not read"], leads: [{ name: "Maybe Ltd", where: "a directory" }] } }));
    expect(r.ok && r.file.coverage.countries.map((c) => [c.country, c.depth])).toEqual([["Poland", "deep"], ["Chile", "todo"]]);
    expect(r.ok && r.file.coverage.leads[0].name).toBe("Maybe Ltd");
  });
});

describe("the same company", () => {
  it("is one by its site, whatever name it trades under", () => {
    expect(sameCompany({ name: "Tube Works", website: "https://www.tubeworks.example/" }, { name: "TW Plastics Group", website: "http://tubeworks.example/en" })).toBe(true);
    expect(sameCompany({ name: "Tube Works", website: "https://tubeworks.example" }, { name: "Tube Works", website: "https://other.example" })).toBe(false);
  });

  it("is one by its name when a site is missing, legal forms apart", () => {
    expect(sameCompany({ name: "Tube Works sp. z o.o." }, { name: "TUBE WORKS", website: "https://tubeworks.example" })).toBe(true);
    expect(sameCompany({ name: "Tube Works" }, { name: "Cup Works" })).toBe(false);
  });
});

const s = (id: string, more: Partial<Row>): Row => ({ id, market: "plastic_candle_containers", name: id, tradeName: null, country: "Poland", city: null, website: null, email: null, phone: null, role: "manufacturer", status: "manufacturer_confirmed", materials: [], technologies: [], productTypes: [], profile: {}, evidenceUrl: "https://x.example", sourceLevel: "supplier_official", checkedAt: null, links: NO_LINKS, ...more });
const ROWS: Row[] = [
  s("Alfa Tubes", { materials: ["PP", "PVC"], technologies: ["blow"], productTypes: ["votive_container"], status: "technical_match_to_review", email: "a@alfa.example", profile: { products: "tubes for grave lights, 120 models" } }),
  s("Beta Mould", { country: "Italy", role: "contract_moulder", technologies: ["injection"], productTypes: ["custom"], status: "discovered" }),
  s("Gamma Cups", { country: "Germany", materials: ["PC"], productTypes: ["tealight_cup"], status: "manufacturer_confirmed", email: "g@gamma.example", profile: { oem: true, products: "tealight cups" } }),
  s("Delta Trade", { country: "China", role: "distributor", status: "evidence_found", productTypes: ["tealight_cup"] }),
  s("Epsilon Wax", { role: "candle_maker", status: "evidence_found", links: { current: true, candidateFor: [], rfq: "contacted" } }),
];
const names = (q: Parameters<typeof filterSuppliers>[1]) => filterSuppliers(ROWS, q).map((x) => x.name);

describe("the filters", () => {
  it("with none, list everything: the furthest along first, makers before the others", () => {
    expect(names({})).toEqual(["Alfa Tubes", "Gamma Cups", "Delta Trade", "Epsilon Wax", "Beta Mould"]);
  });

  it("narrow by continent and by country, in either language", () => {
    expect(names({ continent: "Europe" })).toHaveLength(4);
    expect(names({ continent: "Asia" })).toEqual(["Delta Trade"]);
    expect(names({ country: "Italia" })).toEqual(["Beta Mould"]);
  });

  it("tell makers, those who make to a drawing and resellers apart", () => {
    expect(names({ role: "maker" })).toEqual(["Alfa Tubes", "Gamma Cups"]);
    expect(names({ role: "oem" })).toEqual(["Gamma Cups", "Beta Mould"]);
    expect(names({ role: "reseller" })).toEqual(["Delta Trade"]);
    expect(names({ role: "candle_maker" })).toEqual(["Epsilon Wax"]);
  });

  it("narrow by material, kind of container, technology and status", () => {
    expect(names({ material: "pvc" })).toEqual(["Alfa Tubes"]);
    expect(names({ type: "tealight_cup" })).toEqual(["Gamma Cups", "Delta Trade"]);
    expect(names({ technology: "injection" })).toEqual(["Beta Mould"]);
    expect(names({ status: "evidence_found" })).toEqual(["Delta Trade", "Epsilon Wax"]);
  });

  it("narrow by whether there is an address to write to, a possible match, a request sent", () => {
    expect(names({ email: "yes" })).toEqual(["Alfa Tubes", "Gamma Cups"]);
    expect(names({ email: "no" })).toHaveLength(3);
    expect(names({ match: "yes" })).toEqual(["Alfa Tubes"]);
    expect(names({ rfq: "contacted" })).toEqual(["Epsilon Wax"]);
  });

  it("add up, each one its own", () => {
    expect(names({ continent: "Europe", email: "yes", material: "PC" })).toEqual(["Gamma Cups"]);
    expect(names({ continent: "Asia", role: "maker" })).toEqual([]);
  });

  it("search names and products, with a letter wrong forgiven", () => {
    expect(names({ q: "gamma" })).toEqual(["Gamma Cups"]);
    expect(names({ q: "tubes grave" })).toEqual(["Alfa Tubes"]);
    expect(names({ q: "tealigth" })).toEqual(["Gamma Cups"]);
    expect(names({ q: "zzz" })).toEqual([]);
  });

  it("offer only what is on file, with how many it leaves", () => {
    const f = facets(ROWS);
    expect(f.continents).toEqual([["Europe", 4], ["Asia", 1]]);
    expect(f.materials).toEqual([["PC", 1], ["PP", 1], ["PVC", 1]]);
    expect(f).toMatchObject({ withEmail: 2, makers: 2, oem: 2, resellers: 1, matches: 1 });
    expect(f.statuses[0][0]).toBe("technical_match_to_review");
  });
});

describe("small things the directory relies on", () => {
  it("pages of a fixed size, never past the last", () => {
    const rows = Array.from({ length: 60 }, (_, i) => i);
    expect(pageOf(rows, 1).rows).toHaveLength(25);
    expect(pageOf(rows, 3)).toMatchObject({ page: 3, pages: 3 });
    expect(pageOf(rows, 3).rows).toHaveLength(10);
    expect(pageOf(rows, 99).page).toBe(3);
    expect(pageOf([], 1)).toMatchObject({ page: 1, pages: 1, rows: [] });
  });

  it("the continent of a country, however it is written", () => {
    expect(continentOf("Italia")).toBe("Europe");
    expect(continentOf("China")).toBe("Asia");
    expect(continentOf("Stati Uniti")).toBe("Americas");
    // A country named in Italian is the same place: every country a coverage lists has both names.
    expect(continentOf("Messico")).toBe("Americas");
    expect(continentOf("Giappone")).toBe("Asia");
    expect(countryName("South Africa", "it")).toBe("Sudafrica");
    expect(continentOf("Atlantis")).toBeNull();
    expect(continentOf(null)).toBeNull();
  });

  it("who could make to a drawing, and from which status a match is worth a look", () => {
    expect(isOem({ role: "contract_moulder" })).toBe(true);
    expect(isOem({ role: "manufacturer", profile: { oem: true } })).toBe(true);
    expect(isOem({ role: "manufacturer", profile: {} })).toBe(false);
    expect(isMatch({ status: "technical_match_to_review" })).toBe(true);
    expect(isMatch({ status: "manufacturer_confirmed" })).toBe(false);
    expect(statusRank("quote_received")).toBeGreaterThan(statusRank("rfq_ready"));
  });
});
