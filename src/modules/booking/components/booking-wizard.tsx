"use client";
import { ArrowLeft, CalendarCheck2, Check, Clock, Loader2, MapPin, Stethoscope } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { addDaysKey, formatDate, formatMoney, formatTime, localDateKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createBookingAction, getSlotsAction } from "../actions";
import type { BookingCatalog } from "../schemas";

type Step = "service" | "branch" | "time" | "details" | "done";

export function BookingWizard({ catalog }: { catalog: BookingCatalog }) {
  const tz = catalog.tenant.timezone;
  const [step, setStep] = useState<Step>("service");
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(catalog.branches.length === 1 ? catalog.branches[0]!.id : null);
  const [specialistId, setSpecialistId] = useState<string | null>(null);
  const today = localDateKey(new Date(), tz);
  const [date, setDate] = useState(today);
  const [slotState, setSlotState] = useState<{ key: string; slots: { startsAt: string; specialistId: string }[] } | null>(null);
  const [slot, setSlot] = useState<{ startsAt: string; specialistId: string } | null>(null);
  const [loadingSlots, startSlots] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [accept, setAccept] = useState(false);

  const service = catalog.services.find((s) => s.id === serviceId);
  const branch = catalog.branches.find((b) => b.id === branchId);
  const specialists = catalog.specialists.filter((s) => s.branch_id === branchId);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysKey(today, i)), [today]);

  // Slots are keyed by the request that produced them, so a new selection shows skeletons until it resolves.
  const slotKey = `${serviceId}|${branchId}|${date}|${specialistId ?? ""}`;
  const slots = slotState?.key === slotKey ? slotState.slots : null;
  useEffect(() => {
    if (step !== "time" || !serviceId || !branchId) return;
    startSlots(async () => {
      const result = await getSlotsAction({ slug: catalog.tenant.slug, branchId, serviceId, date, specialistId });
      setSlotState({ key: `${serviceId}|${branchId}|${date}|${specialistId ?? ""}`, slots: result });
    });
  }, [step, serviceId, branchId, date, specialistId, catalog.tenant.slug]);

  const specialistName = (id: string) => catalog.specialists.find((s) => s.id === id)?.name;

  const back = () => setStep(step === "details" ? "time" : step === "time" ? (catalog.branches.length > 1 ? "branch" : "service") : "service");

  if (step === "done" && slot) {
    return (
      <div className="grid gap-4 rounded-2xl border bg-surface p-8 text-center shadow-soft">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success"><CalendarCheck2 className="size-7" /></div>
        <h2 className="text-xl font-semibold">¡Tu cita quedó agendada!</h2>
        <p className="text-muted-foreground first-letter:uppercase">
          {formatDate(slot.startsAt, tz, { weekday: "long", day: "numeric", month: "long" })} a las {formatTime(slot.startsAt, tz)}
          <br />{service?.name} · {branch?.name}
        </p>
        <p className="text-sm text-muted-foreground">Te enviaremos un recordatorio antes de tu cita. Si necesitas cambiarla, contáctanos.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {step !== "service" && (
        <button type="button" onClick={back} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Atrás</button>
      )}

      {step === "service" && (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">¿Qué servicio necesitas?</h2>
          {catalog.services.map((s) => (
            <button key={s.id} type="button" onClick={() => { setServiceId(s.id); setStep(catalog.branches.length > 1 ? "branch" : "time"); }}
              className="flex items-center justify-between gap-3 rounded-xl border bg-surface p-4 text-left shadow-soft transition-colors hover:border-[var(--brand)]">
              <span className="flex items-center gap-3">
                <Stethoscope className="size-5 text-[var(--brand)]" strokeWidth={1.75} />
                <span><span className="block font-medium">{s.name}</span><span className="flex items-center gap-1 text-sm text-muted-foreground"><Clock className="size-3.5" /> {s.duration} min</span></span>
              </span>
              {s.price ? <span className="text-sm font-medium tabular">{formatMoney(s.price)}</span> : null}
            </button>
          ))}
        </section>
      )}

      {step === "branch" && (
        <section className="grid gap-3">
          <h2 className="text-lg font-semibold">Elige la sede</h2>
          {catalog.branches.map((b) => (
            <button key={b.id} type="button" onClick={() => { setBranchId(b.id); setSpecialistId(null); setStep("time"); }}
              className="flex items-center gap-3 rounded-xl border bg-surface p-4 text-left shadow-soft transition-colors hover:border-[var(--brand)]">
              <MapPin className="size-5 text-[var(--brand)]" strokeWidth={1.75} />
              <span><span className="block font-medium">{b.name}</span><span className="text-sm text-muted-foreground">{[b.address, b.city].filter(Boolean).join(", ")}</span></span>
            </button>
          ))}
        </section>
      )}

      {step === "time" && (
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">Elige fecha y hora</h2>
          {specialists.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!specialistId} onClick={() => setSpecialistId(null)}>Cualquier especialista</Chip>
              {specialists.map((s) => <Chip key={s.id} active={specialistId === s.id} onClick={() => setSpecialistId(s.id)}>{s.name}</Chip>)}
            </div>
          )}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {days.map((d) => {
              const label = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "short" }).format(new Date(`${d}T12:00:00Z`));
              return (
                <button key={d} type="button" onClick={() => setDate(d)}
                  className={cn("flex w-14 shrink-0 flex-col items-center rounded-xl border py-2 transition-colors", d === date ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "bg-surface hover:border-foreground/20")}>
                  <span className="text-[11px] capitalize opacity-80">{label.replace(".", "")}</span>
                  <span className="text-lg font-semibold tabular">{Number(d.slice(8))}</span>
                </button>
              );
            })}
          </div>
          {loadingSlots || slots === null ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
          ) : slots.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No hay horarios disponibles este día. Prueba otra fecha.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => (
                <button key={s.startsAt} type="button" onClick={() => { setSlot(s); setStep("details"); }}
                  className="h-10 rounded-lg border bg-surface text-sm font-medium tabular shadow-soft transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]">
                  {formatTime(s.startsAt, tz)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {step === "details" && slot && serviceId && branchId && (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const get = (k: string) => String(fd.get(k) ?? "");
            startSubmit(async () => {
              const res = await createBookingAction({
                slug: catalog.tenant.slug, branchId, serviceId, specialistId: slot.specialistId, startsAt: slot.startsAt,
                documentType: get("documentType") as "CC", documentNumber: get("documentNumber"), firstName: get("firstName"),
                lastName: get("lastName"), phone: get("phone"), email: get("email"), acceptPolicy: accept as true, website: get("website"),
              });
              if (!res.ok) {
                setFormError(res.error);
                setErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
                return;
              }
              setStep("done");
            });
          }}
        >
          <div className="rounded-xl bg-muted/60 p-4 text-sm">
            <p className="font-medium first-letter:uppercase">{formatDate(slot.startsAt, tz, { weekday: "long", day: "numeric", month: "long" })} · {formatTime(slot.startsAt, tz)}</p>
            <p className="text-muted-foreground">{service?.name} · {branch?.name}{specialistName(slot.specialistId) ? ` · ${specialistName(slot.specialistId)}` : ""}</p>
          </div>
          {formError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">{formError}</p>}
          <div className="grid grid-cols-[96px_1fr] gap-3">
            <FormField id="documentType" label="Documento">
              <NativeSelect id="documentType" name="documentType" defaultValue="CC" className="h-10">
                {["CC", "TI", "CE", "PA", "PPT", "PEP"].map((t) => <option key={t}>{t}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="documentNumber" label="Número" error={errors.documentNumber}><Input id="documentNumber" name="documentNumber" inputMode="numeric" className="h-10" required /></FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="firstName" label="Nombre" error={errors.firstName}><Input id="firstName" name="firstName" autoComplete="given-name" className="h-10" required /></FormField>
            <FormField id="lastName" label="Apellido" error={errors.lastName}><Input id="lastName" name="lastName" autoComplete="family-name" className="h-10" required /></FormField>
          </div>
          <FormField id="phone" label="Celular (WhatsApp)" error={errors.phone}><Input id="phone" name="phone" type="tel" autoComplete="tel" className="h-10" required /></FormField>
          <FormField id="email" label="Correo" error={errors.email} optional><Input id="email" name="email" type="email" autoComplete="email" className="h-10" /></FormField>
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={accept} onCheckedChange={(v) => setAccept(v === true)} className="mt-0.5" />
            <span>Autorizo el tratamiento de mis datos personales para gestionar mi cita, conforme a la política de {catalog.tenant.name}.</span>
          </label>
          {errors.acceptPolicy && <p className="text-xs text-destructive">{errors.acceptPolicy}</p>}
          <Button type="submit" size="lg" className="h-11 bg-[var(--brand)] hover:bg-[var(--brand)]/90" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Check />} Confirmar cita
          </Button>
        </form>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-full border px-3 py-1 text-sm", active ? "border-[var(--brand)] bg-[var(--brand)]/10 font-medium text-[var(--brand)]" : "bg-surface text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}
