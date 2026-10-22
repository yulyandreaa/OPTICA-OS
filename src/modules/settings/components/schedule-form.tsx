"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveScheduleAction } from "../actions";

const DAYS = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"]] as const;

export function ScheduleForm({ members, branches }: { members: { id: string; name: string }[]; branches: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);

  return (
    <form
      className="grid gap-4 rounded-xl border bg-surface p-5 shadow-soft"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const get = (k: string) => String(fd.get(k) ?? "");
        startTransition(async () => {
          const res = await saveScheduleAction({
            userId: get("userId"), branchId: get("branchId"), weekdays: days, start: get("start"), end: get("end"),
            breakStart: get("breakStart"), breakEnd: get("breakEnd"), slotMinutes: get("slotMinutes"),
          });
          if (!res.ok) { toast.error(res.error); return; }
          toast.success(res.message);
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="userId" label="Especialista">
          <NativeSelect id="userId" name="userId">{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect>
        </FormField>
        <FormField id="branchId" label="Sede">
          <NativeSelect id="branchId" name="branchId">{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect>
        </FormField>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="text-[13px] font-medium text-foreground/80">Días de atención</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map(([d, label]) => (
            <button key={d} type="button" aria-pressed={days.includes(d)}
              onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
              className={cn("h-8 w-12 rounded-lg border text-sm transition-colors", days.includes(d) ? "border-brand bg-brand-soft font-medium text-brand" : "text-muted-foreground hover:bg-muted")}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <FormField id="start" label="Desde"><Input id="start" name="start" type="time" defaultValue="08:00" /></FormField>
        <FormField id="end" label="Hasta"><Input id="end" name="end" type="time" defaultValue="18:00" /></FormField>
        <FormField id="breakStart" label="Almuerzo desde" optional><Input id="breakStart" name="breakStart" type="time" defaultValue="12:30" /></FormField>
        <FormField id="breakEnd" label="Hasta" optional><Input id="breakEnd" name="breakEnd" type="time" defaultValue="13:30" /></FormField>
        <FormField id="slotMinutes" label="Intervalo">
          <NativeSelect id="slotMinutes" name="slotMinutes" defaultValue="30">
            {[15, 20, 30, 40, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </NativeSelect>
        </FormField>
      </div>
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Guardar horario</Button></div>
    </form>
  );
}
