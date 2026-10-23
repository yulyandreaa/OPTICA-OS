import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { serverEnv } from "@/lib/env";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { can } from "@/modules/authz/permissions";
import { INVOICE_STATUS } from "@/modules/billing/constants";
import { IssueInvoiceButton } from "@/modules/sales/components/sale-actions";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Facturación electrónica" };

export default async function BillingPage() {
  const ctx = await requirePermission("billing.read");
  const now = await nowMs();
  const db = await createClient();
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [{ data: invoices }, { data: paidSales }] = await Promise.all([
    db.from("invoices").select("id, number, status, cufe, total, issued_at, error_message, created_at, sale:sales(id, number, patient:patients(full_name))")
      .eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(80),
    db.from("sales").select("id, number, total, created_at, patient:patients(full_name)").eq("tenant_id", ctx.tenant.id).eq("status", "completed").eq("payment_status", "paid")
      .gte("created_at", new Date(now - 45 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(200),
  ]);
  const invoicedSales = new Set((invoices ?? []).filter((i) => ["accepted", "processing"].includes(i.status)).map((i) => i.sale?.id));
  const month = (invoices ?? []).filter((i) => i.status === "accepted" && i.issued_at && new Date(i.issued_at) >= monthStart);
  // One entry per sale: latest rejected attempt wins over "never invoiced".
  const rejectedBySale = new Map<string, NonNullable<typeof invoices>[number]>();
  for (const i of invoices ?? []) if (i.status === "rejected" && i.sale && !invoicedSales.has(i.sale.id) && !rejectedBySale.has(i.sale.id)) rejectedBySale.set(i.sale.id, i);
  const rejected = [...rejectedBySale.values()];
  const pending = (paidSales ?? []).filter((s) => !invoicedSales.has(s.id) && !rejectedBySale.has(s.id));
  const canIssue = can(ctx.grants, "billing.issue");
  const sandbox = serverEnv().EINVOICE_PROVIDER === "mock";

  return (
    <>
      <PageHeader title="Facturación electrónica" description="La factura es independiente de la venta: si el proveedor falla, la venta no se pierde."
        actions={sandbox && <StatusBadge tone="warning">Proveedor en modo sandbox</StatusBadge>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Facturado este mes" value={formatMoney(month.reduce((a, i) => a + Number(i.total), 0))} hint={`${month.length} facturas aceptadas`} />
        <StatCard label="Pendientes por facturar" value={pending.length} hint={formatMoney(pending.reduce((a, s) => a + Number(s.total), 0))} />
        <StatCard label="Rechazadas" value={rejected.length} hint="requieren reintento" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Panel title="Ventas pagadas sin factura" bodyClassName="p-0">
          {pending.length === 0 && rejected.length === 0 ? <EmptyState icon={Receipt} title="Todo facturado 🎉" compact /> : (
            <ul className="divide-y">
              {[...rejected.map((r) => ({ id: r.sale!.id, number: r.sale!.number, total: r.total, who: r.sale?.patient?.full_name, retry: true, err: r.error_message })),
                ...pending.map((s) => ({ id: s.id, number: s.number, total: s.total, who: s.patient?.full_name, retry: false, err: null }))].slice(0, 30).map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/ventas/${s.id}`} className="font-mono text-xs hover:underline">{s.number}</Link> <span className="text-muted-foreground">· {s.who ?? "Consumidor final"}</span>
                    {s.err && <p className="truncate text-xs text-destructive">{s.err}</p>}
                  </div>
                  <span className="tabular">{formatMoney(s.total)}</span>
                  {canIssue && <IssueInvoiceButton saleId={s.id} retry />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Facturas emitidas" bodyClassName="p-0">
          <ul className="divide-y">{(invoices ?? []).map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs">{i.number ?? "—"} <span className="font-sans text-muted-foreground">· {i.sale?.patient?.full_name ?? "Consumidor final"}</span></p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">{i.cufe ? `CUFE ${i.cufe}` : i.error_message ?? ""}</p>
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(i.issued_at ?? i.created_at, ctx.timezone, { day: "numeric", month: "short" })}</span>
              <span className="tabular">{formatMoney(i.total)}</span>
              <StatusBadge tone={INVOICE_STATUS[i.status]?.tone}>{INVOICE_STATUS[i.status]?.label}</StatusBadge>
            </li>))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
