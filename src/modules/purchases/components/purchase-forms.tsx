"use client";
import { Loader2, PackageCheck, Plus, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { createPurchaseOrderAction, createSupplierAction, receivePurchaseAction, setPurchaseStatusAction } from "../actions";

export function NewPurchaseForm({ suppliers, variants }: { suppliers: { id: string; name: string }[]; variants: { id: string; label: string; cost: number }[] }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [expectedAt, setExpectedAt] = useState("");
  const [rows, setRows] = useState([{ variantId: variants[0]?.id ?? "", quantity: 4, unitCost: variants[0]?.cost ?? 0 }]);
  const [pending, startTransition] = useTransition();
  const total = rows.reduce((a, r) => a + r.quantity * r.unitCost, 0);
  return (
    <div className="grid gap-4 rounded-xl border bg-surface p-5 shadow-soft">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="supplier" label="Proveedor"><NativeSelect id="supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></FormField>
        <FormField id="expected" label="Entrega esperada" optional><Input id="expected" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></FormField>
      </div>
      <div className="grid gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_130px_36px] gap-2">
            <NativeSelect aria-label="Producto" value={r.variantId} onChange={(e) => {
              const v = variants.find((x) => x.id === e.target.value);
              setRows((rs) => rs.map((x, j) => j === i ? { ...x, variantId: e.target.value, unitCost: v?.cost ?? x.unitCost } : x));
            }}>{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</NativeSelect>
            <Input aria-label="Cantidad" type="number" min={1} value={r.quantity} onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} />
            <Input aria-label="Costo unitario" inputMode="numeric" value={r.unitCost} onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, unitCost: Number(e.target.value.replace(/\D/g, "")) } : x))} />
            <Button variant="ghost" size="icon" aria-label="Quitar" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
        <button type="button" className="justify-self-start text-sm text-brand hover:underline" onClick={() => setRows((rs) => [...rs, { variantId: variants[0]?.id ?? "", quantity: 1, unitCost: variants[0]?.cost ?? 0 }])}>+ Agregar producto</button>
      </div>
      <div className="flex items-center justify-between border-t pt-4">
        <p className="text-sm">Total <b className="tabular">{formatMoney(total)}</b></p>
        <Button disabled={pending || rows.length === 0} onClick={() => startTransition(async () => {
          const res = await createPurchaseOrderAction({ supplierId, expectedAt, items: rows });
          if (!res.ok) { toast.error(res.error); return; }
          toast.success(res.message); router.push(`/compras/${res.data.id}`);
        })}>{pending && <Loader2 className="animate-spin" />} Crear orden de compra</Button>
      </div>
    </div>
  );
}

export function PurchaseStatusButtons({ id, status, canApprove }: { id: string; status: string; canApprove: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (s: "sent" | "approved" | "cancelled") => startTransition(async () => {
    const res = await setPurchaseStatusAction(id, s);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message); router.refresh();
  });
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && <Button disabled={pending} onClick={() => run("sent")}><Send /> Enviar al proveedor</Button>}
      {status === "sent" && canApprove && <Button variant="outline" disabled={pending} onClick={() => run("approved")}>Aprobar</Button>}
      {["draft", "sent"].includes(status) && <Button variant="ghost" className="text-destructive" disabled={pending} onClick={() => run("cancelled")}>Cancelar</Button>}
    </div>
  );
}

/** Receiving is when stock grows. Products with lots ask for lot and expiry per line; a retry key avoids double receipts. */
export function ReceiveForm({ id, items }: { id: string; items: { id: string; label: string; pending: number; trackLots: boolean }[] }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(items.map((i) => [i.id, i.pending])));
  const [lots, setLots] = useState<Record<string, { lot: string; expires: string }>>({});
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const missingLot = items.some((i) => i.trackLots && (qty[i.id] ?? 0) > 0 && !lots[i.id]?.lot.trim());
  return (
    <div className="grid gap-3">
      {items.filter((i) => i.pending > 0).map((i) => (
        <div key={i.id} className="grid gap-2 text-sm">
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate">{i.label} <span className="text-muted-foreground">· pendiente {i.pending}</span></span>
            <Input aria-label={`Recibir ${i.label}`} type="number" min={0} max={i.pending} className="w-20" value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Math.min(i.pending, Math.max(0, Number(e.target.value))) })} />
          </div>
          {i.trackLots && (qty[i.id] ?? 0) > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label={`Lote de ${i.label}`} placeholder="Lote" className="h-8 font-mono uppercase" value={lots[i.id]?.lot ?? ""}
                onChange={(e) => setLots({ ...lots, [i.id]: { lot: e.target.value, expires: lots[i.id]?.expires ?? "" } })} />
              <Input aria-label={`Vencimiento de ${i.label}`} type="date" className="h-8" value={lots[i.id]?.expires ?? ""}
                onChange={(e) => setLots({ ...lots, [i.id]: { lot: lots[i.id]?.lot ?? "", expires: e.target.value } })} />
            </div>
          )}
        </div>
      ))}
      {missingLot && <p className="text-xs text-muted-foreground">Indica el lote de los productos que lo manejan.</p>}
      <Button className="mt-1 justify-self-start" disabled={pending || missingLot} onClick={() => startTransition(async () => {
        const res = await receivePurchaseAction(id, Object.entries(qty).map(([itemId, quantity]) => ({ itemId, quantity, lotCode: lots[itemId]?.lot.trim(), expiresOn: lots[itemId]?.expires })), key);
        if (!res.ok) { toast.error(res.error); setKey(crypto.randomUUID()); return; }
        toast.success(res.message); setKey(crypto.randomUUID()); router.refresh();
      })}>{pending ? <Loader2 className="animate-spin" /> : <PackageCheck />} Registrar recepción</Button>
    </div>
  );
}

export function NewSupplierDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}><Plus /> Proveedor</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nuevo proveedor</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const get = (k: string) => String(fd.get(k) ?? "");
          startTransition(async () => {
            const res = await createSupplierAction({ name: get("name"), taxId: get("taxId"), contactName: get("contact"), email: get("email"), phone: get("phone"),
              paymentTerms: get("terms"), leadTimeDays: get("lead") ? Number(get("lead")) : undefined });
            if (!res.ok) { toast.error(res.error); return; }
            toast.success(res.message); setOpen(false); router.refresh();
          });
        }}>
          <FormField id="name" label="Empresa"><Input id="name" name="name" required /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="taxId" label="NIT" optional><Input id="taxId" name="taxId" /></FormField>
            <FormField id="contact" label="Contacto" optional><Input id="contact" name="contact" /></FormField>
            <FormField id="email" label="Correo" optional><Input id="email" name="email" type="email" /></FormField>
            <FormField id="phone" label="Teléfono" optional><Input id="phone" name="phone" /></FormField>
            <FormField id="terms" label="Condiciones de pago" optional><Input id="terms" name="terms" placeholder="30 días" /></FormField>
            <FormField id="lead" label="Entrega (días)" optional><Input id="lead" name="lead" type="number" min={0} /></FormField>
          </div>
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Crear proveedor</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
