import { Boxes, CalendarCheck2, DoorOpen, FlaskConical, ShoppingBag, Sofa, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { addDaysKey, formatCompactMoney, formatDate, formatMoney, formatTime, zonedTimeToUtc } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { listAppointments } from "@/modules/appointments/repositories/appointments";
import { todayKey } from "@/modules/appointments/utils/agenda";
import { can } from "@/modules/authz/permissions";
import { AdminDashboard } from "@/modules/dashboard/components/admin-dashboard";
import { HealthScoreCard } from "@/modules/dashboard/components/health-score";
import { ShowcaseCard } from "@/modules/inventory/components/showcase-card";
import { OnboardingChecklist } from "@/modules/dashboard/components/onboarding-checklist";
import { RecallPanel } from "@/modules/dashboard/components/recall-panel";
import { TodayAgenda } from "@/modules/dashboard/components/today-agenda";
import { delta, getDashboardMetrics, getRecallOpportunities, healthScore } from "@/modules/dashboard/services/metrics";
import { primaryRole, requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Inicio" };

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default async function HomePage(props: PageProps<"/inicio">) {
  const ctx = await requirePermission("dashboard.view");
  await connection(); // reads the clock (today, greeting)
  const sp = await props.searchParams;
  const role = primaryRole(ctx);
  const tz = ctx.timezone;
  const today = todayKey(tz);
  // Owner dashboard: financial KPIs. Everyone else (e.g. sales reps) keeps the operational home below.
  if (can(ctx.grants, "reports.financial")) return <AdminDashboard ctx={ctx} searchParams={sp} today={today} />;
  const db = await createClient();
  const canAppts = can(ctx.grants, "appointments.read");
  const isClinician = role === "OPTOMETRIST" || role === "OPHTHALMOLOGIST";
  const isManager = ["OWNER", "ADMIN", "BRANCH_MANAGER"].includes(role);

  const [metrics, todayAppts, recall, setup] = await Promise.all([
    getDashboardMetrics(db, ctx.tenant.id, ctx.activeBranchId),
    canAppts
      ? listAppointments(db, ctx.tenant.id, {
          branchId: ctx.activeBranchId,
          fromUtc: zonedTimeToUtc(today, "00:00", tz),
          toUtc: zonedTimeToUtc(addDaysKey(today, 1), "00:00", tz),
          specialistId: isClinician ? ctx.user.id : undefined,
        })
      : Promise.resolve([]),
    can(ctx.grants, "patients.read") && !isClinician ? getRecallOpportunities(db, ctx.tenant.id) : Promise.resolve({ items: [], total: 0 }),
    isManager
      ? Promise.all([
          db.from("tenant_members").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id),
          db.from("specialist_schedules").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id),
          db.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id),
          db.from("invoices").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).eq("status", "accepted"),
        ])
      : Promise.resolve(null),
  ]);

  const canSales = can(ctx.grants, "sales.read");
  const monthStart = `${today.slice(0, 8)}01`;
  const [salesToday, salesMonth, readyOrders, lowStock] = await Promise.all([
    canSales ? db.rpc("report_sales", { p_tenant: ctx.tenant.id, p_from: today, p_to: today, p_branch: ctx.activeBranchId ?? undefined }).then((r) => r.data as { total: number; count: number; avg_ticket: number; balance_pending: number } | null) : Promise.resolve(null),
    canSales ? db.rpc("report_sales", { p_tenant: ctx.tenant.id, p_from: monthStart, p_to: today, p_branch: ctx.activeBranchId ?? undefined }).then((r) => r.data as { total: number; prev_total: number; balance_pending: number; consulted_patients: number; converted_patients: number } | null) : Promise.resolve(null),
    can(ctx.grants, "lab_orders.read")
      ? db.from("lab_orders").select("id, number, patient:patients(full_name)").eq("tenant_id", ctx.tenant.id).eq("status", "received").order("updated_at").limit(6).then((r) => r.data ?? [])
      : Promise.resolve([]),
    can(ctx.grants, "inventory.read") && isManager
      ? db.rpc("inventory_overview", { p_tenant: ctx.tenant.id, p_branch: ctx.activeBranchId ?? ctx.branches[0]?.id }).then((r) => (r.data ?? []).filter((x) => x.is_low).slice(0, 5))
      : Promise.resolve([]),
  ]);
  const health = isManager ? healthScore(metrics) : null;
  const nextUp = todayAppts.find((a) => ["scheduled", "confirmed", "checked_in", "waiting"].includes(a.status));
  const noShowRate = metrics.finished_30d > 0 ? Math.round((metrics.no_show_30d / metrics.finished_30d) * 100) : null;
  const completedToday = todayAppts.filter((a) => a.status === "completed");

  const briefItems = [
    { show: canAppts, icon: CalendarCheck2, text: <><b>{metrics.appointments_today}</b> {metrics.appointments_today === 1 ? "cita" : "citas"} hoy</>, href: "/agenda" },
    { show: canAppts && metrics.waiting_now > 0, icon: Sofa, text: <><b>{metrics.waiting_now}</b> en sala de espera</>, href: "/agenda/sala-espera" },
    { show: canAppts && metrics.unconfirmed_tomorrow > 0, icon: CalendarCheck2, text: <><b>{metrics.unconfirmed_tomorrow}</b> sin confirmar para mañana</>, href: `/agenda?date=${addDaysKey(today, 1)}` },
    { show: readyOrders.length > 0, icon: FlaskConical, text: <><b>{readyOrders.length}</b> {readyOrders.length === 1 ? "orden lista" : "órdenes listas"} para entregar</>, href: "/ordenes" },
    { show: lowStock.length > 0, icon: Boxes, text: <><b>{lowStock.length}</b> productos con stock bajo</>, href: "/inventario?disponibilidad=low" },
    { show: !!salesMonth && Number(salesMonth.balance_pending) > 0, icon: ShoppingBag, text: <><b>{formatCompactMoney(Number(salesMonth?.balance_pending ?? 0))}</b> por cobrar</>, href: "/ventas?estado=partial" },
    { show: recall.total > 0, icon: UserPlus, text: <><b>{recall.total}</b> oportunidades de control</>, href: "#oportunidades" },
  ].filter((i) => i.show);

  return (
    <div className="grid gap-6">
      {/* Daily brief */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground first-letter:uppercase">{formatDate(new Date(), tz, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{greeting(tz)}, {ctx.user.firstName} 👋</h1>
          {sp.welcome && <p className="text-sm text-muted-foreground">Tu óptica está lista. Empieza registrando un paciente o configurando la agenda.</p>}
        </div>
        {briefItems.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {briefItems.map((b, i) => (
              <li key={i}>
                <Link href={b.href} className="inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1.5 text-sm shadow-soft transition-colors hover:border-foreground/20">
                  <b.icon className="size-4 text-brand" /> <span className="[&_b]:font-semibold [&_b]:tabular">{b.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sp.denied && <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm">No tienes acceso a esa sección. Pídele a un administrador que te asigne el permiso.</p>}

      {/* Role-specific KPI row */}
      {isClinician ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-primary p-4 text-primary-foreground shadow-soft sm:col-span-2">
            <p className="text-[11px] font-medium tracking-wide uppercase opacity-70">Siguiente paciente</p>
            {nextUp ? (
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xl font-semibold">{nextUp.patient?.full_name}</p>
                  <p className="text-sm opacity-70">{formatTime(nextUp.starts_at, tz)} · {nextUp.type?.name}</p>
                </div>
                <Link href="/agenda/sala-espera" className={buttonVariants({ variant: "secondary", size: "sm" })}><DoorOpen /> Llamar</Link>
              </div>
            ) : <p className="mt-2 text-lg font-medium">No hay más pacientes hoy 🎉</p>}
          </div>
          <StatCard label="Mis citas hoy" value={todayAppts.filter((a) => a.status !== "cancelled").length} />
          <StatCard label="Atendidos hoy" value={completedToday.length} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {salesToday && salesMonth ? (
            <>
              <StatCard label="Ventas hoy" value={formatMoney(salesToday.total)} hint={`${salesToday.count} ventas`} />
              <StatCard label="Ventas del mes" value={formatMoney(salesMonth.total)} delta={delta(Number(salesMonth.total), Number(salesMonth.prev_total))} hint="vs. mes anterior" />
              <StatCard label="Ticket promedio hoy" value={salesToday.count ? formatMoney(salesToday.avg_ticket) : "—"} />
              <StatCard label="Conversión" value={salesMonth.consulted_patients ? `${Math.round((salesMonth.converted_patients / salesMonth.consulted_patients) * 100)}%` : "—"} hint="consulta → compra este mes" />
            </>
          ) : (
            <>
              <StatCard label="Citas hoy" value={metrics.appointments_today} hint={`${metrics.completed_today} atendidas`} />
              <StatCard label="Consultas del mes" value={metrics.consultations_month} delta={delta(metrics.consultations_month, metrics.consultations_prev_month)} hint="vs. mes anterior" />
              <StatCard label="Pacientes nuevos" value={metrics.new_patients_month} delta={delta(metrics.new_patients_month, metrics.new_patients_prev_month)} hint="este mes" />
              <StatCard label="Inasistencia" value={noShowRate === null ? "—" : `${noShowRate}%`} hint="últimos 30 días" />
            </>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-6">
          {canAppts && <TodayAgenda appointments={todayAppts} tz={tz} canCreate={can(ctx.grants, "appointments.create")} title={isClinician ? "Mis citas de hoy" : "Agenda de hoy"} highlightNext />}
          {role === "SALES_REP" && (
            <Panel title="Salieron de consulta hoy" description="Pacientes listos para asesoría de montura y lentes">
              {completedToday.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay pacientes atendidos hoy.</p> : (
                <ul className="grid gap-2">{completedToday.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm">
                    <Link href={`/pacientes/${a.patient?.id}`} className="hover:underline">{a.patient?.full_name}</Link>
                    <span className="text-xs text-muted-foreground">{a.specialist?.full_name}</span>
                  </li>))}
                </ul>
              )}
            </Panel>
          )}
        </div>
        <div className="grid content-start gap-6">
          {can(ctx.grants, "inventory.read") && <ShowcaseCard />}
          {isManager && setup && (
            <OnboardingChecklist items={[
              { label: "Crear tu óptica y primera sede", done: true, href: "/configuracion" },
              { label: "Registrar o importar pacientes", done: metrics.patients_total > 0, href: "/pacientes/nuevo" },
              { label: "Invitar a tu equipo", done: (setup[0].count ?? 0) > 1, href: "/equipo" },
              { label: "Configurar horarios de agenda", done: (setup[1].count ?? 0) > 0, href: "/configuracion/agenda" },
              { label: "Recibir la primera reserva en línea", done: metrics.online_bookings_month > 0, href: `/book/${ctx.tenant.slug}` },
              { label: "Cargar inventario de monturas", done: (setup[2].count ?? 0) > 0, href: "/inventario" },
              { label: "Conectar WhatsApp", done: false, href: "/configuracion/integraciones", soon: true },
              { label: "Emitir la primera factura electrónica", done: (setup[3].count ?? 0) > 0, href: "/facturacion" },
            ]} />
          )}
          {isManager && <HealthScoreCard health={health} />}
          {!isClinician && <div id="oportunidades"><RecallPanel items={recall.items} total={recall.total} /></div>}
          {readyOrders.length > 0 && (
            <Panel title="Gafas listas para entregar" description="Avísale al paciente por WhatsApp" bodyClassName="p-0"
              action={<Link href="/ordenes" className="text-xs text-muted-foreground hover:text-foreground">Ver órdenes</Link>}>
              <ul className="divide-y">{readyOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <Link href={`/ordenes/${o.id}`} className="truncate hover:underline">{o.patient?.full_name}</Link>
                  <span className="font-mono text-xs text-muted-foreground">{o.number}</span>
                </li>))}
              </ul>
            </Panel>
          )}
          {lowStock.length > 0 && (
            <Panel title="Stock bajo" bodyClassName="p-0" action={<Link href="/inventario" className="text-xs text-muted-foreground hover:text-foreground">Inventario</Link>}>
              <ul className="divide-y">{lowStock.map((p) => (
                <li key={p.variant_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="truncate">{p.product_name} {p.color_name ?? ""}</span><span className="font-medium text-destructive tabular">{Number(p.quantity)} u.</span>
                </li>))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
