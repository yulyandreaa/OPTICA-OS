"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordResetAction } from "../actions";
import { emailOnlySchema, type EmailOnlyInput } from "../schemas";

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const form = useForm<EmailOnlyInput>({ resolver: zodResolver(emailOnlySchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await requestPasswordResetAction(values);
      setMessage(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {message && (
        <p role="status" className={message.ok ? "rounded-lg bg-success-soft px-3 py-2 text-sm text-success" : "rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive"}>
          {message.text}
        </p>
      )}
      <FormField id="email" label="Correo" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" className="h-10" {...form.register("email")} />
      </FormField>
      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Enviar instrucciones
      </Button>
    </form>
  );
}
