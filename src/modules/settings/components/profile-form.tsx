"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProfileAction } from "../actions/profile";

export function ProfileForm({ fullName, email, phone }: { fullName: string; email: string; phone: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form className="grid max-w-lg gap-4 rounded-xl border bg-surface p-6 shadow-soft" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      startTransition(async () => {
        const res = await updateProfileAction({ fullName: String(fd.get("fullName")), phone: String(fd.get("phone")) });
        if (!res.ok) toast.error(res.error); else { toast.success(res.message); router.refresh(); }
      });
    }}>
      <FormField id="fullName" label="Nombre completo"><Input id="fullName" name="fullName" defaultValue={fullName} /></FormField>
      <FormField id="email" label="Correo" hint="Para cambiarlo, contacta a soporte."><Input id="email" value={email} readOnly /></FormField>
      <FormField id="phone" label="Celular" optional><Input id="phone" name="phone" defaultValue={phone ?? ""} /></FormField>
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Guardar</Button></div>
    </form>
  );
}
