import { describe, expect, it } from "vitest";
import { countryOfVat } from "./countries";

describe("the country a VAT number names", () => {
  it("is read from its own two-letter prefix, Greece's EL included", () => {
    expect(countryOfVat("TR8390012345")).toBe("Turkey");
    expect(countryOfVat("IT01234567890")).toBe("Italy");
    expect(countryOfVat(" de 123456789")).toBe("Germany");
    expect(countryOfVat("EL123456789")).toBe("Greece");
  });
  it("is nothing when the number has no prefix or a prefix we do not know: nothing is guessed", () => {
    expect(countryOfVat("01234567890")).toBeNull();
    expect(countryOfVat("ZZ12345678")).toBeNull();
    expect(countryOfVat(null)).toBeNull();
  });
});
