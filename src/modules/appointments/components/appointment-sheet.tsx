"use client";
import { CalendarClock, Loader2, MapPin, Phone, Stethoscope, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatTime } from "@/lib/format";
import { updateAppointmentStatusAction } from "../actions";
import { NEXT_STATUSES, statusMeta, type AppointmentStatus } from "../utils/status";
import type { AgendaAppointment } from "./types";

const ACTION_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Reactivar cita",
  confirmed: "Confirmar",
  checked_in: "Marcar llegada",
  waiting: "Enviar a sala de espera",
  in_consultation: "Iniciar consulta",
  completed: "Finalizar consulta",
  cancelled: "Cancelar cita",
  no_show: "No asistió",
};
const SECONDARY: AppointmentStatus[] = ["cancelled", "no_show"];

export function AppointmentSheet({ appointment, tz, onClose }: { appointment: AgendaAppointment | null; tz: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const a = appointment;
  const meta = a ? statusMeta(a.status) : null;
  const next = a ? NEXT_STATUSES[a.status as AppointmentStatus] ?? [] : [];

  const change = (status: AppointmentStatus) =>
    startTransition(async () => {
      if (!a) return;
      const res = await updateAppointmentStatusAction({ id: a.id, status, reason: status === "cancelled" ? reason : undefined });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`${a.patient?.name ?? "Cita"}: ${statusMeta(status).label.toLowerCase()}`);
      setCancelling(false);
      setReason("");
      router.refresh();
      if (status === "cancelled") onClose();
    });

  return (
    <Sheet open={!!a} onOpenChange={(o) => { if (!o) { onClose(); setCancelling(false); } }}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {a && meta && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: a.type?.color }} />
                <span className="text-xs text-muted-foreground">{a.type?.name}</span>
              </div>
              <SheetTitle className="text-xl">{a.patient?.name}</SheetTitle>
              <SheetDescription className="sr-only">Detalle de la cita</SheetDescription>
              <div><StatusBadge tone={meta.tone}>{meta.label}</StatusBadge></div>
            </SheetHeader>

            <div className="grid gap-4 p-4 text-sm">
              <Row icon={CalendarClock}>
                {formatDate(a.startsAt, tz, { weekday: "long", day: "numeric", month: "long" })} · {formatTime(a.startsAt, tz)} – {formatTime(a.endsAt, tz)}
              </Row>
              <Row icon={Stethoscope}>{a.specialistName ?? "Sin especialista asignado"}</Row>
              {a.branchName && <Row icon={MapPin}>{a.branchName}</Row>}
              {a.patient?.phone && <Row icon={Phone}><a className="hover:underline" href={`tel:${a.patient.phone}`}>{a.patient.phone}</a></Row>}
              {a.patient && <Row icon={UserRound}><span className="tabular">{a.patient.document}</span></Row>}
              {a.notes && <p className="rounded-lg bg-muted p-3 text-muted-foreground">{a.notes}</p>}
            </div>

            <div className="mt-auto grid gap-2 border-t p-4">
              {cancelling ? (
                <div className="grid gap-2">
                  <Textarea placeholder="Motivo de la cancelación (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                  <div className="flex gap-2">
                    <Button variant="ghost" className="flex-1" onClick={() => setCancelling(false)}>Volver</Button>
                    <Button variant="destructive" className="flex-1" disabled={pending} onClick={() => change("cancelled")}>
                      {pending && <Loader2 className="animate-spin" />} Confirmar cancelación
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {next.filter((s) => !SECONDARY.includes(s)).map((s, i) => (
                    <Button key={s} variant={i === 0 ? "default" : "outline"} size="lg" disabled={pending} onClick={() => change(s)}>
                      {pending && i === 0 && <Loader2 className="animate-spin" />} {ACTION_LABEL[s]}
                    </Button>
                  ))}
                  <div className="flex gap-2">
                    {a.patient && <Link href={`/pacientes/${a.patient.id}`} className={buttonVariants({ variant: "ghost", className: "flex-1" })}>Ver paciente</Link>}
                    {next.includes("no_show") && <Button variant="ghost" className="flex-1" disabled={pending} onClick={() => change("no_show")}>No asistió</Button>}
                    {next.includes("cancelled") && <Button variant="ghost" className="flex-1 text-destructive" onClick={() => setCancelling(true)}>Cancelar</Button>}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) {
  return <div className="flex items-start gap-3"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} /><div className="min-w-0 first-letter:uppercase">{children}</div></div>;
}
