import { describe, expect, it } from "vitest";
import { parseDate, parseNumber } from "./parse";

describe("parseNumber", () => {
  it.each([
    ["1,58", 1.58],
    ["1.58", 1.58],
    ["0,074", 0.074],
    ["0.074", 0.074],
    ["20.000", 20000],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1,234,567", 1234567],
    ["€ 3.160", 3160],
    ["", null],
    ["abc", null],
  ])("%s → %s", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });
});

describe("parseDate", () => {
  it.each([
    ["2026-09-15", "2026-09-15"],
    ["15/09/2026", "2026-09-15"],
    ["5.9.2026", "2026-09-05"],
    ["31/02/2026", null],
    ["yesterday", null],
  ])("%s → %s", (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });
});
