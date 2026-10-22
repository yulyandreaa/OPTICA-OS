import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";

export async function listLabOrders(db: ServerSupabase, tenantId: string, branchId: string | null) {
  let q = db.from("lab_orders")
    .select("id, number, status, estimated_at, frame_description, lens_description, created_at, updated_at, patient:patients(id, full_name), lab:labs(name)")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data } = await q;
  return data ?? [];
}

export async function getLabOrder(db: ServerSupabase, tenantId: string, id: string) {
  const [{ data: order }, { data: events }] = await Promise.all([
    db.from("lab_orders")
      .select("*, patient:patients(id, full_name, phone, whatsapp), lab:labs(name, phone), branch:branches(name), sale:sales(id, number, balance), prescription:prescriptions(id, number, od_sphere, od_cylinder, od_axis, od_add, oi_sphere, oi_cylinder, oi_axis, oi_add, od_prism, od_base, od_va, oi_prism, oi_base, oi_va)")
      .eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    db.from("lab_order_events").select("id, status, note, created_at, actor:profiles(full_name)").eq("tenant_id", tenantId).eq("order_id", id).order("created_at"),
  ]);
  return order ? { order, events: events ?? [] } : null;
}
