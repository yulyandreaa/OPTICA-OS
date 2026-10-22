import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/modules/tenants/services/context";

/**
 * Platform (SaaS) super admin. Completely separate from tenant dashboards.
 * Reads go through the service role ONLY after verifying `is_platform_admin`, and every access is audited.
 * It never reads clinical tables.
 */
export async function requirePlatformAdmin() {
  const user = await getCurrentUser();
  if (!user) notFound();
  const { data } = await (await createClient()).from("profiles").select("is_platform_admin").eq("id", user.id).single();
  if (!data?.is_platform_admin) notFound();
  return user;
}

export async function auditPlatformAccess(userId: string, action: string, entityId?: string) {
  const h = await headers();
  await createAdminClient().from("audit_logs").insert({
    user_id: userId, action, entity_type: "platform", entity_id: entityId ?? null,
    ip_address: h.get("x-forwarded-for")?.split(",")[0] ?? null, user_agent: h.get("user-agent"),
  });
}

export async function getPlatformOverview() {
  const admin = createAdminClient();
  const [{ data: tenants }, { data: subs }] = await Promise.all([
    admin.from("tenants").select("id, trade_name, slug, city, status, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    admin.from("subscriptions").select("tenant_id, status, trial_ends_at, plan:plans(code, name, price_monthly)"),
  ]);
  const subByTenant = new Map((subs ?? []).map((s) => [s.tenant_id, s]));
  const rows = (tenants ?? []).map((t) => ({ ...t, subscription: subByTenant.get(t.id) ?? null }));
  const paying = rows.filter((r) => r.subscription?.status === "active");
  const mrr = paying.reduce((sum, r) => sum + Number(r.subscription?.plan?.price_monthly ?? 0), 0);
  return {
    rows,
    stats: {
      tenants: rows.length,
      trialing: rows.filter((r) => r.subscription?.status === "trialing").length,
      active: paying.length,
      pastDue: rows.filter((r) => r.subscription?.status === "past_due").length,
      mrr,
      arr: mrr * 12,
      arpu: paying.length ? Math.round(mrr / paying.length) : 0,
    },
  };
}
