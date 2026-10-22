"use client";
import { Download, Loader2, Play, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateRipsAction, saveRipsConfigAction, submitRipsAction } from "./actions";

export function GenerateRips({ months }: { months: { value: string; label: string }[] }) {
  const [pending, startTransition] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      const month = String(new FormData(e.currentTarget).get("month"));
      startTransition(async () => { const res = await generateRipsAction(month); if (res && !res.ok) toast.error(res.error); });
    }}>
      <FormField id="month" label="Periodo"><NativeSelect id="month" name="month" className="w-48">{months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</NativeSelect></FormField>
      <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Play />} Generar y validar</Button>
    </form>
  );
}

export function SubmitRips({ id, disabled }: { id: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button disabled={disabled || pending} onClick={() => startTransition(async () => {
      const res = await submitRipsAction(id);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(res.message); router.refresh();
    })}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Enviar</Button>
  );
}

export function DownloadJson({ filename, json }: { filename: string; json: unknown }) {
  return (
    <Button variant="outline" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(json, (k, v) => (k === "_recordId" ? undefined : v), 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    }}><Download /> Descargar JSON</Button>
  );
}

export function RipsConfigForm({ config }: { config: { providerCode: string | null; municipalityCode: string; consultationCode: string; purposeCode: string; causeCode: string; defaultConsultationValue: number } }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form className="grid gap-3" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const g = (k: string) => String(fd.get(k) ?? "");
      startTransition(async () => {
        const res = await saveRipsConfigAction({ providerCode: g("providerCode"), municipalityCode: g("municipalityCode"), consultationCode: g("consultationCode"),
          purposeCode: g("purposeCode"), causeCode: g("causeCode"), defaultConsultationValue: g("value") });
        if (!res.ok) { toast.error(res.error); return; }
        toast.success(res.message); router.refresh();
      });
    }}>
      <div className="grid grid-cols-2 gap-3">
        <FormField id="providerCode" label="Código REPS" optional><Input id="providerCode" name="providerCode" defaultValue={config.providerCode ?? ""} className="font-mono" /></FormField>
        <FormField id="municipalityCode" label="Municipio (DIVIPOLA)"><Input id="municipalityCode" name="municipalityCode" defaultValue={config.municipalityCode} className="font-mono" /></FormField>
        <FormField id="consultationCode" label="CUPS consulta"><Input id="consultationCode" name="consultationCode" defaultValue={config.consultationCode} className="font-mono" /></FormField>
        <FormField id="value" label="Valor consulta"><Input id="value" name="value" type="number" defaultValue={config.defaultConsultationValue} /></FormField>
        <FormField id="purposeCode" label="Finalidad"><Input id="purposeCode" name="purposeCode" defaultValue={config.purposeCode} className="font-mono" /></FormField>
        <FormField id="causeCode" label="Causa externa"><Input id="causeCode" name="causeCode" defaultValue={config.causeCode} className="font-mono" /></FormField>
      </div>
      <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">{pending && <Loader2 className="animate-spin" />} Guardar configuración</Button>
    </form>
  );
}
