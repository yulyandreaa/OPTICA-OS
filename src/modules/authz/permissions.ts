/** Mirror of the `permissions` catalog (supabase/migrations/*_rbac_plans_onboarding.sql). */
export const PERMISSIONS = [
  "dashboard.view",
  "patients.read", "patients.create", "patients.update", "patients.delete", "patients.export",
  "appointments.read", "appointments.create", "appointments.update", "appointments.cancel", "schedules.manage",
  "medical_records.read", "medical_records.create", "medical_records.sign", "medical_records.amend",
  "prescriptions.read", "prescriptions.create",
  "inventory.read", "inventory.manage", "inventory.adjust", "inventory.transfer", "inventory.costs",
  "suppliers.read", "suppliers.manage", "purchases.read", "purchases.create", "purchases.approve",
  "sales.read", "sales.create", "sales.discount", "sales.refund", "pos.use", "cash.manage",
  "quotes.read", "quotes.create",
  "lab_orders.read", "lab_orders.create", "lab_orders.update", "lab_orders.qc",
  "billing.read", "billing.issue", "rips.read", "rips.manage",
  "crm.read", "crm.manage", "tasks.manage",
  "reports.read", "reports.financial",
  "team.read", "team.manage", "roles.manage",
  "branches.manage", "settings.manage", "integrations.manage", "subscription.manage", "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleCode =
  | "OWNER" | "ADMIN" | "BRANCH_MANAGER" | "OPTOMETRIST" | "OPHTHALMOLOGIST" | "SALES_REP" | "CASHIER"
  | "INVENTORY_MANAGER" | "ACCOUNTANT" | "LAB_TECHNICIAN" | "RECEPTIONIST" | "MARKETING" | "VIEWER";

/**
 * permission → "all" (tenant-wide) or the set of branch ids where it applies.
 * UI gating only: the database (RLS) is the source of truth.
 */
export type PermissionGrants = ReadonlyMap<Permission, "all" | ReadonlySet<string>>;

export function buildGrants(rows: { permission_code: string | null; branch_id: string | null }[]): PermissionGrants {
  const grants = new Map<Permission, "all" | Set<string>>();
  for (const { permission_code, branch_id } of rows) {
    if (!permission_code) continue;
    const perm = permission_code as Permission;
    const current = grants.get(perm);
    if (current === "all") continue;
    if (branch_id === null) grants.set(perm, "all");
    else grants.set(perm, new Set([...(current ?? []), branch_id]));
  }
  return grants;
}

/** branchId undefined → "anywhere"; a specific id → tenant-wide or bound to that branch. */
export function can(grants: PermissionGrants, permission: Permission, branchId?: string | null): boolean {
  const grant = grants.get(permission);
  if (!grant) return false;
  if (grant === "all" || branchId === undefined || branchId === null) return true;
  return grant.has(branchId);
}

export function canAny(grants: PermissionGrants, permissions: readonly Permission[]) {
  return permissions.some((p) => can(grants, p));
}
