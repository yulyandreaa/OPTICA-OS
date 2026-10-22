import { describe, expect, it } from "vitest";
import { delta, healthScore, type DashboardMetrics } from "./metrics";

const base: DashboardMetrics = {
  appointments_today: 0, completed_today: 0, waiting_now: 0, in_consultation_now: 0, unconfirmed_tomorrow: 0,
  consultations_month: 0, consultations_prev_month: 0, no_show_30d: 0, finished_30d: 0, cancelled_30d: 0, cancelled_prev_30d: 0,
  new_patients_month: 0, new_patients_prev_month: 0, patients_total: 0, online_bookings_month: 0,
};

describe("dashboard metrics", () => {
  it("never invents a trend without baseline", () => expect(delta(10, 0)).toBeNull());
  it("computes percent change", () => expect(delta(12, 10)).toBe(20));
  it("returns no score without data", () => expect(healthScore(base)).toBeNull());
  it("scores and explains available signals", () => {
    const hs = healthScore({ ...base, new_patients_month: 30, new_patients_prev_month: 20, no_show_30d: 2, finished_30d: 40, cancelled_30d: 8, cancelled_prev_30d: 7 })!;
    expect(hs.score).toBeGreaterThan(60);
    expect(hs.parts.map((p) => p.label)).toEqual(["Captación", "Asistencia", "Cancelaciones"]);
    expect(hs.parts[2]!.insight).toContain("aumentaron 14%");
  });
});
