"use client";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteBranchAction } from "../actions";
import { BranchFields, type BranchValues } from "./branch-form";

/**
 * Per-branch buttons: edit (where the main branch is chosen) and delete. With a single branch only editing applies.
 * `blocker` is the reason it can't be deleted (already in plain words), so the dialog explains instead of failing after the click.
 */
export function BranchActions({ branch, isMain, single, blocker }: { branch: BranchValues; isMain: boolean; single: boolean; blocker: string | null }) {
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
          {blocker ? (
            <>
              <DialogHeader>
                <DialogTitle>Todavía no puedes eliminar «{name}»</DialogTitle>
                <DialogDescription>{blocker}</DialogDescription>
              </DialogHeader>
              <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>Entendido</Button></DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>¿Eliminar la sede «{name}»?</DialogTitle>
                <DialogDescription>
                  Deja de aparecer en el menú, la agenda, el inventario y las ventas. Las ventas, citas y movimientos que ya se hicieron allí se conservan en los reportes.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancelar</Button>
                <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteBranchAction(id))}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Eliminar sede</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
