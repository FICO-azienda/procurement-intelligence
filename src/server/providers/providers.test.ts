/**
 * The adapters' parsing, on samples in the shape the real sources answer
 * with. No network here: nothing is fetched, and the figures are made up for
 * the test.
 */
import { describe, expect, it } from "vitest";
import { parseComext } from "./comext";
import { parseEcb, rateOn } from "./ecb";
import { connectedProviders, sourceStates } from "./index";
import { readHtml } from "./web-page";
import { webSearchProviders } from "./web-search";

describe("ECB reference rates", () => {
  const xml = `<Cube><Cube time='2026-10-02'><Cube currency='USD' rate='1.1225'/><Cube currency='GBP' rate='0.8410'/></Cube><Cube time='2026-10-01'><Cube currency='USD' rate='1.1200'/></Cube></Cube>`;
  it("gives the rate of the day, or of the last working day before it", () => {
    const days = parseEcb(xml);
    expect(rateOn(days, "USD", "2026-10-02")).toEqual({ rate: 1.1225, date: "2026-10-02" });
    // A Sunday: Friday's rate, and it says so.
    expect(rateOn(days, "usd", "2026-10-04")).toEqual({ rate: 1.1225, date: "2026-10-02" });
    expect(rateOn(days, "USD", "2026-09-30")).toBeNull();
    expect(rateOn(days, "XXX", "2026-10-02")).toBeNull();
  });
});

describe("Eurostat Comext", () => {
  const json = {
    updated: "2026-09-15T11:00:00+0200",
    value: { "0": 3_000_000, "1": 3_600_000, "2": 25_000, "3": 30_000 },
    id: ["freq", "reporter", "partner", "product", "flow", "indicators", "time"],
    size: [1, 1, 1, 1, 1, 2, 2],
    dimension: {
      product: { category: { index: { "271220": 0 }, label: { "271220": "Paraffin wax containing < 0,75% by weight of oil" } } },
      indicators: { category: { index: { VALUE_IN_EUROS: 0, QUANTITY_IN_100KG: 1 } } },
      time: { category: { index: { "2026-05": 0, "2026-06": 1 } } },
    },
  };
  it("reads value and weight month by month: a unit value at the border, not a product's price", () => {
    const series = parseComext(json, "271220", "IT")!;
    expect(series).toMatchObject({ code: "271220", reporter: "IT", updated: "2026-09-15", description: "Paraffin wax containing < 0,75% by weight of oil" });
    expect(series.months).toEqual([
      { period: "2026-05", valueEUR: 3_000_000, quantityKg: 2_500_000 },
      { period: "2026-06", valueEUR: 3_600_000, quantityKg: 3_000_000 },
    ]);
    expect(series.months[0].valueEUR / series.months[0].quantityKg).toBeCloseTo(1.2, 6);
  });
  it("months with no trade are left out, not counted as zero", () => {
    expect(parseComext({ ...json, value: { "0": 3_000_000, "2": 25_000 } }, "271220", "IT")!.months).toHaveLength(1);
  });
});

describe("a supplier's page", () => {
  it("is read as text: no scripts, no markup, with its title and declared name", () => {
    const page = readHtml(`<html><head><title>Mock Wax &ndash; Paraffin</title><meta property="og:site_name" content="Mock Wax GmbH"><meta name="description" content="Refined paraffin for candles"><script>var x = "paraffin 52/54";</script><style>p{}</style></head><body><h1>Waxes</h1><p>We produce paraffin&nbsp;wax.</p></body></html>`, "https://mock-wax.example.test/");
    expect(page).toMatchObject({ siteName: "Mock Wax GmbH", url: "https://mock-wax.example.test/" });
    expect(page.text).toContain("Refined paraffin for candles");
    expect(page.text).toContain("We produce paraffin wax.");
    expect(page.text).not.toContain("52/54");
  });
});

describe("which sources are on", () => {
  it("free public sources work with no key; web search needs one, read from the environment", () => {
    const none = connectedProviders({});
    expect(none.webSearch).toEqual([]);
    expect([none.pages[0].key, none.fx[0].key, none.trade[0].key]).toEqual(["web_page", "ecb", "eurostat_comext"]);
    expect(sourceStates({}).find((s) => s.key === "brave")).toMatchObject({ state: "needs_key", env: "BRAVE_SEARCH_API_KEY" });
    expect(webSearchProviders({ TAVILY_API_KEY: "test-key" }).map((p) => p.key)).toEqual(["tavily"]);
    expect(webSearchProviders({ BRAVE_SEARCH_API_KEY: "test-key", WEB_SEARCH_COST_PER_QUERY_EUR: "0.005" })[0]).toMatchObject({ key: "brave", costPerQuery: 0.005 });
    // The price of a search is never assumed.
    expect(webSearchProviders({ BRAVE_SEARCH_API_KEY: "test-key" })[0].costPerQuery).toBeNull();
  });
  it("premium providers have a place and no adapter: a key alone connects nothing", () => {
    expect(sourceStates({ PRICEPEDIA_API_KEY: "test-key" }).find((s) => s.key === "pricepedia")!.state).toBe("not_available");
    expect(connectedProviders({ RESEARCH_OFFLINE: "1" })).toMatchObject({ pages: [], fx: [], trade: [], webSearch: [] });
  });
});
