/**
 * One company, whatever archive names it. Invented companies and VAT numbers.
 */
import { describe, expect, it } from "vitest";
import { companyProposals, planCompanies, type CompanyFacts, type RoleKind, type RoleRecord } from "./plan";

const rec = (kind: RoleKind, id: string, name: string, over: Partial<RoleRecord> = {}): RoleRecord => ({ kind, id, name, vatNumber: null, taxCode: null, country: null, city: null, website: null, email: null, phone: null, companyId: null, sameAs: [], ...over });
const company = (id: string, name: string, over: Partial<CompanyFacts> = {}): CompanyFacts => ({ id, name, otherNames: [], vatNumber: null, taxCode: null, country: null, city: null, website: null, domain: null, mergedIntoId: null, ...over });
const groups = (plan: ReturnType<typeof planCompanies>) => plan.create.map((c) => c.records.map((r) => `${r.kind}:${r.id}`).sort());

describe("one company per legal entity", () => {
  it("the same VAT number in three archives is one company with three roles, named as on the invoices", () => {
    const plan = planCompanies(
      [rec("candidate", "c1", "Mock Wax Kimya", { vatNumber: "TR1234567890" }), rec("supplier", "s1", "MOCK WAX KIMYA A.S.", { vatNumber: "TR 1234567890" }), rec("reply", "r1", "Mock Wax Kimya A.Ş.", { taxCode: "1234567890" })],
      [],
    );
    expect(groups(plan)).toEqual([["candidate:c1", "reply:r1", "supplier:s1"]]);
    expect(plan.create[0].facts).toMatchObject({ name: "MOCK WAX KIMYA A.S.", vatNumber: "TR 1234567890" });
  });

  it("two VAT numbers are two companies, even with the very same name", () => {
    const plan = planCompanies([rec("supplier", "s1", "Mock Cere S.r.l.", { vatNumber: "IT00000000019" }), rec("reply", "r1", "Mock Cere S.r.l.", { vatNumber: "IT00000000027" })], []);
    expect(groups(plan)).toEqual([["supplier:s1"], ["reply:r1"]]);
  });

  it("a shared site or the same name across archives is never a tie by itself", () => {
    const plan = planCompanies([rec("directory", "d1", "Mock Plast d.o.o.", { website: "https://mockplast.example" }), rec("reply", "r1", "Mock Plast d.o.o.", { website: "mockplast.example" })], []);
    expect(groups(plan)).toEqual([["reply:r1"], ["directory:d1"]]);
  });

  it("the candidates of one company for several products are one company, as the app always read them", () => {
    const plan = planCompanies([rec("candidate", "c1", "Mock Plast d.o.o.", { website: "https://www.mockplast.example/en" }), rec("candidate", "c2", "MOCK PLAST", { website: "mockplast.example" }), rec("candidate", "c3", "Other Mock Ltd")], []);
    expect(groups(plan)).toEqual([["candidate:c1", "candidate:c2"], ["candidate:c3"]]);
  });

  it("what the app already holds as one stays one: a merged supplier, a converted candidate, a person's 'the same company'", () => {
    const plan = planCompanies(
      [
        rec("supplier", "s2", "SER SPA", { sameAs: [{ kind: "supplier", id: "s1" }] }),
        rec("supplier", "s1", "SER S.p.A.", { vatNumber: "IT05583420012" }),
        rec("candidate", "c1", "Ser candidate name", { sameAs: [{ kind: "supplier", id: "s1" }] }),
        rec("reply", "r1", "S.E.R.", { sameAs: [{ kind: "supplier", id: "s1" }] }),
      ],
      [],
    );
    expect(groups(plan)).toEqual([["candidate:c1", "reply:r1", "supplier:s1", "supplier:s2"]]);
  });

  it("a record already tied is never moved, and a new one joins the company its VAT number names", () => {
    const plan = planCompanies([rec("supplier", "s1", "Mock Cere", { vatNumber: "IT00000000019", companyId: "k1" }), rec("reply", "r1", "Mock Cere Spa", { vatNumber: "00000000019" })], [company("k1", "Mock Cere", { vatNumber: "IT00000000019" })]);
    expect(plan).toEqual({ create: [], link: [{ kind: "reply", id: "r1", companyId: "k1" }] });
    // Read as the company it was merged into.
    const merged = planCompanies([rec("reply", "r2", "Mock Cere", { vatNumber: "00000000019" })], [company("k0", "Mock Cere Group"), company("k1", "Mock Cere", { vatNumber: "IT00000000019", mergedIntoId: "k0" })]);
    expect(merged.create).toHaveLength(1);
  });
});

describe("what is proposed", () => {
  it("a shared site, the same name: proposed with the reason, never merged; decided pairs are not proposed again", () => {
    const list = [
      { ...company("a", "Mock Plast d.o.o.", { domain: "mockplast.example" }), roles: 3 },
      { ...company("b", "Mock Plast", { domain: "mockplast.example" }), roles: 1 },
      { ...company("c", "Glassworks Ltd"), roles: 1 },
      { ...company("d", "Mock Group AG", { domain: "mockgroup.example", vatNumber: "CHE111111111" }), roles: 1 },
      { ...company("e", "Mock Group Italia S.r.l.", { domain: "mockgroup.example", vatNumber: "IT22222222222" }), roles: 1 },
    ];
    const proposed = companyProposals(list, new Set());
    expect(proposed.map((p) => [p.a, p.b, p.automatic])).toEqual([["a", "b", false]]);
    expect(companyProposals(list, new Set(["a|b"]))).toEqual([]);
  });
});
