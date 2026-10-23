"use client";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteBranchAction } from "../actions";
import { BranchFields, type BranchValues } from "./branch-form";

export type BranchDeleteImpact = { target: string; becomes_main: boolean; units: number; transfers: number; appointments: number; users: number };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;

/** What the database will do on delete, in plain words (see delete_branch). */
function consequences(i: BranchDeleteImpact) {
  return [
    i.becomes_main && `${i.target} pasa a ser la sede principal.`,
    i.units > 0 && `${plural(i.units, "unidad", "unidades")} en inventario se trasladan a ${i.target}.`,
    i.transfers > 0 && `Se cancelan ${plural(i.transfers, "traslado pendiente", "traslados pendientes")}; lo que estaba en camino vuelve a su sede de origen.`,
    i.appointments > 0 && `Se cancelan ${plural(i.appointments, "cita próxima", "citas próximas")}. Avísales a los pacientes.`,
    i.users > 0 && `${plural(i.users, "usuario que solo trabajaba aquí pasa", "usuarios que solo trabajaban aquí pasan")} a ${i.target}.`,
  ].filter((x): x is string => !!x);
}

/** Per-branch buttons: edit (where the main branch is chosen) and delete. With a single branch only editing applies. */
export function BranchActions({ branch, isMain, single, impact }: { branch: BranchValues; isMain: boolean; single: boolean; impact: BranchDeleteImpact | null }) {
  const { id, name } = branch;
  const router = useRouter();
  const [confirm, setConfirm] = useState<"edit" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => startTransition(async () => {
    const res = await fn();
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message);
    setConfirm(null);
    router.refresh();
  });

  return (
    <>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={() => setConfirm("edit")}><Pencil /> Editar</Button>
        {!single && (
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Eliminar ${name}`} title="Eliminar sede"
            onClick={() => setConfirm("delete")}><Trash2 /></Button>
        )}
      </div>

      <Dialog open={confirm === "edit"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Editar sede</DialogTitle><DialogDescription>Los cambios se ven en todo el sistema: menú, agenda, ventas e impresos.</DialogDescription></DialogHeader>
          <BranchFields branch={branch} main={single ? undefined : { isMain }} onDone={() => setConfirm(null)} onCancel={() => setConfirm(null)} />
        </DialogContent>
      </Dialog>

      <Dialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Eliminar la sede «{name}»?</DialogTitle>
            <DialogDescription>
              Deja de aparecer en el menú, la agenda, el inventario y las ventas. Las ventas, citas y movimientos que ya se hicieron allí se conservan en los reportes.
            </DialogDescription>
          </DialogHeader>
          {impact && consequences(impact).length > 0 && (
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
              <p className="mb-1 font-medium">Además:</p>
              <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">{consequences(impact).map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteBranchAction(id))}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Eliminar sede</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
