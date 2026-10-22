"use server";
import { revalidatePath } from "next/cache";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { zonedTimeToUtc } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";
import {
  createAppointmentSchema, rescheduleSchema, statusSchema,
  type CreateAppointmentInput, type RescheduleInput, type StatusInput,
} from "../schemas";
import { canTransition } from "../utils/status";

function revalidateAgenda() {
  revalidatePath("/agenda", "layout");
  revalidatePath("/inicio");
}

export async function createAppointmentAction(input: CreateAppointmentInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  if (!ctx) return fail("Tu sesión expiró.");
  const parsed = createAppointmentSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;

  // Branch comes from the user's allowed branches, never trusted blindly from the client.
  const branchId = v.branchId ?? ctx.activeBranchId ?? ctx.branches[0]?.id;
  if (!branchId || !ctx.branches.some((b) => b.id === branchId)) return fail("Selecciona una sede válida.");
  if (!can(ctx.grants, "appointments.create", branchId)) return fail("No tienes permiso para agendar en esta sede.");

  const db = await createClient();
  const { data: type } = await db.from("appointment_types").select("duration_minutes").eq("tenant_id", ctx.tenant.id).eq("id", v.typeId).single();
  if (!type) return fail("Tipo de cita no válido.");

  const startsAt = zonedTimeToUtc(v.date, v.time, ctx.timezone);
  const endsAt = new Date(startsAt.getTime() + type.duration_minutes * 60_000);
  const { data, error } = await db
    .from("appointments")
    .insert({
      tenant_id: ctx.tenant.id, branch_id: branchId, patient_id: v.patientId, specialist_id: v.specialistId,
      appointment_type_id: v.typeId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
      notes: v.notes, source: "internal", created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return fromError("appointments.create", error);
  // Domain event → notifications (confirmación por WhatsApp) will subscribe in Phase 9.
  revalidateAgenda();
  return ok({ id: data.id }, "Cita agendada");
}

export async function rescheduleAppointmentAction(input: RescheduleInput): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx) return fail("Tu sesión expiró.");
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const db = await createClient();

  const { data: appt } = await db.from("appointments").select("starts_at, ends_at, branch_id, status, specialist_id")
    .eq("tenant_id", ctx.tenant.id).eq("id", parsed.data.id).single();
  if (!appt) return fail("No encontramos esa cita.");
  if (!can(ctx.grants, "appointments.update", appt.branch_id)) return fail("No tienes permiso para mover esta cita.");
  if (["completed", "cancelled", "no_show", "in_consultation"].includes(appt.status)) return fail("Esta cita ya no puede moverse.");

  const duration = new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime();
  const startsAt = zonedTimeToUtc(parsed.data.date, parsed.data.time, ctx.timezone);
  const { error } = await db.from("appointments").update({
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + duration).toISOString(),
    specialist_id: parsed.data.specialistId === undefined ? appt.specialist_id : parsed.data.specialistId,
    status: appt.status === "confirmed" ? "scheduled" : appt.status, // moved → needs re-confirmation
  }).eq("tenant_id", ctx.tenant.id).eq("id", parsed.data.id);
  if (error) return fromError("appointments.reschedule", error);
  revalidateAgenda();
  return ok(undefined, "Cita reprogramada");
}

export async function updateAppointmentStatusAction(input: StatusInput): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx) return fail("Tu sesión expiró.");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const db = await createClient();

  const { data: appt } = await db.from("appointments").select("status, branch_id").eq("tenant_id", ctx.tenant.id).eq("id", parsed.data.id).single();
  if (!appt) return fail("No encontramos esa cita.");
  const needed = parsed.data.status === "cancelled" ? "appointments.cancel" : "appointments.update";
  if (!can(ctx.grants, needed, appt.branch_id)) return fail("No tienes permiso para esta acción.");
  if (!canTransition(appt.status, parsed.data.status)) return fail("Ese cambio de estado no es válido.");

  const { error } = await db.from("appointments").update({
    status: parsed.data.status,
    cancellation_reason: parsed.data.status === "cancelled" ? parsed.data.reason ?? null : undefined,
  }).eq("tenant_id", ctx.tenant.id).eq("id", parsed.data.id);
  if (error) return fromError("appointments.status", error);
  revalidateAgenda();
  return ok(undefined);
}
