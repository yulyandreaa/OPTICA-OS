import { AlertTriangle, Boxes, CalendarClock, PackageOpen, PackagePlus, PackageX, Plus, SearchX, Tag, Truck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Kpi } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { addDaysKey, formatMoney, localDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import { RetryError } from "@/modules/dashboard/components/retry-error";
import { EXPIRY_WINDOW_DAYS, formatDay, formatQty, UNIT_LABEL, variantLabel, type Unit } from "@/modules/inventory/constants";
import { InventoryFilters } from "@/modules/inventory/components/inventory-filters";
import { InventoryMoreMenu, ProductRowActions } from "@/modules/inventory/components/inventory-menus";
import { ProductThumb, StockBadge } from "@/modules/inventory/components/stock";
import { inventorySummary, listBrands, listCategories, listInventory, type InventoryRow, type InventorySummary } from "@/modules/inventory/repositories";
import { LIST_PAGE_SIZE, parseListParams, type ListParams } from "@/modules/inventory/schemas";
import { requirePermission, type AppContext } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Inventario" };

export default async function InventoryPage(props: PageProps<"/inventario">) {
  const ctx = await requirePermission("inventory.read");
  const params = parseListParams(await props.searchParams);
  const canManage = can(ctx.grants, "inventory.manage");

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Inventario" description="Controla tus productos, existencias y movimientos"
        actions={<>
          <InventoryMoreMenu canAdjust={can(ctx.grants, "inventory.adjust")} canTransfer={can(ctx.grants, "inventory.transfer") && ctx.branches.length > 1} />
          {canManage && <Link href="/inventario/nuevo" className={buttonVariants()}><Plus /> Nuevo producto</Link>}
        </>} />
      <Suspense key={`${ctx.activeBranchId}`} fallback={<SummarySkeleton />}>
        <Summary ctx={ctx} />
      </Suspense>
      <Suspense key={`${ctx.activeBranchId}:${JSON.stringify(params)}`} fallback={<Skeleton className="h-[480px] rounded-2xl" />}>
        <ProductList ctx={ctx} params={params} canManage={canManage} />
      </Suspense>
    </div>
  );
}

async function Summary({ ctx }: { ctx: AppContext }) {
  const db = await createClient();
  let s: InventorySummary;
  try {
    s = await inventorySummary(db, ctx.tenant.id, ctx.activeBranchId);
  } catch {
    return <RetryError message="No pudimos cargar el resumen del inventario." />;
  }
  const scope = ctx.activeBranchId ? `en ${ctx.branches.find((b) => b.id === ctx.activeBranchId)?.name}` : ctx.branches.length > 1 ? "en todas las sedes" : "en la sede";
  const valueNote = !s.can_see_costs ? "Requiere permiso para ver costos"
    : s.uncosted ? `${s.uncosted} ${s.uncosted === 1 ? "referencia" : "referencias"} con stock sin costo, no incluidas`
    : "Al costo promedio ponderado";

  const alerts = [
    { show: s.out > 0, icon: PackageX, tone: "text-destructive bg-destructive/10", text: `${s.out} ${s.out === 1 ? "referencia agotada" : "referencias agotadas"}`, href: "/inventario?disponibilidad=out" },
    { show: s.low > 0, icon: AlertTriangle, tone: "text-[oklch(0.5_0.12_60)] bg-warning-soft", text: `${s.low} con stock bajo`, href: "/inventario?disponibilidad=low" },
    { show: s.expired > 0, icon: CalendarClock, tone: "text-destructive bg-destructive/10", text: `${s.expired} ${s.expired === 1 ? "lote vencido" : "lotes vencidos"} con unidades`, href: "#lotes" },
    { show: s.expiring > 0, icon: CalendarClock, tone: "text-[oklch(0.5_0.12_60)] bg-warning-soft", text: `${s.expiring} ${s.expiring === 1 ? "lote vence" : "lotes vencen"} en ${EXPIRY_WINDOW_DAYS} días`, href: "#lotes" },
    { show: s.transfers_in_transit > 0, icon: Truck, tone: "text-brand bg-brand-soft", text: `${s.transfers_in_transit} ${s.transfers_in_transit === 1 ? "traslado" : "traslados"} en tránsito`, href: "/inventario/traslados?estado=in_transit" },
  ].filter((a) => a.show);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Tag} tone="blue" label="Referencias activas" value={s.active_refs.toLocaleString("es-CO")}
          note={`${s.stocked_refs.toLocaleString("es-CO")} con control de existencias`} />
        <Kpi icon={Boxes} tone="green" label="Unidades en stock" value={formatQty(s.units)}
          note={s.in_transit > 0 ? `${scope} · ${formatQty(s.in_transit)} en tránsito` : scope} />
        <Kpi icon={AlertTriangle} tone="orange" label="Stock bajo" value={s.low.toLocaleString("es-CO")}
          note={s.out > 0 ? `y ${s.out} ${s.out === 1 ? "agotada" : "agotadas"}` : "En o por debajo del mínimo"} />
        <Kpi icon={Wallet} tone="violet" label="Valor del inventario" value={s.value === null ? "—" : formatMoney(s.value)} note={valueNote} />
      </div>
      {alerts.length > 0 && (
        <nav aria-label="Alertas de inventario" className="flex flex-wrap gap-2">
          {alerts.map((a) => (
            <Link key={a.text} href={a.href} className="inline-flex items-center gap-2 rounded-full border bg-surface py-1 pr-3 pl-1 text-sm shadow-soft hover:bg-muted">
              <span className={cn("grid size-6 place-items-center rounded-full", a.tone)}><a.icon className="size-3.5" /></span>{a.text}
            </Link>
          ))}
        </nav>
      )}
      {(s.expired > 0 || s.expiring > 0) && <ExpiringLots ctx={ctx} />}
    </>
  );
}

/** Lots with units that are expired or expire inside the window, soonest first. Only real, registered expiry dates. */
async function ExpiringLots({ ctx }: { ctx: AppContext }) {
  const db = await createClient();
  const today = localDateKey(new Date(), ctx.timezone);
  const limit = addDaysKey(today, EXPIRY_WINDOW_DAYS);
  let q = db.from("inventory_lots")
    .select("id, lot_code, expires_on, quantity, branch:branches(name), variant:product_variants(color_name, attributes, product:products(id, name))")
    .eq("tenant_id", ctx.tenant.id).gt("quantity", 0).lte("expires_on", limit).order("expires_on").limit(8);
  if (ctx.activeBranchId) q = q.eq("branch_id", ctx.activeBranchId);
  const { data } = await q;
  if (!data?.length) return null;
  return (
    <section id="lotes" className="rounded-2xl border bg-surface shadow-soft">
      <h2 className="border-b px-4 py-3 text-sm font-semibold">Lotes vencidos o por vencer</h2>
      <ul className="divide-y text-sm">
        {data.map((l) => {
          const expired = l.expires_on! < today;
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <Link href={`/inventario/${l.variant?.product?.id}?tab=lotes`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">
                {l.variant?.product?.name}{variantLabel(l.variant ?? {}) ? ` · ${variantLabel(l.variant ?? {})}` : ""}
              </Link>
              <span className="font-mono text-xs text-muted-foreground">Lote {l.lot_code}</span>
              <span className="text-muted-foreground">{l.branch?.name}</span>
              <span className="tabular">{formatQty(l.quantity)} u.</span>
              <span className={cn("text-xs font-medium", expired ? "text-destructive" : "text-[oklch(0.5_0.12_60)]")}>
                {expired ? "Venció" : "Vence"} el {formatDay(l.expires_on!)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function ProductList({ ctx, params, canManage }: { ctx: AppContext; params: ListParams; canManage: boolean }) {
  const db = await createClient();
  let list, categories, brands;
  try {
    [list, categories, brands] = await Promise.all([listInventory(db, ctx.tenant.id, ctx.activeBranchId, params), listCategories(db, ctx.tenant.id), listBrands(db, ctx.tenant.id)]);
  } catch {
    return <RetryError message="No pudimos cargar los productos." />;
  }
  const { rows, total } = list;
  const filtered = !!(params.q || params.categoria || params.marca || params.estado !== "activos" || params.disponibilidad !== "todas");

  if (total === 0 && !filtered) {
    const { count } = await db.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id);
    if (!count) {
      return (
        <div className="rounded-2xl border bg-surface shadow-soft">
          <EmptyState icon={PackagePlus} title="Aún no tienes productos registrados"
            description="Crea tu primer producto: monturas, lentes de contacto, accesorios o servicios. Puedes cargar sus existencias iniciales en el mismo paso."
            action={canManage && <Link href="/inventario/nuevo" className={buttonVariants()}><Plus /> Crear el primer producto</Link>} />
        </div>
      );
    }
  }

  const canCosts = can(ctx.grants, "inventory.costs");
  const canAdjust = can(ctx.grants, "inventory.adjust");
  const showBranches = !ctx.activeBranchId && ctx.branches.length > 1;
  const from = (params.pagina - 1) * LIST_PAGE_SIZE;
  const pageHref = (page: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: params.q, categoria: params.categoria, marca: params.marca,
      estado: params.estado === "activos" ? undefined : params.estado, disponibilidad: params.disponibilidad === "todas" ? undefined : params.disponibilidad,
      pagina: page > 1 ? String(page) : undefined })) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/inventario?${s}` : "/inventario";
  };

  return (
    <section className="min-w-0 rounded-2xl border bg-surface shadow-soft">
      <InventoryFilters categories={categories.filter((c) => c.is_active)} brands={brands} />
      {rows.length === 0 ? (
        <EmptyState compact icon={SearchX} title={params.q ? `Sin resultados para “${params.q}”` : "Ningún producto coincide con los filtros"}
          description="Prueba con el SKU, el código de barras o la marca, o quita algún filtro."
          action={<Link href="/inventario" className={buttonVariants({ variant: "outline", size: "sm" })}>Ver todos los productos</Link>} />
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Producto</th>
                <th className="px-4 py-2.5 font-medium">SKU</th>
                <th className="hidden px-4 py-2.5 font-medium 2xl:table-cell">Marca y modelo</th>
                <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Categoría</th>
                <th className="px-4 py-2.5 text-right font-medium">Existencias</th>
                {canCosts && <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Costo</th>}
                <th className="px-4 py-2.5 text-right font-medium">Precio</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.variant_id} className={cn("hover:bg-muted/40", !r.is_active && "opacity-60")}>
                  <td className="max-w-64 px-4 py-2.5">
                    <Link href={`/inventario/${r.product_id}`} className="flex items-center gap-3 rounded-md outline-none hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/40">
                      <ProductThumb imageUrl={r.image_url} colorHex={r.color_hex} kind={r.category_kind} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.product_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{variantLabel(r) || "Variante única"}{r.brand && <span className="2xl:hidden"> · {r.brand}</span>}{!r.is_active ? " · inactivo" : ""}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">{r.sku}</td>
                  <td className="hidden max-w-44 truncate px-4 py-2.5 2xl:table-cell">{[r.brand, r.model].filter(Boolean).join(" · ") || <span className="text-muted-foreground">—</span>}</td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap text-muted-foreground xl:table-cell">{r.category}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Existences row={r} showBranches={showBranches} />
                  </td>
                  {canCosts && <td className="hidden px-4 py-2.5 text-right whitespace-nowrap tabular lg:table-cell">{r.cost ? formatMoney(r.cost) : <span className="text-muted-foreground">Sin costo</span>}</td>}
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular">{formatMoney(r.price)}</td>
                  <td className="px-4 py-2.5"><StockBadge status={r.stock_status} /></td>
                  <td className="px-2 py-2.5 text-right">
                    <ProductRowActions productId={r.product_id} variantId={r.variant_id} name={r.product_name} canEdit={canManage} canAdjust={canAdjust} stocked={r.is_stocked} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <ul className="divide-y md:hidden">
            {rows.map((r) => (
              <li key={r.variant_id} className={cn("flex items-start gap-3 p-4", !r.is_active && "opacity-60")}>
                <ProductThumb imageUrl={r.image_url} colorHex={r.color_hex} kind={r.category_kind} />
                <div className="min-w-0 flex-1">
                  <Link href={`/inventario/${r.product_id}`} className="block truncate font-medium">{r.product_name}</Link>
                  <p className="truncate text-xs text-muted-foreground">{variantLabel(r) || "Variante única"} · <span className="font-mono">{r.sku}</span></p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <StockBadge status={r.stock_status} />
                    {r.is_stocked && <span className="tabular">{formatQty(r.quantity)} {unitLabel(r.unit, r.quantity)}</span>}
                    <span className="ml-auto tabular">{formatMoney(r.price)}</span>
                  </div>
                </div>
                <ProductRowActions productId={r.product_id} variantId={r.variant_id} name={r.product_name} canEdit={canManage} canAdjust={canAdjust} stocked={r.is_stocked} />
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground tabular">{from + 1}–{from + rows.length} de {total.toLocaleString("es-CO")} referencias</span>
            <div className="flex gap-2">
              {params.pagina > 1 && <Link href={pageHref(params.pagina - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>← Anterior</Link>}
              {from + rows.length < total && <Link href={pageHref(params.pagina + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Siguiente →</Link>}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function unitLabel(unit: string, qty: number | null) {
  const u = UNIT_LABEL[unit as Unit]?.toLowerCase() ?? unit;
  return Number(qty) === 1 ? u : u === "unidad" ? "unidades" : u === "blíster" ? "blísteres" : `${u}s`;
}

/** Total for the branches in view; with "all branches", a per-branch breakdown (never a global figure attributed to one branch). */
function Existences({ row, showBranches }: { row: InventoryRow; showBranches: boolean }) {
  if (!row.is_stocked) return <span className="text-xs text-muted-foreground">No aplica</span>;
  return (
    <div className="grid justify-items-end gap-0.5">
      <span className="font-medium whitespace-nowrap tabular">{formatQty(row.quantity)} <span className="text-xs font-normal text-muted-foreground">{unitLabel(row.unit, row.quantity)}</span></span>
      {showBranches && (
        <span className="max-w-56 truncate text-xs text-muted-foreground" title={row.branches.map((b) => `${b.name}: ${formatQty(b.quantity)}`).join(" · ")}>
          {row.branches.map((b) => `${b.name} ${formatQty(b.quantity)}`).join(" · ")}
        </span>
      )}
      {Number(row.in_transit) > 0 && <span className="inline-flex items-center gap-1 text-xs text-brand"><Truck className="size-3" />{formatQty(row.in_transit)} en tránsito</span>}
      {row.next_expiry && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><PackageOpen className="size-3" />vence {formatDay(row.next_expiry)}</span>}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Cargando resumen">
      {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[100px] rounded-2xl" />)}
    </div>
  );
}
