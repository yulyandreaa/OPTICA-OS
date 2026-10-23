import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { addDaysKey, formatMoney, localDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import { delta } from "@/modules/dashboard/services/metrics";
import { BarList } from "@/modules/reports/bar-list";
import { DailyChart } from "@/modules/reports/daily-chart";
import { PAYMENT_METHOD_LABEL } from "@/modules/sales/constants";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Reportes" };

interface Report {
  total: number; count: number; avg_ticket: number; tax_total: number; balance_pending: number; margin: number; prev_total: number; prev_count: number;
  consulted_patients: number; converted_patients: number;
  by_day: { day: string; total: number; count: number }[]; by_category: { category: string; total: number }[];
  by_seller: { seller: string; total: number; count: number }[]; by_branch: { branch: string; total: number }[];
  top_products: { description: string; quantity: number; total: number }[]; by_method: { method: string; total: number }[];
}

const PRESETS = [{ k: "7", l: "7 días" }, { k: "30", l: "30 días" }, { k: "90", l: "90 días" }, { k: "mes", l: "Este mes" }] as const;

export default async function ReportsPage(props: PageProps<"/reportes">) {
  const ctx = await requirePermission("reports.read");
  const sp = await props.searchParams;
  const preset = PRESETS.find((p) => p.k === sp.periodo)?.k ?? "30";
  const today = localDateKey(new Date(await nowMs()), ctx.timezone);
  const from = preset === "mes" ? `${today.slice(0, 8)}01` : addDaysKey(today, -(Number(preset) - 1));
  const { data } = await (await createClient()).rpc("report_sales", { p_tenant: ctx.tenant.id, p_from: from, p_to: today, p_branch: ctx.activeBranchId ?? undefined });
  const r = data as unknown as Report;
  const financial = can(ctx.grants, "reports.financial");
  const conversion = r.consulted_patients ? Math.round((r.converted_patients / r.consulted_patients) * 100) : null;

  return (
    <>
      <PageHeader title="Reportes" description={`${ctx.branches.find((b) => b.id === ctx.activeBranchId)?.name ?? "Todas las sedes"} · ${from} a ${today}`}
        actions={<Link href={`/api/reportes/ventas?from=${from}&to=${today}`} className={buttonVariants({ variant: "outline" })}><Download /> Exportar CSV</Link>} />

      <nav className="mb-4 flex w-fit gap-1 rounded-lg bg-muted p-1" aria-label="Periodo">
        {PRESETS.map((p) => <Link key={p.k} href={`/reportes?periodo=${p.k}`} className={cn("rounded-md px-3 py-1 text-sm", preset === p.k ? "bg-surface font-medium shadow-soft" : "text-muted-foreground hover:text-foreground")}>{p.l}</Link>)}
      </nav>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Ventas" value={formatMoney(r.total)} delta={delta(Number(r.total), Number(r.prev_total))} hint="vs. periodo anterior" />
        <StatCard label="Número de ventas" value={r.count} delta={delta(r.count, r.prev_count)} />
        <StatCard label="Ticket promedio" value={formatMoney(r.avg_ticket)} />
        <StatCard label="Conversión consulta → compra" value={conversion === null ? "—" : `${conversion}%`} hint={`${r.converted_patients} de ${r.consulted_patients} pacientes`} />
        {financial ? <StatCard label="Margen bruto" value={formatMoney(r.margin)} hint={Number(r.total) ? `${Math.round((Number(r.margin) / (Number(r.total) - Number(r.tax_total))) * 100)}% sobre base` : undefined} />
          : <StatCard label="Saldos por cobrar" value={formatMoney(r.balance_pending)} />}
      </div>

      <Panel title="Ventas por día" description="Pasa el cursor sobre una barra para ver el detalle" className="mb-4"><DailyChart data={r.by_day.map((d) => ({ ...d, total: Number(d.total) }))} /></Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Por categoría"><BarList items={r.by_category.map((c) => ({ label: c.category, value: Number(c.total) }))} /></Panel>
        <Panel title="Por asesor"><BarList items={r.by_seller.map((s) => ({ label: s.seller, value: Number(s.total), sub: `${s.count} ventas` }))} /></Panel>
        <Panel title="Por medio de pago"><BarList items={r.by_method.map((m) => ({ label: PAYMENT_METHOD_LABEL[m.method] ?? m.method, value: Number(m.total) }))} /></Panel>
        {r.by_branch.length > 1 && <Panel title="Por sede"><BarList items={r.by_branch.map((b) => ({ label: b.branch, value: Number(b.total) }))} /></Panel>}
        <Panel title="Productos más vendidos" className="lg:col-span-2" bodyClassName="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Producto</th><th className="px-4 py-2 text-right font-medium">Unidades</th><th className="px-4 py-2 text-right font-medium">Ventas</th></tr></thead>
            <tbody className="divide-y">{r.top_products.map((p) => <tr key={p.description}><td className="px-4 py-2">{p.description}</td><td className="px-4 py-2 text-right tabular">{Number(p.quantity)}</td><td className="px-4 py-2 text-right tabular">{formatMoney(p.total)}</td></tr>)}</tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
