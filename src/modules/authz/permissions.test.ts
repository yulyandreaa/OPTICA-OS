import { describe, expect, it } from "vitest";
import { buildGrants, can, canAny } from "./permissions";

describe("permission grants", () => {
  const grants = buildGrants([
    { permission_code: "patients.read", branch_id: null },
    { permission_code: "appointments.read", branch_id: "b1" },
    { permission_code: "appointments.read", branch_id: "b2" },
    { permission_code: "sales.create", branch_id: "b1" },
    { permission_code: "sales.create", branch_id: null },
  ]);

  it("tenant-wide grant applies to every branch", () => {
    expect(can(grants, "patients.read", "b9")).toBe(true);
  });
  it("branch-scoped grant only applies to its branches", () => {
    expect(can(grants, "appointments.read", "b2")).toBe(true);
    expect(can(grants, "appointments.read", "b3")).toBe(false);
  });
  it("a tenant-wide grant wins over branch-scoped ones", () => {
    expect(can(grants, "sales.create", "b7")).toBe(true);
  });
  it("missing permissions are denied", () => {
    expect(can(grants, "settings.manage")).toBe(false);
    expect(canAny(grants, ["settings.manage", "patients.read"])).toBe(true);
  });
});
