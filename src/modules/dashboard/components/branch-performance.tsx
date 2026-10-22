"use client";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Building2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { switchBranchAction } from "@/modules/tenants/actions";
import { branchColor } from "./charts";

export type BranchRow = { branch_id: string; name: string; net: number; count: number; delta: number | null };

/** Net sales per branch with a proportional bar and the change vs. the comparison period. Click = filter the app to it. */
export function BranchPerformance({ branches, activeBranchId }: { branches: BranchRow[]; activeBranchId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = (id: string | null) =>
    startTransition(async () => {
      const res = await switchBranchAction(id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  const colorOf = new Map([...branches].sort((a, b) => a.name.localeCompare(b.name, "es")).map((b, i) => [b.branch_id, branchColor(i)]));
  const max = Math.max(1, ...branches.map((b) => b.net));

  if (branches.length <= 1) {
    const b = branches[0];
    return b ? (
      <div className="flex items-center gap-3 py-2">
        <div className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><Building2 className="size-5" /></div>
        <div>
          <p className="font-medium">{b.name}</p>
          <p className="text-sm text-muted-foreground tabular">{formatMoney(b.net)} · {b.count} ventas · tu única sede</p>
        </div>
      </div>
    ) : <p className="text-sm text-muted-foreground">Sin sedes activas.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_3.5rem] gap-3 border-b pb-2 text-xs text-muted-foreground">
        <span>Sede</span><span className="sr-only">Proporción</span><span className="text-right">Ventas netas</span><span className="text-right">Var. %</span>
      </div>
      {branches.map((b) => (
        <button key={b.branch_id} type="button" disabled={pending} onClick={() => open(b.branch_id === activeBranchId ? null : b.branch_id)}
          className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_3.5rem] items-center gap-3 rounded-lg px-1 py-2.5 text-left text-sm transition-colors hover:bg-muted/60", b.branch_id === activeBranchId && "bg-muted/60")}>
          <span className="truncate">{b.name}</span>
          <span className="h-2.5 rounded-full bg-muted"><span className="block h-full rounded-full" style={{ width: `${(b.net / max) * 100}%`, background: colorOf.get(b.branch_id) }} /></span>
          <span className="text-right font-medium whitespace-nowrap tabular">{formatMoney(b.net)}</span>
          <span className={cn("inline-flex items-center justify-end gap-0.5 text-xs font-medium tabular", b.delta !== null && b.delta > 0 && "text-success", b.delta !== null && b.delta < 0 && "text-destructive", b.delta === null && "text-muted-foreground")}>
            {b.delta === null ? "—" : <>{b.delta > 0 ? <ArrowUpRight className="size-3.5" /> : b.delta < 0 ? <ArrowDownRight className="size-3.5" /> : null}{Math.abs(b.delta)}%</>}
          </span>
        </button>
      ))}
      <div className="mt-2 flex items-center justify-between text-sm">
        {activeBranchId
          ? <button type="button" onClick={() => open(null)} className="font-medium text-brand hover:underline">Ver todas las sedes</button>
          : <span className="text-xs text-muted-foreground">Toca una sede para ver su detalle</span>}
        {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
          <Link href="/reportes" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">Ver reporte <ArrowRight className="size-3.5" /></Link>
        )}
      </div>
    </div>
  );
}
