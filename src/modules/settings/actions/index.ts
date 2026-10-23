"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const tenantSchema = z.object({
  tradeName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(200),
  taxId: z.string().trim().regex(/^[0-9]{5,15}$/).optional().or(z.literal("")).transform((v) => v || null),
  taxDv: z.string().regex(/^[0-9]$/).optional().or(z.literal("")).transform((v) => v || null),
  email: z.email().optional().or(z.literal("")).transform((v) => v || null),
  phone: opt(30), address: opt(200), city: opt(80),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hexadecimal, ej. #4f46e5").optional().or(z.literal("")).transform((v) => v || null),
  timezone: z.enum(["America/Bogota", "America/Lima", "America/Mexico_City", "America/Guayaquil", "America/Panama"]),
});

export async function updateTenantAction(input: z.input<typeof tenantSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "settings.manage")) return fail("No tienes permiso para cambiar la configuración.");
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const db = await createClient();
  const { error } = await db.from("tenants").update({
    trade_name: v.tradeName, legal_name: v.legalName, tax_id: v.taxId, tax_dv: v.taxDv, email: v.email, phone: v.phone,
    address: v.address, city: v.city, brand_color: v.brandColor, timezone: v.timezone,
  }).eq("id", ctx.tenant.id);
  if (error) return fromError("settings.tenant", error);
  revalidatePath("/", "layout");
  return ok(undefined, "Configuración guardada");
}

const branchSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, "2–12 letras/números"),
  city: opt(80), address: opt(200), phone: opt(30),
});

export async function createBranchAction(input: z.input<typeof branchSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "branches.manage")) return fail("No tienes permiso para crear sedes.");
  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const db = await createClient();
  const { error } = await db.from("branches").insert({ ...parsed.data, tenant_id: ctx.tenant.id });
  if (error) return fromError("settings.branch", error);
  revalidatePath("/", "layout");
  return ok(undefined, "Sede creada");
}

export async function updateBranchAction(branchId: string, input: z.input<typeof branchSchema>): Promise<ActionResult> {
  if (!z.uuid().safeParse(branchId).success) return fail("Sede no válida.");
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "branches.manage")) return fail("No tienes permiso para editar sedes.");
  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const db = await createClient();
  const { data, error } = await db.from("branches").update(parsed.data).eq("id", branchId).eq("tenant_id", ctx.tenant.id).is("deleted_at", null).select("id");
  if (error) return fromError("settings.update_branch", error);
  if (!data?.length) return fail("La sede ya no existe.");
  revalidatePath("/", "layout");
  return ok(undefined, "Sede actualizada");
}

export async function setMainBranchAction(branchId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(branchId).success) return fail("Sede no válida.");
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "branches.manage")) return fail("No tienes permiso para gestionar sedes.");
  const db = await createClient();
  const { error } = await db.rpc("set_main_branch", { p_tenant: ctx.tenant.id, p_branch: branchId });
  if (error) return fromError("settings.main_branch", error);
  revalidatePath("/", "layout");
  return ok(undefined, "Sede principal actualizada");
}

/** Soft delete: past sales, movements and appointments keep their branch. The database explains any blocker. */
export async function deleteBranchAction(branchId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(branchId).success) return fail("Sede no válida.");
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "branches.manage")) return fail("No tienes permiso para eliminar sedes.");
  const db = await createClient();
  const { error } = await db.rpc("delete_branch", { p_tenant: ctx.tenant.id, p_branch: branchId });
  if (error) return fromError("settings.delete_branch", error);
  revalidatePath("/", "layout");
  return ok(undefined, "Sede eliminada");
}

const scheduleSchema = z.object({
  userId: z.uuid(),
  branchId: z.uuid(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Elige al menos un día"),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  breakStart: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  breakEnd: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  slotMinutes: z.coerce.number().int().min(10).max(120),
}).refine((v) => v.end > v.start, { message: "La hora final debe ser posterior", path: ["end"] });

/** Replaces a specialist's weekly schedule at a branch (optionally split by a lunch break). */
export async function saveScheduleAction(input: z.input<typeof scheduleSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  if (!ctx || !can(ctx.grants, "schedules.manage", v.branchId)) return fail("No tienes permiso para configurar horarios en esta sede.");

  const windows: [string, string][] = v.breakStart && v.breakEnd && v.breakStart > v.start && v.breakEnd < v.end && v.breakEnd > v.breakStart
    ? [[v.start, v.breakStart], [v.breakEnd, v.end]]
    : [[v.start, v.end]];

  const db = await createClient();
  const del = await db.from("specialist_schedules").delete().eq("tenant_id", ctx.tenant.id).eq("user_id", v.userId).eq("branch_id", v.branchId);
  if (del.error) return fromError("settings.schedule.delete", del.error);
  const rows = v.weekdays.flatMap((weekday) => windows.map(([start_time, end_time]) => ({
    tenant_id: ctx.tenant.id, branch_id: v.branchId, user_id: v.userId, weekday, start_time, end_time, slot_minutes: v.slotMinutes,
  })));
  const { error } = await db.from("specialist_schedules").insert(rows);
  if (error) return fromError("settings.schedule.insert", error);
  revalidatePath("/configuracion/agenda");
  revalidatePath("/agenda");
  return ok(undefined, "Horario guardado");
}
