import {
  ArrowRight, BarChart3, CalendarCheck, CheckCircle2, Glasses, Package, Percent, Receipt, TrendingUp, Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { BranchSwitcher } from "@/components/app-shell/branch-switcher";
import { EmptyState } from "@/components/shared/empty-state";
import { Kpi, TONES, type Tone } from "@/components/shared/kpi-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { addDaysKey, formatCompactMoney, formatMoney, formatTime, initials, zonedTimeToUtc } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listAppointments, type AppointmentRow } from "@/modules/appointments/repositories/appointments";
import { can } from "@/modules/authz/permissions";
import type { AppContext } from "@/modules/tenants/services/context";
import { percentChange, resolvePeriod, type Period } from "../period";
import { canCompare, kpiDeltas, marginState, MIN_COMPARABLE_SALES, parseSummary, summaryArgs, type DashboardSummary } from "../services/summary";
import { BranchPerformance } from "./branch-performance";
import { CategoryDonut } from "./charts";
import { PeriodFilter } from "./period-filter";
import { RetryError } from "./retry-error";
import { SalesTrend } from "./sales-trend-chart";

type Search = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Resumen del negocio": the owner's dashboard. Requires reports.financial (checked again in the database). */
export function AdminDashboard({ ctx, searchParams, today }: { ctx: AppContext; searchParams: Search; today: string }) {
  const period = resolvePeriod({ periodo: str(searchParams.periodo), desde: str(searchParams.desde), hasta: str(searchParams.hasta), agrupar: str(searchParams.agrupar) }, today);
  const branchName = ctx.branches.find((b) => b.id === ctx.activeBranchId)?.name ?? "todas las sedes";

  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Hola, {ctx.user.firstName} 👋</h1>
            {ctx.tenant.is_demo && <StatusBadge tone="warning">Datos de demostración</StatusBadge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Aquí tienes el resumen de tu óptica: {branchName}, {period.label}. Actualizado hoy a las {formatTime(new Date(), ctx.timezone)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BranchSwitcher />
          <PeriodFilter value={period.key} from={period.from} to={period.to} />
        </div>
      </section>

      <Suspense key={`${period.from}:${period.to}:${period.bucket}:${ctx.activeBranchId}`} fallback={<DashboardSkeleton />}>
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
  const comparable = canCompare(s, period);

  const showClinic = can(ctx.grants, "appointments.read")
    && ((await db.from("specialist_schedules").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id)).count ?? 0) > 0;
  const appointments = showClinic
    ? await listAppointments(db, ctx.tenant.id, {
        branchId, fromUtc: zonedTimeToUtc(today, "00:00", ctx.timezone), toUtc: zonedTimeToUtc(addDaysKey(today, 1), "00:00", ctx.timezone),
      })
    : [];
  const branches = s.by_branch.map((b) => ({
    branch_id: b.branch_id, name: b.name, net: b.net, count: b.count,
    delta: comparable && b.prev_count >= MIN_COMPARABLE_SALES ? percentChange(b.net, b.prev_net) : null,
  }));
  const noSales = s.current.sales_count === 0;

  return (
    <>
      <KpiCards s={s} comparable={comparable} prevLabel={period.prevLabel} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Card title="Ventas netas" description={`Sin IVA · comparado con ${period.prevLabel}`}>
          {s.series.every((p) => p.net === 0 && p.prev_net === 0)
            ? <EmptyState compact icon={TrendingUp} title="Sin ventas en el período" description="Prueba con otro período o sede." />
            : <SalesTrend data={s.series} bucket={period.bucket} allowed={period.allowedBuckets} prevLabel={period.prevLabel} />}
        </Card>
        <Card title="Ventas por categoría" description={period.label}>
          {s.by_category.length === 0
            ? <EmptyState compact icon={BarChart3} title="Sin ventas en el período" />
            : <CategoryDonut rows={s.by_category} />}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <Card title="Rendimiento por sede" description="Ventas netas del período">
          <BranchPerformance branches={branches} activeBranchId={branchId} />
        </Card>
        <Card title="Top 5 productos" description="Por ventas netas" footer={<FooterLink href="/reportes">Ver reporte completo</FooterLink>}>
          {noSales ? <Empty>Sin productos vendidos en el período.</Empty> : (
            <ul className="grid grid-cols-1 gap-1">
              {s.top_products.map((p) => (
                <li key={p.description} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted/40">
                    {/* eslint-disable-next-line @next/next/no-img-element -- tenant product photos come from arbitrary storage URLs */}
                    {p.image_url ? <img src={p.image_url} alt="" className="size-full object-cover" /> : <Glasses className="size-4 text-muted-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.description}</span>
                    <span className="text-xs text-muted-foreground tabular">{Number(p.quantity)} u.</span>
                  </span>
                  <span className="shrink-0 font-medium whitespace-nowrap tabular">{formatMoney(p.net)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Asesores con más ventas" description="Ventas netas y número de ventas" footer={<FooterLink href="/reportes">Ver desempeño del equipo</FooterLink>}>
          {s.by_seller.length === 0 ? <Empty>Sin ventas en el período.</Empty> : (
            <div className="grid grid-cols-1 gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_3rem] gap-3 border-b pb-2 text-xs text-muted-foreground">
                <span>Asesor</span><span className="text-right">Ventas netas</span><span className="text-right">Ventas</span>
              </div>
              {s.by_seller.map((a) => (
                <div key={a.seller_id} className="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-center gap-3 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{initials(a.name ?? "?")}</span>
                    <span className="truncate">{a.name ?? "Usuario"}</span>
                  </span>
                  <span className="text-right font-medium whitespace-nowrap tabular">{formatMoney(a.net)}</span>
                  <span className="text-right text-muted-foreground tabular">{a.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <AlertCards s={s} />

      {showClinic && <TodayAppointments appointments={appointments} tz={ctx.timezone} />}
    </>
  );
}

/* ——— KPI cards ——— */

function KpiCards({ s, comparable, prevLabel }: { s: DashboardSummary; comparable: boolean; prevLabel: string }) {
  const d = kpiDeltas(s, comparable);
  const m = marginState(s, comparable);
  const c = s.current;
  const vs = `vs. ${prevLabel}`;
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={BarChart3} tone="blue" label="Ventas netas" value={formatMoney(c.net_sales)} delta={d.netSales}
          note={c.sales_count === 0 ? "Sin ventas en el período" : d.netSales === null ? `${plural(c.sales_count, "venta", "ventas")} · sin IVA` : vs} />
        <Kpi icon={Percent} tone="green" label="Margen bruto"
          value={m.status === "ok" || m.status === "partial" ? `${Math.round(m.pct)}%` : "No disponible"}
          delta={m.status === "ok" ? m.delta : null} unit=" pp"
          note={m.status === "empty" ? "Sin ventas en el período"
            : m.status === "no_costs" ? "Faltan costos de los productos vendidos"
            : m.status === "partial" ? `Sobre el ${Math.round(m.coverage * 100)}% de las ventas con costo`
            : m.delta === null ? `${formatCompactMoney(m.value)} de utilidad bruta` : vs} />
        <Kpi icon={Wallet} tone="violet" label="Recaudo" value={formatMoney(c.collected)} delta={d.collected}
          note={c.payments_count === 0 ? "Sin pagos registrados" : d.collected === null ? plural(c.payments_count, "pago recibido", "pagos recibidos") : vs} />
        <Kpi icon={Receipt} tone="orange" label="Cartera pendiente" value={formatMoney(s.receivables.total)} delta={null}
          note={s.receivables.count === 0 ? "Nadie te debe hoy" : `${plural(s.receivables.count, "venta", "ventas")} con saldo · a hoy`} />
      </div>
      {!comparable && c.sales_count > 0 && (
        <p className="text-xs text-muted-foreground">Sin variación: el período anterior no tiene suficientes ventas registradas para compararlo con justicia.</p>
      )}
    </div>
  );
}

/* ——— Alert cards ——— */

function AlertCard({ icon: Icon, tone, title, subtitle, count, children, href, cta }: {
  icon: LucideIcon; tone: Tone; title: string; subtitle: string; count: number | null; children: ReactNode; href: string; cta: string;
}) {
  return (
    <div className={cn("flex flex-col rounded-2xl border bg-gradient-to-br to-surface p-5 shadow-soft", TONES[tone].wash)}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", TONES[tone].tile)}><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {count !== null && count > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-white tabular">{count}</span>}
      </div>
      <div className="mt-4 flex-1 text-sm">{children}</div>
      <Link href={href} className="mt-4 inline-flex w-fit items-center gap-1 text-sm font-medium text-brand hover:underline">{cta} <ArrowRight className="size-3.5" /></Link>
    </div>
  );
}

const Rows = ({ rows }: { rows: { key: string; left: ReactNode; right: ReactNode; href?: string }[] }) => (
  <ul className="divide-y">
    {rows.map((r) => (
      <li key={r.key}>
        {r.href ? (
          <Link href={r.href} className="flex items-center justify-between gap-3 py-1.5 hover:text-brand"><span className="truncate">{r.left}</span><span className="shrink-0 tabular">{r.right}</span></Link>
        ) : (
          <div className="flex items-center justify-between gap-3 py-1.5"><span className="truncate">{r.left}</span><span className="shrink-0 tabular">{r.right}</span></div>
        )}
      </li>
    ))}
  </ul>
);
const AllGood = ({ children }: { children: ReactNode }) => (
  <p className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="size-4 text-success" />{children}</p>
);

function AlertCards({ s }: { s: DashboardSummary }) {
  const a = s.alerts;
  const stockCount = a.low_stock + a.out_of_stock;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <AlertCard icon={Package} tone="red" title="Inventario bajo" subtitle="Productos en o por debajo del mínimo" count={stockCount}
        href={a.out_of_stock > 0 ? "/inventario?disponibilidad=out" : "/inventario?disponibilidad=low"} cta="Ver inventario">
        {stockCount === 0 ? <AllGood>Stock al día.</AllGood> : (
          <Rows rows={[
            ...a.low_stock_by_category.slice(0, 3).map((c) => ({ key: c.category, left: c.category, right: `${c.count}` })),
            ...(a.out_of_stock > 0 ? [{ key: "agotados", left: <span className="text-destructive">Agotados</span>, right: <span className="text-destructive">{a.out_of_stock}</span>, href: "/inventario?disponibilidad=out" }] : []),
          ]} />
        )}
      </AlertCard>
      <AlertCard icon={Glasses} tone="orange" title="Órdenes ópticas retrasadas" subtitle="Superaron la fecha estimada" count={a.late_lab_orders} href="/ordenes?atrasadas=1" cta="Ver órdenes">
        {a.late_lab_orders === 0 ? <AllGood>Todas a tiempo.</AllGood> : (
          <Rows rows={a.late_orders.map((o) => ({
            key: o.id, href: `/ordenes/${o.id}`, left: <span className="font-mono text-xs">{o.number}</span>,
            right: <span className="text-destructive">{plural(o.days_late, "día", "días")} de retraso</span>,
          }))} />
        )}
      </AlertCard>
      <AlertCard icon={Receipt} tone="blue" title="Cartera vencida" subtitle="Saldos con más de 30 días" count={s.receivables.overdue_count} href="/ventas?estado=partial&vencidas=1" cta="Ver cartera">
        {s.receivables.overdue_count === 0 ? <AllGood>Sin saldos vencidos.</AllGood> : (
          <Rows rows={a.overdue.map((o) => ({ key: o.sale_id, href: `/ventas/${o.sale_id}`, left: o.customer ?? `Venta ${o.number}`, right: formatMoney(o.balance) }))} />
        )}
      </AlertCard>
      <AlertCard icon={CalendarCheck} tone="green" title="Cierres de caja pendientes" subtitle="Cajas que requieren revisión" count={null} href="/caja" cta="Ver caja">
        <p className="text-muted-foreground">Se activa con el módulo de caja (apertura, arqueo y cierre por sede).</p>
      </AlertCard>
    </div>
  );
}

/* ——— Optometry (only when the business runs an agenda) ——— */

function TodayAppointments({ appointments, tz }: { appointments: AppointmentRow[]; tz: string }) {
  const active = appointments.filter((a) => a.status !== "cancelled");
  const pending = active.filter((a) => ["scheduled", "confirmed", "checked_in", "waiting"].includes(a.status));
  return (
    <Card title="Citas de hoy" description={`${plural(active.length, "cita", "citas")} · ${pending.length} por atender`} footer={<FooterLink href="/agenda">Abrir agenda</FooterLink>}>
      {active.length === 0 ? <Empty>No hay citas programadas para hoy.</Empty> : (
        <ul className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
          {pending.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-b py-2 text-sm">
              <span className="w-[5.5rem] shrink-0 font-medium whitespace-nowrap tabular">{formatTime(a.starts_at, tz)}</span>
              <span className="min-w-0"><span className="block truncate">{a.patient?.full_name}</span><span className="block truncate text-xs text-muted-foreground">{a.type?.name}</span></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ——— Layout pieces ——— */

function Card({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border bg-surface p-5 shadow-soft">
      <header className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </header>
      <div className="flex-1">{children}</div>
      {footer && <div className="mt-4">{footer}</div>}
    </section>
  );
}

const FooterLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">{children} <ArrowRight className="size-3.5" /></Link>
);
const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6" aria-busy="true" aria-label="Cargando resumen">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-2xl" />)}</div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]"><Skeleton className="h-[330px] rounded-2xl" /><Skeleton className="h-[330px] rounded-2xl" /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[300px] rounded-2xl" />)}</div>
    </div>
  );
}
