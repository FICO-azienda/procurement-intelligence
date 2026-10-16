/**
 * How long the analysis takes on a large company: 10.000 purchases, 1.000 products, 500 suppliers. These run in a
 * group of their own after every other test (vitest.config.mts): timed next to the rest of the suite, they would
 * measure the machine's other work, not the analysis.
 */
import { describe, expect, it } from "vitest";
import type { ProductData, PurchaseData, QuoteData } from "../analytics";
import { purchasingOverview } from "./decision";
import { analyze } from "./engine";
import { dataset, product, purchase, quote, supplier } from "./fixtures";

const AS_OF = "2026-10-01";

describe("a large company", () => {
  it("analyses 10.000 purchases, 1.000 products and 500 suppliers quickly", () => {
    const suppliers = Array.from({ length: 500 }, (_, i) => supplier({ name: `S${i}` }));
    const products = Array.from({ length: 1000 }, (_, i) => product({ name: `P${i}`, category: `C${i % 12}`, currentSupplierId: suppliers[i % 500].id }));
    const purchases = Array.from({ length: 10000 }, (_, i) => {
      const p = products[i % 1000];
      const month = String((i % 12) + 1).padStart(2, "0");
      return purchase({ productId: p.id, supplierId: suppliers[(i % 1000) % 500].id, date: `2026-${month}-${String((i % 27) + 1).padStart(2, "0")}`, quantity: 100 + (i % 7) * 10, unitPrice: 1 + (i % 13) / 100 });
    });
    const quotes = Array.from({ length: 1500 }, (_, i) => quote({ productId: products[i % 1000].id, supplierId: suppliers[(i * 7 + 3) % 500].id, date: "2026-09-10", unitPrice: 1 + (i % 9) / 100, moq: 100 }));
    const t0 = performance.now();
    const intel = analyze(dataset({ suppliers, products, purchases, quotes }), [], [], AS_OF);
    const ms = performance.now() - t0;
    expect(intel.products).toHaveLength(1000);
    expect(intel.suppliers).toHaveLength(500);
    // About half a second on an ordinary laptop.
    expect(ms).toBeLessThan(2000);
  });

  it("summarises 1.000 products quickly", () => {
    const suppliers = Array.from({ length: 200 }, (_, i) => supplier({ name: `S${i}` }));
    const products: ProductData[] = [];
    const purchases: PurchaseData[] = [];
    const quotes: QuoteData[] = [];
    for (let i = 0; i < 1000; i++) {
      const sup = suppliers[i % suppliers.length];
      const p = product({ name: `P${i}`, currentSupplierId: sup.id });
      products.push(p);
      for (let m = 1; m <= 9; m++) purchases.push(purchase({ productId: p.id, supplierId: sup.id, date: `2026-0${m}-10`, quantity: 100 + i, unitPrice: 1 + m / 50 }));
      if (i % 2 === 0) quotes.push(quote({ productId: p.id, supplierId: suppliers[(i + 7) % suppliers.length].id, date: "2026-09-12", unitPrice: 1.05, moq: 50, incoterm: "DAP" }));
    }
    const intel = analyze(dataset({ suppliers, products, purchases, quotes }), [], [], AS_OF);
    const t = performance.now();
    const ov = purchasingOverview(intel);
    const ms = performance.now() - t;
    // About 0,4 s on an ordinary laptop.
    expect(ms).toBeLessThan(2000);
    expect(ov.products).toHaveLength(1000);
  });
});
