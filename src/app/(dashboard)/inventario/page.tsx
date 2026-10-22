import { AlertTriangle, Boxes } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import { LiveShowcase } from "@/modules/inventory/components/live-showcase";
import { AdjustStockDialog, TransferDialog, TransferStep } from "@/modules/inventory/components/stock-actions";
import { listTransfers, recentMovements, showcaseCatalog, stockOverview } from "@/modules/inventory/repositories";
import { PatientSearch } from "@/modules/patients/components/patient-search";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Inventario" };

const TABS = [{ k: "vitrina", l: "Vitrina" }, { k: "stock", l: "Stock" }, { k: "movimientos", l: "Movimientos" }, { k: "traslados", l: "Traslados" }] as const;
const MOVEMENT_LABEL: Record<string, string> = { initial: "Inventario inicial", purchase: "Compra", sale: "Venta", return: "Devolución", adjustment: "Ajuste", transfer_out: "Traslado (salida)", transfer_in: "Traslado (entrada)", damage: "Daño", loss: "Pérdida" };
const TRANSFER_LABEL: Record<string, string> = { requested: "Solicitado", approved: "Aprobado", in_transit: "En tránsito", received: "Recibido", cancelled: "Cancelado" };

export default async function InventoryPage(props: PageProps<"/inventario">) {
  const ctx = await requirePermission("inventory.read");
  const sp = await props.searchParams;
  const tab = TABS.find((t) => t.k === sp.tab)?.k ?? "vitrina";
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const filter = sp.filtro === "bajo" || sp.filtro === "agotado" ? sp.filtro : undefined;
  const db = await createClient();
  const branchId = ctx.activeBranchId;
  const branchName = ctx.branches.find((b) => b.id === branchId)?.name ?? "Todas las sedes";

  return (
    <>
      <PageHeader title="Inventario" description={`${branchName} · el stock solo cambia con movimientos auditados.`} />
      <nav className="mb-4 flex w-fit gap-1 rounded-lg bg-muted p-1">
        {TABS.map((t) => <Link key={t.k} href={t.k === "vitrina" ? "/inventario" : `/inventario?tab=${t.k}`} className={cn("rounded-md px-3 py-1 text-sm", tab === t.k ? "bg-surface font-medium shadow-soft" : "text-muted-foreground hover:text-foreground")}>{t.l}</Link>)}
      </nav>
      {tab === "vitrina" && <VitrinaTab tenantId={ctx.tenant.id} db={db} />}
      {tab === "stock" && <StockTab ctx={ctx} db={db} branchId={branchId} q={q} filter={filter} />}
      {tab === "movimientos" && <MovementsTab ctx={ctx} db={db} branchId={branchId} />}
      {tab === "traslados" && <TransfersTab ctx={ctx} db={db} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requirePermission>>;
type Db = Awaited<ReturnType<typeof createClient>>;

async function VitrinaTab({ tenantId, db }: { tenantId: string; db: Db }) {
  const { catalog, skuToVariant } = await showcaseCatalog(db, tenantId);
  if (catalog.length === 0) return <EmptyState icon={Boxes} title="Tu vitrina está vacía" description="Marca productos con fotos como “vitrina” para mostrarlos aquí." />;
  return <LiveShowcase catalog={catalog} skuToVariant={skuToVariant} />;
}

async function StockTab({ ctx, db, branchId, q, filter }: { ctx: Ctx; db: Db; branchId: string | null; q?: string; filter?: "bajo" | "agotado" }) {
  const all = await stockOverview(db, ctx.tenant.id, branchId, q);
  // Same definitions as the dashboard alerts: out of stock = 0 units; low = above 0 but at or under the minimum.
  const rows = filter === "agotado" ? all.filter((r) => Number(r.quantity ?? 0) <= 0)
    : filter === "bajo" ? all.filter((r) => r.is_low && Number(r.quantity ?? 0) > 0) : all;
  const units = all.reduce((a, r) => a + Number(r.quantity ?? 0), 0);
  const value = all.reduce((a, r) => a + Number(r.quantity ?? 0) * Number(r.cost ?? 0), 0);
  const low = all.filter((r) => r.is_low);
  const canAdjust = can(ctx.grants, "inventory.adjust");
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Unidades" value={units.toLocaleString("es-CO")} hint={`${all.length} referencias`} />
        <StatCard label="Valor al costo" value={formatMoney(value)} />
        <StatCard label="Stock bajo" value={low.length} hint="referencias en mínimo" />
      </div>
      <PatientSearch placeholder="Producto, SKU o código de barras" label="Buscar productos" />
      {filter && (
        <p className="flex items-center gap-2 text-sm">
          Mostrando solo productos {filter === "agotado" ? "agotados" : "con stock bajo"} ({rows.length}).
          <Link href="/inventario?tab=stock" className="text-muted-foreground underline hover:text-foreground">Ver todos</Link>
        </p>
      )}
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr><th className="px-4 py-2.5 font-medium">Producto</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Categoría</th><th className="hidden px-4 py-2.5 font-medium sm:table-cell">SKU</th>
              <th className="px-4 py-2.5 text-right font-medium">Precio</th><th className="px-4 py-2.5 text-right font-medium">Stock</th><th className="w-10" /></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.variant_id} className="hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="size-8 shrink-0 rounded-lg border bg-cover bg-center" style={{ backgroundImage: r.image_url ? `url(${r.image_url})` : undefined, backgroundColor: r.color_hex ?? "var(--muted)" }} />
                    <span className="min-w-0"><span className="block truncate font-medium">{r.product_name}</span><span className="block truncate text-xs text-muted-foreground">{r.color_name ?? "—"}{r.brand ? ` · ${r.brand}` : ""}</span></span>
                  </div>
                </td>
                <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{r.category}</td>
                <td className="hidden px-4 py-2.5 font-mono text-xs text-muted-foreground sm:table-cell">{r.sku}</td>
                <td className="px-4 py-2.5 text-right tabular">{formatMoney(r.price)}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.is_low ? <StatusBadge tone="danger"><AlertTriangle className="size-3" />{Number(r.quantity)}</StatusBadge> : <span className="font-medium tabular">{Number(r.quantity)}</span>}
                </td>
                <td className="pr-2">{canAdjust && r.variant_id && <AdjustStockDialog variantId={r.variant_id} label={`${r.product_name} ${r.color_name ?? ""}`} branches={ctx.branches} defaultBranchId={branchId ?? ctx.branches[0]!.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function MovementsTab({ ctx, db, branchId }: { ctx: Ctx; db: Db; branchId: string | null }) {
  const rows = await recentMovements(db, ctx.tenant.id, branchId);
  return (
    <Panel bodyClassName="p-0">
      <ul className="divide-y">
        {rows.map((m) => (
          <li key={m.id} className="flex items-center gap-4 px-4 py-2.5 text-sm">
            <span className={cn("w-12 text-right font-semibold tabular", Number(m.quantity) > 0 ? "text-success" : "text-destructive")}>{Number(m.quantity) > 0 ? "+" : ""}{Number(m.quantity)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate">{m.variant?.product?.name} {m.variant?.color_name ?? ""} <span className="font-mono text-xs text-muted-foreground">{m.variant?.sku}</span></p>
              <p className="truncate text-xs text-muted-foreground">{MOVEMENT_LABEL[m.type] ?? m.type}{m.notes ? ` · ${m.notes}` : ""} · {m.branch?.name}{m.author?.full_name ? ` · ${m.author.full_name}` : ""}</p>
            </div>
            <span className="text-xs text-muted-foreground">{formatDate(m.created_at, ctx.timezone, { day: "numeric", month: "short" })} {formatTime(m.created_at, ctx.timezone)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function TransfersTab({ ctx, db }: { ctx: Ctx; db: Db }) {
  const [transfers, stock] = await Promise.all([listTransfers(db, ctx.tenant.id), stockOverview(db, ctx.tenant.id, ctx.activeBranchId)]);
  return (
    <div className="grid gap-4">
      {can(ctx.grants, "inventory.transfer") && ctx.branches.length > 1 && (
        <div><TransferDialog branches={ctx.branches} fromBranchId={ctx.activeBranchId ?? ctx.branches[0]!.id}
          variants={stock.filter((s) => Number(s.quantity) > 0).map((s) => ({ id: s.variant_id!, label: `${s.product_name} ${s.color_name ?? ""} (${Number(s.quantity)} u.)` }))} /></div>
      )}
      <Panel bodyClassName="p-0">
        {transfers.length === 0 ? <EmptyState icon={Boxes} title="Sin traslados" compact /> : (
          <ul className="divide-y">{transfers.map((t) => (
            <li key={t.id} className="flex items-center gap-4 px-4 py-3 text-sm">
              <span className="font-mono text-xs">{t.number}</span>
              <span className="min-w-0 flex-1 truncate">{t.from?.name} → {t.to?.name} · {t.items.map((i) => `${i.quantity}× ${i.variant?.product?.name}`).join(", ")}</span>
              <StatusBadge tone={t.status === "received" ? "success" : t.status === "cancelled" ? "danger" : "brand"}>{TRANSFER_LABEL[t.status]}</StatusBadge>
              <TransferStep id={t.id} status={t.status} />
            </li>))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
