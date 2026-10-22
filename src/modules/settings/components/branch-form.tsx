"use client";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBranchAction } from "../actions";

export function BranchForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><Plus /> Agregar sede</Button>;
  return (
    <form
      className="grid gap-4 rounded-xl border bg-surface p-5 shadow-soft sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const res = await createBranchAction({
            name: String(fd.get("name")), code: String(fd.get("code")), city: String(fd.get("city")),
            address: String(fd.get("address")), phone: String(fd.get("phone")),
          });
          if (!res.ok) { toast.error(res.error); return; }
          toast.success(res.message);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <FormField id="name" label="Nombre"><Input id="name" name="name" required placeholder="Cedritos" /></FormField>
      <FormField id="code" label="Código" hint="Corto, para reportes."><Input id="code" name="code" required placeholder="CED" className="uppercase" /></FormField>
      <FormField id="city" label="Ciudad"><Input id="city" name="city" /></FormField>
      <FormField id="phone" label="Teléfono"><Input id="phone" name="phone" /></FormField>
      <FormField id="address" label="Dirección" className="sm:col-span-2"><Input id="address" name="address" /></FormField>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Crear sede</Button>
      </div>
    </form>
  );
}
