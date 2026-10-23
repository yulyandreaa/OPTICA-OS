import { ArrowLeftRight, CalendarClock, Pencil, PlusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { addDaysKey, formatDate, formatMoney, localDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import {
  EXPIRY_WINDOW_DAYS, formatDay, formatQty, KIND_LABEL, PRODUCT_FIELDS, TAX_RATES, UNIT_LABEL, VARIANT_FIELDS, variantLabel, type Unit,
} from "@/modules/inventory/constants";
import { MinStockEditor } from "@/modules/inventory/components/min-stock-editor";
import { MovementTable } from "@/modules/inventory/components/movement-table";
import { ProductDelete } from "@/modules/inventory/components/product-delete";
import { ProductThumb, StockBadge } from "@/modules/inventory/components/stock";
import { getProduct, movementHistory, type ProductDetail } from "@/modules/inventory/repositories";
import { requirePermission, type AppContext } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Producto" };

const TABS = [
  { key: "general", label: "Información general" },
  { key: "variantes", label: "Variantes" },
  { key: "existencias", label: "Existencias por sede", stocked: true },
  { key: "precios", label: "Costos y precios" },
  { key: "movimientos", label: "Movimientos", stocked: true },
  { key: "lotes", label: "Lotes y vencimientos", lots: true },
] as const;

export default async function ProductPage(props: PageProps<"/inventario/[id]">) {
  const ctx = await requirePermission("inventory.read");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const db = await createClient();
  const product = await getProduct(db, ctx.tenant.id, id).catch(() => null);
  if (!product) notFound();

  const tabs = TABS.filter((t) => (!("stocked" in t) || product.is_stocked) && (!("lots" in t) || product.track_lots || product.lots.length > 0));
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "general";
  const href = (key: string) => (key === "general" ? `/inventario/${id}` : `/inventario/${id}?tab=${key}`);
  const first = product.variants.find((v) => v.image_url) ?? product.variants[0];
  const total = product.levels.reduce((a, l) => a + Number(l.quantity), 0);
  const canAdjust = can(ctx.grants, "inventory.adjust");
  const canManage = can(ctx.grants, "inventory.manage");
  const hasHistory = canManage ? (await db.rpc("product_has_history", { p_tenant: ctx.tenant.id, p_product: id })).data ?? true : true;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <ProductThumb imageUrl={first?.image_url} colorHex={first?.color_hex} kind={product.category.kind} className="size-14" />
          <div className="min-w-0">
            <Link href="/inventario" className="text-xs text-muted-foreground hover:text-foreground">Inventario</Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{product.name}</h1>
              {!product.is_active && <StatusBadge tone="neutral">Inactivo</StatusBadge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {[product.category.name, product.brand?.name, product.model].filter(Boolean).join(" · ")}
              {product.is_stocked && <> · <span className="tabular">{formatQty(total)}</span> {UNIT_LABEL[product.unit as Unit]?.toLowerCase()}{total === 1 ? "" : "s"} en tus sedes</>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && <Link href={`/inventario/${id}/editar`} className={buttonVariants({ variant: "outline" })}><Pencil /> Editar</Link>}
          {canManage && <ProductDelete id={id} name={product.name} hasHistory={hasHistory} isActive={product.is_active} />}
          {product.is_stocked && can(ctx.grants, "inventory.transfer") && ctx.branches.length > 1 && (
            <Link href={`/inventario/traslados/nuevo?variante=${product.variants[0]?.id}`} className={buttonVariants({ variant: "outline" })}><ArrowLeftRight /> Trasladar</Link>
          )}
          {product.is_stocked && canAdjust && (
            <Link href={`/inventario/movimientos/nuevo?variante=${product.variants[0]?.id}`} className={buttonVariants()}><PlusCircle /> Registrar movimiento</Link>
          )}
        </div>
      </div>

      <nav className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0" aria-label="Secciones del producto">
        <ul className="flex min-w-max gap-1">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link href={href(t.key)} aria-current={tab === t.key ? "page" : undefined}
                className={cn("inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
                  tab === t.key ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
                {t.key === "variantes" && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular">{product.variants.length}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "general" && <General product={product} ctx={ctx} />}
      {tab === "variantes" && <Variants product={product} />}
      {tab === "existencias" && <Stock product={product} ctx={ctx} canAdjust={canAdjust} />}
      {tab === "precios" && <Prices product={product} canCosts={can(ctx.grants, "inventory.costs")} />}
      {tab === "movimientos" && <Movements product={product} ctx={ctx} />}
      {tab === "lotes" && <Lots product={product} ctx={ctx} />}
    </div>
  );
}

function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-2xl border bg-surface shadow-soft", className)}>
      {title && <h2 className="border-b px-4 py-3 text-sm font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 text-sm">{v || <span className="text-muted-foreground">—</span>}</dd></div>
      ))}
    </dl>
  );
}

function General({ product, ctx }: { product: ProductDetail; ctx: AppContext }) {
  const attrs = (product.attributes ?? {}) as Record<string, unknown>;
  const specific = PRODUCT_FIELDS[product.category.kind].map((f): [string, React.ReactNode] => {
    const v = attrs[f.key];
    return [f.label, Array.isArray(v) ? v.join(", ") : (v as string | undefined)];
  });
  return (
    <div className="grid grid-cols-1 gap-6">
      <Card title="Información general">
        <Facts items={[
          ["Categoría", product.category.name === KIND_LABEL[product.category.kind] ? product.category.name : `${product.category.name} (${KIND_LABEL[product.category.kind]})`], ["Marca", product.brand?.name], ["Modelo o referencia", product.model],
          [product.category.kind === "ophthalmic_lens" ? "Familia" : "Colección", product.collection], ...specific,
          ["Control de existencias", product.is_stocked ? `Sí · por ${UNIT_LABEL[product.unit as Unit]?.toLowerCase()}` : "No (servicio o fabricación por orden)"],
          ...(product.is_stocked ? [["Stock mínimo por sede", formatQty(product.default_min_stock)] as [string, React.ReactNode], ["Lote y vencimiento", product.track_lots ? "Sí" : "No"] as [string, React.ReactNode]] : []),
          ["Estado", product.is_active ? "Activo" : "Inactivo"],
          ["Creado", formatDate(product.created_at, ctx.timezone)], ["Última modificación", formatDate(product.updated_at, ctx.timezone)],
        ]} />
        {product.description && <p className="border-t px-4 py-3 text-sm whitespace-pre-line text-muted-foreground">{product.description}</p>}
      </Card>
    </div>
  );
}

function Variants({ product }: { product: ProductDetail }) {
  const fields = VARIANT_FIELDS[product.category.kind];
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Variante</th><th className="px-4 py-2.5 font-medium">SKU</th><th className="px-4 py-2.5 font-medium">Código de barras</th>
              {fields.map((f) => <th key={f.key} className="hidden px-4 py-2.5 font-medium lg:table-cell">{f.label}</th>)}
              <th className="px-4 py-2.5 text-right font-medium">Precio</th><th className="px-4 py-2.5 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {product.variants.map((v, i) => {
              const a = (v.attributes ?? {}) as Record<string, string>;
              return (
                <tr key={v.id} className={cn(!v.is_active && "opacity-60")}>
                  <td className="px-4 py-2.5"><span className="flex items-center gap-3"><ProductThumb imageUrl={v.image_url} colorHex={v.color_hex} kind={product.category.kind} className="size-8" />{v.color_name || `Variante ${i + 1}`}</span></td>
                  <td className="px-4 py-2.5 font-mono text-xs">{v.sku}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{v.barcode ?? "—"}</td>
                  {fields.map((f) => <td key={f.key} className="hidden px-4 py-2.5 lg:table-cell">{a[f.key] ?? "—"}</td>)}
                  <td className="px-4 py-2.5 text-right tabular">{formatMoney(v.price)}</td>
                  <td className="px-4 py-2.5"><StatusBadge tone={v.is_active ? "success" : "neutral"}>{v.is_active ? "Activa" : "Inactiva"}</StatusBadge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Stock({ product, ctx, canAdjust }: { product: ProductDetail; ctx: AppContext; canAdjust: boolean }) {
  const level = (variant: string, branch: string) => product.levels.find((l) => l.variant_id === variant && l.branch_id === branch);
  const transit = (variant: string, branch: string) => product.inTransit.filter((t) => t.variant_id === variant && t.to_branch_id === branch).reduce((a, t) => a + t.quantity, 0);
  return (
    <div className="grid grid-cols-1 gap-4">
      {ctx.branches.map((b) => {
        const rows = product.variants.map((v) => {
          const l = level(v.id, b.id);
          const qty = Number(l?.quantity ?? 0);
          const min = Number(l?.min_quantity ?? product.default_min_stock);
          return { v, qty, min, transit: transit(v.id, b.id), status: qty <= 0 ? "out" : qty <= min ? "low" : "ok" };
        });
        const units = rows.reduce((a, r) => a + r.qty, 0);
        const branchAdjust = canAdjust && can(ctx.grants, "inventory.adjust", b.id);
        return (
          <Card key={b.id}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">{b.name}</h2>
              <span className="text-sm text-muted-foreground tabular">{formatQty(units)} {units === 1 ? "unidad" : "unidades"}</span>
            </div>
            {units === 0 && rows.every((r) => r.transit === 0) ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">Sin existencias en esta sede.</p>
            ) : null}
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr><th className="px-4 py-2 font-medium">Variante</th><th className="px-4 py-2 text-right font-medium">Disponible</th><th className="px-4 py-2 text-right font-medium">Mínimo</th><th className="px-4 py-2 font-medium">Estado</th></tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.v.id}>
                    <td className="px-4 py-2"><span className="block">{variantLabel(r.v) || "Variante única"}</span><span className="font-mono text-xs text-muted-foreground">{r.v.sku}</span></td>
                    <td className="px-4 py-2 text-right tabular">
                      {formatQty(r.qty)}
                      {r.transit > 0 && <span className="block text-xs text-brand">+{formatQty(r.transit)} en tránsito</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {branchAdjust ? <MinStockEditor variantId={r.v.id} branchId={b.id} value={r.min} label={`${variantLabel(r.v) || product.name} en ${b.name}`} /> : <span className="tabular">{formatQty(r.min)}</span>}
                    </td>
                    <td className="px-4 py-2"><StockBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
}

function Prices({ product, canCosts }: { product: ProductDetail; canCosts: boolean }) {
  const tax = TAX_RATES.find((t) => t.value === Number(product.tax_rate))?.label ?? `${product.tax_rate} %`;
  return (
    <Card title="Costos y precios">
      <p className="border-b px-4 py-3 text-sm text-muted-foreground">
        Precios con IVA incluido · {tax}. {canCosts ? "El costo es el promedio ponderado: cada compra recibida lo recalcula." : "Los costos solo los ve quien tiene permiso de costos y márgenes."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Variante</th><th className="px-4 py-2.5 text-right font-medium">Precio de venta</th>
              {canCosts && <><th className="px-4 py-2.5 text-right font-medium">Costo promedio</th><th className="px-4 py-2.5 text-right font-medium">Último costo de compra</th><th className="px-4 py-2.5 text-right font-medium">Margen bruto</th></>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {product.variants.map((v, i) => {
              const c = product.costs.get(v.id);
              const cost = Number(c?.avg_cost ?? 0);
              const net = Number(v.price) / (1 + Number(product.tax_rate) / 100);
              return (
                <tr key={v.id}>
                  <td className="px-4 py-2.5">{variantLabel(v) || `Variante ${i + 1}`} <span className="ml-1 font-mono text-xs text-muted-foreground">{v.sku}</span></td>
                  <td className="px-4 py-2.5 text-right tabular">{formatMoney(v.price)}</td>
                  {canCosts && (
                    <>
                      <td className="px-4 py-2.5 text-right tabular">{cost > 0 ? formatMoney(cost) : <span className="text-muted-foreground">Sin costo registrado</span>}</td>
                      <td className="px-4 py-2.5 text-right tabular">{c?.last_cost ? formatMoney(c.last_cost) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2.5 text-right tabular">{cost > 0 && net > 0 ? `${Math.round(((net - cost) / net) * 100)} %` : <span className="text-muted-foreground">—</span>}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canCosts && <p className="border-t px-4 py-3 text-xs text-muted-foreground">Margen bruto = (precio sin IVA − costo promedio) ÷ precio sin IVA.</p>}
    </Card>
  );
}

async function Movements({ product, ctx }: { product: ProductDetail; ctx: AppContext }) {
  const db = await createClient();
  const rows = await movementHistory(db, ctx.tenant.id, { productId: product.id, limit: 100 }).catch(() => null);
  return (
    <Card>
      {rows === null ? <p className="px-4 py-6 text-sm text-destructive">No pudimos cargar los movimientos. Recarga la página.</p> : (
        <>
          <MovementTable rows={rows} tz={ctx.timezone} showProduct={false} showCost={can(ctx.grants, "inventory.costs")}
            emptyText="Este producto todavía no tiene entradas, salidas ni ajustes." />
          {rows.length === 100 && (
            <p className="border-t px-4 py-3 text-sm"><Link href={`/inventario/movimientos?producto=${product.id}`} className="text-brand hover:underline">Ver el historial completo →</Link></p>
          )}
        </>
      )}
    </Card>
  );
}

function Lots({ product, ctx }: { product: ProductDetail; ctx: AppContext }) {
  const today = localDateKey(new Date(), ctx.timezone);
  const soonLimit = addDaysKey(today, EXPIRY_WINDOW_DAYS);
  const branchName = (id: string) => ctx.branches.find((b) => b.id === id)?.name ?? "—";
  const variant = (id: string) => product.variants.find((v) => v.id === id);
  if (product.lots.length === 0) return <Card><EmptyState compact icon={CalendarClock} title="Sin lotes con unidades" description="Los lotes aparecen cuando registras entradas con su número de lote." /></Card>;
  return (
    <Card>
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr><th className="px-4 py-2.5 font-medium">Lote</th><th className="px-4 py-2.5 font-medium">Variante</th><th className="px-4 py-2.5 font-medium">Sede</th><th className="px-4 py-2.5 text-right font-medium">Unidades</th><th className="px-4 py-2.5 font-medium">Vencimiento</th></tr>
        </thead>
        <tbody className="divide-y">
          {product.lots.map((l) => {
            const expired = !!l.expires_on && l.expires_on < today;
            const soon = !!l.expires_on && !expired && l.expires_on <= soonLimit;
            return (
              <tr key={l.id}>
                <td className="px-4 py-2.5 font-mono text-xs">{l.lot_code}</td>
                <td className="px-4 py-2.5">{variantLabel(variant(l.variant_id) ?? {}) || "Variante única"}</td>
                <td className="px-4 py-2.5">{branchName(l.branch_id)}</td>
                <td className="px-4 py-2.5 text-right tabular">{formatQty(l.quantity)}</td>
                <td className="px-4 py-2.5">
                  {l.expires_on ? <span className={cn(expired && "font-medium text-destructive", soon && "font-medium text-[oklch(0.5_0.12_60)]")}>{formatDay(l.expires_on)}{expired ? " · vencido" : soon ? " · por vencer" : ""}</span> : <span className="text-muted-foreground">Sin fecha</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
