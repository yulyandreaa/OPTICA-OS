"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";

const leadSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(120), phone: z.string().trim().max(30).optional(),
  source: z.enum(["instagram", "facebook", "google", "whatsapp", "referral", "web", "walk_in", "other"]),
  interest: z.string().trim().max(160).optional(), value: z.coerce.number().min(0).optional(), stageId: z.uuid(),
});

export async function createLeadAction(input: z.input<typeof leadSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "crm.manage")) return fail("No tienes permiso.");
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const db = await createClient();
  const { error } = await db.from("leads").insert({
    tenant_id: ctx.tenant.id, stage_id: v.stageId, name: v.name, phone: v.phone || null, source: v.source, interest: v.interest || null,
    value: v.value ?? null, assigned_to: ctx.user.id, created_by: ctx.user.id,
  });
  if (error) return fromError("crm.create", error);
  revalidatePath("/crm");
  return ok(undefined, "Lead creado");
}

export async function moveLeadAction(leadId: string, stageId: string, lostReason?: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "crm.manage")) return fail("No tienes permiso.");
  if (!z.uuid().safeParse(leadId).success || !z.uuid().safeParse(stageId).success) return fail("Datos inválidos");
  const db = await createClient();
  const { error } = await db.from("leads").update({ stage_id: stageId, lost_reason: lostReason ?? null }).eq("tenant_id", ctx.tenant.id).eq("id", leadId);
  if (error) return fromError("crm.move", error);
  revalidatePath("/crm");
  return ok(undefined);
}

const taskSchema = z.object({
  title: z.string().trim().min(3).max(160), priority: z.enum(["low", "normal", "high", "urgent"]), dueAt: z.string().optional(), assignedTo: z.uuid().optional(),
});

export async function createTaskAction(input: z.input<typeof taskSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx) return fail("Tu sesión expiró.");
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const db = await createClient();
  const { error } = await db.from("tasks").insert({
    tenant_id: ctx.tenant.id, title: v.title, priority: v.priority, due_at: v.dueAt ? new Date(`${v.dueAt}T17:00:00-05:00`).toISOString() : null,
    assigned_to: v.assignedTo ?? ctx.user.id, created_by: ctx.user.id,
  });
  if (error) return fromError("tasks.create", error);
  revalidatePath("/crm");
  revalidatePath("/inicio");
  return ok(undefined, "Tarea creada");
}

export async function completeTaskAction(id: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx) return fail("Tu sesión expiró.");
  const db = await createClient();
  const { error } = await db.from("tasks").update({ status: "done", completed_at: new Date().toISOString() }).eq("tenant_id", ctx.tenant.id).eq("id", id);
  if (error) return fromError("tasks.complete", error);
  revalidatePath("/crm");
  revalidatePath("/inicio");
  return ok(undefined, "Tarea completada");
}
