import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Accent per indicator (validated data-viz slots): icon tile + a faint wash on the card. */
export const TONES = {
  blue: { tile: "bg-series-1/12 text-series-1", wash: "from-series-1/[0.06]" },
  green: { tile: "bg-series-3/14 text-series-3", wash: "from-series-3/[0.07]" },
  violet: { tile: "bg-series-7/12 text-series-7", wash: "from-series-7/[0.06]" },
  orange: { tile: "bg-series-2/12 text-series-2", wash: "from-series-2/[0.07]" },
  red: { tile: "bg-destructive/10 text-destructive", wash: "from-destructive/[0.06]" },
} as const;
export type Tone = keyof typeof TONES;

/** KPI card: tinted icon, label, value, optional change vs. a previous period and a one-line note. */
export function Kpi({ icon: Icon, tone, label, value, delta, unit = "%", invert, note }: {
  icon: LucideIcon; tone: Tone; label: string; value: string; delta?: number | null; unit?: string; invert?: boolean; note: string;
}) {
  const good = delta != null && (invert ? delta < 0 : delta > 0);
  const bad = delta != null && (invert ? delta > 0 : delta < 0);
  return (
    <div className={cn("flex gap-4 rounded-2xl border bg-gradient-to-br to-surface p-5 shadow-soft", TONES[tone].wash)}>
      <span className={cn("grid size-12 shrink-0 place-items-center rounded-xl", TONES[tone].tile)}><Icon className="size-6" strokeWidth={2} /></span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-2xl font-semibold tracking-tight tabular">{value}</p>
        {delta !== null && delta !== undefined && (
          <p className={cn("mt-1 inline-flex items-center gap-0.5 text-sm font-medium tabular", good && "text-success", bad && "text-destructive", delta === 0 && "text-muted-foreground")}>
            {delta > 0 ? <ArrowUpRight className="size-4" /> : delta < 0 ? <ArrowDownRight className="size-4" /> : null}
            {delta > 0 ? "+" : ""}{delta}{unit}
          </p>
        )}
        <p className="truncate text-xs text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}
