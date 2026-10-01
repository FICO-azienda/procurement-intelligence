import { describe, expect, it } from "vitest";
import {
  compareRows,
  minusMonths,
  overview,
  priceChange,
  productMetrics,
  recentPriceChanges,
  supplierOrderStats,
  type Dataset,
  type PurchaseData,
} from "./analytics";

const AS_OF = "2026-09-30";

let n = 0;
function purchase(p: Partial<PurchaseData> & Pick<PurchaseData, "date" | "quantity" | "unitPrice">): PurchaseData {
  const freight = p.freightCost ?? 0;
  return {
    id: `pu${++n}`,
    productId: "par",
    supplierId: "abc",
    unit: "kg",
    currency: "EUR",
    fxRate: 1,
    freightCost: freight,
    otherCosts: 0,
    totalAmount: p.quantity * p.unitPrice + freight,
    invoiceReference: null,
    paymentTermsDays: null,
    incoterm: null,
    originalDescription: null,
    source: "manual",
    sourceDoc: null,
    notes: null,
    ...p,
  };
}

const product = {
  id: "par",
  sku: "PAR-5860",
  name: "Paraffina 58/60",
  description: null,
  category: "Wax",
  unit: "kg",
  technicalSpecifications: null,
  currentSupplierId: "abc",
};

const paraffin = [
  purchase({ date: "2026-01-10", quantity: 2000, unitPrice: 1.42 }),
  purchase({ date: "2026-03-10", quantity: 2000, unitPrice: 1.45 }),
  purchase({ date: "2026-06-12", quantity: 2500, unitPrice: 1.52 }),
  purchase({ date: "2026-09-15", quantity: 2000, unitPrice: 1.58 }),
];

describe("priceChange", () => {
  it("compares the latest price with the one ~12 months earlier", () => {
    const c = priceChange(paraffin, AS_OF);
    expect(c.currentPrice).toBe(1.58);
    expect(c.referencePrice).toBe(1.42);
    expect(c.changePct).toBeCloseTo(11.27, 2);
    expect(c.previousPrice).toBe(1.52);
    expect(c.changedOn).toBe("2026-09-15");
  });

  it("dates a price change at the first purchase at the new price", () => {
    const same = purchase({ date: "2026-09-25", quantity: 100, unitPrice: 1.58 });
    expect(priceChange([...paraffin, same], AS_OF).changedOn).toBe("2026-09-15");
  });

  it("uses the last purchase on/before the window start as reference", () => {
    const withOld = [purchase({ date: "2025-08-01", quantity: 1, unitPrice: 1.3 }), ...paraffin];
    expect(priceChange(withOld, AS_OF).referencePrice).toBe(1.3);
  });

  it("has no change with a single purchase, and nothing with none", () => {
    expect(priceChange([paraffin[0]], AS_OF).changePct).toBeNull();
    expect(priceChange([], AS_OF).currentPrice).toBeNull();
  });

  it("converts foreign-currency prices to EUR", () => {
    const usd = purchase({ date: "2026-09-20", quantity: 10, unitPrice: 2, currency: "USD", fxRate: 0.9 });
    expect(priceChange([usd], AS_OF).currentPrice).toBeCloseTo(1.8);
  });

  it("takes the current price from the current supplier when given", () => {
    const other = purchase({ date: "2026-09-25", quantity: 100, unitPrice: 1.2, supplierId: "cheap" });
    const c = priceChange([...paraffin, other], AS_OF, "abc");
    expect(c.currentPrice).toBe(1.58);
    expect(priceChange([...paraffin, other], AS_OF).currentPrice).toBe(1.2);
  });
});

describe("productMetrics", () => {
  it("sums the last 12 months and flags increases above 5%", () => {
    const m = productMetrics(product, paraffin, AS_OF);
    expect(m.annualQuantity).toBe(8500);
    expect(m.annualSpend).toBeCloseTo(2840 + 2900 + 3800 + 3160);
    expect(m.spendAtCurrentPrice).toBeCloseTo(8500 * 1.58);
    expect(m.changeImpact).toBeCloseTo(8500 * 0.16);
    expect(m.status).toBe("increase");
  });

  it("is stable up to +5%", () => {
    const m = productMetrics(product, [
      purchase({ date: "2026-03-01", quantity: 1, unitPrice: 1.0 }),
      purchase({ date: "2026-09-01", quantity: 1, unitPrice: 1.05 }),
    ], AS_OF);
    expect(m.status).toBe("stable");
  });

  it("asks for review without purchases or with a stale price", () => {
    expect(productMetrics(product, [], AS_OF).status).toBe("review");
    const stale = productMetrics(product, [purchase({ date: "2026-02-01", quantity: 1, unitPrice: 1 })], AS_OF);
    expect(stale.status).toBe("review");
  });

  it("includes freight in spend and ignores purchases older than 12 months", () => {
    const m = productMetrics(product, [
      purchase({ date: "2025-09-01", quantity: 1000, unitPrice: 1 }),
      purchase({ date: "2026-05-01", quantity: 100, unitPrice: 2, freightCost: 50 }),
    ], AS_OF);
    expect(m.annualQuantity).toBe(100);
    expect(m.annualSpend).toBe(250);
  });
});

describe("overview and compare", () => {
  const data: Dataset = {
    suppliers: [
      { id: "abc", name: "ABC Srl", country: "Italy", city: null, vatNumber: null, contactName: null, email: null, phone: null, website: null, currency: "EUR", paymentTermsDays: 60, defaultLeadTimeDays: 12, notes: null },
      { id: "tw", name: "Turkish Wax Ltd", country: "Turkey", city: null, vatNumber: null, contactName: null, email: null, phone: null, website: null, currency: "EUR", paymentTermsDays: 0, defaultLeadTimeDays: 30, notes: null },
    ],
    products: [product],
    purchases: paraffin,
    quotes: [
      { id: "q1", productId: "par", supplierId: "tw", date: "2026-09-18", quantity: null, unitPrice: 1.31, currency: "EUR", fxRate: 1, moq: 5000, leadTimeDays: 30, paymentTermsDays: 0, incoterm: "FOB", freightCost: null, validUntil: null, originalDescription: null, source: "manual", sourceDoc: null, notes: null },
    ],
  };

  it("totals spend and counts increases and suppliers", () => {
    const o = overview(data, AS_OF);
    expect(o.totalAnnualSpend).toBeCloseTo(12700);
    expect(o.priceIncreases).toBe(1);
    expect(o.activeSuppliers).toBe(1);
    expect(o.otherSuppliers).toBe(1);
  });

  it("lists the current supplier first with last paid price, alternatives with quotes", () => {
    const rows = compareRows(product, data, AS_OF);
    expect(rows.map((r) => [r.supplier.id, r.priceBasis, r.price])).toEqual([
      ["abc", "last-paid", 1.58],
      ["tw", "quote", 1.31],
    ]);
    expect(rows[0].terms.fromDefaults).toBe(true);
    expect(rows[1].terms.moq).toBe(5000);
  });
});

describe("recent changes and supplier orders", () => {
  const data: Dataset = {
    suppliers: [],
    products: [product],
    purchases: [
      purchase({ date: "2026-06-01", quantity: 1000, unitPrice: 1.5, invoiceReference: "A-1" }),
      purchase({ date: "2026-08-04", quantity: 1000, unitPrice: 1.6, invoiceReference: "A-2" }),
      purchase({ date: "2026-08-04", quantity: 500, unitPrice: 1.6, invoiceReference: "A-2" }),
      purchase({ date: "2026-09-20", quantity: 1000, unitPrice: 1.6 }),
    ],
    quotes: [],
  };

  it("reports the last change with its real date and annual impact", () => {
    const [c] = recentPriceChanges(data, AS_OF);
    expect(c).toMatchObject({ previousPrice: 1.5, currentPrice: 1.6, changedOn: "2026-08-04", annualQuantity: 3500 });
    expect(c.annualImpact).toBeCloseTo(350);
    expect(recentPriceChanges(data, "2027-01-15")).toHaveLength(0);
  });

  it("counts orders by invoice (or day) and their average value", () => {
    const s = supplierOrderStats("abc", data.purchases, AS_OF);
    expect(s.purchasesLast12m).toBe(4);
    expect(s.ordersLast12m).toBe(3);
    expect(s.ordersYtd).toBe(3);
    expect(s.averageOrderValue).toBeCloseTo((1500 + 1600 + 800 + 1600) / 3);
    expect(s.lastInvoice?.date).toBe("2026-09-20");
    expect(s.priceIncreases).toBe(1);
  });

  it("leaves purchases without an exchange rate out of EUR figures", () => {
    const usd = purchase({ date: "2026-09-25", quantity: 10, unitPrice: 2, currency: "USD", fxRate: null });
    const m = productMetrics(product, [...paraffin, usd], AS_OF);
    expect(m.unpricedCount).toBe(1);
    expect(m.annualSpend).toBeCloseTo(2840 + 2900 + 3800 + 3160);
    expect(m.currentPrice).toBe(1.58);
  });
});

describe("minusMonths", () => {
  it("clamps to month end", () => {
    expect(minusMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(minusMonths("2026-09-30", 12)).toBe("2025-09-30");
  });
});
