"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updatePasswordAction } from "../actions";
import { updatePasswordSchema, type UpdatePasswordInput } from "../schemas";

export function UpdatePasswordForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<UpdatePasswordInput>({ resolver: zodResolver(updatePasswordSchema), defaultValues: { password: "", confirm: "" } });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await updatePasswordAction(values);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.replace("/inicio");
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormField id="password" label="Nueva contraseña" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" className="h-10" {...form.register("password")} />
      </FormField>
      <FormField id="confirm" label="Confirmar contraseña" error={errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" className="h-10" {...form.register("confirm")} />
      </FormField>
      <Button type="submit" size="lg" className="h-10" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Guardar contraseña
      </Button>
    </form>
  );
}
