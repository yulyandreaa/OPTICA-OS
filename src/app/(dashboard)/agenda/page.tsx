import { CalendarDays, ChevronLeft, ChevronRight, Settings2, Sofa } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, localDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AgendaBoard } from "@/modules/appointments/components/agenda-board";
import { MonthView } from "@/modules/appointments/components/month-view";
import type { AgendaColumn } from "@/modules/appointments/components/types";
import { listAppointments, listAppointmentTypes, listSpecialists } from "@/modules/appointments/repositories/appointments";
import { agendaParams } from "@/modules/appointments/schemas";
import {
  DAY_END_HOUR, DAY_START_HOUR, hhmmToMinutes, rangeFor, shiftDate, toAgendaAppointment, todayKey,
} from "@/modules/appointments/utils/agenda";
import { can } from "@/modules/authz/permissions";
import { requirePermission } from "@/modules/tenants/services/context";
import { getPatient } from "@/modules/patients/repositories/patients";
import { weekdayOfKey } from "@/lib/format";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage(props: PageProps<"/agenda">) {
  const ctx = await requirePermission("appointments.read");
  await connection(); // reads the clock (today, greeting)
  const sp = await props.searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const params = agendaParams.parse({ view: str(sp.view), date: str(sp.date), specialist: str(sp.specialist) });
  const tz = ctx.timezone;
  const today = todayKey(tz);
  const dateKey = params.date ?? today;
  const { view } = params;
  const branchId = ctx.activeBranchId;

  const db = await createClient();
  const range = rangeFor(view, dateKey, tz);
  const [rows, specialists, types] = await Promise.all([
    listAppointments(db, ctx.tenant.id, { branchId, fromUtc: range.from, toUtc: range.to, specialistId: params.specialist }),
    listSpecialists(db, ctx.tenant.id, branchId),
    listAppointmentTypes(db, ctx.tenant.id),
  ]);
  const appointments = rows.map(toAgendaAppointment);

  const prefillPatientId = str(sp.paciente);
  const prefillPatient = prefillPatientId ? await getPatient(db, ctx.tenant.id, prefillPatientId) : null;
  const openNew = str(sp.nueva) === "1"
    ? { date: dateKey, patient: prefillPatient ? { id: prefillPatient.id, name: prefillPatient.full_name } : undefined }
    : null;

  const visibleSpecialists = params.specialist ? specialists.filter((s) => s.id === params.specialist) : specialists;
  const workingFor = (sId: string | null, dKey: string): [number, number][] => {
    if (!sId) return [];
    const wd = weekdayOfKey(dKey);
    return (specialists.find((s) => s.id === sId)?.schedules ?? [])
      .filter((s) => s.weekday === wd && (!branchId || s.branchId === branchId))
      .map((s) => [hhmmToMinutes(s.start), hhmmToMinutes(s.end)] as [number, number]);
  };

  let columns: AgendaColumn[] = [];
  if (view === "day") {
    columns = visibleSpecialists.map((s) => ({
      key: s.id, label: s.name, dateKey, specialistId: s.id, working: workingFor(s.id, dateKey), isToday: dateKey === today,
      sublabel: `${appointments.filter((a) => a.specialistId === s.id && !["cancelled", "no_show"].includes(a.status)).length} citas`,
    }));
    if (appointments.some((a) => !a.specialistId) || columns.length === 0) {
      columns.push({ key: "none", label: "Sin asignar", dateKey, specialistId: null, working: [], isToday: dateKey === today });
    }
  } else if (view === "week") {
    columns = range.days.map((d) => ({
      key: d, dateKey: d, specialistId: params.specialist ?? null, isToday: d === today,
      label: formatDate(`${d}T12:00:00Z`, "UTC", { weekday: "short", day: "numeric" }),
      working: params.specialist ? workingFor(params.specialist, d) : [],
    }));
  }

  const byDay = new Map<string, typeof appointments>();
  for (const a of appointments) {
    const k = localDateKey(new Date(a.startsAt), tz);
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view: view === "day" ? undefined : view, date: dateKey === today ? undefined : dateKey, specialist: params.specialist, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/agenda?${s}` : "/agenda";
  };

  const title = view === "month"
    ? formatDate(`${dateKey}T12:00:00Z`, "UTC", { month: "long", year: "numeric" })
    : view === "week"
      ? `Semana del ${formatDate(`${range.days[0]}T12:00:00Z`, "UTC", { day: "numeric", month: "short" })}`
      : formatDate(`${dateKey}T12:00:00Z`, "UTC", { weekday: "long", day: "numeric", month: "long" });

  const active = appointments.filter((a) => !["cancelled", "no_show"].includes(a.status));
  const branchName = ctx.branches.find((b) => b.id === branchId)?.name ?? "Todas las sedes";

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border bg-surface shadow-soft">
            <Link href={link({ date: shiftDate(view, dateKey, -1) })} aria-label="Anterior" className="grid size-8 place-items-center text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /></Link>
            <Link href={link({ date: undefined })} className="border-x px-3 text-sm leading-8 hover:bg-muted">Hoy</Link>
            <Link href={link({ date: shiftDate(view, dateKey, 1) })} aria-label="Siguiente" className="grid size-8 place-items-center text-muted-foreground hover:text-foreground"><ChevronRight className="size-4" /></Link>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight first-letter:uppercase">{title}</h1>
            <p className="text-xs text-muted-foreground">{branchName} · {active.length} citas</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {specialists.length > 0 && (
            <nav className="flex flex-wrap gap-1" aria-label="Especialista">
              <Link href={link({ specialist: undefined })} className={cn("rounded-full border px-3 py-1 text-xs", !params.specialist ? "border-foreground/20 bg-surface font-medium shadow-soft" : "text-muted-foreground hover:text-foreground")}>Todos</Link>
              {specialists.map((s) => (
                <Link key={s.id} href={link({ specialist: s.id })} className={cn("rounded-full border px-3 py-1 text-xs", params.specialist === s.id ? "border-foreground/20 bg-surface font-medium shadow-soft" : "text-muted-foreground hover:text-foreground")}>
                  {s.name.split(" ").slice(0, 2).join(" ")}
                </Link>
              ))}
            </nav>
          )}
          <div className="flex rounded-lg bg-muted p-1">
            {(["day", "week", "month"] as const).map((v) => (
              <Link key={v} href={link({ view: v === "day" ? undefined : v })}
                className={cn("rounded-md px-3 py-1 text-sm", view === v ? "bg-surface font-medium shadow-soft" : "text-muted-foreground hover:text-foreground")}>
                {{ day: "Día", week: "Semana", month: "Mes" }[v]}
              </Link>
            ))}
          </div>
          <Link href="/agenda/sala-espera" className={buttonVariants({ variant: "outline" })}><Sofa /> Sala de espera</Link>
        </div>
      </div>

      {specialists.length === 0 && can(ctx.grants, "schedules.manage") && (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed bg-surface p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground"><b className="text-foreground">Configura los horarios de tus especialistas</b> para ver la agenda por profesional y habilitar la reserva en línea.</p>
          <Link href="/configuracion/agenda" className={buttonVariants({ variant: "outline", size: "sm" })}><Settings2 /> Configurar horarios</Link>
        </div>
      )}

      {view === "month" ? (
        <MonthView days={range.days} monthKey={dateKey} todayKey={today} byDay={byDay} tz={tz} />
      ) : columns.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Sin especialistas para mostrar" />
      ) : (
        <AgendaBoard
          key={`${view}-${dateKey}-${params.specialist ?? ""}`}
          view={view}
          columns={columns}
          appointments={appointments}
          tz={tz}
          startHour={DAY_START_HOUR}
          endHour={DAY_END_HOUR}
          canCreate={can(ctx.grants, "appointments.create", branchId)}
          canUpdate={can(ctx.grants, "appointments.update", branchId)}
          types={types.map((t) => ({ id: t.id, name: t.name, color: t.color, duration: t.duration_minutes }))}
          specialists={specialists.map((s) => ({ id: s.id, name: s.name }))}
          branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
          defaultBranchId={branchId}
          openNew={openNew}
        />
      )}
    </div>
  );
}
