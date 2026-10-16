import { describe, expect, it } from "vitest";
import { translator } from "./i18n";
import { readSetup } from "./setup";

const answer = { companyName: "  Mock Candles  S.r.l. ", country: "Italia", vatNumber: "IT 01234567890", userName: "", deliveryCity: "Mockville", deliveryProvince: "MV", language: "it" };

describe("the first start", () => {
  it("reads the company as written, tidied, with nothing added", () => {
    expect(readSetup(answer)).toEqual({
      value: { companyName: "Mock Candles S.r.l.", country: "Italia", vatNumber: "IT 01234567890", userName: null, deliveryCity: "Mockville", deliveryProvince: "MV", language: "it" },
      errors: {},
    });
  });

  it("asks for the name and the country, and nothing else", () => {
    const { value, errors } = readSetup({ language: "en" });
    expect(value).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["companyName", "country"]);
    expect(readSetup({ companyName: "Mock Srl", country: "Italy", language: "en" }).value).toMatchObject({ vatNumber: null, deliveryCity: null });
  });

  it("refuses a VAT number that is not one, or that names another country than the one written", () => {
    expect(readSetup({ ...answer, vatNumber: "123" }).errors.vatNumber).toBe("This does not look like a VAT number.");
    // The prefix says Germany, the company said Italy: one of the two is wrong, and nothing is guessed.
    expect(readSetup({ ...answer, vatNumber: "DE123456789" }).errors.vatNumber).toBe("This VAT number names Germany as its country, not Italia: check one of the two.");
    expect(readSetup({ ...answer, vatNumber: "DE123456789" }, translator("it")).errors.vatNumber).toBe("Questa partita IVA indica come paese Germania, non Italia: controlla uno dei due.");
    // "Italy" and "Italia" are one place; a number with no prefix names no country.
    expect(readSetup({ ...answer, country: "Italy", vatNumber: "IT01234567890" }).errors).toEqual({});
    expect(readSetup({ ...answer, vatNumber: "01234567890" }).errors).toEqual({});
  });

  it("takes only a language the app speaks", () => {
    expect(readSetup({ ...answer, language: "fr" }).errors.language).toBe("Choose a language.");
  });
});
