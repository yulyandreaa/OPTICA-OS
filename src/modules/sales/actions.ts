"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { variantLabel } from "@/modules/inventory/constants";
import type { InventoryRow } from "@/modules/inventory/repositories";
import { getAppContext } from "@/modules/tenants/services/context";

const item = z.object({
  variantId: z.uuid(), quantity: z.number().positive().max(999), discount: z.number().min(0).default(0),
});
const payment = z.object({
  method: z.enum(["cash", "card", "transfer", "nequi", "daviplata", "wompi"]), amount: z.number().positive(), reference: z.string().max(80).optional(),
});
const saleSchema = z.object({
  branchId: z.uuid().optional(), patientId: z.uuid().nullable(), prescriptionId: z.uuid().nullable().optional(), sellerId: z.uuid().optional(),
  notes: z.string().max(500).optional(), paymentTerms: z.string().max(200).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), draftId: z.uuid().optional(),
  items: z.array(item).min(1, "Agrega al menos un producto"), payments: z.array(payment), idempotencyKey: z.string().min(8).max(80),
});
const draftSchema = saleSchema.pick({ branchId: true, patientId: true, sellerId: true, notes: true, paymentTerms: true, draftId: true })
  .extend({ items: z.array(item) });

type Ctx = NonNullable<Awaited<ReturnType<typeof getAppContext>>>;
function branchFor(ctx: Ctx) {
  return ctx.activeBranchId ?? ctx.branches[0]?.id ?? null;
}
/** The requested branch if the user works there; the database checks it again (RLS + can_write). */
function saleBranch(ctx: Ctx, requested?: string) {
  const id = requested ?? branchFor(ctx);
  return id && ctx.branches.some((b) => b.id === id) && can(ctx.grants, "sales.create", id) ? id : null;
}

export async function createSaleAction(input: z.input<typeof saleSchema>): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAppContext();
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const branchId = ctx && saleBranch(ctx, v.branchId);
  if (!ctx || !branchId) return fail("No tienes permiso para vender en esta sede.");
  const db = await createClient();
  const { data, error } = await db.rpc("create_sale", { p: {
    tenant_id: ctx.tenant.id, branch_id: branchId, patient_id: v.patientId, prescription_id: v.prescriptionId ?? null, notes: v.notes ?? null,
    seller_id: v.sellerId ?? null, payment_terms: v.paymentTerms ?? null, due_date: v.dueDate ?? null, draft_id: v.draftId ?? null,
    idempotency_key: v.idempotencyKey,
    items: v.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, discount: i.discount })),
    payments: v.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
  } });
  if (error) return fromError("sales.create", error);
  revalidatePath("/ventas", "layout");
  revalidatePath("/inicio");
  revalidatePath("/inventario", "layout");
  return ok({ id: data as string }, "Venta registrada");
}

/** Saves (or updates) a draft: priced from the catalog, no stock or payments. */
export async function saveSaleDraftAction(input: z.input<typeof draftSchema>): Promise<ActionResult<{ id: string; number: string }>> {
  const ctx = await getAppContext();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  const branchId = ctx && saleBranch(ctx, v.branchId);
  if (!ctx || !branchId) return fail("No tienes permiso para vender en esta sede.");
  const db = await createClient();
  const { data, error } = await db.rpc("save_sale_draft", { p: {
    tenant_id: ctx.tenant.id, id: v.draftId ?? null, branch_id: branchId, patient_id: v.patientId, seller_id: v.sellerId ?? null,
    notes: v.notes ?? null, payment_terms: v.paymentTerms ?? null,
    items: v.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, discount: i.discount })),
  } });
  if (error) return fromError("sales.draft", error);
  const { data: row } = await db.from("sales").select("number").eq("id", data as string).single();
  revalidatePath("/ventas");
  return ok({ id: data as string, number: row?.number ?? "" }, "Borrador guardado");
}

export async function deleteSaleDraftAction(id: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !z.uuid().safeParse(id).success) return fail("Borrador no válido.");
  const db = await createClient();
  const { error } = await db.rpc("delete_sale_draft", { p_tenant: ctx.tenant.id, p_draft: id });
  if (error) return fromError("sales.draft_delete", error);
  revalidatePath("/ventas");
  return ok(undefined, "Borrador descartado");
}

export type SaleProduct = {
  variantId: string; productId: string; name: string; detail: string; brand: string | null; model: string | null; sku: string;
  barcode: string | null; image: string | null; colorHex: string | null; kind: string; category: string; price: number; taxRate: number;
  stocked: boolean; available: number | null; unit: string;
};

/** Catalog search for a sale: name, SKU, brand, model or barcode; availability is that of the variant in `branchId`. */
export async function searchSaleProductsAction(query: string, branchId: string, kind?: string): Promise<SaleProduct[]> {
  const ctx = await getAppContext();
  if (!ctx || !saleBranch(ctx, branchId)) return [];
  const db = await createClient();
  const { data } = await db.rpc("inventory_list", { p_tenant: ctx.tenant.id, p_branch: branchId, p_query: query.trim().slice(0, 80) || undefined, p_limit: 40 });
  const rows = (data ?? []) as unknown as InventoryRow[];
  const ids = [...new Set(rows.map((r) => r.product_id))];
  const { data: taxes } = ids.length ? await db.from("products").select("id, tax_rate").in("id", ids) : { data: [] };
  const tax = new Map((taxes ?? []).map((t) => [t.id, Number(t.tax_rate)]));
  return rows.filter((r) => r.is_active && (!kind || r.category_kind === kind)).slice(0, 20).map((r) => ({
    variantId: r.variant_id, productId: r.product_id, name: r.product_name, detail: variantLabel(r), brand: r.brand, model: r.model,
    sku: r.sku, barcode: r.barcode, image: r.image_url, colorHex: r.color_hex, kind: r.category_kind, category: r.category,
    price: Number(r.price), taxRate: tax.get(r.product_id) ?? 19, stocked: r.is_stocked, available: r.is_stocked ? Number(r.quantity ?? 0) : null, unit: r.unit,
  }));
}

export type CustomerHit = { id: string; full_name: string; document_type: string; document_number: string; phone: string | null; email: string | null };

/** Directory search for the sale form: name, document, phone or email. Contact data only, nothing clinical. */
export async function searchCustomersAction(q: string): Promise<CustomerHit[]> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "patients.read")) return [];
  const term = q.replace(/[%_,()]/g, " ").trim();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const db = await createClient();
  let query = db.from("patients").select("id, full_name, document_type, document_number, phone, email")
    .eq("tenant_id", ctx.tenant.id).is("deleted_at", null).eq("is_active", true).order("full_name").limit(8);
  query = term.includes("@") ? query.ilike("email", `%${term}%`)
    : digits.length >= 4 ? query.or(`document_number.ilike.${digits}%,phone.ilike.%${digits}%,whatsapp.ilike.%${digits}%`)
    : query.ilike("full_name", `%${term.split(/\s+/).join("%")}%`);
  const { data } = await query;
  return data ?? [];
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
  const validUntil = new Date(Date.now() + v.validDays * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await db.rpc("save_quote", { p: {
    tenant_id: ctx.tenant.id, branch_id: branchId, patient_id: v.patientId, prescription_id: v.prescriptionId ?? null, notes: v.notes ?? null,
    status: "sent", valid_until: validUntil, items: v.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, discount: i.discount })),
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
