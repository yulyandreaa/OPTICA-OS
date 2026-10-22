import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({ label, value, delta, hint, invertDelta, className }: {
  label: string; value: ReactNode; delta?: number | null; hint?: ReactNode; invertDelta?: boolean; className?: string;
}) {
  const positive = delta !== null && delta !== undefined && (invertDelta ? delta < 0 : delta > 0);
  const negative = delta !== null && delta !== undefined && (invertDelta ? delta > 0 : delta < 0);
  return (
    <div className={cn("rounded-xl border bg-surface p-4 shadow-soft", className)}>
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {delta !== null && delta !== undefined && (
          <span className={cn("inline-flex items-center font-medium tabular", positive && "text-success", negative && "text-destructive")}>
            {delta > 0 ? <ArrowUpRight className="size-3.5" /> : delta < 0 ? <ArrowDownRight className="size-3.5" /> : null}
            {delta > 0 ? "+" : ""}{delta}%
          </span>
        )}
        {hint && <span className="truncate">{hint}</span>}
      </div>
    </div>
  );
}
