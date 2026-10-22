"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signUpAction } from "../actions";
import { signUpSchema, type SignUpInput } from "../schemas";

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema), defaultValues: { fullName: "", email: "", password: "", next: params.get("next") ?? undefined } });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      setFormError(null);
      const res = await signUpAction(values);
      if (!res.ok) return setFormError(res.error);
      if (res.data.needsConfirmation) return setSentTo(values.email);
      router.replace(res.data.next);
      router.refresh();
    }),
  );

  if (sentTo) {
    return (
      <div className="grid gap-3 rounded-xl border bg-surface p-6 text-center shadow-soft">
        <MailCheck className="mx-auto size-8 text-brand" strokeWidth={1.5} />
        <p className="font-medium">Revisa tu correo</p>
        <p className="text-sm text-muted-foreground">Enviamos un enlace de confirmación a <b className="text-foreground">{sentTo}</b>. Al abrirlo continuarás con la configuración de tu óptica.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {formError && <p role="alert" className="rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2 text-sm text-destructive">{formError}</p>}
      <FormField id="fullName" label="Nombre completo" error={errors.fullName?.message}>
        <Input id="fullName" autoComplete="name" placeholder="Andrés Rojas" aria-invalid={!!errors.fullName} className="h-10" {...form.register("fullName")} />
      </FormField>
      <FormField id="email" label="Correo de trabajo" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" placeholder="tu@optica.com" aria-invalid={!!errors.email} className="h-10" {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Contraseña" error={errors.password?.message} hint="Mínimo 8 caracteres, con letras y números.">
        <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} className="h-10" {...form.register("password")} />
      </FormField>
      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Crear cuenta
      </Button>
      <p className="text-center text-xs text-muted-foreground">14 días de prueba gratis. Sin tarjeta de crédito.</p>
    </form>
  );
}
