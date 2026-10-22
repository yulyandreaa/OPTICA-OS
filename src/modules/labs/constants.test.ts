import { describe, expect, it } from "vitest";
import { nextStatus, trackStep } from "./constants";

describe("lab order flow", () => {
  it("advances in order", () => {
    expect(nextStatus("pending")).toBe("sent");
    expect(nextStatus("quality_control")).toBe("ready");
    expect(nextStatus("delivered")).toBeNull();
  });
  it("maps to patient tracking steps", () => {
    expect(trackStep("in_process")).toBe(1);
    expect(trackStep("received")).toBe(3);
  });
});
