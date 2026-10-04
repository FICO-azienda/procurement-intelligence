import { describe, expect, it } from "vitest";
import { purchasePreview, quoteGapPct } from "./entry";

describe("purchase preview", () => {
  it("computes total, change and annual impact from what was typed", () => {
    const p = purchasePreview({ quantity: 2000, unitPrice: 1.58, fxRate: 1, previousPrice: 1.52, annualQuantity: 20_000 });
    expect(p.total).toBeCloseTo(3160, 6);
    expect(p.changePct).toBeCloseTo(3.947, 2);
    expect(p.annualImpact).toBeCloseTo(1200, 6);
  });

  it("includes freight in the total, not in the price", () => {
    const p = purchasePreview({ quantity: 100, unitPrice: 2, fxRate: 1, freight: 35, otherCosts: 5, previousPrice: 2, annualQuantity: 500 });
    expect(p.total).toBe(240);
    expect(p.changePct).toBe(0);
    expect(p.annualImpact).toBeNull(); // unchanged price: nothing to annualise
  });

  it("says nothing it cannot know", () => {
    expect(purchasePreview({ quantity: null, unitPrice: 1.58, fxRate: 1, previousPrice: 1.52, annualQuantity: 0 })).toMatchObject({ total: null, annualImpact: null });
    expect(purchasePreview({ quantity: 10, unitPrice: 1.4, fxRate: null, previousPrice: 1.52, annualQuantity: 100 })).toMatchObject({ total: 14, priceEUR: null, changePct: null, annualImpact: null });
    expect(purchasePreview({ quantity: 10, unitPrice: 1.4, fxRate: 1, previousPrice: null, annualQuantity: 100 }).changePct).toBeNull();
  });

  it("converts a foreign price with the given rate before comparing", () => {
    const p = purchasePreview({ quantity: 1000, unitPrice: 1.4, fxRate: 0.9, previousPrice: 1.4, annualQuantity: 10_000 });
    expect(p.priceEUR).toBeCloseTo(1.26, 6);
    expect(p.changePct).toBeCloseTo(-10, 6);
    expect(p.annualImpact).toBeCloseTo(-1400, 6);
  });

  it("compares a quote with the price paid today", () => {
    expect(quoteGapPct(1.49, 1.58)).toBeCloseTo(-5.696, 2);
    expect(quoteGapPct(1.49, null)).toBeNull();
  });
});
