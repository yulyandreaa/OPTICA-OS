"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Eye, Loader2, Stethoscope, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { nitCheckDigit, slugify } from "@/modules/tenants/utils/nit";
import { checkSlugAction, createTenantAction } from "../actions";
import { ONBOARDING_STEPS, onboardingSchema, type OnboardingInput } from "../schemas";

const SPECIALTIES = [
  { value: "optometry", title: "Optometría", description: "Valoración visual, refracción, fórmulas y venta de gafas.", icon: Eye },
  { value: "ophthalmology", title: "Oftalmología", description: "Consulta médica especializada y procedimientos.", icon: Stethoscope },
  { value: "both", title: "Ambas", description: "Optómetras y oftalmólogos en el mismo equipo.", icon: Users },
] as const;

export function OnboardingWizard({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugCheck, setSlugCheck] = useState<{ slug: string; free: boolean } | null>(null);

  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    mode: "onTouched",
    defaultValues: {
      tradeName: "", legalName: "", slug: "", taxIdType: "NIT", taxId: "", taxDv: "", taxRegime: "responsable_iva",
      branchName: "Sede principal", branchCity: "Bogotá", branchAddress: "", branchPhone: "", specialty: "optometry",
    },
  });
  const { errors } = form.formState;
  const [tradeName, slug, taxId, taxIdType, specialty] = useWatch({
    control: form.control, name: ["tradeName", "slug", "taxId", "taxIdType", "specialty"],
  });

  useEffect(() => {
    if (!slugTouched) form.setValue("slug", slugify(tradeName));
  }, [tradeName, slugTouched, form]);

  useEffect(() => {
    if (taxIdType === "NIT") form.setValue("taxDv", nitCheckDigit(taxId) ?? "");
  }, [taxId, taxIdType, form]);

  useEffect(() => {
    if (slug.length < 3) return;
    const t = setTimeout(() => { void checkSlugAction(slug).then((free) => setSlugCheck({ slug, free })); }, 350);
    return () => clearTimeout(t);
  }, [slug]);
  // Only trust a result for the slug currently typed.
  const slugFree = slugCheck?.slug === slug ? slugCheck.free : null;

  const current = ONBOARDING_STEPS[step]!;
  const isLast = step === ONBOARDING_STEPS.length - 1;

  async function next() {
    const valid = await form.trigger([...current.fields]);
    if (!valid || (current.key === "company" && slugFree === false)) return;
    if (!isLast) return setStep((s) => s + 1);
    startTransition(async () => {
      setFormError(null);
      const res = await createTenantAction(form.getValues());
      if (!res.ok) return setFormError(res.error);
      router.replace("/inicio?welcome=1");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-8">
      <ol className="flex items-center gap-2" aria-label="Progreso">
        {ONBOARDING_STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 flex-col gap-2">
            <span className={cn("h-1 rounded-full transition-colors", i <= step ? "bg-brand" : "bg-border")} />
            <span className={cn("hidden text-xs sm:block", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>{s.title}</span>
          </li>
        ))}
      </ol>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Paso {step + 1} de {ONBOARDING_STEPS.length}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {step === 0 ? `Hola, ${defaultName.split(" ")[0]} 👋 Cuéntanos de tu óptica` : current.title}
        </h1>
      </div>

      {formError && <p role="alert" className="rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2 text-sm text-destructive">{formError}</p>}

      <form onSubmit={(e) => { e.preventDefault(); void next(); }} className="grid gap-4" noValidate>
        {current.key === "company" && (
          <>
            <FormField id="tradeName" label="Nombre comercial" error={errors.tradeName?.message}>
              <Input id="tradeName" placeholder="Óptica Nova Vision" autoFocus className="h-10" {...form.register("tradeName")} />
            </FormField>
            <FormField id="legalName" label="Razón social" error={errors.legalName?.message}>
              <Input id="legalName" placeholder="Óptica Nova Vision SAS" className="h-10" {...form.register("legalName")} />
            </FormField>
            <FormField
              id="slug" label="Enlace de reservas" error={errors.slug?.message ?? (slugFree === false ? "Ese enlace ya está en uso" : undefined)}
              hint={slugFree ? "¡Disponible! Tus pacientes agendarán aquí." : "Tus pacientes agendarán citas en este enlace."}
            >
              <div className="flex h-10 items-center rounded-lg border border-input bg-surface shadow-soft focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40">
                <span className="pl-3 text-sm text-muted-foreground">/book/</span>
                <input id="slug" className="h-full flex-1 bg-transparent pr-3 text-sm outline-none" {...form.register("slug", { onChange: () => setSlugTouched(true) })} />
                {slugFree && <Check className="mr-3 size-4 text-success" />}
              </div>
            </FormField>
          </>
        )}

        {current.key === "tax" && (
          <>
            <div className="grid grid-cols-[110px_1fr_64px] gap-3">
              <FormField id="taxIdType" label="Tipo">
                <NativeSelect id="taxIdType" className="h-10" {...form.register("taxIdType")}>
                  <option value="NIT">NIT</option><option value="CC">CC</option><option value="CE">CE</option><option value="PP">PP</option>
                </NativeSelect>
              </FormField>
              <FormField id="taxId" label="Número" error={errors.taxId?.message} optional>
                <Input id="taxId" inputMode="numeric" placeholder="900123456" className="h-10 tabular" {...form.register("taxId")} />
              </FormField>
              <FormField id="taxDv" label="DV" error={errors.taxDv?.message}>
                <Input id="taxDv" readOnly={taxIdType === "NIT"} className="h-10 text-center tabular" {...form.register("taxDv")} />
              </FormField>
            </div>
            <FormField id="taxRegime" label="Régimen tributario">
              <NativeSelect id="taxRegime" className="h-10" {...form.register("taxRegime")}>
                <option value="responsable_iva">Responsable de IVA</option>
                <option value="no_responsable_iva">No responsable de IVA</option>
                <option value="simple">Régimen Simple de Tributación</option>
              </NativeSelect>
            </FormField>
            <p className="text-xs text-muted-foreground">Usaremos estos datos para tus facturas y reportes. Puedes completarlos después.</p>
          </>
        )}

        {current.key === "branch" && (
          <>
            <FormField id="branchName" label="Nombre de la sede" error={errors.branchName?.message}>
              <Input id="branchName" placeholder="Chapinero" className="h-10" {...form.register("branchName")} />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="branchCity" label="Ciudad" error={errors.branchCity?.message}>
                <Input id="branchCity" className="h-10" {...form.register("branchCity")} />
              </FormField>
              <FormField id="branchPhone" label="Teléfono" optional>
                <Input id="branchPhone" type="tel" className="h-10" {...form.register("branchPhone")} />
              </FormField>
            </div>
            <FormField id="branchAddress" label="Dirección" optional>
              <Input id="branchAddress" placeholder="Cra. 13 # 63-20" className="h-10" {...form.register("branchAddress")} />
            </FormField>
          </>
        )}

        {current.key === "specialty" && (
          <fieldset className="grid gap-2.5">
            <legend className="sr-only">Especialidad</legend>
            {SPECIALTIES.map((s) => {
              const selected = specialty === s.value;
              return (
                <label key={s.value} className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border bg-surface p-4 shadow-soft transition-colors",
                  selected ? "border-brand ring-3 ring-brand/15" : "hover:border-foreground/20",
                )}>
                  <input type="radio" value={s.value} className="sr-only" {...form.register("specialty")} />
                  <s.icon className={cn("mt-0.5 size-5", selected ? "text-brand" : "text-muted-foreground")} strokeWidth={1.75} />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{s.title}</span>
                    <span className="text-sm text-muted-foreground">{s.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        <div className="mt-2 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || pending} className={step === 0 ? "invisible" : ""}>
            <ArrowLeft /> Atrás
          </Button>
          <Button type="submit" size="lg" className="h-10 min-w-36" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {isLast ? "Crear mi óptica" : "Continuar"} {!pending && !isLast && <ArrowRight />}
          </Button>
        </div>
      </form>
    </div>
  );
}
