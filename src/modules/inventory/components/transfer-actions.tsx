"use client";
import { Loader2, PackageCheck, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelTransferAction, receiveTransferAction, sendTransferAction } from "../actions";

export function TransferActions({ id, number, canSend, canReceive, canCancel }: { id: string; number: string; canSend: boolean; canReceive: boolean; canCancel: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => startTransition(async () => {
    const res = await fn();
    if (!res.ok) toast.error(res.error);
    else { toast.success(res.message); router.refresh(); }
  });
  const cancel = () => {
    const reason = window.prompt(`¿Por qué cancelas el traslado ${number}? Las unidades vuelven a la sede de origen.`);
    if (reason === null) return;
    run(() => cancelTransferAction(id, reason));
  };
  return (
    <div className="flex flex-wrap gap-2">
      {canCancel && <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}><XCircle /> Cancelar</Button>}
      {canSend && <Button size="sm" disabled={pending} onClick={() => run(() => sendTransferAction(id))}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Enviar</Button>}
      {canReceive && <Button size="sm" disabled={pending} onClick={() => run(() => receiveTransferAction(id))}>{pending ? <Loader2 className="animate-spin" /> : <PackageCheck />} Recibir</Button>}
    </div>
  );
}
