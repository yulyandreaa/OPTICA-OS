import { describe, expect, it } from "vitest";
import { nitCheckDigit, slugify } from "./nit";

describe("nitCheckDigit", () => {
  it("computes DIAN check digits", () => {
    expect(nitCheckDigit("900123456")).toBe("8");
    expect(nitCheckDigit("860.002.964")).toBe("4"); // Bancolombia-style formatting tolerated
    expect(nitCheckDigit("800197268")).toBe("4"); // DIAN
  });
  it("rejects invalid lengths", () => expect(nitCheckDigit("12")).toBeNull());
});

describe("slugify", () => {
  it("strips accents and symbols", () => expect(slugify("Óptica Nova Visión S.A.S.")).toBe("optica-nova-vision-s-a-s"));
});
