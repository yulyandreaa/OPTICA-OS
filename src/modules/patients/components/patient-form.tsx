"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, HeartPulse, Loader2, ShoppingBag, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { SearchSelect } from "@/components/shared/search-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEPARTMENTS, municipalitiesOf } from "@/lib/divipola";
import { formatAge } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createPatientAction, findPersonMatchesAction, updatePatientAction, type PersonMatch } from "../actions";
import {
  CONTACT_PREFERENCES, DOCUMENT_TYPES, HEALTH_REGIMES, PATIENT_SOURCES, patientSchema, RELATION_DESCRIPTIONS, RELATIONS,
  type PatientFormInput, type PatientInput, type Relation,
} from "../schemas";

const DEPARTMENT_OPTIONS = DEPARTMENTS.map((d) => ({ value: d.name, label: d.name }));

const EMPTY: PatientFormInput = {
  relation: "customer", documentType: "CC", documentNumber: "", firstName: "", middleName: "", lastName: "", secondLastName: "", birthDate: "",
  sex: "", email: "", phone: "", whatsapp: "", address: "", city: "", department: "", occupation: "", eps: "", healthRegime: "",
  emergencyContactName: "", emergencyContactPhone: "", contactPreference: "whatsapp", source: "", homeBranchId: "", notes: "",
  acceptDataPolicy: true, acceptMarketing: false,
};

/**
 * This form registers other people: the browser must never autofill it with the logged-in user's own data.
 * Chrome honours autocomplete="off" per field; the data-* flags keep password managers out too.
 */
const NO_AUTOFILL = { autoComplete: "off", "data-1p-ignore": true, "data-lpignore": "true" } as const;

const RELATION_ICONS: Record<Relation, typeof ShoppingBag> = { customer: ShoppingBag, patient: HeartPulse, both: UsersRound };
const MATCH_REASONS: Record<string, string> = {
  document: "mismo documento", document_number: "mismo número con otro tipo", name: "mismo nombre", phone: "mismo teléfono", email: "mismo correo",
};

/** Debounced lookup of possible duplicates (server-side, same company only). */
function usePersonMatches(values: { documentType: string; documentNumber: string; firstName: string; lastName: string; birthDate?: string | null; phone?: string | null; email?: string | null }, excludeId?: string) {
  const [matches, setMatches] = useState<PersonMatch[]>([]);
  const key = JSON.stringify(values);
  useEffect(() => {
    const t = setTimeout(async () => {
      const v = JSON.parse(key) as typeof values;
      setMatches(await findPersonMatchesAction({ ...v, birthDate: v.birthDate ?? undefined, phone: v.phone ?? undefined, email: v.email ?? undefined, excludeId }));
    }, 450);
    return () => clearTimeout(t);
  }, [key, excludeId]);
  return matches;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 border-b py-8 first:pt-0 last:border-0 md:grid-cols-[220px_1fr]">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

export function PatientForm({ patientId, defaults, branches }: {
  patientId?: string; defaults?: Partial<PatientFormInput>; branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<PatientFormInput, unknown, PatientInput>({
    resolver: zodResolver(patientSchema),
    defaultValues: { ...EMPTY, ...defaults },
  });
  const { errors } = form.formState;
  const reg = form.register;
  const [acceptDataPolicy, acceptMarketing, department, city, relation] = useWatch({
    control: form.control, name: ["acceptDataPolicy", "acceptMarketing", "department", "city", "relation"],
  });
  const [documentType, documentNumber, firstName, lastName, birthDate, phoneValue, emailValue] = useWatch({
    control: form.control, name: ["documentType", "documentNumber", "firstName", "lastName", "birthDate", "phone", "email"],
  });
  const matches = usePersonMatches({ documentType, documentNumber, firstName, lastName, birthDate, phone: phoneValue, email: emailValue }, patientId);
  const sameDocument = matches.find((m) => m.reasons.includes("document"));
  const isPatient = relation !== "customer";
  const age = /^\d{4}-\d{2}-\d{2}$/.test(birthDate ?? "") ? formatAge(birthDate) : null;
  const err = (k: keyof PatientFormInput) => errors[k]?.message as string | undefined;
  const cityOptions = useMemo(() => municipalitiesOf(department).map((m) => ({ value: m.name, label: m.name })), [department]);

  const onSubmit = form.handleSubmit((_values, event) => {
    if (pending) return;
    const raw = form.getValues();
    startTransition(async () => {
      const res = patientId ? await updatePatientAction(patientId, raw) : await createPatientAction(raw);
      if (!res.ok) {
        toast.error(res.error);
        for (const [field, messages] of Object.entries(res.fieldErrors ?? {})) {
          form.setError(field as keyof PatientFormInput, { message: messages?.[0] });
        }
        return;
      }
      toast.success(res.message);
      const next = (event?.nativeEvent as SubmitEvent | undefined)?.submitter?.getAttribute("data-next");
      router.push(next === "agenda" ? `/agenda?nueva=1&paciente=${res.data.id}` : `/pacientes/${res.data.id}`);
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate autoComplete="off" className="rounded-2xl border bg-surface p-6 shadow-soft sm:p-8">
      <Section title="Tipo de registro" description="Una persona tiene un solo registro, aunque compre y también reciba atención.">
        <div role="radiogroup" aria-label="Tipo de registro" className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(RELATIONS) as Relation[]).map((r) => {
            const Icon = RELATION_ICONS[r];
            const selected = relation === r;
            return (
              <button key={r} type="button" role="radio" aria-checked={selected} onClick={() => form.setValue("relation", r, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
                className={cn("flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                  selected ? "border-brand bg-brand-soft/60 ring-1 ring-brand" : "hover:border-foreground/20")}>
                <span className="flex items-center gap-2 text-sm font-medium"><Icon className={cn("size-4", selected ? "text-brand" : "text-muted-foreground")} />{RELATIONS[r]}</span>
                <span className="text-xs text-muted-foreground">{RELATION_DESCRIPTIONS[r]}</span>
              </button>
            );
          })}
        </div>
        {err("relation") && <p role="alert" className="text-sm text-destructive">{err("relation")}</p>}
      </Section>

      <Section title="Identificación" description="El documento debe ser único en tu óptica.">
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <FormField id="documentType" label="Tipo de documento">
            <NativeSelect id="documentType" {...reg("documentType")}>
              {Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="documentNumber" label="Número" error={err("documentNumber")}>
            <Input id="documentNumber" {...NO_AUTOFILL} inputMode="numeric" autoFocus={!patientId} className="tabular" aria-invalid={!!errors.documentNumber} {...reg("documentNumber")} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="firstName" label="Primer nombre" error={err("firstName")}><Input id="firstName" {...NO_AUTOFILL} aria-invalid={!!errors.firstName} {...reg("firstName")} /></FormField>
          <FormField id="middleName" label="Segundo nombre" optional><Input id="middleName" {...NO_AUTOFILL} {...reg("middleName")} /></FormField>
          <FormField id="lastName" label="Primer apellido" error={err("lastName")}><Input id="lastName" {...NO_AUTOFILL} aria-invalid={!!errors.lastName} {...reg("lastName")} /></FormField>
          <FormField id="secondLastName" label="Segundo apellido" optional><Input id="secondLastName" {...NO_AUTOFILL} {...reg("secondLastName")} /></FormField>
        </div>
        {matches.length > 0 && (
          <div role="status" className={cn("grid gap-2 rounded-xl border p-3 text-sm", sameDocument ? "border-destructive/40 bg-danger-soft" : "border-warning/40 bg-warning-soft")}>
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className={cn("size-4", sameDocument ? "text-destructive" : "text-[oklch(0.5_0.12_60)]")} />
              {sameDocument ? "Esta persona ya está registrada." : "Posibles coincidencias: revisa antes de crear un registro nuevo."}
            </p>
            <ul className="grid gap-1.5">
              {matches.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium">{m.full_name}</span>
                    <span className="text-muted-foreground tabular"> · {m.document_type} {m.document_number}{!m.is_active ? " · inactivo" : ""}</span>
                    <span className="block text-xs text-muted-foreground">Coincide: {m.reasons.map((r) => MATCH_REASONS[r] ?? r).join(", ")}</span>
                  </span>
                  <Link href={`/pacientes/${m.id}`} target="_blank" className="text-xs font-medium text-brand hover:underline">Ver registro</Link>
                </li>
              ))}
            </ul>
            {!sameDocument && <p className="text-xs text-muted-foreground">Compartir teléfono o correo es normal en familias: puedes continuar si es otra persona.</p>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="birthDate" label="Fecha de nacimiento" error={err("birthDate")} optional={!isPatient}
            hint={age ? `Edad: ${age}` : isPatient ? "Escríbela como dd/mm/aaaa o elígela en el calendario." : "Opcional para clientes."}>
            <Controller control={form.control} name="birthDate" render={({ field }) => (
              <DatePicker typeable id="birthDate" value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} invalid={!!errors.birthDate} />
            )} />
          </FormField>
          {isPatient && (
            <FormField id="sex" label="Sexo biológico" hint="Requerido para RIPS y uso clínico." optional>
              <NativeSelect id="sex" {...reg("sex")}>
                <option value="">Sin especificar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="I">Indeterminado</option>
              </NativeSelect>
            </FormField>
          )}
        </div>
      </Section>

      <Section title="Contacto" description="Opcional. Lo usaremos para confirmaciones y avisos de entrega.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="phone" label="Celular" error={err("phone")} optional><Input id="phone" {...NO_AUTOFILL} type="tel" placeholder="300 123 4567" {...reg("phone")} /></FormField>
          <FormField id="email" label="Correo" error={err("email")} optional><Input id="email" {...NO_AUTOFILL} type="email" {...reg("email")} /></FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="contactPreference" label="Prefiere que lo contacten por">
            <NativeSelect id="contactPreference" {...reg("contactPreference")}>
              {Object.entries(CONTACT_PREFERENCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="source" label="¿Cómo nos conoció?" optional>
            <NativeSelect id="source" {...reg("source")}>
              <option value="">—</option>
              {Object.entries(PATIENT_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </FormField>
        </div>
      </Section>

      <Section title="Ubicación y ocupación">
        <FormField id="address" label="Dirección" optional><Input id="address" {...NO_AUTOFILL} {...reg("address")} /></FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="department" label="Departamento" optional>
            <SearchSelect id="department" value={department} options={DEPARTMENT_OPTIONS} emptyText="No encontramos ese departamento."
              onBlur={() => form.trigger("department")}
              onChange={(v) => {
                const cities = municipalitiesOf(v);
                form.setValue("department", v, { shouldDirty: true });
                form.setValue("city", cities.length === 1 ? cities[0]!.name : "", { shouldDirty: true });
              }} />
          </FormField>
          <FormField id="city" label="Ciudad" optional>
            <SearchSelect id="city" value={city} options={cityOptions}
              emptyText={department ? "No encontramos esa ciudad." : "Elige primero el departamento."}
              onBlur={() => form.trigger("city")}
              onChange={(v) => form.setValue("city", v, { shouldDirty: true })} />
          </FormField>
          <FormField id="occupation" label="Ocupación" optional><Input id="occupation" {...NO_AUTOFILL} {...reg("occupation")} /></FormField>
        </div>
        {branches.length > 1 && (
          <FormField id="homeBranchId" label="Sede habitual" optional>
            <NativeSelect id="homeBranchId" {...reg("homeBranchId")}>
              <option value="">Sede actual</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </FormField>
        )}
      </Section>
      {isPatient && (
        <Section title="Aseguramiento" description="Datos administrativos para RIPS. Diagnósticos y fórmulas se registran en la consulta, no aquí.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="eps" label="EPS" optional><Input id="eps" {...NO_AUTOFILL} {...reg("eps")} /></FormField>
            <FormField id="healthRegime" label="Régimen" optional>
              <NativeSelect id="healthRegime" {...reg("healthRegime")}>
                <option value="">—</option>
                {Object.entries(HEALTH_REGIMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </FormField>
          </div>
        </Section>
      )}

      <Section title="Notas internas" description="Visibles para tu equipo. No escribas datos clínicos.">
        <FormField id="notes" label="Notas" optional><Textarea id="notes" {...NO_AUTOFILL} rows={3} {...reg("notes")} /></FormField>
      </Section>

      {!patientId && (
        <div className="grid gap-3 rounded-lg bg-muted/60 p-4">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={acceptDataPolicy} onCheckedChange={(v) => form.setValue("acceptDataPolicy", v === true)} className="mt-0.5" />
            <span>La persona autoriza el <b>tratamiento de sus datos personales</b> según la política vigente (Ley 1581 de 2012).</span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={acceptMarketing} onCheckedChange={(v) => form.setValue("acceptMarketing", v === true)} className="mt-0.5" />
            <span>Acepta recibir recordatorios de control y comunicaciones comerciales.</span>
          </label>
        </div>
      )}

      <div className={cn("flex flex-col-reverse gap-2 pt-6 sm:flex-row sm:justify-end")}>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        {!patientId && isPatient && <Button type="submit" variant="outline" data-next="agenda" disabled={pending || !!sameDocument}>Guardar y agendar cita</Button>}
        <Button type="submit" disabled={pending || !!sameDocument}>{pending && <Loader2 className="animate-spin" />}{patientId ? "Guardar cambios" : "Crear registro"}</Button>
      </div>
    </form>
  );
}
