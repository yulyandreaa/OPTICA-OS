"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
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
import { cn } from "@/lib/utils";
import { createPatientAction, updatePatientAction } from "../actions";
import {
  CONTACT_PREFERENCES, DOCUMENT_TYPES, HEALTH_REGIMES, PATIENT_SOURCES, patientSchema,
  type PatientFormInput, type PatientInput,
} from "../schemas";

const DEPARTMENT_OPTIONS = DEPARTMENTS.map((d) => ({ value: d.name, label: d.name }));

const EMPTY: PatientFormInput = {
  documentType: "CC", documentNumber: "", firstName: "", middleName: "", lastName: "", secondLastName: "", birthDate: "",
  sex: "", email: "", phone: "", whatsapp: "", address: "", city: "", department: "", occupation: "", eps: "", healthRegime: "",
  emergencyContactName: "", emergencyContactPhone: "", contactPreference: "whatsapp", source: "", homeBranchId: "", notes: "",
  acceptDataPolicy: true, acceptMarketing: false,
};

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
  const [acceptDataPolicy, acceptMarketing, department, city] = useWatch({
    control: form.control, name: ["acceptDataPolicy", "acceptMarketing", "department", "city"],
  });
  const err = (k: keyof PatientFormInput) => errors[k]?.message as string | undefined;
  const cityOptions = useMemo(() => municipalitiesOf(department).map((m) => ({ value: m.name, label: m.name })), [department]);

  const onSubmit = form.handleSubmit((_values, event) => {
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
    <form onSubmit={onSubmit} noValidate className="rounded-xl border bg-surface p-6 shadow-soft sm:p-8">
      <Section title="Identificación" description="El documento debe ser único en tu óptica.">
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <FormField id="documentType" label="Tipo de documento">
            <NativeSelect id="documentType" {...reg("documentType")}>
              {Object.entries(DOCUMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="documentNumber" label="Número" error={err("documentNumber")}>
            <Input id="documentNumber" inputMode="numeric" autoFocus={!patientId} className="tabular" aria-invalid={!!errors.documentNumber} {...reg("documentNumber")} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="firstName" label="Primer nombre" error={err("firstName")}><Input id="firstName" aria-invalid={!!errors.firstName} {...reg("firstName")} /></FormField>
          <FormField id="middleName" label="Segundo nombre" optional><Input id="middleName" {...reg("middleName")} /></FormField>
          <FormField id="lastName" label="Primer apellido" error={err("lastName")}><Input id="lastName" aria-invalid={!!errors.lastName} {...reg("lastName")} /></FormField>
          <FormField id="secondLastName" label="Segundo apellido" optional><Input id="secondLastName" {...reg("secondLastName")} /></FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="birthDate" label="Fecha de nacimiento" error={err("birthDate")}>
            <Controller control={form.control} name="birthDate" render={({ field }) => (
              <DatePicker id="birthDate" value={field.value ?? ""} onChange={field.onChange} onBlur={field.onBlur} invalid={!!errors.birthDate} />
            )} />
          </FormField>
          <FormField id="sex" label="Sexo biológico" hint="Requerido para RIPS y uso clínico." optional>
            <NativeSelect id="sex" {...reg("sex")}>
              <option value="">Sin especificar</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="I">Indeterminado</option>
            </NativeSelect>
          </FormField>
        </div>
      </Section>

      <Section title="Contacto" description="Lo usaremos para confirmaciones y avisos de entrega.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="phone" label="Celular" error={err("phone")}><Input id="phone" type="tel" placeholder="300 123 4567" {...reg("phone")} /></FormField>
          <FormField id="email" label="Correo" error={err("email")} optional><Input id="email" type="email" {...reg("email")} /></FormField>
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
        <FormField id="address" label="Dirección" optional><Input id="address" {...reg("address")} /></FormField>
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
          <FormField id="occupation" label="Ocupación" optional><Input id="occupation" {...reg("occupation")} /></FormField>
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
      <Section title="Salud" description="Información de aseguramiento.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="eps" label="EPS" optional><Input id="eps" {...reg("eps")} /></FormField>
          <FormField id="healthRegime" label="Régimen" optional>
            <NativeSelect id="healthRegime" {...reg("healthRegime")}>
              <option value="">—</option>
              {Object.entries(HEALTH_REGIMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </FormField>
        </div>
        <FormField id="notes" label="Notas internas" optional><Textarea id="notes" rows={3} {...reg("notes")} /></FormField>
      </Section>

      {!patientId && (
        <div className="grid gap-3 rounded-lg bg-muted/60 p-4">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={acceptDataPolicy} onCheckedChange={(v) => form.setValue("acceptDataPolicy", v === true)} className="mt-0.5" />
            <span>El paciente autoriza el <b>tratamiento de sus datos personales</b> según la política vigente (Ley 1581 de 2012).</span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={acceptMarketing} onCheckedChange={(v) => form.setValue("acceptMarketing", v === true)} className="mt-0.5" />
            <span>Acepta recibir recordatorios de control y comunicaciones comerciales.</span>
          </label>
        </div>
      )}

      <div className={cn("flex flex-col-reverse gap-2 pt-6 sm:flex-row sm:justify-end")}>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        {!patientId && <Button type="submit" variant="outline" data-next="agenda" disabled={pending}>Guardar y agendar cita</Button>}
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{patientId ? "Guardar cambios" : "Crear paciente"}</Button>
      </div>
    </form>
  );
}
