import { describe, expect, it } from "vitest";
import { formatDiopter } from "./constants";

describe("formatDiopter", () => {
  it("formats like a prescription", () => {
    expect(formatDiopter("-1.25")).toBe("−1.25");
    expect(formatDiopter(0.5)).toBe("+0.50");
    expect(formatDiopter("0")).toBe("Neutro");
    expect(formatDiopter("")).toBe("—");
  });
});

import { examSchema } from "./schemas";
describe("refraction validation", () => {
  it("requires an axis when there is cylinder", () => {
    expect(examSchema.safeParse({ refraction: { od: { sphere: "-1.00", cylinder: "-0.50" } } }).success).toBe(false);
    expect(examSchema.safeParse({ refraction: { od: { sphere: "-1.00", cylinder: "-0.50", axis: "180" } } }).success).toBe(true);
  });
  it("rejects non 0.25 steps", () => expect(examSchema.safeParse({ refraction: { od: { sphere: "-1.10" } } }).success).toBe(false));
});
