/**
 * Direct Order, the rules: when an article can be ordered, what a quantity
 * must respect, what an order is worth and when no total can be said, who may
 * move an order from which status. Every company and article here is a mock.
 */
import { describe, expect, it } from "vitest";
import { seal, unseal } from "../auth/cookie";
import { TRANSITIONS, actionsFor, applyChanges, changedFields, expiryFrom, needsSpecApproval, orderAmounts, readChanges, refusal, reorderNotes, type OrderDraft } from "./flow";
import { checkQuantity, deliveryFromIncoterm, identityGaps, leadTimeFromDays, listingState, minimumProblem, missingTerms, orgGaps, paymentFromDays, type ListingFacts, type OrgFacts } from "./ready";
import { EMPTY_TERMS, ORDER_STATUSES, ORDER_TERMS_VERSION, PERMISSIONS, type Principal, type Terms, type TermsSnapshot } from "./types";

const TODAY = "2026-10-12";
const FULL: Terms = {
  ...EMPTY_TERMS, unitPrice: 1.45, currency: "EUR", taxesIncluded: false, minQuantity: 1000, quantityStep: 500, leadTime: "7_14", delivery: "DAP", deliveryPlace: "Mock Town", incotermsVersion: "2020",
  payment: "30_days", validUntil: "2026-12-31",
};
const ORG: OrgFacts = { name: "Mock Wax Supplier S.p.A.", vatNumber: "IT00000000001", taxCode: null, address: "1 Mock Road", city: "Mock City", country: "Italy", emailVerified: true, authorisedUser: true, termsVersion: ORDER_TERMS_VERSION };
const READY: ListingFacts = { enabled: true, suspended: false, blocked: false, orgGaps: 0, identityGaps: 0, terms: FULL, confirmed: true };
const buyer: Principal = { side: "buyer", orgId: "b", orgName: "Mock Buyer S.r.l.", userId: null, name: "Mock User", permissions: [...PERMISSIONS.buyer], actorType: "user" };
const supplier: Principal = { side: "supplier", orgId: "s", orgName: "Mock Wax Supplier S.p.A.", userId: "u", name: "Mock Seller", permissions: [...PERMISSIONS.supplier], actorType: "supplier" };

describe("what a company gives once", () => {
  it("is complete with a name, a fiscal identifier, a verified address, a place, a person and the conditions accepted", () => {
    expect(orgGaps(ORG)).toEqual([]);
    expect(orgGaps({ ...ORG, vatNumber: null, taxCode: "MOCKCODE" })).toEqual([]);
  });
  it("names each thing that is missing", () => {
    expect(orgGaps({ ...ORG, vatNumber: null })).toEqual(["identity"]);
    expect(orgGaps({ ...ORG, emailVerified: false, address: null })).toEqual(["email", "address"]);
    expect(orgGaps({ ...ORG, authorisedUser: false })).toEqual(["user"]);
  });
  it("asks again when the conditions accepted are an older version", () => {
    expect(orgGaps({ ...ORG, termsVersion: "older" })).toEqual(["conditions"]);
    expect(orgGaps({ ...ORG, termsVersion: null })).toEqual(["conditions"]);
  });
});

describe("an article precise enough to be ordered", () => {
  it("is not one word, with or without a code", () => {
    expect(identityGaps({ code: "W1", name: "Wax", description: null, specConfirmed: true })).toEqual(["description"]);
    expect(identityGaps({ code: null, name: "Wax", description: null, specConfirmed: false })).toEqual(["code", "description", "confirmation"]);
  });
  it("is a code, a description that says which one, and the supplier's confirmation", () => {
    const article = { code: "MW-5254", name: "Paraffin 52/54", description: "Fully refined paraffin wax, melting point 52–54 °C, oil content max 0.5%" };
    expect(identityGaps({ ...article, specConfirmed: true })).toEqual([]);
    expect(identityGaps({ ...article, specConfirmed: false })).toEqual(["confirmation"]);
  });
});

describe("the six conditions", () => {
  it("are all missing when nothing was stated", () => {
    expect(missingTerms(null)).toEqual(["price", "minimum", "leadTime", "delivery", "payment", "validity"]);
    expect(missingTerms(EMPTY_TERMS)).toHaveLength(6);
  });
  it("are complete when each says what it needs", () => {
    expect(missingTerms(FULL)).toEqual([]);
  });
  it("say which one is short", () => {
    expect(missingTerms({ ...FULL, validUntil: null })).toEqual(["validity"]);
    expect(missingTerms({ ...FULL, taxesIncluded: null })).toEqual(["price"]);
    expect(missingTerms({ ...FULL, currency: null })).toEqual(["price"]);
    expect(missingTerms({ ...FULL, deliveryPlace: null })).toEqual(["delivery"]);
    expect(missingTerms({ ...FULL, leadTime: "custom" })).toEqual(["leadTime"]);
    expect(missingTerms({ ...FULL, leadTime: "custom", leadTimeNote: "45 days" })).toEqual([]);
    expect(missingTerms({ ...FULL, payment: "other" })).toEqual(["payment"]);
    expect(missingTerms({ ...FULL, delivery: "other", deliveryPlace: null, deliveryNote: "CFR Mock Port" })).toEqual(["delivery"]);
    expect(missingTerms({ ...FULL, delivery: "other", deliveryPlace: null, deliveryNote: "CFR Mock Port", transportIncluded: false })).toEqual([]);
    expect(missingTerms({ ...FULL, delivery: "existing_agreement", deliveryPlace: null })).toEqual([]);
  });
  it("refuse a minimum that is not a whole number of steps", () => {
    expect(missingTerms({ ...FULL, minQuantity: 1000, quantityStep: 300 })).toEqual(["minimum"]);
    expect(minimumProblem({ minQuantity: 1000, quantityStep: 300 })).toMatch(/whole number of steps/);
    expect(minimumProblem({ minQuantity: 1000, quantityStep: 500 })).toBeNull();
    expect(minimumProblem({ minQuantity: 1000, quantityStep: null })).toBeNull();
  });
  it("a date in the past is a complete validity — an expired one", () => {
    expect(missingTerms({ ...FULL, validUntil: "2020-01-01" })).toEqual([]);
  });
});

describe("the state of an article", () => {
  it("is Order Ready only with everything in place and confirmed", () => {
    expect(listingState(READY, TODAY)).toBe("order_ready");
    expect(listingState({ ...READY, confirmed: false }, TODAY)).toBe("catalog_ready");
    expect(listingState({ ...READY, enabled: false }, TODAY)).toBe("catalog_ready");
    expect(listingState({ ...READY, orgGaps: 1 }, TODAY)).toBe("catalog_ready");
    expect(listingState({ ...READY, identityGaps: 1 }, TODAY)).toBe("catalog_ready");
    expect(listingState({ ...READY, terms: { ...FULL, payment: null } }, TODAY)).toBe("catalog_ready");
    expect(listingState({ ...READY, terms: null }, TODAY)).toBe("catalog_ready");
  });
  it("stops by itself the day after the price's date", () => {
    expect(listingState({ ...READY, terms: { ...FULL, validUntil: TODAY } }, TODAY)).toBe("order_ready");
    expect(listingState({ ...READY, terms: { ...FULL, validUntil: "2026-10-11" } }, TODAY)).toBe("expired");
  });
  it("is suspended when the supplier paused it, for everyone or for this customer", () => {
    expect(listingState({ ...READY, suspended: true }, TODAY)).toBe("suspended");
    expect(listingState({ ...READY, blocked: true }, TODAY)).toBe("suspended");
  });
});

describe("a quantity", () => {
  it("starts at the minimum and goes up in whole steps", () => {
    expect(checkQuantity(22000, FULL, "kg").ok).toBe(true);
    expect(checkQuantity(1000, FULL, "kg").ok).toBe(true);
    expect(checkQuantity(999, FULL, "kg")).toMatchObject({ ok: false, reason: "below_minimum" });
    expect(checkQuantity(1250, FULL, "kg")).toMatchObject({ ok: false, reason: "not_a_multiple" });
    expect(checkQuantity(0, FULL, "kg")).toMatchObject({ ok: false, reason: "invalid" });
    expect(checkQuantity(null, FULL, "kg")).toMatchObject({ ok: false, reason: "invalid" });
  });
  it("is free above the minimum when there are no steps", () => {
    expect(checkQuantity(1234.5, { ...FULL, quantityStep: null }, "kg").ok).toBe(true);
  });
});

describe("what an order is worth", () => {
  const facts = { quantity: 22000, unitPrice: 1.45, currency: "EUR", unit: "kg", terms: FULL, destinationCity: "Mock Town", transportCost: null };
  it("is goods at the agreed price, with transport in it when the price is delivered to the customer's own town", () => {
    const a = orderAmounts(facts);
    expect(a.goods).toBe(31900);
    expect(a.transport.state).toBe("included");
    expect(a.total).toBe(31900);
    expect(a.open).toEqual([]);
    expect(a.taxesIncluded).toBe(false);
  });
  it("has no total when the price is delivered somewhere else: DAP alone is not 'delivered anywhere'", () => {
    const a = orderAmounts({ ...facts, destinationCity: "Another Mock Town" });
    expect(a.goods).toBe(31900);
    expect(a.transport.state).toBe("to_confirm");
    expect(a.total).toBeNull();
    expect(a.open).toHaveLength(1);
  });
  it("leaves transport to the customer under FCA and EXW, and says so", () => {
    for (const delivery of ["FCA", "EXW"] as const) {
      const a = orderAmounts({ ...facts, terms: { ...FULL, delivery } });
      expect(a.transport.state).toBe("excluded");
      expect(a.total).toBe(31900);
      expect(a.open).toEqual([]);
    }
  });
  it("does not make up a total under an agreement that is not on file", () => {
    const a = orderAmounts({ ...facts, terms: { ...FULL, delivery: "existing_agreement", deliveryPlace: null } });
    expect(a.transport.state).toBe("agreed");
    expect(a.total).toBeNull();
    expect(a.open).toEqual([]);
  });
  it("adds a transport charge the supplier stated", () => {
    const a = orderAmounts({ ...facts, destinationCity: "Another Mock Town", transportCost: 450 });
    expect(a.transport).toMatchObject({ state: "stated", amount: 450 });
    expect(a.total).toBe(32350);
    expect(a.open).toEqual([]);
  });
  it("asks for the transport under terms in words that include it nowhere in particular", () => {
    expect(orderAmounts({ ...facts, terms: { ...FULL, delivery: "other", deliveryNote: "CFR Mock Port", transportIncluded: true } }).transport.state).toBe("to_confirm");
    expect(orderAmounts({ ...facts, terms: { ...FULL, delivery: "other", deliveryNote: "Ex warehouse", transportIncluded: false } }).transport.state).toBe("excluded");
  });
});

describe("who may move an order", () => {
  it("covers every status with the transitions and nothing else", () => {
    for (const rule of Object.values(TRANSITIONS)) for (const s of [...rule.from, rule.to]) expect(ORDER_STATUSES).toContain(s);
  });
  it("lets the supplier answer a request and the buyer answer a proposal — never the other way round", () => {
    expect(actionsFor("pending_supplier", supplier).sort()).toEqual(["accept", "propose", "reject"]);
    expect(actionsFor("pending_supplier", buyer)).toEqual(["cancel"]);
    expect(actionsFor("pending_buyer_approval", buyer).sort()).toEqual(["accept_changes", "cancel", "reject_changes"]);
    expect(actionsFor("pending_buyer_approval", supplier)).toEqual([]);
    expect(actionsFor("draft", buyer).sort()).toEqual(["cancel", "send"]);
    expect(actionsFor("draft", supplier)).toEqual([]);
  });
  it("lets nobody confirm twice, cancel a confirmed order, or touch a closed one", () => {
    expect(refusal("accept", "confirmed", supplier)).toMatch(/moved on/);
    expect(refusal("accept_changes", "confirmed", buyer)).toMatch(/moved on/);
    expect(actionsFor("confirmed", buyer)).toEqual(["complete"]);
    expect(actionsFor("confirmed", supplier)).toEqual([]);
    for (const s of ["rejected", "cancelled", "expired", "completed"] as const) expect([...actionsFor(s, buyer), ...actionsFor(s, supplier)]).toEqual([]);
  });
  it("refuses a person without the permission, and the wrong side whatever its permissions", () => {
    expect(refusal("accept", "pending_supplier", { ...supplier, permissions: ["terms.edit"] })).toMatch(/not allowed/);
    expect(refusal("accept", "pending_supplier", buyer)).toMatch(/not yours/);
    expect(refusal("send", "draft", { ...buyer, permissions: ["channel.manage"] })).toMatch(/not allowed/);
    expect(refusal("expire", "pending_supplier", buyer)).toMatch(/not yours/);
    expect(refusal("expire", "pending_supplier", "system")).toBeNull();
  });
  it("counts the day a request lapses from the day it last moved", () => {
    expect(expiryFrom("2026-10-12", 14)).toBe("2026-10-26");
    expect(expiryFrom("2026-12-25", 14)).toBe("2027-01-08");
  });
});

describe("a proposal of changes", () => {
  const snap: TermsSnapshot = { ...FULL, unit: "kg", termsId: "t1", reserved: false };
  const draft: OrderDraft = { line: { orderProductId: "p1", code: "MW-5254", name: "Paraffin 52/54", description: "Fully refined", unit: "kg", quantity: 22000, unitPrice: 1.45, currency: "EUR" }, terms: snap, transportCost: null, deliveryDate: null };
  it("keeps only whole, well-formed changes", () => {
    expect(readChanges({ unitPrice: "1.5", quantity: -3, deliveryDate: "soon", transportCost: 0, payment: { term: "nonsense" } })).toEqual({ transportCost: 0 });
    expect(readChanges({ quantity: 20000, deliveryDate: "2026-11-02" })).toEqual({ quantity: 20000, deliveryDate: "2026-11-02" });
    expect(readChanges(null)).toEqual({});
  });
  it("gives the order as it would be, leaving the rest as asked", () => {
    const after = applyChanges(draft, { quantity: 20000, deliveryDate: "2026-11-02", payment: { term: "60_days", note: null } });
    expect(after.line).toMatchObject({ quantity: 20000, unitPrice: 1.45, code: "MW-5254" });
    expect(after.deliveryDate).toBe("2026-11-02");
    expect(after.terms.payment).toBe("60_days");
    expect(after.terms.delivery).toBe("DAP");
    expect(draft.line.quantity).toBe(22000);
  });
  it("says another article is another specification", () => {
    const changes = readChanges({ product: { orderProductId: "p2", code: "MW-5658", name: "Paraffin 56/58", description: "Fully refined", unit: "kg" } });
    expect(needsSpecApproval(changes)).toBe(true);
    expect(changedFields(changes)).toEqual(["product"]);
    expect(applyChanges(draft, changes).line).toMatchObject({ orderProductId: "p2", code: "MW-5658", name: "Paraffin 56/58", quantity: 22000 });
    expect(needsSpecApproval({ quantity: 1 })).toBe(false);
  });
});

describe("ordering again", () => {
  const f = { price: (n: number, c: string) => `${n} ${c}` };
  const past = { unitPrice: 1.45, currency: "EUR", quantity: 22000, unit: "kg", terms: FULL };
  it("says nothing when nothing changed", () => {
    expect(reorderNotes(past, FULL, f)).toEqual([]);
  });
  it("says what the price is now, and never takes the old one along", () => {
    const notes = reorderNotes(past, { ...FULL, unitPrice: 1.52, payment: "60_days" }, f);
    expect(notes[0]).toContain("1.52 EUR");
    expect(notes[0]).toContain("1.45 EUR");
    expect(notes).toHaveLength(2);
  });
});

describe("values already known, read into the choices on offer", () => {
  it("days into a lead time, or the days themselves when none fits", () => {
    expect(leadTimeFromDays(10)).toEqual({ leadTime: "7_14", leadTimeNote: null });
    expect(leadTimeFromDays(45)).toEqual({ leadTime: "custom", leadTimeNote: "45 days" });
    expect(leadTimeFromDays(null)).toBeNull();
  });
  it("days into payment terms", () => {
    expect(paymentFromDays(0)).toEqual({ payment: "advance", paymentNote: null });
    expect(paymentFromDays(60)).toEqual({ payment: "60_days", paymentNote: null });
    expect(paymentFromDays(45)).toEqual({ payment: "other", paymentNote: "45 days" });
  });
  it("delivery terms: the three on offer, and the others in words — never turned into DAP", () => {
    expect(deliveryFromIncoterm("dap", "Mock Town")).toEqual({ delivery: "DAP", deliveryPlace: "Mock Town", deliveryNote: null });
    expect(deliveryFromIncoterm("CFR", "Mock Port")).toEqual({ delivery: "other", deliveryPlace: null, deliveryNote: "CFR Mock Port" });
    expect(deliveryFromIncoterm(null, "Mock Port")).toBeNull();
  });
});

describe("the workspace cookie", () => {
  const secret = "a-mock-secret-of-at-least-thirty-two-chars";
  it("is accepted with its signature, within its time", () => {
    const sealed = seal("mock-token", new Date(Date.now() + 60_000), secret);
    expect(unseal(sealed, secret)).toBe("mock-token");
  });
  it("is nobody when altered, expired, signed with another secret, or missing", () => {
    const sealed = seal("mock-token", new Date(Date.now() + 60_000), secret);
    expect(unseal(sealed.replace("mock-token", "other-token"), secret)).toBeNull();
    expect(unseal(sealed, "another-mock-secret-of-thirty-two-chars!")).toBeNull();
    expect(unseal(seal("mock-token", new Date(Date.now() - 1000), secret), secret)).toBeNull();
    expect(unseal(undefined, secret)).toBeNull();
    expect(unseal("mock-token", secret)).toBeNull();
  });
});
