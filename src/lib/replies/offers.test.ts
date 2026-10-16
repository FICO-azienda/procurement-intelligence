/**
 * An offer and one of the buyer's products: what is proposed and why, where
 * an offer is in its life, what it costs to the plant — and when, only then,
 * it can be set against what is paid. Invented products and prices.
 */
import { describe, expect, it } from "vitest";
import { isPublic, publicOnly } from "../negotiation/data-class";
import { landedCost, readLandedInput, type LandedInput } from "./landed";
import { rangesIn, suggestFor, type MatchProduct } from "./match";
import { OFFER_DATA_CLASS, groupOf, offerState, savingOf, shortfallsOf, supersededIds, unitFactorOf } from "./offers";
import type { ReplyOffer } from "./types";

const offer = (o: Partial<ReplyOffer> = {}): ReplyOffer => ({
  id: "o1", threadId: "t1", key: "k", productName: "MOCK 1500", productCode: null, grade: "MOCK 1500", category: "Paraffin", unitPrice: 1.4, currency: "EUR", unit: "kg", quantity: 20000, moq: null,
  incoterm: "CFR", destination: "Mockport (Italy)", paymentTerms: null, offeredOn: null, validUntil: "2026-06-30", validity: "30/06/2026", specs: { melting_point: "52–56°C", oil_content: "0,8–1%" },
  productId: null, compatibility: "not_analyzed", compatibilityNote: null, declinedProductIds: [], decision: null, decisionNote: null, landed: {}, destinationId: null, createdAt: "2026-06-01T10:00:00.000Z",
  technicalStatus: null, missing: null, sourceUrl: null, sourceDocument: null, ...o,
});
const paraffin: MatchProduct = { id: "p1", name: "Mock paraffin 52/54", unit: "kg", subKey: "paraffin" };
const TODAY = "2026-06-10";

describe("a grade written as a range", () => {
  it("is two numbers apart by a few units — not a percentage, not a size", () => {
    expect(rangesIn("Paraffin 52/54")).toEqual([[52, 54]]);
    expect(rangesIn("51–54°C in the table; 58–62°C among the properties")).toEqual([[51, 54], [58, 62]]);
    expect(rangesIn("0,8–1%")).toEqual([]);
    expect(rangesIn("Container 30/2 TR")).toEqual([]);
    expect(rangesIn("12-20%")).toEqual([]);
  });
});

describe("proposing a product for an offer", () => {
  it("needs the same kind of thing in the same unit, and says how the grades stand", () => {
    expect(suggestFor(offer(), [paraffin])).toMatchObject([{ productId: "p1", compatibility: "possible" }]);
    expect(suggestFor(offer({ specs: { melting_point: "52–54°C" } }), [paraffin])[0].reasons.join(" ")).toContain("the grade of your product");
    // Another grade is proposed for what it is — never as the same product.
    expect(suggestFor(offer({ productName: "Fully refined paraffin 56/58", grade: "56/58", specs: { melting_point: "56–58°C" } }), [paraffin])).toMatchObject([{ compatibility: "not_equivalent" }]);
    expect(suggestFor(offer({ specs: { melting_point: "48–52°C" } }), [paraffin])).toMatchObject([{ compatibility: "not_equivalent" }]);
    // Documents that contradict each other: nothing is said until the right one comes.
    expect(suggestFor(offer({ specs: { melting_point: "51–54°C in the table; 58–62°C among the properties" } }), [paraffin])).toMatchObject([{ compatibility: "awaiting_specs" }]);
    expect(suggestFor(offer({ specs: {} }), [paraffin])).toMatchObject([{ compatibility: "not_analyzed" }]);
  });

  it("proposes an offer quoted per tonne for a product bought by the kilo, and keeps its price as written", () => {
    const perTonne = offer({ productName: "Mock paraffin 52/54 slabs", grade: "52/54", specs: {}, unit: "t", unitPrice: 1520 });
    const [s] = suggestFor(perTonne, [paraffin]);
    expect(s).toMatchObject({ productId: "p1", compatibility: "possible" });
    expect(s.reasons.join(" ")).toContain("quoted per t where you buy per kg");
    expect(perTonne.unitPrice).toBe(1520);
    // Proposed is not comparable: it still needs a person's link, validation and its cost to the plant.
    expect(groupOf(perTonne, { state: "technical_review", compatibility: "possible", productUnit: "kg", landed: { complete: true }, today: TODAY, linked: false })).toBe("to_verify");
  });

  it("reads the same unit written two ways as one unit, and a count of a unit for what it holds", () => {
    const wick: MatchProduct = { id: "w1", name: "Mock wick 30 mm", unit: "pcs", subKey: "wick" };
    const perPiece = offer({ productName: "Stoppino mock cotone 30 mm", grade: null, category: "Stoppini", specs: {}, unit: "pz", unitPrice: 0.02 });
    expect(suggestFor(perPiece, [wick])[0].reasons.join(" ")).toContain("Same kind of product and same unit");
    const perThousand = offer({ productName: "Stoppino mock cotone 30 mm", grade: null, category: "Stoppini", specs: {}, unit: "1.000 pz", unitPrice: 18 });
    expect(suggestFor(perThousand, [wick])[0].reasons.join(" ")).toContain("quoted per 1.000 pz where you buy per pcs");
    expect([unitFactorOf("pz", "pcs"), unitFactorOf("1.000 pz", "pcs"), unitFactorOf("t", "kg"), unitFactorOf("box", "pcs")]).toEqual([1, 1000, 1000, null]);
    // A support for wicks is not a wick, whatever the category's name says after it.
    expect(suggestFor(offer({ productName: "Supporto SM/2", grade: null, category: "Supporti per stoppini", specs: {}, unit: "pz" }), [wick])).toEqual([]);
    // A box holds what each product puts in it: never converted, never proposed for pieces.
    expect(suggestFor(offer({ productName: "Stoppino mock cotone 30 mm", grade: null, category: "Stoppini", specs: {}, unit: "box" }), [wick])).toEqual([]);
  });

  it("proposes nothing across kinds or units, nothing a person declined, and never an equivalence", () => {
    expect(suggestFor(offer({ unit: "pcs" }), [paraffin])).toEqual([]);
    expect(suggestFor(offer(), [{ ...paraffin, subKey: "wick" }])).toEqual([]);
    expect(suggestFor(offer({ productName: "Something", grade: null, category: null }), [paraffin])).toEqual([]);
    expect(suggestFor(offer({ declinedProductIds: ["p1"] }), [paraffin])).toEqual([]);
    for (const specs of [{ melting_point: "52–54°C" }, {}, { melting_point: "60–62°C" }] as Record<string, string>[]) expect(suggestFor(offer({ specs }), [paraffin]).map((s) => s.compatibility)).not.toContain("validated");
  });
});

describe("the cost to the plant", () => {
  const ctx = { customs: true, destinationCity: "Mocktown" };
  const entry = (amount: number, more: Partial<NonNullable<LandedInput["freight"]>> = {}) => ({ amount, per: "unit" as const, currency: "EUR", status: "confirmed" as const, source: "forwarder", date: "2026-06-05", note: null, ...more });

  it("is incomplete while anything the terms leave to the buyer is missing — and then has no total", () => {
    const fob = landedCost(offer({ currency: "USD", unitPrice: 1.45, incoterm: "FOB", destination: "Dalian" }), {}, ctx);
    expect(fob.complete).toBe(false);
    expect(fob.total).toBeNull();
    expect(fob.missing).toEqual(["goods", "freight", "insurance", "duty", "clearance", "inland"]);
    expect(fob.fx).toMatchObject({ status: "missing" });
  });

  it("does not add again what the terms already include, whatever was typed in", () => {
    const cfr = landedCost(offer(), { freight: entry(0.2) }, ctx);
    expect(cfr.lines.find((l) => l.key === "freight")).toMatchObject({ status: "included", perUnit: 0 });
    expect(cfr.lines.find((l) => l.key === "freight")!.note).toContain("not added again");
    expect(cfr.missing).toEqual(["insurance", "duty", "clearance", "inland"]);
    expect(landedCost(offer({ incoterm: "CIF" }), {}, ctx).missing).toEqual(["duty", "clearance", "inland"]);
  });

  it("is the price itself for goods delivered to the plant from inside the customs area", () => {
    const dap = landedCost(offer({ incoterm: "DAP", destination: "Mocktown (MI)" }), {}, { customs: false, destinationCity: "Mocktown" });
    expect(dap).toMatchObject({ complete: true, total: 1.4, estimated: false });
    // Delivered somewhere else is not delivered to the plant.
    expect(landedCost(offer({ incoterm: "DAP", destination: "Elsewhere" }), {}, { customs: false, destinationCity: "Mocktown" }).missing).toEqual(["inland"]);
    expect(landedCost(offer({ incoterm: "DAP", destination: "Mocktown" }), {}, { customs: false, destinationCity: null }).missing).toEqual(["inland"]);
  });

  it("adds what was stated, each for what it is: per unit, for the shipment, a percentage of the customs value, at a dated rate", () => {
    const input: LandedInput = {
      fx: { rate: 0.9, date: "2026-06-05", source: "ECB", status: "confirmed" },
      freight: entry(2000, { per: "shipment" }),
      insurance: entry(0.01, { currency: "USD" }),
      duty: entry(5, { per: "percent" }),
      clearance: entry(0.005),
      inland: entry(0.03, { status: "estimated" }),
    };
    const landed = landedCost(offer({ currency: "USD", unitPrice: 1, incoterm: "FOB", quantity: 20000 }), input, ctx);
    const value = (key: string) => landed.lines.find((l) => l.key === key)!.perUnit!;
    expect(value("goods")).toBeCloseTo(0.9);
    expect(value("freight")).toBeCloseTo(0.1);
    expect(value("insurance")).toBeCloseTo(0.009);
    expect(value("duty")).toBeCloseTo((0.9 + 0.1 + 0.009) * 0.05);
    expect(landed.complete).toBe(true);
    expect(landed.total).toBeCloseTo(0.9 + 0.1 + 0.009 + 1.009 * 0.05 + 0.005 + 0.03);
    // One estimate makes the total an estimate.
    expect(landed.estimated).toBe(true);
    // Zero is a figure: a duty stated as nil is not a missing duty.
    expect(landedCost(offer(), { insurance: entry(0), duty: entry(0, { per: "percent" }), clearance: entry(0.01), inland: entry(0.02) }, ctx)).toMatchObject({ complete: true });
  });

  it("reads back only whole entries: no amount, no rate without its date and source", () => {
    expect(readLandedInput({ fx: { rate: 0.9 }, freight: { amount: "2", per: "unit" }, duty: { amount: 3, per: "percent", status: "confirmed" }, inland: { amount: 3, per: "percent" } })).toEqual({ duty: { amount: 3, per: "percent", currency: "EUR", status: "confirmed", source: null, date: null, note: null } });
  });
});

describe("an offer's life", () => {
  const known = { today: TODAY, superseded: false, awaitingSupplier: false, landed: { complete: true } };
  it("is decided by a refusal, then by time, then by its checks", () => {
    expect(offerState(offer(), known)).toBe("quote_received");
    expect(offerState(offer({ compatibility: "possible" }), known)).toBe("technical_review");
    expect(offerState(offer({ compatibility: "awaiting_specs" }), known)).toBe("awaiting_supplier_info");
    expect(offerState(offer({ compatibility: "not_equivalent" }), known)).toBe("not_comparable");
    expect(offerState(offer({ compatibility: "validated" }), { ...known, landed: { complete: false } })).toBe("commercial_review");
    expect(offerState(offer({ compatibility: "validated" }), known)).toBe("validated");
    expect(offerState(offer({ compatibility: "validated", validUntil: "2026-06-09" }), known)).toBe("expired");
    expect(offerState(offer({ compatibility: "validated" }), { ...known, superseded: true })).toBe("superseded");
    expect(offerState(offer({ compatibility: "validated", decision: "rejected" }), known)).toBe("rejected");
  });

  it("keeps the earlier versions of a line and knows the last", () => {
    const first = offer({ id: "a", unitPrice: 1.5, createdAt: "2026-06-01T10:00:00.000Z" });
    const second = offer({ id: "b", unitPrice: 1.4, createdAt: "2026-06-08T10:00:00.000Z" });
    const other = offer({ id: "c", incoterm: "FOB", createdAt: "2026-06-09T10:00:00.000Z" });
    expect([...supersededIds([second, other, first])]).toEqual([["a", "b"]]);
  });

  it("is comparable only when validated, linked, still valid on a stated date, in the product's unit and whole to the plant", () => {
    const yes = { state: "validated" as const, compatibility: "validated" as const, productUnit: "kg", landed: { complete: true }, today: TODAY, linked: true };
    expect(groupOf(offer(), yes)).toBe("comparable");
    expect(groupOf(offer(), { ...yes, linked: false })).toBe("to_verify");
    expect(groupOf(offer(), { ...yes, compatibility: "possible", state: "technical_review" })).toBe("to_verify");
    expect(groupOf(offer(), { ...yes, landed: { complete: false }, state: "commercial_review" })).toBe("to_verify");
    expect(groupOf(offer({ validUntil: "2026-06-01" }), { ...yes, state: "expired" })).toBe("to_verify");
    expect(groupOf(offer({ validUntil: null }), yes)).toBe("to_verify");
    // Quoted per tonne for a product bought by the kilo: one converts exactly into the other, and the price stays as quoted.
    expect(groupOf(offer({ unit: "t" }), yes)).toBe("comparable");
    expect(groupOf(offer({ unit: "pcs" }), yes)).toBe("to_verify");
    expect(shortfallsOf(offer({ unit: "pcs" }), { ...yes })).toEqual(["unit"]);
    // Another grade is never in the ranking, however complete its figures.
    expect(groupOf(offer(), { ...yes, compatibility: "not_equivalent", state: "not_comparable" })).toBe("other_grade");
    expect(groupOf(offer(), { ...yes, state: "superseded" })).toBe("history");
    expect(shortfallsOf(offer({ validUntil: "2026-06-01" }), { compatibility: "possible", productUnit: "kg", landed: { complete: false }, today: TODAY, linked: false })).toEqual(["not_linked", "compatibility", "expired", "landed"]);
  });
});

describe("what an alternative would be worth", () => {
  it("is the difference on the volume really bought, and says when the offer asks for more than a year's volume", () => {
    expect(savingOf({ currentCost: 1.5, alternativeCost: 1.38, annualVolume: 100000, minimum: 20000 })).toMatchObject({ pct: expect.closeTo(0.08, 5), overMinimum: false });
    expect(savingOf({ currentCost: 1.5, alternativeCost: 1.38, annualVolume: 100000, minimum: 20000 }).annual).toBeCloseTo(12000);
    expect(savingOf({ currentCost: 1.5, alternativeCost: 1.38, annualVolume: 15000, minimum: 20000 }).overMinimum).toBe(true);
    expect(savingOf({ currentCost: 1.5, alternativeCost: 1.6, annualVolume: null, minimum: null })).toMatchObject({ annual: null });
    expect(savingOf({ currentCost: 1.5, alternativeCost: 1.6, annualVolume: null, minimum: null }).perUnit).toBeLessThan(0);
  });
});

describe("privacy", () => {
  it("keeps a price quoted to the buyer inside its account: nothing of it is public", () => {
    expect(isPublic(OFFER_DATA_CLASS)).toBe(false);
    expect(publicOnly([offer(), offer({ id: "o2" })].map((o) => ({ ...o, dataClass: OFFER_DATA_CLASS })))).toEqual([]);
  });
});
describe("a cost to the plant that is not whole", () => {
  const fob = { unitPrice: 1.2, currency: "USD", quantity: 20000, incoterm: "FOB", destination: "Mock Port" };
  const ctx = { customs: true, destinationCity: "Mocktown" };
  it("says what is known so far and what it leaves out — a partial figure, never a total", () => {
    const l = landedCost(fob, { fx: { rate: 0.9, date: "2026-10-10", source: "Mock reference rate", status: "estimated" }, freight: { amount: 2000, per: "shipment", currency: "EUR", status: "estimated", source: "forwarder", date: "2026-10-10", note: null } }, ctx);
    expect(l.complete).toBe(false);
    expect(l.total).toBeNull();
    expect(l.partial).toMatchObject({ includes: ["goods", "freight"], excludes: ["insurance", "duty", "clearance", "inland"] });
    expect(l.partial!.perUnit).toBeCloseTo(1.18, 6);
  });
  it("has no partial figure without the goods in euro, and none once the cost is whole", () => {
    expect(landedCost(fob, {}, ctx).partial).toBeNull();
    const whole = landedCost({ unitPrice: 1.45, currency: "EUR", quantity: 20000, incoterm: "DAP", destination: "Mocktown" }, {}, { customs: false, destinationCity: "Mocktown" });
    expect(whole).toMatchObject({ complete: true, partial: null });
  });
});

