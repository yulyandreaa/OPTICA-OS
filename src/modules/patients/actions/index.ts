"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { clientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";
import { patientSchema, type PatientFormInput } from "../schemas";
import { toPatientRow } from "../utils/mappers";

const DATA_POLICY_VERSION = "2026-10";

const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "23505";

/** Same type + number already registered in this company → point to that record instead of a generic error. */
async function duplicateDocument(db: Awaited<ReturnType<typeof createClient>>, tenantId: string, type: string, number: string, exclude?: string) {
  let q = db.from("patients").select("id, full_name").eq("tenant_id", tenantId).eq("document_type", type).eq("document_number", number.toUpperCase()).is("deleted_at", null);
  if (exclude) q = q.neq("id", exclude);
  const { data } = await q.maybeSingle();
  return data;
}

export async function createPatientAction(input: PatientFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.create")) return fail("No tienes permiso para crear registros.");
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const db = await createClient();
  const existing = await duplicateDocument(db, ctx.tenant.id, parsed.data.documentType, parsed.data.documentNumber);
  if (existing) return fail(`Ya existe ${existing.full_name} con ese documento.`, { documentNumber: [`Ya registrado: ${existing.full_name}`] });

  const { data, error } = await db
    .from("patients")
    .insert({ ...toPatientRow(parsed.data), tenant_id: ctx.tenant.id, created_by: ctx.user.id, home_branch_id: parsed.data.homeBranchId ?? ctx.activeBranchId })
    .select("id")
    .single();
  if (error) return isUniqueViolation(error) ? fail("Ya existe una persona con ese documento.", { documentNumber: ["Ya registrado"] }) : fromError("patients.create", error);

  const consents = [
    parsed.data.acceptDataPolicy && "data_processing",
    parsed.data.acceptMarketing && "marketing",
  ].filter((c): c is "data_processing" | "marketing" => Boolean(c));
  if (consents.length) {
    const ip = await clientIp();
    await db.from("patient_consents").insert(consents.map((consent_type) => ({
      tenant_id: ctx.tenant.id, patient_id: data.id, consent_type, version: DATA_POLICY_VERSION, granted: true,
      ip_address: ip, recorded_by: ctx.user.id,
    })));
  }

  revalidatePath("/pacientes");
  return ok({ id: data.id }, "Registro creado");
}

export async function updatePatientAction(id: string, input: PatientFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.update")) return fail("No tienes permiso para editar registros.");
  if (!z.uuid().safeParse(id).success) return fail("Registro no válido");
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const db = await createClient();
  const existing = await duplicateDocument(db, ctx.tenant.id, parsed.data.documentType, parsed.data.documentNumber, id);
  if (existing) return fail(`Ese documento ya pertenece a ${existing.full_name}.`, { documentNumber: [`Ya registrado: ${existing.full_name}`] });

  // A role backed by real history cannot be removed by hand (it would hide that history's context).
  const [sales, quotes, visits, records] = await Promise.all([
    db.from("sales").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).eq("patient_id", id),
    db.from("quotes").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).eq("patient_id", id),
    db.from("appointments").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).eq("patient_id", id),
    db.from("prescriptions").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).eq("patient_id", id),
  ]);
  if (parsed.data.relation === "patient" && ((sales.count ?? 0) + (quotes.count ?? 0)) > 0) {
    return fail("Tiene compras o cotizaciones registradas: debe seguir siendo cliente.", { relation: ["Tiene historial comercial"] });
  }
  if (parsed.data.relation === "customer" && ((visits.count ?? 0) + (records.count ?? 0)) > 0) {
    return fail("Tiene citas o fórmulas registradas: debe seguir siendo paciente.", { relation: ["Tiene historial de atención"] });
  }

  const { error, count } = await db
    .from("patients")
    .update(toPatientRow(parsed.data), { count: "exact" })
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", id);
  if (error) return isUniqueViolation(error) ? fail("Ese documento ya está registrado.", { documentNumber: ["Ya registrado"] }) : fromError("patients.update", error);
  if (!count) return fail("No encontramos ese registro.");

  revalidatePath(`/pacientes/${id}`);
  revalidatePath("/pacientes");
  return ok({ id }, "Registro actualizado");
}

export type PersonMatch = { id: string; full_name: string; document_type: string; document_number: string; phone: string | null; email: string | null; is_active: boolean; reasons: string[] };

/** Possible duplicates while filling the form. Hints only (except the same document); the user decides. */
export async function findPersonMatchesAction(input: {
  documentType: string; documentNumber: string; firstName: string; lastName: string; birthDate?: string; phone?: string; email?: string; excludeId?: string;
}): Promise<PersonMatch[]> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.read")) return [];
  const doc = input.documentNumber.trim().toUpperCase();
  const first = input.firstName.trim(), last = input.lastName.trim();
  if (doc.length < 3 && !(first && last) && !input.phone && !input.email) return [];
  const db = await createClient();
  const { data } = await db.rpc("find_person_matches", {
    p_tenant: ctx.tenant.id, p_document_type: input.documentType, p_document_number: doc || "-", p_first_name: first || "-", p_last_name: last || "-",
    p_birth_date: /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate ?? "") ? input.birthDate : undefined,
    p_phone: input.phone?.replace(/[\s-]/g, "") || undefined, p_email: input.email?.trim() || undefined,
    p_exclude: z.uuid().safeParse(input.excludeId).success ? input.excludeId : undefined,
  });
  return (data ?? []) as PersonMatch[];
}

/** Deactivate / reactivate. Requires patients.delete (also enforced by a DB trigger). History is never touched. */
export async function setPersonActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.delete")) return fail("No tienes permiso para activar o desactivar registros.");
  if (!z.uuid().safeParse(id).success) return fail("Registro no válido");
  const db = await createClient();
  const { error, count } = await db.from("patients").update({ is_active: active }, { count: "exact" }).eq("tenant_id", ctx.tenant.id).eq("id", id);
  if (error) return fromError("patients.active", error);
  if (!count) return fail("No encontramos ese registro.");
  revalidatePath("/pacientes");
  revalidatePath(`/pacientes/${id}`);
  return ok(undefined, active ? "Registro reactivado" : "Registro desactivado");
}

/** Soft delete. Requires patients.delete (also enforced by a DB trigger). Clinical data is never hard-deleted. */
export async function archivePatientAction(id: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.delete")) return fail("No tienes permiso para archivar pacientes.");
  const db = await createClient();
  const { error } = await db.from("patients").update({ deleted_at: new Date().toISOString() }).eq("tenant_id", ctx.tenant.id).eq("id", id);
  if (error) return fromError("patients.archive", error);
  revalidatePath("/pacientes");
  return ok(undefined, "Paciente archivado");
}

/** Lightweight lookup for comboboxes (agenda, POS). */
export async function searchPatientsAction(q: string) {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.read")) return [];
  const term = q.replace(/[%_,()]/g, " ").trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const db = await createClient();
  let query = db.from("patients").select("id, full_name, document_type, document_number, phone").eq("tenant_id", ctx.tenant.id).is("deleted_at", null).eq("is_active", true).limit(8);
  query = digits.length >= 4 ? query.or(`document_number.ilike.${digits}%,phone.ilike.%${digits}%`) : query.ilike("full_name", `%${term}%`);
  const { data } = await query;
  return data ?? [];
}
