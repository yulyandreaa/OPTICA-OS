"use server";
import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action";
import { humanizeError, logError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { getElectronicInvoiceProvider } from "@/integrations/einvoice";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";

/**
 * Issues the electronic invoice of a sale. Sale and invoice are independent:
 * a provider error leaves the invoice `rejected` (retryable) and never touches the sale.
 */
export async function issueInvoiceAction(saleId: string): Promise<ActionResult<{ status: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "billing.issue")) return fail("No tienes permiso para facturar.");
  const db = await createClient();
  const { data: sale } = await db.from("sales").select("id, number, subtotal, tax_total, total, status, patient:patients(document_type, document_number, full_name, email)")
    .eq("tenant_id", ctx.tenant.id).eq("id", saleId).single();
  if (!sale) return fail("No encontramos la venta.");
  if (sale.status !== "paid") return fail("Solo se facturan ventas pagadas en su totalidad.");
  const { data: existing } = await db.from("invoices").select("id, status, attempts").eq("tenant_id", ctx.tenant.id).eq("sale_id", saleId).order("created_at", { ascending: false });
  if (existing?.some((i) => i.status === "accepted" || i.status === "processing")) return fail("Esta venta ya tiene factura.");

  const attempt = (existing?.length ?? 0) + 1;
  const idempotencyKey = `invoice:${saleId}:${attempt}`;
  const provider = getElectronicInvoiceProvider();
  const { data: inv, error } = await db.from("invoices").insert({
    tenant_id: ctx.tenant.id, sale_id: saleId, status: "processing", provider: provider.name, attempts: attempt,
    subtotal: Number(sale.total) - Number(sale.tax_total), tax_total: sale.tax_total, total: sale.total, idempotency_key: idempotencyKey,
    customer: sale.patient ? { document_type: sale.patient.document_type, document_number: sale.patient.document_number, name: sale.patient.full_name, email: sale.patient.email }
      : { name: "Consumidor final", document_number: "222222222222" },
    created_by: ctx.user.id,
  }).select("id").single();
  if (error) return fail(humanizeError(error));

  const started = Date.now();
  try {
    const res = await provider.issueInvoice({ tenantId: ctx.tenant.id, saleId, idempotencyKey, payload: { saleNumber: sale.number } });
    await db.from("invoices").update({
      status: res.status, provider_ref: res.providerRef, cufe: res.cufe ?? null, number: res.invoiceNumber ? `${res.invoiceNumber.split("-")[0]}-${sale.number.split("-")[1]}` : null,
      issued_at: new Date().toISOString(), dian_response: { sandbox: provider.name === "mock" },
    }).eq("id", inv.id);
    await db.from("integration_logs").insert({ tenant_id: ctx.tenant.id, provider: provider.name, operation: "issueInvoice", status: "success", request_id: idempotencyKey, duration_ms: Date.now() - started });
    revalidatePath(`/ventas/${saleId}`);
    revalidatePath("/facturacion");
    return ok({ status: res.status }, res.status === "accepted" ? "Factura aceptada" : "Factura en proceso");
  } catch (err) {
    logError("billing.issue", err, { tenantId: ctx.tenant.id });
    await db.from("invoices").update({ status: "rejected", error_message: "El proveedor no respondió. Puedes reintentar." }).eq("id", inv.id);
    await db.from("integration_logs").insert({ tenant_id: ctx.tenant.id, provider: provider.name, operation: "issueInvoice", status: "error", request_id: idempotencyKey, duration_ms: Date.now() - started, error: "provider_error" });
    revalidatePath("/facturacion");
    return fail("El proveedor de facturación no respondió. La venta está a salvo; puedes reintentar.");
  }
}
