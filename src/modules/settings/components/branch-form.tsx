"use client";
import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { createBranchAction, setMainBranchAction, updateBranchAction } from "../actions";

export type BranchValues = { id: string; name: string; code: string; city: string | null; address: string | null; phone: string | null };

/**
 * Fields shared by "Agregar sede" and "Editar"; with `branch` it saves changes to that branch.
 * `main` shows the "sede principal" option while editing (omitted when the company has a single branch).
 */
export function BranchFields({ branch, main, onDone, onCancel }: {
  branch?: BranchValues; main?: { isMain: boolean }; onDone: () => void; onCancel: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [makeMain, setMakeMain] = useState(main?.isMain ?? false);
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
          if (branch && main && makeMain && !main.isMain) {
            const m = await setMainBranchAction(branch.id);
            if (!m.ok) { toast.error(m.error); router.refresh(); return; }
            toast.success(`${input.name.trim()} ahora es la sede principal`);
          } else toast.success(res.message);
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
      {branch && main && (
        <label className="flex items-start gap-3 rounded-xl border p-3 sm:col-span-2">
          <Checkbox checked={makeMain} disabled={main.isMain} onCheckedChange={(c) => setMakeMain(c === true)} className="mt-0.5" />
          <span className="text-sm">
            <span className="block font-medium">Sede principal</span>
            <span className="text-muted-foreground">
              {main.isMain
                ? "Ya es la principal. Para cambiarla, edita otra sede y márcala como principal."
                : "Aparece primero en las listas y es con la que empiezan los usuarios. La principal actual pasa a ser una sede más."}
            </span>
          </span>
        </label>
      )}
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
