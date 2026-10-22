import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";

export async function listRecords(db: ServerSupabase, tenantId: string, opts: { status?: string; professionalId?: string; limit?: number } = {}) {
  let q = db.from("medical_records")
    .select("id, number, status, record_type, chief_complaint, created_at, signed_at, patient:patients(id, full_name, document_type, document_number), professional:profiles!medical_records_professional_profile_fkey(full_name), branch:branches(name)")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.professionalId) q = q.eq("professional_id", opts.professionalId);
  const { data } = await q;
  return data ?? [];
}

export async function getRecord(db: ServerSupabase, tenantId: string, id: string) {
  const { data } = await db.from("medical_records")
    .select("*, patient:patients(id, full_name, document_type, document_number, birth_date, sex, phone), professional:profiles!medical_records_professional_profile_fkey(full_name), branch:branches(name)")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return data;
}

export async function getAmendments(db: ServerSupabase, tenantId: string, recordId: string) {
  const { data } = await db.from("medical_record_amendments")
    .select("id, reason, previous, changes, amended_at, content_hash, author:profiles(full_name)")
    .eq("tenant_id", tenantId).eq("record_id", recordId).order("amended_at");
  return data ?? [];
}

export async function getPrescription(db: ServerSupabase, tenantId: string, id: string) {
  const { data } = await db.from("prescriptions")
    .select("*, patient:patients(full_name, document_type, document_number, birth_date), professional:profiles!prescriptions_professional_profile_fkey(full_name)")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return data;
}

export async function listPatientPrescriptions(db: ServerSupabase, tenantId: string, patientId: string) {
  const { data } = await db.from("prescriptions")
    .select("id, number, issued_at, expires_at, kind, od_sphere, od_cylinder, od_axis, od_add, oi_sphere, oi_cylinder, oi_axis, oi_add, lens_type, material, professional:profiles!prescriptions_professional_profile_fkey(full_name)")
    .eq("tenant_id", tenantId).eq("patient_id", patientId).order("issued_at", { ascending: false });
  return data ?? [];
}
