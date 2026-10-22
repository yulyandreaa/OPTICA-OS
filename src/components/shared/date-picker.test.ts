import { describe, expect, it } from "vitest";
import { parseTypedDate } from "./date-picker";

describe("parseTypedDate", () => {
  it("acepta dd/mm/aaaa con o sin separadores", () => {
    expect(parseTypedDate("15/03/1990")).toBe("1990-03-15");
    expect(parseTypedDate("15031990")).toBe("1990-03-15");
    expect(parseTypedDate("5/3/1990")).toBe("1990-03-05");
  });
  it("rechaza fechas que no existen", () => {
    expect(parseTypedDate("31/02/1990")).toBeNull();
    expect(parseTypedDate("1990-03-15")).toBeNull();
    expect(parseTypedDate("abc")).toBeNull();
  });
});
