import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { publicEnv } from "@/lib/env";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import { RxTable } from "@/modules/clinical/components/rx-table";
import { LENS_MATERIALS, LENS_TYPES, TREATMENTS } from "@/modules/clinical/constants";
import { OrderActions } from "@/modules/labs/components/order-actions";
import { LAB_FLOW, LAB_STATUS, QC_ITEMS, type LabStatus } from "@/modules/labs/constants";
import { getLabOrder } from "@/modules/labs/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Orden de laboratorio" };

export default async function LabOrderPage(props: PageProps<"/ordenes/[id]">) {
  const { id } = await props.params;
  const ctx = await requirePermission("lab_orders.read");
  const data = await getLabOrder(await createClient(), ctx.tenant.id, id);
  if (!data) notFound();
  const { order: o, events } = data;
  const st = LAB_STATUS[o.status as LabStatus];
  const tz = ctx.timezone;
  const reached = LAB_FLOW.indexOf(o.status as (typeof LAB_FLOW)[number]);
  const m = o.measurements as Record<string, string | number | null>;
  const qc = o.qc_checklist as Record<string, boolean>;

  return (
    <>
      <PageHeader eyebrow={<Link href="/ordenes" className="hover:text-foreground">Órdenes</Link>}
        title={<span className="flex items-center gap-3">{o.patient?.full_name}<StatusBadge tone={st.tone}>{st.label}</StatusBadge></span>}
        description={`${o.number} · ${o.lab?.name ?? "Sin laboratorio"} · ${o.branch?.name}${o.estimated_at ? ` · entrega estimada ${formatDate(`${o.estimated_at}T12:00:00Z`, "UTC")}` : ""}`} />

      <ol className="mb-6 grid grid-cols-4 gap-1 sm:grid-cols-8" aria-label="Progreso">
        {LAB_FLOW.map((s, i) => (
          <li key={s} className="grid gap-1.5">
            <span className={cn("h-1.5 rounded-full", i <= reached ? "bg-brand" : "bg-border")} />
            <span className={cn("text-[11px] leading-tight", i === reached ? "font-medium text-foreground" : "text-muted-foreground")}>{LAB_STATUS[s].label}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-4">
          <Panel title="Trabajo">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Montura</dt><dd>{o.frame_description ?? "Montura propia del paciente"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Lentes</dt><dd>{o.lens_description ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Tipo y material</dt><dd>{LENS_TYPES[o.lens_type as keyof typeof LENS_TYPES] ?? "—"} · {LENS_MATERIALS[o.material as keyof typeof LENS_MATERIALS] ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Tratamientos</dt><dd>{o.treatments.map((t) => TREATMENTS[t as keyof typeof TREATMENTS] ?? t).join(", ") || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Medidas</dt><dd className="tabular">DP {m.dp ?? "—"}{m.height_od ? ` · Alt. OD ${m.height_od} / OI ${m.height_oi}` : ""}</dd></div>
              {o.sale && <div><dt className="text-xs text-muted-foreground">Venta</dt><dd><Link href={`/ventas/${o.sale.id}`} className="font-mono hover:underline">{o.sale.number}</Link>{Number(o.sale.balance) > 0 && <span className="ml-2 text-xs text-[oklch(0.5_0.12_60)]">Saldo {formatMoney(o.sale.balance)}</span>}</dd></div>}
            </dl>
          </Panel>
          {o.prescription && <Panel title={`Fórmula ${o.prescription.number}`}><RxTable rx={o.prescription} /></Panel>}
          {o.qc_approved_at && (
            <Panel title="Control de calidad aprobado" description={`${formatDate(o.qc_approved_at, tz)} · ${formatTime(o.qc_approved_at, tz)}`}>
              <ul className="grid gap-1 text-sm">{QC_ITEMS.map((q) => <li key={q.key} className={qc[q.key] ? "text-foreground" : "text-destructive"}>{qc[q.key] ? "✓" : "✗"} {q.label}</li>)}</ul>
            </Panel>
          )}
        </div>
        <div className="grid content-start gap-4">
          {can(ctx.grants, "lab_orders.update") && (
            <Panel title="Siguiente paso">
              <OrderActions orderId={o.id} status={o.status} canQc={can(ctx.grants, "lab_orders.qc", o.branch_id)}
                trackingUrl={`${publicEnv().NEXT_PUBLIC_APP_URL}/track/${o.tracking_token}`} phone={o.patient?.whatsapp ?? o.patient?.phone ?? null}
                firstName={o.patient?.full_name.split(" ")[0] ?? ""} branch={o.branch?.name ?? ""} />
            </Panel>
          )}
          <Panel title="Línea de tiempo">
            <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
              {events.map((e) => (
                <li key={e.id} className="relative pl-6">
                  <span className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-surface bg-brand ring-1 ring-border" />
                  <p className="text-sm">{e.note ?? LAB_STATUS[e.status as LabStatus]?.label ?? e.status}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(e.created_at, tz, { weekday: "short", day: "numeric", month: "short" })} · {formatTime(e.created_at, tz)}{e.actor?.full_name ? ` · ${e.actor.full_name}` : ""}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
