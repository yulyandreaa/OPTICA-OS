"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";

const item = z.object({
  variantId: z.uuid(), quantity: z.number().positive().max(999), discount: z.number().min(0).default(0),
});
const payment = z.object({
  method: z.enum(["cash", "card", "transfer", "nequi", "daviplata", "wompi", "credit"]), amount: z.number().positive(), reference: z.string().max(80).optional(),
});
const saleSchema = z.object({
  patientId: z.uuid().nullable(), prescriptionId: z.uuid().nullable().optional(), notes: z.string().max(500).optional(),
  items: z.array(item).min(1, "Agrega al menos un producto"), payments: z.array(payment), idempotencyKey: z.string().min(8).max(80),
});

function branchFor(ctx: NonNullable<Awaited<ReturnType<typeof getAppContext>>>) {
  return ctx.activeBranchId ?? ctx.branches[0]?.id ?? null;
}

export async function createSaleAction(input: z.input<typeof saleSchema>): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  const branchId = ctx && branchFor(ctx);
  if (!ctx || !branchId || !can(ctx.grants, "sales.create", branchId)) return fail("No tienes permiso para vender en esta sede.");
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc("create_sale", { p: {
    tenant_id: ctx.tenant.id, branch_id: branchId, patient_id: v.patientId, prescription_id: v.prescriptionId ?? null, notes: v.notes ?? null,
    idempotency_key: v.idempotencyKey,
    items: v.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, discount: i.discount })),
    payments: v.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
  } });
  if (error) return fromError("sales.create", error);
  revalidatePath("/ventas");
  revalidatePath("/inicio");
  return ok({ id: data as string }, "Venta registrada");
}

export async function addPaymentAction(saleId: string, input: z.input<typeof payment>): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "sales.create")) return fail("No tienes permiso.");
  const parsed = payment.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const db = await createClient();
  const { error } = await db.rpc("add_sale_payment", { p_sale: saleId, p_payments: [parsed.data] });
  if (error) return fromError("sales.payment", error);
  revalidatePath(`/ventas/${saleId}`);
  return ok(undefined, "Pago registrado");
}

const quoteSchema = z.object({
  patientId: z.uuid("Selecciona el paciente"), prescriptionId: z.uuid().nullable().optional(), notes: z.string().max(500).optional(),
  items: z.array(item).min(1, "Agrega al menos un producto"), validDays: z.number().int().min(1).max(90).default(15),
});

export async function createQuoteAction(input: z.input<typeof quoteSchema>): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  const branchId = ctx && branchFor(ctx);
  if (!ctx || !branchId || !can(ctx.grants, "quotes.create", branchId)) return fail("No tienes permiso para cotizar.");
  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const db = await createClient();
  const { data, error } = await db.rpc("create_quote", { p: {
    tenant_id: ctx.tenant.id, branch_id: branchId, patient_id: v.patientId, prescription_id: v.prescriptionId ?? null, notes: v.notes ?? null,
    valid_days: v.validDays, items: v.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, discount: i.discount })),
  } });
  if (error) return fromError("quotes.create", error);
  revalidatePath("/cotizaciones");
  return ok({ id: data as string }, "Cotización creada");
}

export async function convertQuoteAction(quoteId: string, payments: z.input<typeof payment>[]): Promise<ActionResult<{ saleId: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "sales.create")) return fail("No tienes permiso para vender.");
  const parsed = z.array(payment).safeParse(payments);
  if (!parsed.success) return fromZod(parsed.error);
  const db = await createClient();
  const { data, error } = await db.rpc("convert_quote", { p_quote: quoteId, p_payments: parsed.data });
  if (error) return fromError("quotes.convert", error);
  revalidatePath("/cotizaciones");
  revalidatePath("/ventas");
  return ok({ saleId: data as string }, "Cotización convertida en venta");
}

/** Latest valid prescription of a patient, to attach to a sale/quote. */
export async function latestPrescriptionAction(patientId: string) {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "prescriptions.read")) return null;
  const db = await createClient();
  const { data } = await db.from("prescriptions")
    .select("id, number, issued_at, lens_type, material, od_sphere, od_cylinder, od_axis, od_add, oi_sphere, oi_cylinder, oi_axis, oi_add")
    .eq("tenant_id", ctx.tenant.id).eq("patient_id", patientId).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}
