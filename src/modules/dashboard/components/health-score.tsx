import { Activity } from "lucide-react";
import { Panel } from "@/components/shared/panel";
import type { healthScore } from "../services/metrics";

export function HealthScoreCard({ health }: { health: ReturnType<typeof healthScore> }) {
  if (!health) {
    return (
      <Panel title="Salud del negocio" action={<Activity className="size-4 text-muted-foreground" />}>
        <p className="text-sm text-muted-foreground">Necesitamos unas semanas de actividad para calcular tu puntaje. No inventamos datos.</p>
      </Panel>
    );
  }
  const { score, parts } = health;
  const tone = score >= 75 ? "var(--success)" : score >= 55 ? "var(--warning)" : "var(--destructive)";
  const headline = score >= 75 ? "Tu negocio va por buen camino." : score >= 55 ? "Hay oportunidades claras de mejora." : "Requiere atención esta semana.";
  const worst = [...parts].sort((a, b) => a.score - b.score)[0];
  const circumference = 2 * Math.PI * 34;
  return (
    <Panel title="Salud del negocio" action={<Activity className="size-4 text-muted-foreground" />}>
      <div className="flex items-center gap-4">
        <div className="relative size-20 shrink-0">
          <svg viewBox="0 0 80 80" className="size-20 -rotate-90">
            <circle cx="40" cy="40" r="34" fill="none" strokeWidth="7" className="stroke-muted" />
            <circle cx="40" cy="40" r="34" fill="none" strokeWidth="7" strokeLinecap="round" stroke={tone}
              strokeDasharray={circumference} strokeDashoffset={circumference * (1 - score / 100)} />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-xl font-semibold tabular">{score}</span>
        </div>
        <div className="min-w-0 text-sm">
          <p className="font-medium">{headline}</p>
          {worst && <p className="mt-1 text-muted-foreground">Oportunidad: {worst.insight.charAt(0).toLowerCase() + worst.insight.slice(1)}.</p>}
        </div>
      </div>
      <ul className="mt-4 grid gap-2">
        {parts.map((p) => (
          <li key={p.label} className="grid grid-cols-[96px_1fr_28px] items-center gap-2 text-xs">
            <span className="text-muted-foreground">{p.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-brand" style={{ width: `${p.score}%` }} /></span>
            <span className="text-right tabular">{p.score}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
