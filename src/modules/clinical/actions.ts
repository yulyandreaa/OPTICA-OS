"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { humanizeError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";
import { amendSchema, recordSchema, type RecordInput } from "./schemas";

export async function startConsultationAction(input: { patientId: string; appointmentId?: string | null }) {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "medical_records.create")) return { ok: false as const, error: "No tienes permiso para crear historias clínicas." };
  const patientId = z.uuid().parse(input.patientId);
  const db = await createClient();

  let branchId = ctx.activeBranchId ?? ctx.branches[0]?.id;
  if (input.appointmentId) {
    const { data: appt } = await db.from("appointments").select("branch_id, status").eq("tenant_id", ctx.tenant.id).eq("id", input.appointmentId).single();
    if (appt) {
      branchId = appt.branch_id;
      if (["checked_in", "waiting", "scheduled", "confirmed"].includes(appt.status)) {
        await db.from("appointments").update({ status: appt.status === "scheduled" || appt.status === "confirmed" ? "checked_in" : "in_consultation" }).eq("id", input.appointmentId);
        if (appt.status === "scheduled" || appt.status === "confirmed") await db.from("appointments").update({ status: "in_consultation" }).eq("id", input.appointmentId);
      }
    }
    const { data: existing } = await db.from("medical_records").select("id").eq("tenant_id", ctx.tenant.id).eq("appointment_id", input.appointmentId).maybeSingle();
    if (existing) redirect(`/consultas/${existing.id}`);
  }
  if (!branchId) return { ok: false as const, error: "Selecciona una sede." };

  // Pre-fill history from the patient's last record (antecedentes no cambian cada visita).
  const { data: last } = await db.from("medical_records")
    .select("personal_history, family_history, ocular_history, allergies, medications, surgeries, habits")
    .eq("tenant_id", ctx.tenant.id).eq("patient_id", patientId).neq("status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle();

  const { data, error } = await db.from("medical_records").insert({
    tenant_id: ctx.tenant.id, branch_id: branchId, patient_id: patientId, appointment_id: input.appointmentId ?? null,
    professional_id: ctx.user.id, number: "", ...(last ?? {}),
  }).select("id").single();
  if (error) return { ok: false as const, error: humanizeError(error) };
  revalidatePath("/consultas");
  redirect(`/consultas/${data.id}`);
}

export async function saveRecordAction(id: string, input: RecordInput): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "medical_records.create")) return fail("No tienes permiso.");
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const db = await createClient();
  const { error, count } = await db.from("medical_records").update(parsed.data, { count: "exact" }).eq("tenant_id", ctx.tenant.id).eq("id", id).eq("status", "draft");
  if (error) return fromError("clinical.save", error);
  if (!count) return fail("Esta historia ya fue firmada y no puede editarse.");
  return ok(undefined, "Borrador guardado");
}

export async function signRecordAction(id: string, input: RecordInput): Promise<ActionResult<{ prescriptionId: string | null }>> {
  const saved = await saveRecordAction(id, input);
  if (!saved.ok) return saved;
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "medical_records.sign")) return fail("No tienes permiso para firmar.");
  const db = await createClient();
  const { data, error } = await db.rpc("sign_medical_record", { p_record: id });
  if (error) return fail(error.message.includes("RECORD_INCOMPLETE") ? "Completa el motivo de consulta antes de firmar." : humanizeError(error));
  revalidatePath(`/consultas/${id}`);
  revalidatePath("/consultas");
  return ok({ prescriptionId: (data as { prescription_id: string | null }).prescription_id }, "Historia firmada");
}

export async function amendRecordAction(id: string, input: z.input<typeof amendSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "medical_records.amend")) return fail("No tienes permiso para enmendar.");
  const parsed = amendSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const changes = Object.fromEntries(Object.entries(parsed.data.changes).filter(([, v]) => v !== undefined));
  if (Object.keys(changes).length === 0) return fail("No hay cambios para enmendar.");
  const db = await createClient();
  const { error } = await db.rpc("amend_medical_record", { p_record: id, p_reason: parsed.data.reason, p_changes: changes });
  if (error) return fromError("clinical.amend", error);
  revalidatePath(`/consultas/${id}`);
  return ok(undefined, "Enmienda registrada");
}
