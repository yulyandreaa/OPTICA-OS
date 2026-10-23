import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { PAYMENT_STATUS, SALE_STATUS } from "@/modules/sales/constants";
import { getAppContext } from "@/modules/tenants/services/context";

/** CSV export of sales for a date range (RLS-scoped to the signed-in user). */
export async function GET(request: NextRequest) {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "reports.read")) return new NextResponse("No autorizado", { status: 403 });
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new NextResponse("Rango inválido", { status: 400 });
  const db = await createClient();
  let q = db.from("sales").select("number, created_at, status, payment_status, subtotal, discount_total, tax_total, total, paid_total, balance, patient:patients(full_name, document_number), seller:profiles!sales_seller_profile_fkey(full_name), branch:branches(name)")
    .eq("tenant_id", ctx.tenant.id).gte("created_at", `${from}T05:00:00Z`).lt("created_at", `${to}T23:59:59-05:00`).order("created_at").limit(10000);
  if (ctx.activeBranchId) q = q.eq("branch_id", ctx.activeBranchId);
  const { data } = await q;
  const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ["Venta", "Fecha", "Sede", "Paciente", "Documento", "Asesor", "Estado", "Estado de pago", "Subtotal", "Descuentos", "IVA", "Total", "Pagado", "Saldo"];
  const rows = (data ?? []).map((s) => [s.number, s.created_at, s.branch?.name, s.patient?.full_name, s.patient?.document_number, s.seller?.full_name, SALE_STATUS[s.status]?.label ?? s.status, PAYMENT_STATUS[s.payment_status]?.label ?? s.payment_status, s.subtotal, s.discount_total, s.tax_total, s.total, s.paid_total, s.balance]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ventas-${from}-a-${to}.csv"` } });
}
