"use client";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DatePicker } from "@/components/shared/date-picker";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, type PaymentMethod } from "../constants";

export type PaymentPlan = { payments: { method: PaymentMethod; amount: number; reference?: string }[]; dueDate?: string; paymentTerms?: string };
type Row = { method: PaymentMethod; amount: string; reference: string };

const toNumber = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Last step before confirming: review, then pay in full, leave a deposit (abono) or leave the balance pending
 * with a due date. Cash over the total is change handed back, never recorded as paid.
 */
export function PaymentDialog({ open, onOpenChange, total, itemsCount, customerName, branchName, pending, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; total: number; itemsCount: number; customerName: string | null; branchName: string;
  pending: boolean; onConfirm: (plan: PaymentPlan) => void;
}) {
  const [rows, setRows] = useState<Row[]>([{ method: "cash", amount: "", reference: "" }]);
  const [dueDate, setDueDate] = useState(() => plusDays(30));
  const [today] = useState(() => plusDays(0));
  const [maxDue] = useState(() => new Date(Date.now() + 365 * 86_400_000));
  const [terms, setTerms] = useState("");

  const received = rows.reduce((a, r) => a + toNumber(r.amount), 0);
  const nonCash = rows.filter((r) => r.method !== "cash").reduce((a, r) => a + toNumber(r.amount), 0);
  const change = Math.max(0, received - total);
  const balance = Math.max(0, total - received);
  const overNonCash = nonCash > total; // card/transfer can't give change
  const needsCustomer = balance > 0 && !customerName;
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const confirm = () => {
    // Change comes out of the cash rows; only what settles the sale is recorded.
    let excess = change;
    const payments = rows.map((r) => {
      let amount = toNumber(r.amount);
      if (r.method === "cash" && excess > 0) { const cut = Math.min(excess, amount); amount -= cut; excess -= cut; }
      return { method: r.method, amount, reference: r.reference.trim() || undefined };
    }).filter((p) => p.amount > 0);
    onConfirm({ payments, dueDate: balance > 0 ? dueDate : undefined, paymentTerms: balance > 0 ? terms.trim() || undefined : undefined });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pago y confirmación</DialogTitle>
          <DialogDescription>{customerName ?? "Venta de mostrador"} · {branchName} · {itemsCount} {itemsCount === 1 ? "producto" : "productos"}</DialogDescription>
        </DialogHeader>

        <div className="flex items-baseline justify-between rounded-xl bg-muted/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">Total a pagar</span>
          <span className="text-2xl font-semibold tabular">{formatMoney(total)}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setRows([{ method: rows[0]?.method ?? "cash", amount: String(total), reference: "" }])}>Pago completo</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setRows([{ method: rows[0]?.method ?? "cash", amount: String(Math.round(total / 2 / 1000) * 1000), reference: "" }])}>Abono del 50 %</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setRows([{ method: "cash", amount: "", reference: "" }])}>Sin pago ahora</Button>
        </div>

        <div className="grid gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
              <NativeSelect aria-label="Medio de pago" value={r.method} onChange={(e) => set(i, { method: e.target.value as PaymentMethod })}>
                {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input aria-label="Valor" inputMode="numeric" className="pl-6 tabular" placeholder="0"
                  value={toNumber(r.amount) ? toNumber(r.amount).toLocaleString("es-CO") : ""} onChange={(e) => set(i, { amount: e.target.value })} />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Quitar medio de pago" disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 /></Button>
              {r.method !== "cash" && (
                <Input aria-label="Referencia" placeholder="Referencia o número de aprobación (opcional)" className="col-span-2" value={r.reference}
                  onChange={(e) => set(i, { reference: e.target.value })} maxLength={80} />
              )}
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setRows((rs) => [...rs, { method: "card", amount: balance ? String(balance) : "", reference: "" }])}>
            <Plus /> Otro medio de pago
          </Button>
        </div>

        <dl className="grid gap-1.5 border-t pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Recibido</dt><dd className="tabular">{formatMoney(received)}</dd></div>
          {change > 0 && <div className="flex justify-between font-medium text-success"><dt>Cambio a devolver</dt><dd className="tabular">{formatMoney(change)}</dd></div>}
          <div className={cn("flex justify-between font-medium", balance > 0 && "text-[oklch(0.5_0.12_60)]")}>
            <dt>{balance > 0 ? (received > 0 ? "Saldo pendiente (abono)" : "Saldo pendiente (sin pago)") : "Saldo"}</dt><dd className="tabular">{formatMoney(balance)}</dd>
          </div>
        </dl>

        {balance > 0 && !needsCustomer && (
          <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
            <FormField id="due" label="Fecha límite de pago" hint="El saldo queda en la cartera del cliente">
              <DatePicker id="due" value={dueDate} onChange={setDueDate} fromYear={new Date().getFullYear()} toDate={maxDue} className="w-full" />
            </FormField>
            <FormField id="terms" label="Condiciones de pago" optional>
              <Input id="terms" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Saldo al recoger las gafas" maxLength={200} />
            </FormField>
          </div>
        )}
        {needsCustomer && (
          <p role="alert" className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Para dejar saldo pendiente debes elegir el cliente: la deuda queda a su nombre. Cierra esta ventana y selecciónalo, o registra el pago completo.</p>
        )}
        {overNonCash && <p role="alert" className="text-sm text-destructive">Tarjeta, transferencia y billeteras no pueden superar el total: no dan cambio.</p>}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Volver a la venta</Button>
          <Button type="button" disabled={pending || needsCustomer || overNonCash || (dueDate < today && balance > 0)} onClick={confirm}>
            {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirmar venta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
