"use client";
import { Loader2, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteBranchAction, setMainBranchAction } from "../actions";

/**
 * Per-branch menu: make it the main branch, or delete it. `blocker` is the reason it can't be deleted
 * (already in plain words), so the dialog explains instead of failing after the click.
 */
export function BranchActions({ id, name, isMain, blocker }: { id: string; name: string; isMain: boolean; blocker: string | null }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"main" | "delete" | null>(null);
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
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Opciones de ${name}`} />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isMain && <DropdownMenuItem onClick={() => setConfirm("main")}><Star /> Hacer principal</DropdownMenuItem>}
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm("delete")}><Trash2 /> Eliminar sede</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirm === "main"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Hacer «{name}» la sede principal?</DialogTitle>
            <DialogDescription>Aparecerá primero en las listas y será la sede con la que empiezan los usuarios. La sede principal actual pasa a ser una sede más.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button disabled={pending} onClick={() => run(() => setMainBranchAction(id))}>{pending ? <Loader2 className="animate-spin" /> : <Star />} Hacer principal</Button>
          </DialogFooter>
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
