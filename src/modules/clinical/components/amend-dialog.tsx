"use client";
import { FilePen, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { amendRecordAction } from "../actions";

export function AmendDialog({ recordId, current }: { recordId: string; current: { plan: string | null; recommendations: string | null; observations: string | null } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ reason: "", plan: current.plan ?? "", recommendations: current.recommendations ?? "", observations: current.observations ?? "" });

  const submit = () => startTransition(async () => {
    const changes: Record<string, string> = {};
    if (form.plan !== (current.plan ?? "")) changes.plan = form.plan;
    if (form.recommendations !== (current.recommendations ?? "")) changes.recommendations = form.recommendations;
    if (form.observations !== (current.observations ?? "")) changes.observations = form.observations;
    const res = await amendRecordAction(recordId, { reason: form.reason, changes });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message);
    setOpen(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}><FilePen /> Enmendar</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enmendar historia firmada</DialogTitle>
          <DialogDescription>La versión original se conserva. Quedarán registrados el cambio, el motivo, tu usuario y la fecha.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField id="reason" label="Motivo de la enmienda"><Textarea id="reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ej.: se corrige el plan de control acordado" /></FormField>
          <FormField id="a_plan" label="Plan"><Textarea id="a_plan" rows={2} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} /></FormField>
          <FormField id="a_rec" label="Recomendaciones"><Textarea id="a_rec" rows={2} value={form.recommendations} onChange={(e) => setForm({ ...form, recommendations: e.target.value })} /></FormField>
          <FormField id="a_obs" label="Observaciones"><Textarea id="a_obs" rows={2} value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} /></FormField>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={pending || form.reason.trim().length < 5}>{pending && <Loader2 className="animate-spin" />} Registrar enmienda</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
