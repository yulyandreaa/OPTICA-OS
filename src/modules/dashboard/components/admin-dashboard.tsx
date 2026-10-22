import { CheckCircle2, FlaskConical, PackageX, Package, Receipt, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { BranchSwitcher } from "@/components/app-shell/branch-switcher";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { addDaysKey, formatCompactMoney, formatMoney, zonedTimeToUtc } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listAppointments } from "@/modules/appointments/repositories/appointments";
import { can } from "@/modules/authz/permissions";
import type { AppContext } from "@/modules/tenants/services/context";
import { resolvePeriod, type Period } from "../period";
import { canCompare, kpiDeltas, marginState, parseSummary, summaryArgs, type DashboardSummary } from "../services/summary";
import { BranchPerformance } from "./branch-performance";
import { PeriodFilter } from "./period-filter";
import { RetryError } from "./retry-error";
import { SalesTrend } from "./sales-trend-chart";
import { TodayAgenda } from "./today-agenda";

type Search = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** "Resumen del negocio": the owner's dashboard. Requires reports.financial (checked again in the database). */
export function AdminDashboard({ ctx, searchParams, today }: { ctx: AppContext; searchParams: Search; today: string }) {
  const period = resolvePeriod({ periodo: str(searchParams.periodo), desde: str(searchParams.desde), hasta: str(searchParams.hasta) }, today);
  const branchName = ctx.branches.find((b) => b.id === ctx.activeBranchId)?.name ?? "Todas las sedes";

  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Resumen del negocio</h1>
            {ctx.tenant.is_demo && <StatusBadge tone="warning">Datos de demostración</StatusBadge>}
          </div>
          <p className="text-sm text-muted-foreground">Hola, {ctx.user.firstName}. {branchName} · {period.label} · comparado con {period.prevLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BranchSwitcher />
          <PeriodFilter value={period.key} from={period.from} to={period.to} />
        </div>
      </section>

      <Suspense key={`${period.from}:${period.to}:${ctx.activeBranchId}`} fallback={<DashboardSkeleton />}>
        <DashboardData ctx={ctx} period={period} today={today} />
      </Suspense>
    </div>
  );
}

async function DashboardData({ ctx, period, today }: { ctx: AppContext; period: Period; today: string }) {
  const db = await createClient();
  const branchId = ctx.activeBranchId;
  const { data, error } = await db.rpc("dashboard_summary", summaryArgs(ctx.tenant.id, period, branchId));
  if (error) return <RetryError message="No pudimos calcular el resumen del negocio." />;
  const s = parseSummary(data);

  const showClinic = can(ctx.grants, "appointments.read")
    && ((await db.from("specialist_schedules").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id)).count ?? 0) > 0;
  const appointments = showClinic
    ? await listAppointments(db, ctx.tenant.id, {
        branchId, fromUtc: zonedTimeToUtc(today, "00:00", ctx.timezone), toUtc: zonedTimeToUtc(addDaysKey(today, 1), "00:00", ctx.timezone),
      })
    : [];

  return (
    <>
      <KpiCards s={s} comparable={canCompare(s, period)} />
      <div className="grid items-start gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel className="min-w-0" title="Ventas netas" description={`${period.label} · sin IVA`}>
          {s.series.every((p) => p.net === 0 && p.prev_net === 0)
            ? <EmptyState compact icon={TrendingUp} title="Sin ventas en el período" description="Prueba con otro período o sede." />
            : <SalesTrend data={s.series} bucket={period.bucket} prevLabel={period.prevLabel} />}
        </Panel>
        <Alerts s={s} />
      </div>
      <div className="grid items-start gap-6 grid-cols-1 xl:grid-cols-2">
        <BranchPerformance branches={s.by_branch} activeBranchId={branchId} />
        {showClinic && <TodayAgenda appointments={appointments} tz={ctx.timezone} canCreate={can(ctx.grants, "appointments.create")} title="Citas de hoy" highlightNext />}
      </div>
    </>
  );
}

function KpiCards({ s, comparable }: { s: DashboardSummary; comparable: boolean }) {
  const d = kpiDeltas(s, comparable);
  const m = marginState(s, comparable);
  const c = s.current;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="grid grid-cols-1 gap-3">
      {!comparable && c.sales_count > 0 && (
        <p className="text-xs text-muted-foreground">Sin comparación: el período anterior no tiene suficientes ventas registradas para compararlo.</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Ventas netas" value={formatMoney(c.net_sales)} delta={d.netSales}
        hint={c.sales_count === 0 ? "Sin ventas en el período" : `${plural(c.sales_count, "venta", "ventas")} · sin IVA`} />
      <StatCard label="Margen bruto"
        value={m.status === "ok" || m.status === "partial" ? `${Math.round(m.pct)}%` : "No disponible"}
        delta={m.status === "ok" ? m.delta : null}
        hint={m.status === "empty" ? "Sin ventas en el período"
          : m.status === "no_costs" ? "Faltan costos de los productos vendidos"
          : m.status === "partial" ? `Sobre el ${Math.round(m.coverage * 100)}% de las ventas (resto sin costo)`
          : `${formatCompactMoney(m.value)} de utilidad bruta`} />
      <StatCard label="Recaudo" value={formatMoney(c.collected)} delta={d.collected}
        hint={c.payments_count === 0 ? "Sin pagos registrados" : `${plural(c.payments_count, "pago recibido", "pagos recibidos")}`} />
      <StatCard label="Cartera pendiente" value={formatMoney(s.receivables.total)}
        hint={s.receivables.count === 0 ? "Nadie te debe hoy" : `${plural(s.receivables.count, "venta", "ventas")} con saldo · a hoy`} />
      </div>
    </div>
  );
}

function Alerts({ s }: { s: DashboardSummary }) {
  const a = s.alerts;
  const items = [
    { show: a.out_of_stock > 0, icon: PackageX, text: `${a.out_of_stock} ${a.out_of_stock === 1 ? "producto agotado" : "productos agotados"}`, href: "/inventario?tab=stock&filtro=agotado", tone: "text-destructive" },
    { show: a.low_stock > 0, icon: Package, text: `${a.low_stock} ${a.low_stock === 1 ? "producto con" : "productos con"} stock bajo`, href: "/inventario?tab=stock&filtro=bajo", tone: "text-warning" },
    { show: a.late_lab_orders > 0, icon: FlaskConical, text: `${a.late_lab_orders} ${a.late_lab_orders === 1 ? "orden óptica retrasada" : "órdenes ópticas retrasadas"}`, href: "/ordenes?atrasadas=1", tone: "text-destructive" },
    { show: s.receivables.overdue_count > 0, icon: Receipt, text: `${formatMoney(s.receivables.overdue_total)} en cartera vencida (${s.receivables.overdue_count} ${s.receivables.overdue_count === 1 ? "venta" : "ventas"} > 30 días)`, href: "/ventas?estado=partial&vencidas=1", tone: "text-warning" },
  ].filter((i) => i.show);

  return (
    <Panel title="Alertas operativas" description="Lo que necesita tu atención" bodyClassName="p-0">
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-6 text-sm"><CheckCircle2 className="size-5 text-success" /> Sin alertas pendientes.</div>
      ) : (
        <ul className="divide-y">
          {items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/60">
                <i.icon className={`size-4 shrink-0 ${i.tone}`} />
                <span className="flex-1">{i.text}</span>
                <span className="text-xs text-muted-foreground">Ver</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6" aria-busy="true" aria-label="Cargando resumen">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}</div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"><Skeleton className="h-[320px] rounded-xl" /><Skeleton className="h-[320px] rounded-xl" /></div>
    </div>
  );
}
