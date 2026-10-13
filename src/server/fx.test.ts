/** Exchange rates in one place: a rate comes from a source or there is none. The provider here is a mock. */
import { describe, expect, it } from "vitest";
import type { FXProvider } from "@/lib/sourcing/providers";
import { referenceRate } from "./fx";

const mock = (rate: number | null): FXProvider => ({ key: "mock", name: "Mock rates", rate: async (_currency, date) => (rate == null ? null : { rate, date: date === "2026-10-11" ? "2026-10-09" : date, sourceName: "Mock reference rates", sourceUrl: "https://rates.example" }) });
const broken: FXProvider = { key: "broken-mock", name: "Broken mock", rate: async () => Promise.reject(new Error("mock outage")) };

describe("a reference rate", () => {
  it("is what the source publishes, read both ways, with its day and its source", async () => {
    expect(await referenceRate("usd", "2026-10-12", [mock(1.1)])).toEqual({ currency: "USD", eurPerUnit: 0.909091, unitsPerEur: 1.1, date: "2026-10-12", source: "Mock reference rates", sourceUrl: "https://rates.example" });
  });
  it("says which day it is of, when the day asked has none", async () => {
    expect((await referenceRate("USD", "2026-10-11", [mock(1.1)]))!.date).toBe("2026-10-09");
  });
  it("is never made up: no source, a source with no rate, a source that fails — there is none", async () => {
    expect(await referenceRate("USD", "2026-10-12", [])).toBeNull();
    expect(await referenceRate("USD", "2026-10-12", [mock(null)])).toBeNull();
    expect(await referenceRate("USD", "2026-10-12", [broken])).toBeNull();
    expect(await referenceRate("USD", "2026-10-12", [mock(0)])).toBeNull();
  });
  it("asks the next source when one fails", async () => {
    expect((await referenceRate("USD", "2026-10-12", [broken, mock(1.25)]))!.eurPerUnit).toBe(0.8);
  });
  it("needs a currency and a day that are ones", async () => {
    expect(await referenceRate("dollars", "2026-10-12", [mock(1.1)])).toBeNull();
    expect(await referenceRate("USD", "yesterday", [mock(1.1)])).toBeNull();
    expect(await referenceRate("EUR", "2026-10-12", [])).toMatchObject({ eurPerUnit: 1, unitsPerEur: 1 });
  });
});
