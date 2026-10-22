"use client";
import { ArrowRight, Check, Clock, DoorOpen, Loader2, Sofa } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { updateAppointmentStatusAction } from "../actions";
import { statusMeta, type AppointmentStatus } from "../utils/status";
import type { AgendaAppointment } from "./types";

type WaitingItem = AgendaAppointment & { checkedInAt: string | null; startedAt: string | null };

function WaitingColumn({ title, icon: Icon, items, empty, tz, children }: {
  title: string; icon: typeof Sofa; items: WaitingItem[]; empty: string; tz: string; children: (a: WaitingItem) => React.ReactNode;
}) {
  return (
    <section className="grid content-start gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" /> {title}
        <span className="rounded-full bg-muted px-2 text-xs font-medium tabular">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-surface/50"><EmptyState icon={Icon} title={empty} compact /></div>
      ) : items.map((a) => (
        <article key={a.id} className="rounded-xl border bg-surface p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{a.patient?.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {formatTime(a.startsAt, tz)} · {a.type?.name}{a.specialistName ? ` · ${a.specialistName}` : ""}
              </p>
            </div>
            <StatusBadge tone={statusMeta(a.status).tone}>{statusMeta(a.status).label}</StatusBadge>
          </div>
          {children(a)}
        </article>
      ))}
    </section>
  );
}

function humanMinutes(m: number) {
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

function minutesSince(iso: string | null, now: number) {
  return iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000)) : 0;
}

export function WaitingRoom({ appointments, tz, canUpdate }: { appointments: WaitingItem[]; tz: string; canUpdate: boolean }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Lightweight live view: re-render timers every 30s and refetch server data every 20s.
  // (Supabase Realtime can replace the polling later without changing this component's API.)
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const refresh = setInterval(() => router.refresh(), 20_000);
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [router]);

  const move = (id: string, status: AppointmentStatus) => {
    setPendingId(id);
    startTransition(async () => {
      const res = await updateAppointmentStatusAction({ id, status });
      if (!res.ok) toast.error(res.error);
      setPendingId(null);
      router.refresh();
    });
  };

  const arriving = appointments.filter((a) => ["scheduled", "confirmed"].includes(a.status));
  const waiting = appointments.filter((a) => ["checked_in", "waiting"].includes(a.status));
  const inside = appointments.filter((a) => a.status === "in_consultation");

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <WaitingColumn tz={tz} title="Por llegar" icon={Clock} items={arriving} empty="No hay más pacientes por llegar hoy 🎉">
        {(a) => {
          const late = now > new Date(a.startsAt).getTime() + 10 * 60_000;
          return (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className={cn("text-xs", late ? "font-medium text-destructive" : "text-muted-foreground")}>
                {late ? `Retrasado ${humanMinutes(minutesSince(a.startsAt, now))}` : `En ${humanMinutes(Math.max(0, Math.round((new Date(a.startsAt).getTime() - now) / 60_000)))}`}
              </span>
              {canUpdate && (
                <Button size="sm" disabled={pendingId === a.id} onClick={() => move(a.id, "checked_in")}>
                  {pendingId === a.id ? <Loader2 className="animate-spin" /> : <Check />} Llegó
                </Button>
              )}
            </div>
          );
        }}
      </WaitingColumn>
      <WaitingColumn tz={tz} title="Sala de espera" icon={Sofa} items={waiting} empty="Nadie esperando ahora mismo">
        {(a) => {
          const mins = minutesSince(a.checkedInAt, now);
          return (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className={cn("inline-flex items-center gap-1 text-xs tabular", mins >= 20 ? "font-medium text-destructive" : mins >= 10 ? "text-[oklch(0.5_0.12_60)]" : "text-muted-foreground")}>
                <Clock className="size-3" /> Esperando {mins} min
              </span>
              {canUpdate && (
                <Button size="sm" disabled={pendingId === a.id} onClick={() => move(a.id, "in_consultation")}>
                  {pendingId === a.id ? <Loader2 className="animate-spin" /> : <DoorOpen />} Pasar a consulta
                </Button>
              )}
            </div>
          );
        }}
      </WaitingColumn>
      <WaitingColumn tz={tz} title="En consulta" icon={DoorOpen} items={inside} empty="Ningún consultorio ocupado">
        {(a) => (
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground tabular">Hace {minutesSince(a.startedAt, now)} min</span>
            {canUpdate && (
              <Button size="sm" variant="outline" disabled={pendingId === a.id} onClick={() => move(a.id, "completed")}>
                {pendingId === a.id ? <Loader2 className="animate-spin" /> : <ArrowRight />} Finalizar
              </Button>
            )}
          </div>
        )}
      </WaitingColumn>
    </div>
  );
}
