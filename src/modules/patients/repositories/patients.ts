import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { PatientListParams } from "../schemas";
import { searchFilter } from "../utils/search";

export const PAGE_SIZE = 25;

/** Cursor = "<created_at>|<id>" of the last row (stable keyset pagination; never loads the whole table). */
function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString().split("|");
  return createdAt && id ? { createdAt, id } : null;
}
function encodeCursor(createdAt: string, id: string) {
  return Buffer.from(`${createdAt}|${id}`).toString("base64url");
}

export async function listPatients(db: ServerSupabase, tenantId: string, params: PatientListParams) {
  let query = db
    .from("patients")
    .select("id, full_name, document_type, document_number, phone, email, is_customer, is_patient, is_active, created_at")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  // Relationship filter. "inactivos" lists only inactive people; every other tab only active ones.
  if (params.tipo === "inactivos") query = query.eq("is_active", false);
  else {
    query = query.eq("is_active", true);
    if (params.tipo === "clientes") query = query.eq("is_customer", true);
    if (params.tipo === "pacientes") query = query.eq("is_patient", true);
    if (params.tipo === "ambos") query = query.eq("is_customer", true).eq("is_patient", true);
  }
  if (params.q) query = applySearch(query, params.q);
  if (params.branch) query = query.eq("home_branch_id", params.branch);
  if (params.segment === "new") query = query.gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());

  const cursor = decodeCursor(params.cursor);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page.at(-1);
  return { rows: page, nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the PostgREST builder type is not worth spelling out here
function applySearch<Q extends { ilike: any; or: any }>(query: Q, raw: string): Q {
  const f = searchFilter(raw);
  if (!f.value) return query;
  if (f.kind === "email") return query.ilike("email", `${f.value}%`);
  if (f.kind === "number") return query.or(`document_number.ilike.${f.value}%,phone.ilike.%${f.value}%,whatsapp.ilike.%${f.value}%`);
  if (f.kind === "document") return query.ilike("document_number", `${f.value}%`);
  return query.ilike("full_name", `%${f.value}%`);
}

export async function getPeopleSummary(db: ServerSupabase, tenantId: string) {
  const { data, error } = await db.rpc("people_summary", { p_tenant: tenantId });
  if (error) throw error;
  const s = data as Record<string, number>;
  return { total: Number(s.total), customers: Number(s.customers), patients: Number(s.patients), both: Number(s.both), inactive: Number(s.inactive) };
}

export async function countPatients(db: ServerSupabase, tenantId: string) {
  const { count } = await db.from("patients").select("id", { count: "estimated", head: true }).eq("tenant_id", tenantId).is("deleted_at", null);
  return count ?? 0;
}

export async function getPatient(db: ServerSupabase, tenantId: string, id: string) {
  const { data, error } = await db
    .from("patients")
    .select("*, home_branch:branches(id, name), assignee:profiles!patients_assigned_profile_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  // Inactive people stay readable: their history must remain accessible.
  if (error) throw error;
  return data;
}

export async function getPatientTimeline(db: ServerSupabase, tenantId: string, patientId: string, limit = 30) {
  const { data } = await db
    .from("patient_activities")
    .select("id, type, title, occurred_at, actor:profiles(full_name)")
    .eq("tenant_id", tenantId)
    .eq("patient_id", patientId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getPatientAppointments(db: ServerSupabase, tenantId: string, patientId: string) {
  const { data } = await db
    .from("appointments")
    .select("id, starts_at, ends_at, status, type:appointment_types(name, color), branch:branches(name), specialist:profiles!appointments_specialist_profile_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .eq("patient_id", patientId)
    .order("starts_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function getPatientConsents(db: ServerSupabase, tenantId: string, patientId: string) {
  const { data } = await db
    .from("patient_consents")
    .select("id, consent_type, version, granted, granted_at, revoked_at")
    .eq("tenant_id", tenantId)
    .eq("patient_id", patientId)
    .order("granted_at", { ascending: false });
  return data ?? [];
}
