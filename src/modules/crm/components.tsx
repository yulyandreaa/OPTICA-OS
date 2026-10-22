"use client";
import { Check, Loader2, MessageCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCompactMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PATIENT_SOURCES } from "@/modules/patients/schemas";
import { completeTaskAction, createLeadAction, createTaskAction, moveLeadAction } from "./actions";

export interface Stage { id: string; name: string; is_won: boolean; is_lost: boolean }
export interface Lead { id: string; stage_id: string; name: string; phone: string | null; source: string; interest: string | null; value: number | null; days: number; assignee: string | null }

const SOURCE_COLOR: Record<string, string> = { instagram: "#d62976", facebook: "#1877f2", google: "#ea4335", whatsapp: "#25d366", referral: "#8b5cf6", web: "#0ea5e9", walk_in: "#64748b", other: "#94a3b8" };

export function Pipeline({ stages, leads }: { stages: Stage[]; leads: Lead[] }) {
  const router = useRouter();
  const [items, move] = useOptimistic(leads, (state, m: { id: string; stage: string }) => state.map((l) => (l.id === m.id ? { ...l, stage_id: m.stage } : l)));
  const [over, setOver] = useState<string | null>(null);

  const drop = (leadId: string, stageId: string) => {
    const lead = items.find((l) => l.id === leadId);
    if (!lead || lead.stage_id === stageId) return;
    const stage = stages.find((s) => s.id === stageId)!;
    startTransition(async () => {
      move({ id: leadId, stage: stageId });
      const res = await moveLeadAction(leadId, stageId);
      if (!res.ok) toast.error(res.error);
      else if (stage.is_won) toast.success(`🎉 ${lead.name} pasó a venta`);
      router.refresh();
    });
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {stages.map((s) => {
        const col = items.filter((l) => l.stage_id === s.id);
        const total = col.reduce((a, l) => a + Number(l.value ?? 0), 0);
        return (
          <section key={s.id} onDragOver={(e) => { e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); drop(e.dataTransfer.getData("text/plain"), s.id); }}
            className={cn("grid w-64 shrink-0 content-start gap-2 rounded-2xl bg-muted/50 p-2 transition", over === s.id && "ring-2 ring-brand/40")}>
            <header className="px-2 pt-1">
              <h2 className={cn("flex items-center gap-2 text-sm font-semibold", s.is_won && "text-success", s.is_lost && "text-muted-foreground")}>
                {s.name}<span className="ml-auto rounded-full bg-surface px-2 text-xs tabular">{col.length}</span>
              </h2>
              <p className="text-[11px] text-muted-foreground tabular">{total ? formatCompactMoney(total) : "—"}</p>
            </header>
            {col.map((l) => (
              <article key={l.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                className="cursor-grab rounded-xl border bg-surface p-3 shadow-soft active:cursor-grabbing">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  {l.phone && <a href={`https://wa.me/${l.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "57$1")}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="text-muted-foreground hover:text-success"><MessageCircle className="size-4" /></a>}
                </div>
                <p className="truncate text-xs text-muted-foreground">{l.interest ?? "—"}</p>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><span className="size-1.5 rounded-full" style={{ background: SOURCE_COLOR[l.source] }} />{PATIENT_SOURCES[l.source as keyof typeof PATIENT_SOURCES] ?? l.source}</span>
                  <span className={cn("tabular", l.days > 7 && !s.is_won && !s.is_lost ? "text-destructive" : "text-muted-foreground")}>{l.days}d{l.value ? ` · ${formatCompactMoney(Number(l.value))}` : ""}</span>
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function NewLeadDialog({ firstStageId }: { firstStageId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><Plus /> Nuevo lead</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Nuevo lead</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const g = (k: string) => String(fd.get(k) ?? "");
          start(async () => {
            const res = await createLeadAction({ name: g("name"), phone: g("phone"), source: g("source") as "instagram", interest: g("interest"), value: g("value") || undefined, stageId: firstStageId });
            if (!res.ok) { toast.error(res.error); return; }
            toast.success(res.message); setOpen(false); router.refresh();
          });
        }}>
          <FormField id="name" label="Nombre"><Input id="name" name="name" required /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="phone" label="Celular" optional><Input id="phone" name="phone" type="tel" /></FormField>
            <FormField id="source" label="Origen"><NativeSelect id="source" name="source" defaultValue="instagram">{Object.entries(PATIENT_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></FormField>
          </div>
          <FormField id="interest" label="Interés" optional><Input id="interest" name="interest" placeholder="Progresivos, gafas de sol…" /></FormField>
          <FormField id="value" label="Valor estimado" optional><Input id="value" name="value" type="number" min={0} /></FormField>
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Crear lead</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaskList({ tasks, members }: { tasks: { id: string; title: string; priority: string; due_at: string | null; assignee: string | null; overdue: boolean; dueLabel: string | null }[]; members: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  return (
    <div className="grid gap-3">
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await createTaskAction({ title, priority: String(fd.get("priority")) as "normal", dueAt: String(fd.get("due") ?? ""), assignedTo: String(fd.get("who") ?? "") || undefined });
          if (!res.ok) { toast.error(res.error); return; }
          setTitle(""); router.refresh();
        });
      }}>
        <Input placeholder="Nueva tarea…" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nueva tarea" />
        <NativeSelect name="priority" aria-label="Prioridad" className="w-28" defaultValue="normal"><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option><option value="low">Baja</option></NativeSelect>
        <Input name="due" type="date" aria-label="Fecha" className="w-36" />
        <NativeSelect name="who" aria-label="Responsable" className="w-36" defaultValue="">{[<option key="me" value="">Yo</option>, ...members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)]}</NativeSelect>
        <Button type="submit" size="icon" disabled={pending || title.trim().length < 3} aria-label="Crear tarea"><Plus /></Button>
      </form>
      <ul className="grid gap-1.5">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
            <button type="button" aria-label="Completar" disabled={pending} onClick={() => start(async () => { const r = await completeTaskAction(t.id); if (!r.ok) toast.error(r.error); router.refresh(); })}
              className="grid size-5 shrink-0 place-items-center rounded-full border hover:border-success hover:bg-success-soft"><Check className="size-3 opacity-0 hover:opacity-100" /></button>
            <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
            {["high", "urgent"].includes(t.priority) && <span className={cn("rounded-full px-1.5 text-[10px] font-medium", t.priority === "urgent" ? "bg-danger-soft text-destructive" : "bg-warning-soft text-[oklch(0.5_0.12_60)]")}>{t.priority === "urgent" ? "Urgente" : "Alta"}</span>}
            <span className={cn("text-xs", t.overdue ? "text-destructive" : "text-muted-foreground")}>{t.dueLabel}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">{t.assignee}</span>
          </li>
        ))}
        {tasks.length === 0 && <li className="text-sm text-muted-foreground">Sin tareas pendientes 🎉</li>}
      </ul>
    </div>
  );
}
