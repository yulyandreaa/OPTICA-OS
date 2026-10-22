"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";

const poSchema = z.object({
  supplierId: z.uuid("Selecciona el proveedor"), expectedAt: z.string().optional(), notes: z.string().max(500).optional(),
  items: z.array(z.object({ variantId: z.uuid(), quantity: z.number().int().positive().max(9999), unitCost: z.number().min(0) })).min(1, "Agrega productos"),
});

export async function createPurchaseOrderAction(input: z.input<typeof poSchema>): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  const branchId = ctx?.activeBranchId ?? ctx?.branches[0]?.id;
  if (!ctx || !branchId || !can(ctx.grants, "purchases.create", branchId)) return fail("No tienes permiso para crear compras.");
  const parsed = poSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const db = await createClient();
  const total = v.items.reduce((a, i) => a + i.quantity * i.unitCost, 0);
  const { data, error } = await db.from("purchase_orders").insert({
    tenant_id: ctx.tenant.id, branch_id: branchId, supplier_id: v.supplierId, number: "", status: "draft",
    expected_at: v.expectedAt || null, notes: v.notes ?? null, total, created_by: ctx.user.id,
  }).select("id").single();
  if (error) return fromError("purchases.create", error);
  const items = await db.from("purchase_order_items").insert(v.items.map((i) => ({ tenant_id: ctx.tenant.id, purchase_order_id: data.id, variant_id: i.variantId, quantity: i.quantity, unit_cost: i.unitCost })));
  if (items.error) return fromError("purchases.items", items.error);
  revalidatePath("/compras");
  return ok({ id: data.id }, "Orden de compra creada");
}

export async function setPurchaseStatusAction(id: string, status: "sent" | "approved" | "cancelled"): Promise<ActionResult> {
  const ctx = await getAppContext();
  const perm = status === "approved" ? "purchases.approve" : "purchases.create";
  if (!ctx || !can(ctx.grants, perm)) return fail("No tienes permiso.");
  const db = await createClient();
  const { error } = await db.from("purchase_orders").update({ status }).eq("tenant_id", ctx.tenant.id).eq("id", id);
  if (error) return fromError("purchases.status", error);
  revalidatePath(`/compras/${id}`);
  revalidatePath("/compras");
  return ok(undefined, { sent: "Orden enviada al proveedor", approved: "Orden aprobada", cancelled: "Orden cancelada" }[status]);
}

export async function receivePurchaseAction(id: string, items: { itemId: string; quantity: number; lotCode?: string; expiresOn?: string }[], key?: string): Promise<ActionResult<{ status: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "purchases.approve")) return fail("No tienes permiso para recibir mercancía.");
  const db = await createClient();
  const { data, error } = await db.rpc("receive_purchase_order", {
    p_order: id, p_key: key?.slice(0, 80),
    p_items: items.filter((i) => i.quantity > 0).map((i) => ({ item_id: i.itemId, quantity: i.quantity, lot_code: i.lotCode || null, expires_on: i.expiresOn || null })),
  });
  if (error) return fromError("purchases.receive", error);
  revalidatePath(`/compras/${id}`);
  revalidatePath("/inventario");
  return ok({ status: data as string }, data === "received" ? "Mercancía recibida completa" : "Recepción parcial registrada");
}

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160), taxId: z.string().trim().max(20).optional(), contactName: z.string().trim().max(120).optional(),
  email: z.email().optional().or(z.literal("")), phone: z.string().trim().max(30).optional(), paymentTerms: z.string().trim().max(60).optional(),
  leadTimeDays: z.number().int().min(0).max(120).optional(),
});

export async function createSupplierAction(input: z.input<typeof supplierSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "suppliers.manage")) return fail("No tienes permiso.");
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const db = await createClient();
  const { error } = await db.from("suppliers").insert({
    tenant_id: ctx.tenant.id, name: v.name, tax_id: v.taxId || null, contact_name: v.contactName || null, email: v.email || null,
    phone: v.phone || null, payment_terms: v.paymentTerms || null, lead_time_days: v.leadTimeDays ?? null,
  });
  if (error) return fromError("suppliers.create", error);
  revalidatePath("/compras");
  return ok(undefined, "Proveedor creado");
}
