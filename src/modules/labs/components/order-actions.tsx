"use client";
import { ArrowRight, Check, Copy, Loader2, MessageCircle, PackageCheck, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { advanceLabOrderAction } from "../actions";
import { LAB_STATUS, nextStatus, QC_ITEMS, type LabStatus } from "../constants";

export function OrderActions({ orderId, status, canQc, trackingUrl, phone, firstName, branch }: {
  orderId: string; status: string; canQc: boolean; trackingUrl: string; phone: string | null; firstName: string; branch: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [qcOpen, setQcOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const next = nextStatus(status);

  const advance = (to: LabStatus, extra: { checklist?: Record<string, boolean>; note?: string } = {}) => startTransition(async () => {
    const res = await advanceLabOrderAction({ orderId, status: to, ...extra });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(LAB_STATUS[to].label);
    setQcOpen(false); setDeliverOpen(false);
    router.refresh();
  });

  const onNext = () => {
    if (!next) return;
    if (next === "ready" && status === "quality_control") return setQcOpen(true);
    if (next === "delivered") return setDeliverOpen(true);
    advance(next);
  };

  const ready = status === "received";
  const wa = phone ? `https://wa.me/${phone.replace(/\D/g, "").replace(/^(\d{10})$/, "57$1")}?text=${encodeURIComponent(
    ready ? `Hola ${firstName} 👋 Tus gafas ya están listas para recoger en nuestra sede de ${branch}. Sigue tu pedido aquí: ${trackingUrl}`
      : `Hola ${firstName}, puedes seguir el estado de tus gafas aquí: ${trackingUrl}`)}` : null;

  return (
    <div className="grid gap-3">
      {next && status !== "cancelled" && (
        <Button size="lg" disabled={pending || (next === "ready" && !canQc)} onClick={onNext}>
          {pending ? <Loader2 className="animate-spin" /> : next === "delivered" ? <PackageCheck /> : next === "ready" ? <ShieldCheck /> : <ArrowRight />}
          {next === "ready" ? "Aprobar control de calidad" : next === "delivered" ? "Entregar al paciente" : `Marcar: ${LAB_STATUS[next].label.toLowerCase()}`}
        </Button>
      )}
      {next === "ready" && !canQc && <p className="text-xs text-muted-foreground">Solo un usuario con permiso de control de calidad puede aprobar.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(trackingUrl); toast.success("Enlace de seguimiento copiado"); }}><Copy /> Enlace de seguimiento</Button>
        {wa && <a href={wa} target="_blank" rel="noreferrer"><Button variant={ready ? "default" : "outline"}><MessageCircle /> {ready ? "Avisar: gafas listas" : "Enviar seguimiento"}</Button></a>}
      </div>

      <Dialog open={qcOpen} onOpenChange={setQcOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Control de calidad</DialogTitle><DialogDescription>Verifica cada punto antes de aprobar. Quedarás registrado como responsable.</DialogDescription></DialogHeader>
          <ul className="grid gap-2.5">
            {QC_ITEMS.map((q) => (
              <li key={q.key}><label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={!!checks[q.key]} onCheckedChange={(v) => setChecks((c) => ({ ...c, [q.key]: v === true }))} /> {q.label}
              </label></li>
            ))}
          </ul>
          <Button disabled={pending || QC_ITEMS.some((q) => !checks[q.key])} onClick={() => advance("ready", { checklist: Object.fromEntries(QC_ITEMS.map((q) => [q.key, true])) })}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} Aprobar
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Entrega al paciente</DialogTitle><DialogDescription>Se verifica que no haya saldo pendiente.</DialogDescription></DialogHeader>
          <Textarea rows={3} placeholder="Observaciones (ajuste realizado, estuche entregado…)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button disabled={pending} onClick={() => advance("delivered", { note: note || undefined })}>{pending ? <Loader2 className="animate-spin" /> : <PackageCheck />} Confirmar entrega</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
