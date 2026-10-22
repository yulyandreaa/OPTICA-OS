import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { cn } from "@/lib/utils";
import { LAB_STATUS, type LabStatus } from "@/modules/labs/constants";
import { listLabOrders } from "@/modules/labs/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Órdenes de laboratorio" };

const COLUMNS: { title: string; statuses: LabStatus[]; accent: string }[] = [
  { title: "Por enviar", statuses: ["pending"], accent: "bg-muted-foreground" },
  { title: "En laboratorio", statuses: ["sent", "accepted", "in_process"], accent: "bg-brand" },
  { title: "Control de calidad", statuses: ["quality_control", "ready"], accent: "bg-warning" },
  { title: "Listas en la óptica", statuses: ["received"], accent: "bg-success" },
  { title: "Entregadas (7 días)", statuses: ["delivered"], accent: "bg-border" },
];

export default async function LabOrdersPage() {
  const ctx = await requirePermission("lab_orders.read");
  await connection();
  const orders = await listLabOrders(await createClient(), ctx.tenant.id, ctx.activeBranchId);
  const now = await nowMs();
  const visible = orders.filter((o) => o.status !== "delivered" || now - new Date(o.updated_at).getTime() < 7 * 86_400_000);
  const late = visible.filter((o) => !["delivered", "received", "cancelled"].includes(o.status) && o.estimated_at && new Date(`${o.estimated_at}T23:59:59`).getTime() < now);

  return (
    <>
      <PageHeader title="Órdenes de laboratorio" description={`${visible.filter((o) => o.status !== "delivered").length} en curso${late.length ? ` · ${late.length} atrasadas` : ""}`} />
      {visible.length === 0 ? <EmptyState icon={FlaskConical} title="Sin órdenes" description="Se crean desde una venta con lentes." /> : (
        <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-5">
          {COLUMNS.map((col) => {
            const items = visible.filter((o) => col.statuses.includes(o.status as LabStatus));
            return (
              <section key={col.title} className="grid min-w-[240px] content-start gap-2 rounded-2xl bg-muted/50 p-2">
                <h2 className="flex items-center gap-2 px-2 pt-1 text-sm font-semibold">
                  <span className={cn("size-2 rounded-full", col.accent)} /> {col.title}
                  <span className="ml-auto rounded-full bg-surface px-2 text-xs tabular">{items.length}</span>
                </h2>
                {items.map((o) => {
                  const isLate = late.includes(o);
                  return (
                    <Link key={o.id} href={`/ordenes/${o.id}`} className="rounded-xl border bg-surface p-3 shadow-soft transition hover:shadow-lift">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{o.number}</span>
                        {isLate && <span className="rounded-full bg-danger-soft px-1.5 text-[10px] font-medium text-destructive">Atrasada</span>}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{o.patient?.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{o.frame_description ?? "Montura propia"} · {o.lens_description ?? "Lentes"}</p>
                      <p className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{LAB_STATUS[o.status as LabStatus].label}</span>
                        {o.estimated_at && o.status !== "delivered" && <span>ETA {formatDate(`${o.estimated_at}T12:00:00Z`, "UTC", { day: "numeric", month: "short" })}</span>}
                      </p>
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
