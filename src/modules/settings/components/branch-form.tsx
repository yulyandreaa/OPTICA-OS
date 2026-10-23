"use client";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBranchAction, updateBranchAction } from "../actions";

export type BranchValues = { id: string; name: string; code: string; city: string | null; address: string | null; phone: string | null };

/** Fields shared by "Agregar sede" and "Editar"; with `branch` it saves changes to that branch. */
export function BranchFields({ branch, onDone, onCancel }: { branch?: BranchValues; onDone: () => void; onCancel: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = {
          name: String(fd.get("name")), code: String(fd.get("code")), city: String(fd.get("city")),
          address: String(fd.get("address")), phone: String(fd.get("phone")),
        };
        startTransition(async () => {
          const res = branch ? await updateBranchAction(branch.id, input) : await createBranchAction(input);
          if (!res.ok) { setErrors(res.fieldErrors ?? {}); toast.error(res.error); return; }
          toast.success(res.message);
          onDone();
          router.refresh();
        });
      }}
    >
      <FormField id={`${branch?.id ?? "new"}-name`} label="Nombre" error={errors.name?.[0]}>
        <Input id={`${branch?.id ?? "new"}-name`} name="name" required defaultValue={branch?.name} placeholder="Cedritos" />
      </FormField>
      <FormField id={`${branch?.id ?? "new"}-code`} label="Código" hint="Corto, para reportes." error={errors.code?.[0]}>
        <Input id={`${branch?.id ?? "new"}-code`} name="code" required defaultValue={branch?.code} placeholder="CED" className="uppercase" />
      </FormField>
      <FormField id={`${branch?.id ?? "new"}-city`} label="Ciudad" optional>
        <Input id={`${branch?.id ?? "new"}-city`} name="city" defaultValue={branch?.city ?? ""} />
      </FormField>
      <FormField id={`${branch?.id ?? "new"}-phone`} label="Teléfono" optional>
        <Input id={`${branch?.id ?? "new"}-phone`} name="phone" defaultValue={branch?.phone ?? ""} />
      </FormField>
      <FormField id={`${branch?.id ?? "new"}-address`} label="Dirección" optional className="sm:col-span-2">
        <Input id={`${branch?.id ?? "new"}-address`} name="address" defaultValue={branch?.address ?? ""} />
      </FormField>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {branch ? "Guardar cambios" : "Crear sede"}</Button>
      </div>
    </form>
  );
}

export function BranchForm() {
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><Plus /> Agregar sede</Button>;
  return (
    <div className="rounded-xl border bg-surface p-5 shadow-soft">
      <BranchFields onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </div>
  );
}
