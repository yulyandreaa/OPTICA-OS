import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { buildGrants, can, type Permission, type PermissionGrants } from "@/modules/authz/permissions";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type TenantSummary = Pick<Tables<"tenants">, "id" | "slug" | "trade_name" | "brand_color" | "logo_path">;

export interface AppContext {
  user: { id: string; email: string; fullName: string; firstName: string; isPlatformAdmin: boolean };
  tenant: Tables<"tenants">;
  memberships: TenantSummary[];
  branches: Pick<Tables<"branches">, "id" | "name" | "code" | "city" | "is_main">[];
  /** null = "todas las sedes" (only for users with tenant-wide scope). */
  activeBranchId: string | null;
  roles: { code: string; name: string; branchId: string | null }[];
  grants: PermissionGrants;
  subscription: { status: string; planCode: string; planName: string; trialEndsAt: string | null } | null;
  timezone: string;
}

/** Authenticated user (verified with the Auth server, not just the cookie). */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

/**
 * Resolves the tenant from the *server-side* session (profiles.active_tenant_id, validated by a DB trigger).
 * A tenant id coming from the browser is never trusted.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, active_tenant_id, active_branch_id, is_platform_admin")
    .eq("id", user.id)
    .single();

  const { data: memberships } = await supabase
    .from("tenant_members")
    .select("tenant:tenants!tenant_members_tenant_id_fkey(id, slug, trade_name, brand_color, logo_path)")
    .eq("user_id", user.id)
    .eq("status", "active");

  const tenants = (memberships ?? []).flatMap((m) => (m.tenant ? [m.tenant] : []));
  if (tenants.length === 0) return null;

  const tenantId = tenants.some((t) => t.id === profile?.active_tenant_id) ? profile!.active_tenant_id! : tenants[0]!.id;

  const [tenantRes, branchesRes, permsRes, rolesRes, subRes] = await Promise.all([
    supabase.from("tenants").select("*").eq("id", tenantId).single(),
    supabase.from("branches").select("id, name, code, city, is_main").eq("tenant_id", tenantId).is("deleted_at", null)
      .eq("status", "active").order("is_main", { ascending: false }).order("name"),
    supabase.rpc("my_permissions", { p_tenant: tenantId }),
    supabase.from("user_roles").select("branch_id, role:roles(code, name)").eq("tenant_id", tenantId).eq("user_id", user.id),
    supabase.from("subscriptions").select("status, trial_ends_at, plan:plans(code, name)").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!tenantRes.data) return null;

  const grants = buildGrants(permsRes.data ?? []);
  const roles = (rolesRes.data ?? []).flatMap((r) => (r.role ? [{ code: r.role.code, name: r.role.name, branchId: r.branch_id }] : []));
  const hasTenantWideScope = roles.some((r) => r.branchId === null);
  const scopedBranchIds = new Set(roles.map((r) => r.branchId).filter((b): b is string => b !== null));
  const allBranches = branchesRes.data ?? [];
  const branches = hasTenantWideScope ? allBranches : allBranches.filter((b) => scopedBranchIds.has(b.id));

  let activeBranchId = profile?.active_tenant_id === tenantId ? profile?.active_branch_id ?? null : null;
  if (activeBranchId && !branches.some((b) => b.id === activeBranchId)) activeBranchId = null;
  if (!activeBranchId && !hasTenantWideScope) activeBranchId = branches[0]?.id ?? null;

  const fullName = profile?.full_name || user.email?.split("@")[0] || "";

  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      fullName,
      firstName: fullName.split(" ")[0] ?? fullName,
      isPlatformAdmin: profile?.is_platform_admin ?? false,
    },
    tenant: tenantRes.data,
    memberships: tenants,
    branches,
    activeBranchId,
    roles,
    grants,
    subscription: subRes.data?.plan
      ? { status: subRes.data.status, planCode: subRes.data.plan.code, planName: subRes.data.plan.name, trialEndsAt: subRes.data.trial_ends_at }
      : null,
    timezone: tenantRes.data.timezone,
  };
});

/** For pages inside the dashboard: guarantees a session and a tenant. */
export async function requireContext(): Promise<AppContext> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const ctx = await getAppContext();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

/** Server-side permission gate for pages and actions (RLS still enforces underneath). */
export async function requirePermission(permission: Permission, branchId?: string | null): Promise<AppContext> {
  const ctx = await requireContext();
  if (!can(ctx.grants, permission, branchId)) redirect("/inicio?denied=1");
  return ctx;
}

export function primaryRole(ctx: AppContext): string {
  const order = ["OWNER", "ADMIN", "BRANCH_MANAGER", "OPTOMETRIST", "OPHTHALMOLOGIST", "SALES_REP", "RECEPTIONIST", "CASHIER",
    "INVENTORY_MANAGER", "ACCOUNTANT", "LAB_TECHNICIAN", "MARKETING", "VIEWER"];
  return [...ctx.roles].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))[0]?.code ?? "VIEWER";
}
