import { describe, expect, it } from "vitest";
import { canTransition } from "./status";

describe("appointment status machine", () => {
  it("follows the check-in journey", () => {
    expect(canTransition("scheduled", "checked_in")).toBe(true);
    expect(canTransition("checked_in", "waiting")).toBe(true);
    expect(canTransition("waiting", "in_consultation")).toBe(true);
    expect(canTransition("in_consultation", "completed")).toBe(true);
  });
  it("blocks invalid jumps", () => {
    expect(canTransition("scheduled", "completed")).toBe(false);
    expect(canTransition("completed", "cancelled")).toBe(false);
  });
});
