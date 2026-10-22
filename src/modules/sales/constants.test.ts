import { describe, expect, it } from "vitest";
import { lineTotals } from "./constants";

describe("sale line math (IVA incluido)", () => {
  it("derives tax from an IVA-inclusive price", () => {
    expect(lineTotals(1, 119000, 0, 19)).toEqual({ total: 119000, tax: 19000 });
  });
  it("applies discounts before tax", () => expect(lineTotals(2, 50000, 10000, 19).total).toBe(90000));
  it("handles exempt services", () => expect(lineTotals(1, 60000, 0, 0).tax).toBe(0));
});
