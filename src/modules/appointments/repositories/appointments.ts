import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";

const APPOINTMENT_FIELDS =
  "id, branch_id, starts_at, ends_at, status, source, notes, specialist_id, checked_in_at, started_at, " +
  "patient:patients(id, full_name, phone, document_type, document_number), " +
  "type:appointment_types(id, name, color, duration_minutes), " +
  "specialist:profiles!appointments_specialist_profile_fkey(id, full_name), branch:branches(id, name)";

export async function listAppointments(
  db: ServerSupabase, tenantId: string, opts: { branchId: string | null; fromUtc: Date; toUtc: Date; specialistId?: string },
) {
  let q = db
    .from("appointments")
    .select(APPOINTMENT_FIELDS)
    .eq("tenant_id", tenantId)
    .gte("starts_at", opts.fromUtc.toISOString())
    .lt("starts_at", opts.toUtc.toISOString())
    .order("starts_at");
  if (opts.branchId) q = q.eq("branch_id", opts.branchId);
  if (opts.specialistId) q = q.eq("specialist_id", opts.specialistId);
  const { data, error } = await q.overrideTypes<AppointmentRow[], { merge: false }>();
  if (error) throw error;
  return data ?? [];
}

export interface AppointmentRow {
  id: string;
  branch_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  notes: string | null;
  specialist_id: string | null;
  checked_in_at: string | null;
  started_at: string | null;
  patient: { id: string; full_name: string; phone: string | null; document_type: string; document_number: string } | null;
  type: { id: string; name: string; color: string; duration_minutes: number } | null;
  specialist: { id: string; full_name: string } | null;
  branch: { id: string; name: string } | null;
}

/** Specialists = members with a configured schedule (readable by anyone with appointments.read). */
export async function listSpecialists(db: ServerSupabase, tenantId: string, branchId: string | null) {
  let q = db.from("specialist_schedules").select("user_id, branch_id, weekday, start_time, end_time, profile:profiles!specialist_schedules_profile_fkey(id, full_name)").eq("tenant_id", tenantId);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data } = await q;
  const byUser = new Map<string, { id: string; name: string; schedules: { weekday: number; start: string; end: string; branchId: string }[] }>();
  for (const s of data ?? []) {
    if (!s.profile) continue;
    const entry = byUser.get(s.user_id) ?? { id: s.user_id, name: s.profile.full_name, schedules: [] };
    entry.schedules.push({ weekday: s.weekday, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), branchId: s.branch_id });
    byUser.set(s.user_id, entry);
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function listAppointmentTypes(db: ServerSupabase, tenantId: string) {
  const { data } = await db
    .from("appointment_types")
    .select("id, name, color, duration_minutes, is_clinical")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("sort_order");
  return data ?? [];
}
