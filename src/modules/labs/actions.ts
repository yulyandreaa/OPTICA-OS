"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";
import { LAB_FLOW } from "./constants";

/** Creates a lab order from a sale, carrying prescription, frame and lens without retyping. */
export async function createLabOrderFromSaleAction(saleId: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "lab_orders.create")) return fail("No tienes permiso para crear órdenes.");
  const db = await createClient();
  const { data: sale } = await db.from("sales").select("id, branch_id, patient_id, prescription_id").eq("tenant_id", ctx.tenant.id).eq("id", saleId).single();
  if (!sale?.patient_id) return fail("La venta necesita un paciente para crear la orden.");
  const [{ data: items }, { data: rx }, { data: lab }] = await Promise.all([
    db.from("sale_items").select("description, category").eq("sale_id", saleId),
    sale.prescription_id
      ? db.from("prescriptions").select("lens_type, material, treatments, notes, dp_binocular, dp_od, dp_oi, height_od, height_oi").eq("id", sale.prescription_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("labs").select("id, lead_days").eq("tenant_id", ctx.tenant.id).eq("is_active", true).order("name").limit(1).maybeSingle(),
  ]);
  const frame = items?.find((i) => i.category === "Monturas" || i.category === "Gafas de sol");
  const lens = items?.find((i) => i.category === "Lentes oftálmicos");
  const eta = new Date(Date.now() + (lab?.lead_days ?? 5) * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db.from("lab_orders").insert({
    tenant_id: ctx.tenant.id, branch_id: sale.branch_id, patient_id: sale.patient_id, sale_id: sale.id, prescription_id: sale.prescription_id,
    lab_id: lab?.id ?? null, number: "", frame_description: frame?.description ?? null, lens_description: lens?.description ?? null,
    lens_type: rx?.lens_type ?? null, material: rx?.material ?? null, treatments: rx?.treatments ?? [],
    measurements: rx ? { dp: rx.dp_binocular, dp_od: rx.dp_od, dp_oi: rx.dp_oi, height_od: rx.height_od, height_oi: rx.height_oi } : {},
    notes: rx?.notes ?? null, // optometrist's lens recommendation
    estimated_at: eta, created_by: ctx.user.id,
  }).select("id").single();
  if (error) return fromError("labs.create", error);
  revalidatePath("/ordenes");
  revalidatePath(`/ventas/${saleId}`);
  return ok({ id: data.id }, "Orden de laboratorio creada");
}

const advanceSchema = z.object({
  orderId: z.uuid(), status: z.enum([...LAB_FLOW, "cancelled"]), note: z.string().max(500).optional(),
  checklist: z.record(z.string(), z.boolean()).optional(),
});

export async function advanceLabOrderAction(input: z.input<typeof advanceSchema>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "lab_orders.update")) return fail("No tienes permiso para actualizar órdenes.");
  const v = advanceSchema.parse(input);
  const db = await createClient();
  const { error } = await db.rpc("advance_lab_order", { p_order: v.orderId, p_status: v.status, p_note: v.note ?? undefined, p_checklist: v.checklist ?? undefined });
  if (error) return fromError("labs.advance", error);
  // When glasses arrive at the store, the patient is notified (NotificationProvider in Phase 9: WhatsApp template "lab_order_ready").
  revalidatePath("/ordenes", "layout");
  return ok(undefined);
}
