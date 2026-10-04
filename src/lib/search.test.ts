import { describe, expect, it } from "vitest";
import { analyze } from "./intel/engine";
import { dataset, product, purchase, quote, supplier } from "./intel/fixtures";
import { search } from "./search";

const a = supplier({ name: "Acme Srl", country: "Italy" });
const b = supplier({ name: "Beta Wax Ltd", country: "Turkey" });
const wax = product({ name: "Paraffina 58/60", sku: "PAR-5860", category: "Wax", currentSupplierId: a.id });
const jar = product({ name: "Vetro Trasparente 300 ml", sku: "GLS-300", category: "Glass", unit: "pcs", currentSupplierId: a.id });
const data = dataset({
  suppliers: [a, b],
  products: [wax, jar],
  purchases: [
    purchase({ productId: wax.id, supplierId: a.id, date: "2026-03-10", quantity: 5000, unitPrice: 1.45, invoiceReference: "FT 2026/0142" }),
    purchase({ productId: wax.id, supplierId: a.id, date: "2026-09-15", quantity: 5000, unitPrice: 1.58 }),
    purchase({ productId: jar.id, supplierId: a.id, date: "2026-09-01", quantity: 1000, unitPrice: 1.18, unit: "pcs" }),
  ],
  quotes: [quote({ productId: wax.id, supplierId: b.id, date: "2026-09-18", unitPrice: 1.31, moq: 2000, incoterm: "DAP" })],
});
const intel = analyze(data, [], [], "2026-10-01");
const find = (q: string) => search(q, data, intel, { productAliases: [{ productId: wax.id, alias: "PAR WAX 58-60" }], supplierAliases: [] });
const kinds = (q: string) => find(q).map((r) => `${r.kind}:${r.title}`);

describe("global search", () => {
  it("one word finds the product, its quotes, purchases and opportunities", () => {
    expect(kinds("paraffina")).toEqual([
      "product:Paraffina 58/60",
      "quote:Beta Wax Ltd — Paraffina 58/60",
      "purchase:Paraffina 58/60 — Acme Srl",
      "purchase:Paraffina 58/60 — Acme Srl",
      "opportunity:Lower quote — Paraffina 58/60",
    ]);
    expect(find("paraffina")[0]).toMatchObject({ subtitle: "€1,58/kg · Acme Srl", href: `/products/${wax.id}` });
  });

  it("ignores accents and case, matches word starts, codes and learned names", () => {
    expect(kinds("PAR 58")[0]).toBe("product:Paraffina 58/60");
    expect(kinds("gls-300")[0]).toBe("product:Vetro Trasparente 300 ml");
    expect(kinds("par wax")[0]).toBe("product:Paraffina 58/60"); // an alias confirmed during an import
    expect(kinds("affina")).toEqual([]); // not the middle of a word
  });

  it("finds a supplier with what it quoted and sold", () => {
    const r = kinds("beta");
    expect(r[0]).toBe("supplier:Beta Wax Ltd");
    expect(r).toContain("quote:Beta Wax Ltd — Paraffina 58/60");
    expect(find("acme").filter((x) => x.kind === "purchase")).toHaveLength(3);
  });

  it("finds a purchase by its invoice number", () => {
    expect(find("0142").map((r) => r.kind)).toEqual(["purchase"]);
  });

  it("returns nothing for an empty or unknown query", () => {
    expect(find("  ")).toEqual([]);
    expect(find("zzz")).toEqual([]);
  });
});
