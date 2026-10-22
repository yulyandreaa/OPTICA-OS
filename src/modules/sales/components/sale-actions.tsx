"use client";
import { Check, Copy, FlaskConical, Loader2, MessageCircle, Receipt, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { issueInvoiceAction } from "@/modules/billing/actions";
import { createLabOrderFromSaleAction } from "@/modules/labs/actions";
import { addPaymentAction, convertQuoteAction } from "../actions";
import { PAYMENT_METHODS, type PaymentMethod } from "../constants";

export function AddPaymentForm({ saleId, balance }: { saleId: string; balance: number }) {
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(String(balance));
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <NativeSelect aria-label="Medio de pago" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-40">
        {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </NativeSelect>
      <Input aria-label="Valor" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="w-36 tabular" />
      <Button disabled={pending || !Number(amount)} onClick={() => startTransition(async () => {
        const res = await addPaymentAction(saleId, { method, amount: Number(amount) });
        if (!res.ok) { toast.error(res.error); return; }
        toast.success(`${res.message} · ${formatMoney(Number(amount))}`);
        router.refresh();
      })}>{pending && <Loader2 className="animate-spin" />} Registrar pago</Button>
    </div>
  );
}

export function CreateLabOrderButton({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => startTransition(async () => {
      const res = await createLabOrderFromSaleAction(saleId);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(res.message);
      router.push(`/ordenes/${res.data.id}`);
    })}>{pending ? <Loader2 className="animate-spin" /> : <FlaskConical />} Crear orden de laboratorio</Button>
  );
}

export function IssueInvoiceButton({ saleId, retry }: { saleId: string; retry?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant={retry ? "outline" : "default"} size={retry ? "sm" : "default"} disabled={pending} onClick={() => startTransition(async () => {
      const res = await issueInvoiceAction(saleId);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(res.message);
      router.refresh();
    })}>{pending ? <Loader2 className="animate-spin" /> : <Receipt />} {retry ? "Reintentar" : "Emitir factura electrónica"}</Button>
  );
}

export function QuoteActions({ quoteId, total, publicUrl, phone, firstName, convertible }: {
  quoteId: string; total: number; publicUrl: string; phone: string | null; firstName: string; convertible: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(String(Math.round(total / 2 / 1000) * 1000));
  const [pending, startTransition] = useTransition();
  const wa = phone ? `https://wa.me/${phone.replace(/\D/g, "").replace(/^(\d{10})$/, "57$1")}?text=${encodeURIComponent(`Hola ${firstName}, aquí está tu cotización: ${publicUrl}`)}` : null;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(publicUrl); setCopied(true); toast.success("Enlace copiado"); }}>
          {copied ? <Check /> : <Copy />} Copiar enlace para el paciente
        </Button>
        {wa && <a href={wa} target="_blank" rel="noreferrer"><Button variant="outline"><MessageCircle /> Enviar por WhatsApp</Button></a>}
      </div>
      {convertible && (
        <div className="grid gap-2 rounded-xl border bg-muted/40 p-4">
          <p className="text-sm font-medium">Convertir en venta</p>
          <p className="text-xs text-muted-foreground">Se usan las mismas líneas. Registra el anticipo o el pago total.</p>
          <div className="flex flex-wrap gap-2">
            <NativeSelect aria-label="Medio de pago" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="w-40">
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
            <Input aria-label="Anticipo" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className="w-36 tabular" />
            <Button disabled={pending} onClick={() => startTransition(async () => {
              const res = await convertQuoteAction(quoteId, Number(amount) > 0 ? [{ method, amount: Number(amount) }] : []);
              if (!res.ok) { toast.error(res.error); return; }
              toast.success(res.message);
              router.push(`/ventas/${res.data.saleId}`);
            })}>{pending ? <Loader2 className="animate-spin" /> : <ShoppingCart />} Convertir en venta</Button>
          </div>
        </div>
      )}
    </div>
  );
}
