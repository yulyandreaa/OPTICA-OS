import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AppointmentRow } from "@/modules/appointments/repositories/appointments";
import { statusMeta } from "@/modules/appointments/utils/status";

export function TodayAgenda({ appointments, tz, canCreate, title = "Agenda de hoy", highlightNext }: {
  appointments: AppointmentRow[]; tz: string; canCreate: boolean; title?: string; highlightNext?: boolean;
}) {
  const visible = appointments.filter((a) => !["cancelled"].includes(a.status));
  const nextId = highlightNext ? visible.find((a) => ["scheduled", "confirmed", "checked_in", "waiting"].includes(a.status))?.id : undefined;
  return (
    <Panel title={title} description={`${visible.length} citas`} bodyClassName="p-0"
      action={<Link href="/agenda" className="text-xs text-muted-foreground hover:text-foreground">Abrir agenda</Link>}>
      {visible.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No tienes citas para hoy 🎉" description="Aprovecha para llamar a pacientes con control pendiente." compact
          action={canCreate && <Link href="/agenda?nueva=1" className={buttonVariants({ size: "sm" })}>Crear cita</Link>} />
      ) : (
        <ul className="max-h-[420px] divide-y overflow-y-auto">
          {visible.map((a) => {
            const meta = statusMeta(a.status);
            const done = ["completed", "no_show"].includes(a.status);
            return (
              <li key={a.id} className={cn("flex items-center gap-3 px-4 py-2.5", a.id === nextId && "bg-brand-soft/60")}>
                <span className={cn("w-[76px] shrink-0 text-sm whitespace-nowrap tabular", done ? "text-muted-foreground" : "font-medium")}>{formatTime(a.starts_at, tz)}</span>
                <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: a.type?.color }} />
                <div className="min-w-0 flex-1">
                  <Link href={a.patient ? `/pacientes/${a.patient.id}` : "/agenda"} className={cn("block truncate text-sm hover:underline", done && "text-muted-foreground")}>
                    {a.patient?.full_name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{a.type?.name}{a.specialist ? ` · ${a.specialist.full_name}` : ""}</p>
                </div>
                {a.id === nextId ? <StatusBadge tone="brand">Siguiente</StatusBadge> : <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
