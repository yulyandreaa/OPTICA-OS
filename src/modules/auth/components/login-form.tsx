"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendMagicLinkAction, signInAction } from "../actions";
import { signInSchema, type SignInInput } from "../schemas";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [magicPending, startMagic] = useTransition();
  const [formError, setFormError] = useState<string | null>(params.get("error") === "link" ? "El enlace expiró o no es válido. Solicita uno nuevo." : null);
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", next: params.get("next") ?? undefined },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      setFormError(null);
      const res = await signInAction(values);
      if (!res.ok) return setFormError(res.error);
      router.replace(res.data.next);
      router.refresh();
    }),
  );

  const onMagicLink = () =>
    startMagic(async () => {
      const valid = await form.trigger("email");
      if (!valid) return;
      const res = await sendMagicLinkAction({ email: form.getValues("email") });
      if (res.ok) toast.success(res.message ?? "Revisa tu correo");
      else setFormError(res.error);
    });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {formError && <p role="alert" className="rounded-lg border border-destructive/20 bg-danger-soft px-3 py-2 text-sm text-destructive">{formError}</p>}
      <FormField id="email" label="Correo" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" placeholder="tu@optica.com" aria-invalid={!!errors.email} className="h-10" {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Contraseña" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} className="h-10" {...form.register("password")} />
      </FormField>
      <div className="-mt-1 flex justify-end">
        <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">¿Olvidaste tu contraseña?</Link>
      </div>
      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Ingresar
      </Button>
      <div className="relative py-1 text-center text-xs text-muted-foreground">
        <span className="relative z-10 bg-background px-2">o</span>
        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
      </div>
      <Button type="button" variant="outline" size="lg" className="h-10" onClick={onMagicLink} disabled={magicPending}>
        {magicPending ? <Loader2 className="animate-spin" /> : <Mail />} Enviarme un enlace mágico
      </Button>
    </form>
  );
}
