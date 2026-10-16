/**
 * The offers still to verify, as the summaries and the bell say them. Invented companies and products.
 */
import { describe, expect, it } from "vitest";
import { offerNotices, pendingAcross, pendingOf, type PendingOffers } from "./pending";

const view = (id: string, over: { state?: string; validUntil?: string | null; company?: string } = {}) => ({
  offer: { id, productName: "Mock wax 52/54", grade: "52/54", unitPrice: 1450, currency: "EUR", unit: "t", incoterm: "FCA", destination: "Mockport", validUntil: over.validUntil === undefined ? "2026-11-30" : over.validUntil },
  company: { id: `c-${id}`, name: over.company ?? `Mock ${id}` },
  link: "proposed" as const,
  state: (over.state ?? "quote_received") as "quote_received",
  group: "to_verify" as const,
  shortfalls: ["not_linked" as const, "landed" as const],
});

describe("what is still to verify", () => {
  it("counts the active offers, keeps the price as quoted, and sets the expired apart", () => {
    const p = pendingOf({ toVerify: [view("a"), view("b", { validUntil: "2026-10-16", company: "Mock Baykim" }), view("c", { state: "expired", validUntil: "2026-09-01" })], awaitingPrice: [{}] }, "2026-10-16")!;
    expect(p.toVerify.map((o) => o.offerId)).toEqual(["b", "a"]);
    expect(p.toVerify[0].quoted).toBe("€1.450,00/t FCA Mockport");
    expect([p.expired, p.awaitingPrice, p.companies]).toEqual([1, 1, ["Mock Baykim", "Mock a"]]);
    expect(p.expiring.map((o) => o.offerId)).toEqual(["b"]);
    expect(pendingOf({ toVerify: [], awaitingPrice: [] }, "2026-10-16")).toBeNull();
  });

  it("is said on the bell the day an offer ends, and a week before — never with a price", () => {
    const pending: Record<string, PendingOffers> = {
      wax: pendingOf({ toVerify: [view("b", { validUntil: "2026-10-16", company: "Mock Baykim" }), view("d", { validUntil: "2026-10-20" })], awaitingPrice: [] }, "2026-10-16")!,
    };
    const names = new Map([["wax", "Mock paraffin 52/54"]]);
    const n = offerNotices(pending, names, "2026-10-16", [{ date: "2026-10-15" }, { date: "2026-10-01" }], 7);
    expect(n.map((x) => [x.text, x.href, x.todo])).toEqual([
      ["Mock Baykim's offer for Mock paraffin 52/54 expires today", "/sourcing/replies/offers/b", true],
      ["1 offer to verify ends within 7 days", "/products/wax#offers", true],
      ["1 reply to your requests in the last 7 days", "/sourcing/replies", false],
    ]);
    expect(JSON.stringify(n)).not.toContain("1450");
    // The day before, nothing ends today.
    expect(offerNotices(pending, names, "2026-10-15", [], 7).map((x) => x.key)).toEqual(["expiring"]);
  });

  it("adds up over the products of one supplier", () => {
    const pending: Record<string, PendingOffers> = { a: pendingOf({ toVerify: [view("x"), view("y")], awaitingPrice: [] }, "2026-10-16")!, b: pendingOf({ toVerify: [view("z")], awaitingPrice: [] }, "2026-10-16")! };
    expect(pendingAcross(["a", "b", "c", "a"], pending)).toEqual({ offers: 3, products: ["a", "b"] });
    // The same offer proposed for two products counts once, on the bell too.
    const twice: Record<string, PendingOffers> = { a: pendingOf({ toVerify: [view("x", { validUntil: "2026-10-18" })], awaitingPrice: [] }, "2026-10-16")!, b: pendingOf({ toVerify: [view("x", { validUntil: "2026-10-18" })], awaitingPrice: [] }, "2026-10-16")! };
    expect(pendingAcross(["a", "b"], twice).offers).toBe(1);
    expect(offerNotices(twice, new Map(), "2026-10-16", [], 7).map((n) => n.text)).toEqual(["1 offer to verify ends within 7 days"]);
  });
});
