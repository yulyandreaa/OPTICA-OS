"use client";
import { EyeOff, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteProductAction, setProductActiveAction } from "../actions";

/**
 * "Eliminar" on the product page. Without history the product is deleted for good; with history
 * (movements, purchases, sales…) deleting would break the trail, so the dialog offers deactivating instead.
 */
export function ProductDelete({ id, name, hasHistory, isActive }: { id: string; name: string; hasHistory: boolean; isActive: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const remove = () => startTransition(async () => {
    const res = await deleteProductAction(id);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message);
    setOpen(false);
    router.replace("/inventario");
  });
  const deactivate = () => startTransition(async () => {
    const res = await setProductActiveAction(id, false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message);
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)}><Trash2 /> Eliminar</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {hasHistory ? (
            <>
              <DialogHeader>
                <DialogTitle>No se puede eliminar «{name}»</DialogTitle>
                <DialogDescription>
                  Este producto ya tiene movimientos, compras o ventas registradas. Si lo borráramos, esos registros quedarían sin producto y el inventario dejaría de cuadrar.
                  {isActive ? " Puedes desactivarlo: deja de aparecer para vender y en el catálogo, pero conserva todo su historial. Lo puedes volver a activar desde Editar." : " Ya está desactivado: no aparece para vender."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cerrar</Button>
                {isActive && <Button disabled={pending} onClick={deactivate}>{pending ? <Loader2 className="animate-spin" /> : <EyeOff />} Desactivar producto</Button>}
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>¿Eliminar «{name}»?</DialogTitle>
                <DialogDescription>Se borran el producto y todas sus variantes. Esta acción no se puede deshacer.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancelar</Button>
                <Button variant="destructive" disabled={pending} onClick={remove}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Eliminar producto</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
