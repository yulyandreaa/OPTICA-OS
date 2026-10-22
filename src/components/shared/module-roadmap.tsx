import { CheckCircle2, type LucideIcon } from "lucide-react";
import { PageHeader } from "./page-header";
import { StatusBadge } from "./status-badge";

/** Landing for modules scheduled in a later phase: explains what's coming instead of faking data. */
export function ModuleRoadmap({ title, icon: Icon, phase, pitch, features }: {
  title: string; icon: LucideIcon; phase: number; pitch: string; features: string[];
}) {
  return (
    <>
      <PageHeader title={title} actions={<StatusBadge tone="brand" dot={false}>Fase {phase} del roadmap</StatusBadge>} />
      <div className="grid gap-8 rounded-2xl border bg-surface p-8 shadow-soft md:grid-cols-[1fr_1.2fr] md:p-10">
        <div className="space-y-4">
          <div className="grid size-12 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-6" strokeWidth={1.75} /></div>
          <h2 className="text-xl font-semibold tracking-tight text-balance">{pitch}</h2>
          <p className="text-sm text-muted-foreground">
            Este módulo se activa en tu cuenta sin migraciones manuales: usará los mismos pacientes, sedes, permisos y auditoría que ya tienes.
          </p>
        </div>
        <ul className="grid content-start gap-3">
          {features.map((f) => (
            <li key={f} className="flex gap-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{f}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
