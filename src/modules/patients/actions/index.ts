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

export async function createPatientAction(input: PatientFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.create")) return fail("No tienes permiso para crear pacientes.");
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const db = await createClient();
  const { data, error } = await db
    .from("patients")
    .insert({ ...toPatientRow(parsed.data), tenant_id: ctx.tenant.id, created_by: ctx.user.id, home_branch_id: parsed.data.homeBranchId ?? ctx.activeBranchId })
    .select("id")
    .single();
  if (error) return fromError("patients.create", error);

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
  return ok({ id: data.id }, "Paciente creado");
}

export async function updatePatientAction(id: string, input: PatientFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.update")) return fail("No tienes permiso para editar pacientes.");
  if (!z.uuid().safeParse(id).success) return fail("Paciente no válido");
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);

  const db = await createClient();
  const { error, count } = await db
    .from("patients")
    .update(toPatientRow(parsed.data), { count: "exact" })
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", id);
  if (error) return fromError("patients.update", error);
  if (!count) return fail("No encontramos ese paciente.");

  revalidatePath(`/pacientes/${id}`);
  revalidatePath("/pacientes");
  return ok({ id }, "Cambios guardados");
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
  let query = db.from("patients").select("id, full_name, document_type, document_number, phone").eq("tenant_id", ctx.tenant.id).is("deleted_at", null).limit(8);
  query = digits.length >= 4 ? query.or(`document_number.ilike.${digits}%,phone.ilike.%${digits}%`) : query.ilike("full_name", `%${term}%`);
  const { data } = await query;
  return data ?? [];
}
