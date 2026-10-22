"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";
import { variantLabel } from "./constants";
import type { InventoryRow } from "./repositories";
import { categorySchema, movementSchema, productSchema, transferSchema, type MovementInput, type ProductInput, type TransferInput } from "./schemas";

/**
 * Every write goes through a database function that re-checks permissions, company and branch (RLS),
 * runs in one transaction and, with an idempotency key, returns the first result on a retry.
 */

export async function saveProductAction(input: ProductInput): Promise<ActionResult<{ id: string }>> {
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.manage")) return fail("No tienes permiso para gestionar productos.");
  const v = parsed.data;
  if (v.variants.some((x) => x.cost !== undefined) && !can(ctx.grants, "inventory.costs")) return fail("No tienes permiso para modificar costos.");
  const db = await createClient();
  const { data, error } = await db.rpc("save_product", { p: { ...v, tenant_id: ctx.tenant.id, initial_stock: v.id ? [] : v.initial_stock } });
  if (error) return fromError("inventory.save_product", error);
  revalidatePath("/inventario", "layout");
  return ok({ id: data as string }, v.id ? "Producto actualizado" : "Producto creado");
}

export async function recordMovementAction(input: MovementInput): Promise<ActionResult<{ id: string | null }>> {
  const parsed = movementSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const ctx = await getAppContext();
  const v = parsed.data;
  if (!ctx || !can(ctx.grants, "inventory.adjust", v.branch_id)) return fail("No tienes permiso para registrar movimientos en esta sede.");
  if (v.unit_cost !== undefined && !can(ctx.grants, "inventory.costs")) return fail("No tienes permiso para registrar costos.");
  const db = await createClient();
  const { data, error } = await db.rpc("record_movement", { p: { ...v, tenant_id: ctx.tenant.id } });
  if (error) return fromError("inventory.record_movement", error);
  revalidatePath("/inventario", "layout");
  return ok({ id: (data as string | null) ?? null }, data ? "Movimiento registrado" : "El conteo coincide con el sistema: no hubo diferencias");
}

export async function setMinStockAction(variantId: string, branchId: string, min: number): Promise<ActionResult> {
  const parsed = z.object({ variantId: z.uuid(), branchId: z.uuid(), min: z.number().int().min(0).max(99_999) }).safeParse({ variantId, branchId, min });
  if (!parsed.success) return fail("Escribe un número entero entre 0 y 99.999.");
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.adjust", branchId)) return fail("No tienes permiso para cambiar el mínimo en esta sede.");
  const db = await createClient();
  const { error } = await db.rpc("set_min_stock", { p_tenant: ctx.tenant.id, p_branch: branchId, p_variant: variantId, p_min: min });
  if (error) return fromError("inventory.set_min_stock", error);
  revalidatePath("/inventario", "layout");
  return ok(undefined, "Stock mínimo actualizado");
}

export async function createTransferAction(input: TransferInput): Promise<ActionResult<{ id: string }>> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const ctx = await getAppContext();
  const v = parsed.data;
  if (!ctx || !can(ctx.grants, "inventory.transfer", v.from_branch_id)) return fail("No tienes permiso para trasladar desde esa sede.");
  const db = await createClient();
  const { data, error } = await db.rpc("create_transfer", { p: { ...v, tenant_id: ctx.tenant.id } });
  if (error) return fromError("inventory.create_transfer", error);
  revalidatePath("/inventario", "layout");
  return ok({ id: data as string }, "Traslado enviado: las unidades quedan en tránsito hasta que la sede destino las reciba");
}

/** Transfers created before send → receive (status "Por enviar"): dispatch them now. */
export async function sendTransferAction(id: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.transfer")) return fail("No tienes permiso para enviar traslados.");
  const db = await createClient();
  const { error } = await db.rpc("advance_transfer", { p_transfer: id, p_status: "in_transit" });
  if (error) return fromError("inventory.send_transfer", error);
  revalidatePath("/inventario", "layout");
  return ok(undefined, "Traslado enviado: las unidades quedan en tránsito");
}

export async function receiveTransferAction(id: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.transfer")) return fail("No tienes permiso para recibir traslados.");
  const db = await createClient();
  const { error } = await db.rpc("receive_transfer", { p_transfer: id });
  if (error) return fromError("inventory.receive_transfer", error);
  revalidatePath("/inventario", "layout");
  return ok(undefined, "Traslado recibido: el stock de la sede destino se actualizó");
}

export async function cancelTransferAction(id: string, reason: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.transfer")) return fail("No tienes permiso para cancelar traslados.");
  if (reason.trim().length < 3) return fail("Explica por qué cancelas el traslado.");
  const db = await createClient();
  const { error } = await db.rpc("cancel_transfer", { p_transfer: id, p_reason: reason.trim().slice(0, 300) });
  if (error) return fromError("inventory.cancel_transfer", error);
  revalidatePath("/inventario", "layout");
  return ok(undefined, "Traslado cancelado: las unidades volvieron a la sede de origen");
}

export async function createCategoryAction(input: z.input<typeof categorySchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.manage")) return fail("No tienes permiso para crear categorías.");
  const code = `c-${parsed.data.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)}`;
  const db = await createClient();
  const { data, error } = await db.from("product_categories")
    .insert({ tenant_id: ctx.tenant.id, code, name: parsed.data.name, kind: parsed.data.kind }).select("id").single();
  if (error) return fromError("inventory.create_category", error);
  revalidatePath("/inventario", "layout");
  return ok({ id: data.id }, "Categoría creada");
}

export type VariantOption = { id: string; productId: string; label: string; sku: string; quantity: number; trackLots: boolean; unit: string };

/** Picker for movement and transfer forms: stocked, active variants with their units in `branchId`. */
export async function searchVariantsAction(query: string, branchId: string, variantId?: string): Promise<VariantOption[]> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "inventory.read") || !z.uuid().safeParse(branchId).success) return [];
  const db = await createClient();
  const { data } = await db.rpc("inventory_list", { p_tenant: ctx.tenant.id, p_branch: branchId, p_query: query.trim().slice(0, 80) || undefined, p_limit: 20 });
  return ((data ?? []) as unknown as InventoryRow[]).filter((r) => r.is_stocked && (!variantId || r.variant_id === variantId)).map((r) => {
    const detail = variantLabel(r);
    return {
      id: r.variant_id, productId: r.product_id, sku: r.sku, quantity: Number(r.quantity ?? 0), trackLots: r.track_lots, unit: r.unit,
      label: `${r.product_name}${detail ? ` · ${detail}` : ""}`,
    };
  });
}
