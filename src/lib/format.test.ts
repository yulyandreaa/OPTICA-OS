import { describe, expect, it } from "vitest";
import { addDaysKey, ageFrom, formatMoney, localDateKey, minutesInTz, weekdayOfKey, zonedTimeToUtc } from "./format";

describe("dates (America/Bogota, UTC-5)", () => {
  it("converts wall-clock time to UTC", () => {
    expect(zonedTimeToUtc("2026-10-16", "09:30").toISOString()).toBe("2026-10-16T14:30:00.000Z");
  });
  it("reads local minutes and date keys back", () => {
    const d = new Date("2026-10-17T03:15:00Z"); // 22:15 on the 16th in Bogotá
    expect(localDateKey(d)).toBe("2026-10-16");
    expect(minutesInTz(d)).toBe(22 * 60 + 15);
  });
  it("does calendar arithmetic across months", () => {
    expect(addDaysKey("2026-10-30", 3)).toBe("2026-11-02");
    expect(weekdayOfKey("2026-10-16")).toBe(5); // viernes
  });
  it("computes age", () => expect(ageFrom("1990-10-17", new Date("2026-10-16T12:00:00"))).toBe(35));
});

describe("money", () => {
  it("formats COP without decimals", () => expect(formatMoney(8450000).replace(/\s/g, " ")).toBe("$ 8.450.000"));
});
