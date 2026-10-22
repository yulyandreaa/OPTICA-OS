import { ArrowRight, Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { RetryError } from "@/modules/dashboard/components/retry-error";
import { formatQty, TRANSFER_STATUS, variantLabel } from "@/modules/inventory/constants";
import { TransferActions } from "@/modules/inventory/components/transfer-actions";
import { UrlSelect } from "@/modules/inventory/components/url-select";
import { listTransfers } from "@/modules/inventory/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Traslados" };

const STATUS_FILTERS = [
  { key: "", label: "Todos los estados" }, { key: "in_transit", label: "En tránsito" }, { key: "received", label: "Recibidos" },
  { key: "cancelled", label: "Cancelados" }, { key: "requested", label: "Por enviar" },
] as const;

export default async function TransfersPage(props: PageProps<"/inventario/traslados">) {
  const ctx = await requirePermission("inventory.read");
  const sp = await props.searchParams;
  const status = STATUS_FILTERS.find((s) => s.key && s.key === sp.estado)?.key;
  const db = await createClient();
  let transfers;
  try {
    transfers = await listTransfers(db, ctx.tenant.id, { status, branchId: ctx.activeBranchId });
  } catch {
    return <RetryError message="No pudimos cargar los traslados." />;
  }
  const canTransfer = can(ctx.grants, "inventory.transfer") && ctx.branches.length > 1;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader eyebrow={<Link href="/inventario" className="hover:text-foreground">Inventario</Link>} title="Traslados entre sedes"
        description="Las unidades salen del origen al enviar, quedan en tránsito y entran al destino cuando allí las reciben."
        actions={canTransfer && <Link href="/inventario/traslados/nuevo" className={buttonVariants()}><Plus /> Nuevo traslado</Link>} />
      <section className="min-w-0 rounded-2xl border bg-surface shadow-soft">
        <div className="border-b p-4"><UrlSelect param="estado" label="Estado" options={STATUS_FILTERS} className="h-8 w-48" /></div>
        {transfers.length === 0 ? (
          <EmptyState compact icon={Truck} title={status ? "No hay traslados con este estado" : "Aún no hay traslados"}
            description={ctx.branches.length > 1 ? "Mueve mercancía entre tus sedes sin que cambie el total de la empresa." : "Los traslados se usan cuando tienes más de una sede."}
            action={canTransfer && !status && <Link href="/inventario/traslados/nuevo" className={buttonVariants({ variant: "outline", size: "sm" })}>Crear el primer traslado</Link>} />
        ) : (
          <ul className="divide-y">
            {transfers.map((t) => {
              const s = TRANSFER_STATUS[t.status] ?? TRANSFER_STATUS.requested!;
              const units = t.items.reduce((a, i) => a + Number(i.quantity), 0);
              const open = t.status === "in_transit" || t.status === "requested" || t.status === "approved";
              return (
                <li key={t.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs">{t.number}</span>
                      <span className="inline-flex items-center gap-1 font-medium">{t.from?.name} <ArrowRight className="size-3.5 text-muted-foreground" /> {t.to?.name}</span>
                      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {t.items.map((i) => `${formatQty(i.quantity)}× ${i.variant?.product?.name ?? ""}${variantLabel(i.variant ?? {}) ? ` (${variantLabel(i.variant ?? {})})` : ""}`).join(", ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatQty(units)} {units === 1 ? "unidad" : "unidades"} · creado el {formatDate(t.created_at, ctx.timezone)}
                      {t.received_at && ` · recibido el ${formatDate(t.received_at, ctx.timezone)}`}
                      {t.cancelled_at && ` · cancelado el ${formatDate(t.cancelled_at, ctx.timezone)}${t.cancel_reason ? `: ${t.cancel_reason}` : ""}`}
                      {t.notes && ` · ${t.notes}`}
                    </p>
                  </div>
                  {open && (
                    <TransferActions id={t.id} number={t.number}
                      canSend={t.status !== "in_transit" && can(ctx.grants, "inventory.transfer", t.from_branch_id)}
                      canReceive={t.status === "in_transit" && can(ctx.grants, "inventory.transfer", t.to_branch_id)}
                      canCancel={can(ctx.grants, "inventory.transfer", t.from_branch_id)} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
