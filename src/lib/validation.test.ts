import { describe, expect, it } from "vitest";
import { demoFile } from "./static-demo";
import { fieldErrors, purchaseInput, quoteInput } from "./validation";

const base = { productId: "00000000-0000-4000-8000-000000000001", supplierId: "00000000-0000-4000-8000-000000000002", quantity: "100", unitPrice: "1,5" };
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });

describe("dates of what already happened", () => {
  it("accepts today and the past, refuses a day after today for a purchase and a quote", () => {
    expect(purchaseInput.safeParse({ ...base, date: iso(0) }).success).toBe(true);
    expect(purchaseInput.safeParse({ ...base, date: "2024-01-15" }).success).toBe(true);
    const future = purchaseInput.safeParse({ ...base, date: iso(40) });
    expect(future.success).toBe(false);
    if (!future.success) expect(fieldErrors(future.error).date).toBe("Date cannot be in the future");
    expect(quoteInput.safeParse({ ...base, date: iso(40) }).success).toBe(false);
  });
});

describe("files of the read-only demo", () => {
  it("names each export by its address", () => {
    expect(demoFile("/export/products")).toBe("/export/products.csv");
    expect(demoFile("/export/comparison?product=abc")).toBe("/export/comparison-abc.csv");
    expect(demoFile("/export/market/candle_containers")).toBe("/export/market/candle_containers.xlsx");
    expect(demoFile("/export/data")).toBe("/export/data.ndjson");
  });
});
