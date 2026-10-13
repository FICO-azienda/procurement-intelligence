/** The bridge from the replies to the analysis: what crosses, as what, and what it leaves untouched. Mock data only. */
import { describe, expect, it } from "vitest";
import type { Dataset } from "../analytics";
import { REPLY_SOURCE, bridgeDataset, bridgedQuoteId, offerIdOf, replyCompanyIdOf, replySupplierId, type BridgeOffer } from "./bridge";

const data: Dataset = {
  suppliers: [{ id: "s1", name: "Mock Current Supplier", country: "Italy", city: null, vatNumber: null, contactName: null, email: null, phone: null, website: null, currency: "EUR", paymentTermsDays: 60, defaultLeadTimeDays: null, notes: null }],
  products: [{ id: "p1", sku: "P1", name: "Mock paraffin", description: null, category: null, kind: "direct_material", subcategory: null, familyId: null, variant: null, mapped: true, unit: "kg", technicalSpecifications: null, specs: null, currentSupplierId: "s1" }],
  purchases: [],
  quotes: [],
};
const offer: BridgeOffer = {
  offerId: "o1", productId: "p1", company: { id: "c1", name: "Mock Wax Kimya", country: "Turkey", email: null, website: null }, supplierId: null, productName: "MOCK WAX 52/54", landedPerUnit: 1.46, estimated: false,
  date: "2026-10-01", validUntil: "2026-12-31", quantity: 22000, moq: 20000, paymentTerms: "30 days", quoted: "1.19 USD/kg FOB Mock Port",
};

describe("the dataset the analysis reads", () => {
  it("is the one on file when no offer is comparable", () => {
    expect(bridgeDataset(data, [])).toBe(data);
    expect(bridgeDataset(data, [{ ...offer, productId: "gone" }])).toBe(data);
  });

  it("takes a comparable offer as a quote on the cost to the plant, with nothing left to add", () => {
    const out = bridgeDataset(data, [offer]);
    expect(out.quotes).toEqual([expect.objectContaining({ id: "offer:o1", productId: "p1", supplierId: "reply:c1", unitPrice: 1.46, currency: "EUR", fxRate: 1, incoterm: "DDP", freightCost: null, moq: 20000, paymentTermsDays: 30, validUntil: "2026-12-31", source: REPLY_SOURCE, notes: "1.19 USD/kg FOB Mock Port" })]);
    expect(out.suppliers.map((s) => [s.id, s.name, s.country])).toEqual([["s1", "Mock Current Supplier", "Italy"], ["reply:c1", "Mock Wax Kimya", "Turkey"]]);
    // The dataset on file is not touched.
    expect(data.quotes).toEqual([]);
    expect(data.suppliers).toHaveLength(1);
  });

  it("reads the company as the supplier on file it is, when it is one — and makes up no supplier for it", () => {
    const out = bridgeDataset(data, [{ ...offer, supplierId: "s1" }, { ...offer, offerId: "o2", supplierId: "no-such-supplier" }]);
    expect(out.quotes.map((q) => q.supplierId)).toEqual(["s1", "reply:c1"]);
    expect(out.suppliers.map((s) => s.id)).toEqual(["s1", "reply:c1"]);
  });

  it("tells its quotes and companies from the ones on file by their id alone", () => {
    expect(offerIdOf(bridgedQuoteId("o1"))).toBe("o1");
    expect(offerIdOf("3f53a63b-a5ee-4768-a351-49bb2b145581")).toBeNull();
    expect(offerIdOf(null)).toBeNull();
    expect(replyCompanyIdOf(replySupplierId("c1"))).toBe("c1");
    expect(replyCompanyIdOf("s1")).toBeNull();
  });
});
