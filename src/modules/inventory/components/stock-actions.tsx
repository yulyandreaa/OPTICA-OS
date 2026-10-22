"use client";
import { ArrowRightLeft, Loader2, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { adjustStockAction, advanceTransferAction, requestTransferAction } from "../actions";

export function AdjustStockDialog({ variantId, label, branches, defaultBranchId }: { variantId: string; label: string; branches: { id: string; name: string }[]; defaultBranchId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ajustar ${label}`} />}><SlidersHorizontal /></DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Movimiento de inventario</DialogTitle><DialogDescription>{label}. Queda registrado y no se puede borrar.</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const type = String(fd.get("type")) as "adjustment" | "damage" | "loss";
          const qty = Number(fd.get("quantity"));
          startTransition(async () => {
            const res = await adjustStockAction({ variantId, branchId: String(fd.get("branchId")), type, quantity: type === "adjustment" ? qty : -Math.abs(qty), notes: String(fd.get("notes")) });
            if (!res.ok) { toast.error(res.error); return; }
            toast.success(res.message); setOpen(false); router.refresh();
          });
        }}>
          <FormField id="branchId" label="Sede"><NativeSelect id="branchId" name="branchId" defaultValue={defaultBranchId}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></FormField>
          <FormField id="type" label="Tipo"><NativeSelect id="type" name="type"><option value="adjustment">Ajuste (+ / −)</option><option value="damage">Daño</option><option value="loss">Pérdida</option></NativeSelect></FormField>
          <FormField id="quantity" label="Cantidad" hint="En ajustes usa negativo para restar."><Input id="quantity" name="quantity" type="number" required /></FormField>
          <FormField id="notes" label="Motivo"><Input id="notes" name="notes" required placeholder="Conteo físico, montura rota…" /></FormField>
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Registrar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TransferDialog({ branches, variants, fromBranchId }: { branches: { id: string; name: string }[]; variants: { id: string; label: string }[]; fromBranchId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}><ArrowRightLeft /> Solicitar traslado</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Traslado entre sedes</DialogTitle><DialogDescription>Solicitado → aprobado → en tránsito → recibido. El stock se mueve al enviar y al recibir.</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(async () => {
            const res = await requestTransferAction({ fromBranchId: String(fd.get("from")), toBranchId: String(fd.get("to")),
              items: [{ variantId: String(fd.get("variant")), quantity: Number(fd.get("quantity")) }], notes: String(fd.get("notes") ?? "") });
            if (!res.ok) { toast.error(res.error); return; }
            toast.success(res.message); setOpen(false); router.refresh();
          });
        }}>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="from" label="Desde"><NativeSelect id="from" name="from" defaultValue={fromBranchId}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></FormField>
            <FormField id="to" label="Hacia"><NativeSelect id="to" name="to" defaultValue={branches.find((b) => b.id !== fromBranchId)?.id}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></FormField>
          </div>
          <FormField id="variant" label="Producto"><NativeSelect id="variant" name="variant">{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</NativeSelect></FormField>
          <FormField id="quantity" label="Cantidad"><Input id="quantity" name="quantity" type="number" min={1} defaultValue={1} required /></FormField>
          <FormField id="notes" label="Nota" optional><Input id="notes" name="notes" /></FormField>
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Solicitar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const NEXT: Record<string, { to: "approved" | "in_transit" | "received"; label: string } | undefined> = {
  requested: { to: "approved", label: "Aprobar" }, approved: { to: "in_transit", label: "Enviar" }, in_transit: { to: "received", label: "Recibir" },
};

export function TransferStep({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = NEXT[status];
  if (!next) return null;
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
      const res = await advanceTransferAction(id, next.to);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(res.message); router.refresh();
    })}>{pending && <Loader2 className="animate-spin" />} {next.label}</Button>
  );
}
