"use client";
import { Building2, ChevronRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/shared/panel";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { switchBranchAction } from "@/modules/tenants/actions";

type Row = { branch_id: string; name: string; net: number; count: number };

/** Net sales per branch (one hue, proportional bars). Clicking a branch filters the whole app to it. */
export function BranchPerformance({ branches, activeBranchId }: { branches: Row[]; activeBranchId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = (id: string | null) =>
    startTransition(async () => {
      const res = await switchBranchAction(id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });

  if (branches.length <= 1) {
    const b = branches[0];
    return (
      <Panel title="Tu sede" description="Tu empresa tiene una sola sede">
        {b ? (
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand"><Building2 className="size-5" /></div>
            <div><p className="font-medium">{b.name}</p><p className="text-sm text-muted-foreground tabular">{formatMoney(b.net)} · {b.count} ventas</p></div>
          </div>
        ) : <p className="text-sm text-muted-foreground">Sin sedes activas.</p>}
      </Panel>
    );
  }

  const max = Math.max(1, ...branches.map((b) => b.net));
  const total = branches.reduce((acc, b) => acc + b.net, 0);
  return (
    <Panel title="Rendimiento por sede" description="Ventas netas del período · toca una sede para ver su detalle"
      action={activeBranchId ? <button type="button" onClick={() => open(null)} className="text-xs text-muted-foreground hover:text-foreground">Ver todas</button> : pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}>
      {total === 0 ? <p className="text-sm text-muted-foreground">Ninguna sede tiene ventas en el período.</p> : (
        <ul className="grid gap-1">
          {branches.map((b) => (
            <li key={b.branch_id}>
              <button type="button" disabled={pending} onClick={() => open(b.branch_id)}
                className={cn("group grid w-full gap-1 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60", b.branch_id === activeBranchId && "bg-muted/60")}>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{b.name}</span>
                  <span className="flex items-center gap-1 tabular">
                    {formatMoney(b.net)}
                    <span className="text-xs text-muted-foreground">{Math.round((b.net / total) * 100)}%</span>
                    <ChevronRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </span>
                </span>
                <span className="h-2 rounded-full bg-muted"><span className="block h-full rounded-full bg-brand" style={{ width: `${(b.net / max) * 100}%` }} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
