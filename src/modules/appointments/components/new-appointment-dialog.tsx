"use client";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { searchPatientsAction } from "@/modules/patients/actions";
import { createAppointmentAction } from "../actions";
import type { AgendaOption, AgendaTypeOption } from "./types";

export interface NewAppointmentPrefill {
  date?: string;
  time?: string;
  specialistId?: string;
  patient?: { id: string; name: string };
}

type PatientHit = Awaited<ReturnType<typeof searchPatientsAction>>[number];

export function NewAppointmentDialog({ prefill, onClose, types, specialists, branches, defaultBranchId }: {
  prefill: NewAppointmentPrefill | null; onClose: () => void;
  types: AgendaTypeOption[]; specialists: AgendaOption[]; branches: AgendaOption[]; defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Remounted (via `key`) whenever the prefill changes, so initial state comes straight from props.
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(prefill?.patient ?? null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (query.trim().length < 2) return;
    const t = setTimeout(() => { void searchPatientsAction(query).then(setHits); }, 200);
    return () => clearTimeout(t);
  }, [query]);
  const visibleHits = query.trim().length < 2 ? [] : hits;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!patient) { setErrors({ patientId: "Selecciona un paciente" }); return; }
    startTransition(async () => {
      const res = await createAppointmentAction({
        patientId: patient.id,
        typeId: String(fd.get("typeId") ?? ""),
        specialistId: String(fd.get("specialistId") ?? ""),
        branchId: String(fd.get("branchId") ?? defaultBranchId ?? ""),
        date: String(fd.get("date") ?? ""),
        time: String(fd.get("time") ?? ""),
        notes: String(fd.get("notes") ?? ""),
      });
      if (!res.ok) {
        setErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
        toast.error(res.error);
        return;
      }
      toast.success(`Cita agendada para ${patient.name}`);
      onClose();
      router.replace("/agenda?" + new URLSearchParams({ date: String(fd.get("date")) }).toString());
      router.refresh();
    });
  }

  return (
    <Dialog open={!!prefill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva cita</DialogTitle>
          <DialogDescription>Agenda en segundos. La confirmación se enviará automáticamente cuando conectes WhatsApp.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField id="patient" label="Paciente" error={errors.patientId}>
            {patient ? (
              <div className="flex h-9 items-center justify-between rounded-lg border bg-muted/50 px-3 text-sm">
                <span className="truncate font-medium">{patient.name}</span>
                <button type="button" onClick={() => setPatient(null)} aria-label="Cambiar paciente" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="patient" autoFocus autoComplete="off" placeholder="Nombre, documento o celular" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
                {query.length >= 2 && (
                  <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-lg border bg-popover p-1 shadow-lift">
                    {visibleHits.map((h) => (
                      <button key={h.id} type="button" onClick={() => { setPatient({ id: h.id, name: h.full_name }); setQuery(""); }}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
                        <span className="truncate">{h.full_name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular">{h.document_type} {h.document_number}</span>
                      </button>
                    ))}
                    <Link href="/pacientes/nuevo" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-brand hover:bg-muted">
                      <UserPlus className="size-4" /> Registrar paciente nuevo
                    </Link>
                  </div>
                )}
              </div>
            )}
          </FormField>

          <FormField id="typeId" label="Tipo de cita" error={errors.typeId}>
            <NativeSelect id="typeId" name="typeId" defaultValue={types[0]?.id}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.duration} min</option>)}
            </NativeSelect>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField id="date" label="Fecha" error={errors.date}><Input id="date" name="date" type="date" required defaultValue={prefill?.date} /></FormField>
            <FormField id="time" label="Hora" error={errors.time}><Input id="time" name="time" type="time" step={900} required defaultValue={prefill?.time ?? "09:00"} /></FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="specialistId" label="Especialista" optional>
              <NativeSelect id="specialistId" name="specialistId" defaultValue={prefill?.specialistId ?? ""}>
                <option value="">Sin asignar</option>
                {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </FormField>
            {branches.length > 1 && (
              <FormField id="branchId" label="Sede">
                <NativeSelect id="branchId" name="branchId" defaultValue={defaultBranchId ?? branches[0]?.id}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </NativeSelect>
              </FormField>
            )}
          </div>

          <FormField id="notes" label="Notas" optional><Textarea id="notes" name="notes" rows={2} placeholder="Ej.: trae sus gafas actuales" /></FormField>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Agendar cita</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
