import { describe, expect, it } from "vitest";
import { currencyInText, normalizeCurrency } from "./currency";
import { detectDateOrder, parseDate } from "./dates";
import { detectDecimalStyle, parseNumber } from "./numbers";
import { companyKey, codeKey, productKey, vatKey } from "./text";
import { conversionFactor, normalizeUnit, splitQuantityAndUnit } from "./units";

describe("units", () => {
  it.each([
    ["kg", "kg"], ["KG", "kg"], ["Kg", "kg"], ["kilograms", "kg"], ["chilogrammi", "kg"], ["Kg.", "kg"],
    ["pcs", "pcs"], ["pieces", "pcs"], ["pz", "pcs"], ["PZ.", "pcs"], ["pezzi", "pcs"], ["nr", "pcs"],
    ["t", "t"], ["ton", "t"], ["tonnes", "t"], ["tonnellate", "t"],
    ["l", "l"], ["litres", "l"], ["litri", "l"], ["LT", "l"],
    ["m", "m"], ["meters", "m"], ["metri", "m"], ["mq", "m²"],
    ["cartoni", "box"], ["xyz", null], ["", null],
  ])("%s → %s", (raw, code) => {
    expect(normalizeUnit(raw)).toBe(code);
  });

  it("converts only within the same dimension", () => {
    expect(conversionFactor("t", "kg")).toBe(1000);
    expect(conversionFactor("ml", "l")).toBe(0.001);
    expect(conversionFactor("kg", "pcs")).toBeNull();
    expect(conversionFactor("box", "pcs")).toBeNull();
  });

  it("splits quantity and unit", () => {
    expect(splitQuantityAndUnit("2.000 kg")).toEqual({ numberText: "2.000", unit: "kg" });
    expect(splitQuantityAndUnit("25kg")).toEqual({ numberText: "25", unit: "kg" });
    expect(splitQuantityAndUnit("120")).toEqual({ numberText: "120", unit: null });
  });
});

describe("currency", () => {
  it.each([
    ["€", "EUR"], ["eur", "EUR"], ["Euro", "EUR"], ["$", "USD"], ["usd", "USD"], ["£", "GBP"],
    ["CHF", "CHF"], ["RMB", "CNY"], ["TL", "TRY"], ["", null], ["??", null],
  ])("%s → %s", (raw, code) => {
    expect(normalizeCurrency(raw)).toBe(code);
  });

  it("finds the currency inside an amount", () => {
    expect(currencyInText("€ 1,58")).toBe("EUR");
    expect(currencyInText("1.58 USD")).toBe("USD");
    expect(currencyInText("1,58")).toBeNull();
  });
});

describe("numbers", () => {
  it.each([
    ["1.234,50", 1234.5],
    ["1,234.50", 1234.5],
    ["1,58", 1.58],
    ["1.58", 1.58],
    ["0,074", 0.074],
    ["€ 3.160,00", 3160],
    ["1 234,50", 1234.5],
    ["1'234.50", 1234.5],
    ["(12,50)", -12.5],
    ["1.234,50-", -1234.5],
    ["2000", 2000],
  ])("%s → %s without ambiguity", (raw, value) => {
    expect(parseNumber(raw)).toEqual({ value, ambiguous: false });
  });

  it("flags values that can be read two ways", () => {
    expect(parseNumber("1.500")).toEqual({ value: 1500, ambiguous: true });
    expect(parseNumber("1,500").ambiguous).toBe(true);
  });

  it("resolves ambiguity with the file's decimal style", () => {
    expect(parseNumber("1.500", "comma")).toEqual({ value: 1500, ambiguous: false });
    expect(parseNumber("1,500", "dot")).toEqual({ value: 1500, ambiguous: false });
    expect(parseNumber("1.500", "dot")).toEqual({ value: 1.5, ambiguous: false });
  });

  it("flags a value that contradicts the file's style", () => {
    expect(parseNumber("1.58", "comma").ambiguous).toBe(true);
  });

  it("rejects text", () => {
    expect(parseNumber("abc").error).toBeTruthy();
    expect(parseNumber("1.2.3,4,5").value).toBeNull();
  });

  it("detects the decimal style of a column", () => {
    expect(detectDecimalStyle(["1.500", "1,58", "2.000"])).toEqual({ style: "comma", conflict: false });
    expect(detectDecimalStyle(["1,500", "1.58"])).toEqual({ style: "dot", conflict: false });
    expect(detectDecimalStyle(["1.500", "2.000"])).toEqual({ style: null, conflict: false });
    expect(detectDecimalStyle(["1,58", "1.58"]).conflict).toBe(true);
  });
});

describe("dates", () => {
  it.each([
    ["2026-09-15", "2026-09-15"],
    ["15/09/2026", "2026-09-15"],
    ["15.09.26", "2026-09-15"],
    ["15 settembre 2026", "2026-09-15"],
    ["15 Sep 2026", "2026-09-15"],
    ["Sep 15, 2026", "2026-09-15"],
    ["31/02/2026", null],
  ])("%s → %s", (raw, iso) => {
    expect(parseDate(raw)).toBe(iso);
  });

  it("reads month-first only when the column proves it", () => {
    expect(detectDateOrder(["09/15/2026", "10/01/2026"])).toEqual({ order: "mdy", conflict: false });
    expect(detectDateOrder(["01/09/2026", "02/09/2026"])).toEqual({ order: "dmy", conflict: false });
    expect(detectDateOrder(["15/09/2026", "09/15/2026"]).conflict).toBe(true);
    expect(parseDate("09/15/2026", "mdy")).toBe("2026-09-15");
  });

  it("reads Excel serial dates", () => {
    expect(parseDate(46280)).toBe("2026-09-15");
  });
});

describe("text keys", () => {
  it("ignores legal forms in company names", () => {
    expect(companyKey("ABC S.r.l.")).toBe("abc");
    expect(companyKey("ABC SRL")).toBe("abc");
    expect(companyKey("Vetreria Rossi S.p.A.")).toBe("vetreria rossi");
    expect(companyKey("Turkish Wax Limited")).toBe("turkish wax");
    expect(companyKey("Glaswerk GmbH & Co. KG")).toBe("glaswerk");
    expect(companyKey("Szkło Nova Sp. z o.o.")).toBe("szklo nova");
  });

  it("normalizes product text and codes", () => {
    expect(productKey("PARAFFINA RAFFINATA 58-60")).toBe("paraffina raffinata 58 60");
    expect(productKey("Vetro 300ml")).toBe("vetro 300 ml");
    expect(codeKey("PAR 5860")).toBe(codeKey("par-5860"));
    expect(vatKey("IT 01234567890")).toBe(vatKey("01234567890"));
  });
});
