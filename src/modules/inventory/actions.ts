"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";

const adjustSchema = z.object({
  variantId: z.uuid(), branchId: z.uuid(), type: z.enum(["adjustment", "damage", "loss", "initial"]),
  quantity: z.number().int().refine((n) => n !== 0, "La cantidad no puede ser cero").refine((n) => Math.abs(n) <= 999, "Cantidad muy alta"),
  notes: z.string().trim().min(3, "Explica el motivo").max(300),
});

/** Stock never changes directly: this records an immutable movement (the DB updates the level). */
export async function adjustStockAction(input: z.input<typeof adjustSchema>): Promise<ActionResult> {
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const ctx = await getAppContext();
  const v = parsed.data;
  if (!ctx || !can(ctx.grants, "inventory.adjust", v.branchId)) return fail("No tienes permiso para ajustar inventario en esta sede.");
  const db = await createClient();
  const { error } = await db.from("inventory_movements").insert({
    tenant_id: ctx.tenant.id, branch_id: v.branchId, variant_id: v.variantId, type: v.type, quantity: v.quantity, notes: v.notes, created_by: ctx.user.id,
  });
  if (error) return fromError("inventory.adjust", error);
  revalidatePath("/inventario");
  return ok(undefined, "Movimiento registrado");
}

const transferSchema = z.object({
  fromBranchId: z.uuid(), toBranchId: z.uuid(), notes: z.string().max(300).optional(),
  items: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().positive().max(999) })).min(1),
}).refine((v) => v.fromBranchId !== v.toBranchId, { message: "Elige sedes distintas", path: ["toBranchId"] });

export async function requestTransferAction(input: z.input<typeof transferSchema>): Promise<ActionResult> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.transfer")) return fail("No tienes permiso para trasladar.");
  const v = parsed.data;
  const db = await createClient();
  const { data, error } = await db.from("inventory_transfers").insert({
    tenant_id: ctx.tenant.id, number: "", from_branch_id: v.fromBranchId, to_branch_id: v.toBranchId, notes: v.notes ?? null, requested_by: ctx.user.id,
  }).select("id").single();
  if (error) return fromError("inventory.transfer", error);
  const items = await db.from("inventory_transfer_items").insert(v.items.map((i) => ({ tenant_id: ctx.tenant.id, transfer_id: data.id, variant_id: i.variantId, quantity: i.quantity })));
  if (items.error) return fromError("inventory.transfer_items", items.error);
  revalidatePath("/inventario");
  return ok(undefined, "Traslado solicitado");
}

export async function advanceTransferAction(id: string, status: "approved" | "in_transit" | "received" | "cancelled"): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.transfer")) return fail("No tienes permiso.");
  const db = await createClient();
  const { error } = await db.rpc("advance_transfer", { p_transfer: id, p_status: status });
  if (error) return fromError("inventory.advance_transfer", error);
  revalidatePath("/inventario");
  return ok(undefined, { approved: "Traslado aprobado", in_transit: "Enviado: en tránsito", received: "Recibido: stock actualizado", cancelled: "Traslado cancelado" }[status]);
}
