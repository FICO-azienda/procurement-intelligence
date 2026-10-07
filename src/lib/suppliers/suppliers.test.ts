/**
 * Supplier entity resolution on generic cases. "Mock Wax" and the others are
 * not real companies, and their VAT numbers are made up.
 */
import { describe, expect, it } from "vitest";
import { matchSupplier, type MatchContext } from "../import/match";
import { companyKey } from "../import/normalize/text";
import { automaticGroups, canonicalIds, compareSuppliers, domainOf, resolveSuppliers, type SupplierRecord } from "./resolve";

let n = 0;
const record = (name: string, over: Partial<SupplierRecord> = {}): SupplierRecord => ({ id: over.id ?? `s${++n}`, name, vatNumber: null, taxCode: null, website: null, email: null, phone: null, city: null, country: null, aliases: [], records: 0, createdAt: "2026-01-01T00:00:00.000Z", ...over });

describe("names", () => {
  it("reads every spelling of a company the same way", () => {
    for (const name of ["SER S.p.A.", "SER SPA", "S.E.R. S.p.A.", "SER S.P.A", "Ser Spa", "SER S P A", "S. E. R. S.p.A."]) expect(companyKey(name)).toBe("ser");
    expect(companyKey("B.F.M S.R.L")).toBe("bfm");
    expect(companyKey("OQEMA SpA Società con Socio Unico")).toBe("oqema");
    expect(companyKey("GRC Parfum S.p.A. Società Benefit")).toBe("grc parfum");
    expect(companyKey("Szkło Nova Sp. z o.o.")).toBe("szklo nova");
    // A different company keeps a different key.
    expect(companyKey("SER INDUSTRIES SPA")).toBe("ser industries");
  });

  it("takes a company's own web domain, never a mailbox anyone can have", () => {
    expect(domainOf({ website: "https://www.mock-wax.example/it/", email: null })).toBe("mock-wax.example");
    expect(domainOf({ website: null, email: "sales@mock-wax.example" })).toBe("mock-wax.example");
    expect(domainOf({ website: null, email: "mockwax@gmail.com" })).toBeNull();
    expect(domainOf({ website: null, email: "mockwax@pec.it" })).toBeNull();
  });
});

describe("the hierarchy", () => {
  it("the same VAT number is the same company, whatever the names — and needs no asking", () => {
    const m = compareSuppliers(record("SER SPA", { vatNumber: "05583420012" }), record("SER S.p.A.", { vatNumber: "IT 05583420012", records: 23 }))!;
    expect(m).toMatchObject({ confidence: "high", automatic: true, conflicts: [] });
    expect(m.basis).toEqual(["vat", "name"]);
    // Names that have nothing in common, the same VAT number: still one company.
    expect(compareSuppliers(record("Mock Wax S.p.A.", { vatNumber: "01234567890" }), record("Cereria Mock", { vatNumber: "01234567890" }))).toMatchObject({ confidence: "high", automatic: true, basis: ["vat"] });
  });

  it("a tax code counts like a VAT number, in whichever field it was written", () => {
    expect(compareSuppliers(record("Mock Wax", { taxCode: "01234567890" }), record("Mock Wax Srl", { vatNumber: "IT01234567890" }))).toMatchObject({ confidence: "high", automatic: true });
    expect(compareSuppliers(record("Rossi Mario", { taxCode: "RSSMRA80A01H501U" }), record("Mario Rossi ditta", { taxCode: "rssmra80a01h501u" }))).toMatchObject({ confidence: "high", automatic: true, basis: ["tax_code", "similar_name"] });
  });

  it("two different VAT numbers are two companies, even with the very same name", () => {
    const m = compareSuppliers(record("Mock Wax Srl", { vatNumber: "01234567890" }), record("MOCK WAX S.R.L.", { vatNumber: "09876543210" }))!;
    expect(m).toMatchObject({ confidence: "low", automatic: false });
    expect(m.conflicts[0]).toMatch(/Different VAT numbers/);
    // A similar name with another VAT number is not even worth showing.
    expect(compareSuppliers(record("Mock Wax Italia Srl", { vatNumber: "01234567890" }), record("Mock Wax Financial Services Italia Srl", { vatNumber: "09876543210" }))).toBeNull();
  });

  it("a shared domain decides alone only when the names agree", () => {
    const a = record("Mock Wax GmbH", { website: "mock-wax.example" });
    expect(compareSuppliers(a, record("MOCK WAX", { email: "info@mock-wax.example" }))).toMatchObject({ confidence: "high", automatic: true, basis: ["domain", "name"] });
    expect(compareSuppliers(a, record("Other Trading Ltd", { website: "www.mock-wax.example" }))).toMatchObject({ confidence: "medium", automatic: false, basis: ["domain"] });
  });

  it("the same name alone is a suggestion, never a merge", () => {
    expect(compareSuppliers(record("SER S.p.A."), record("S.E.R. S.p.A."))).toMatchObject({ confidence: "medium", automatic: false, basis: ["name"] });
    expect(compareSuppliers(record("Mock Wax Srl", { country: "Italy" }), record("Mock Wax Ltd", { country: "Turkey" }))).toMatchObject({ confidence: "low" });
    expect(compareSuppliers(record("Mock Wax Srl", { aliases: ["Cereria Mock"] }), record("Cereria Mock S.r.l."))).toMatchObject({ confidence: "medium", basis: ["alias"] });
  });

  it("a similar name is low confidence: listed, not proposed", () => {
    expect(compareSuppliers(record("SER SPA"), record("SER INDUSTRIES SPA"))).toMatchObject({ confidence: "low", automatic: false, basis: ["similar_name"] });
    expect(compareSuppliers(record("SER SPA", { phone: "+39 02 1234567" }), record("SER INDUSTRIES SPA", { phone: "02 1234567" }))).toMatchObject({ confidence: "medium", basis: ["similar_name", "phone"] });
    expect(compareSuppliers(record("Mock Wax"), record("Glassworks Ltd"))).toBeNull();
  });

  it("keeps the record a tax office would recognise, then the one more hangs on", () => {
    const [named, bare] = [record("SER S.p.A.", { vatNumber: "05583420012", records: 2 }), record("SER SPA", { records: 40 })];
    expect(compareSuppliers(bare, named)).toMatchObject({ keep: named.id, merge: bare.id });
    const [big, small] = [record("Mock Wax", { records: 30 }), record("MOCK WAX SRL", { records: 3 })];
    expect(compareSuppliers(small, big)).toMatchObject({ keep: big.id, merge: small.id });
  });
});

describe("what is merged, what is asked, what is remembered", () => {
  const a = record("Mock Wax S.p.A.", { id: "a", vatNumber: "01234567890", records: 10 });
  const b = record("MOCK WAX SPA", { id: "b", vatNumber: "01234567890", records: 2 });
  const c = record("Mock Wax Spa", { id: "c", records: 1 });
  const d = record("Mock Wax Industries SpA", { id: "d" });
  const all = [a, b, c, d];

  it("sorts every pair into automatic, to review, and weak", () => {
    const r = resolveSuppliers(all);
    expect(r.automatic.map((m) => [m.merge, m.keep])).toEqual([["b", "a"]]);
    expect(r.suggestions.map((m) => [m.merge, m.keep]).sort()).toEqual([["c", "a"], ["c", "b"]]);
    expect(r.suggestions.every((m) => m.confidence === "medium" && !m.automatic)).toBe(true);
    expect(r.weak.map((m) => m.basis[0])).toEqual(["similar_name", "similar_name", "similar_name"]);
  });

  it("does not propose again what the user kept apart, nor redo a merge the user took back", () => {
    expect(resolveSuppliers(all, [{ a: "c", b: "a", decision: "separate" }]).suggestions.map((m) => [m.merge, m.keep])).toEqual([["c", "b"]]);
    const undone = resolveSuppliers(all, [{ a: "b", b: "a", decision: "undone" }]);
    expect(undone.automatic).toEqual([]);
    expect(undone.suggestions.find((m) => m.merge === "b" && m.keep === "a")).toMatchObject({ confidence: "high", automatic: false });
  });

  it("three records of one company become one group, with the fullest record kept", () => {
    const e = record("Mock Wax Soc. per Azioni", { id: "e", vatNumber: "IT01234567890", records: 1 });
    const { automatic } = resolveSuppliers([a, b, e]);
    const groups = automaticGroups([a, b, e], automatic);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep).toBe("a");
    expect(groups[0].merge.map((x) => x.id).sort()).toEqual(["b", "e"]);
  });

  it("follows a merge to the record that stands for the company, and cuts a loop", () => {
    const canon = canonicalIds([
      { id: "a", mergedIntoId: null },
      { id: "b", mergedIntoId: "a" },
      { id: "c", mergedIntoId: "b" },
      { id: "x", mergedIntoId: "y" },
      { id: "y", mergedIntoId: "x" },
      { id: "z", mergedIntoId: "gone" },
    ]);
    expect([canon.get("a"), canon.get("b"), canon.get("c")]).toEqual(["a", "a", "a"]);
    expect(canon.get("z")).toBe("z");
    expect(["x", "y"]).toContain(canon.get("x"));
  });
});

describe("a name on a document being imported", () => {
  const ctx: MatchContext = {
    suppliers: [
      { id: "ser", name: "SER S.p.A.", vatNumber: "05583420012", taxCode: null },
      // A record merged into "ser": its name and VAT number lead to the company it is read as.
      { id: "ser", name: "SER Cere Srl", vatNumber: "01111111111", taxCode: "01111111111" },
      { id: "homonym", name: "Mock Wax Srl", vatNumber: "01234567890", taxCode: null },
    ],
    supplierAliases: [],
    products: [],
    productAliases: [],
    supplierProducts: [],
  };

  it("is tied by VAT number first, then tax code, whatever it is called", () => {
    expect(matchSupplier({ name: "S.E.R. SOCIETA' PER AZIONI", vat: "IT05583420012" }, ctx)).toMatchObject({ status: "exact", id: "ser", reason: "Same VAT number" });
    expect(matchSupplier({ name: "Qualcosa d'altro", taxCode: "01111111111" }, ctx)).toMatchObject({ status: "exact", id: "ser", reason: "Same tax code" });
    expect(matchSupplier({ name: "SER Cere Srl" }, ctx)).toMatchObject({ status: "exact", id: "ser" });
  });

  it("another spelling of the name is a suggestion to confirm", () => {
    expect(matchSupplier({ name: "S.E.R. S.p.A." }, ctx)).toMatchObject({ status: "probable", id: "ser", reason: "Same name, different spelling or legal form" });
  });

  it("the same name with another VAT number is not taken for the same company", () => {
    const m = matchSupplier({ name: "Mock Wax Srl", vat: "09876543210" }, ctx);
    expect(m).toMatchObject({ status: "probable", id: "homonym", reason: "Same name, but a different VAT number" });
    expect(matchSupplier({ name: "Mock Wax Srl" }, ctx)).toMatchObject({ status: "exact", id: "homonym" });
    expect(matchSupplier({ name: "Brand New Supplier GmbH", vat: "DE123456789" }, ctx)).toMatchObject({ status: "none" });
  });
});
