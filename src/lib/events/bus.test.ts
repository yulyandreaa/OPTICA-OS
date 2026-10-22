import { describe, expect, it, vi } from "vitest";
import { publish, subscribe } from "./bus";

describe("domain event bus", () => {
  it("delivers to every subscriber and isolates failures", async () => {
    const ok = vi.fn();
    subscribe("PatientCreated", () => { throw new Error("boom"); });
    subscribe("PatientCreated", ok);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await publish("PatientCreated", { tenantId: "t1", patientId: "p1" });
    expect(ok).toHaveBeenCalledWith({ tenantId: "t1", patientId: "p1" });
    expect(spy).toHaveBeenCalledOnce();
  });
});
