import { PlusCircle, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { RetryError } from "@/modules/dashboard/components/retry-error";
import { MOVEMENT_FILTERS } from "@/modules/inventory/constants";
import { MovementTable } from "@/modules/inventory/components/movement-table";
import { UrlSelect } from "@/modules/inventory/components/url-select";
import { movementHistory } from "@/modules/inventory/repositories";
import { requirePermission, type AppContext } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Movimientos de inventario" };
const PAGE = 50;

export default async function MovementsPage(props: PageProps<"/inventario/movimientos">) {
  const ctx = await requirePermission("inventory.read");
  const sp = await props.searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const filters = {
    type: MOVEMENT_FILTERS.some((f) => f.key === one("tipo")) ? one("tipo") : undefined,
    productId: uuid(one("producto")),
    before: one("antes") && uuid(one("antesId")) ? { at: one("antes")!, id: one("antesId")! } : undefined,
  };
  const branchName = ctx.branches.find((b) => b.id === ctx.activeBranchId)?.name ?? "todas las sedes";
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader eyebrow={<Link href="/inventario" className="hover:text-foreground">Inventario</Link>} title="Historial de movimientos"
        description={`Entradas, salidas, ajustes y traslados en ${branchName}. Los movimientos no se editan ni se borran: las correcciones se registran como un nuevo movimiento.`}
        actions={can(ctx.grants, "inventory.adjust") && <Link href="/inventario/movimientos/nuevo" className={buttonVariants()}><PlusCircle /> Registrar movimiento</Link>} />
      <Suspense key={JSON.stringify(filters) + ctx.activeBranchId} fallback={<Skeleton className="h-[420px] rounded-2xl" />}>
        <History ctx={ctx} filters={filters} />
      </Suspense>
    </div>
  );
}

async function History({ ctx, filters }: { ctx: AppContext; filters: { type?: string; productId?: string; before?: { at: string; id: string } } }) {
  const db = await createClient();
  let rows;
  try {
    rows = await movementHistory(db, ctx.tenant.id, { branchId: ctx.activeBranchId, ...filters, limit: PAGE });
  } catch {
    return <RetryError message="No pudimos cargar los movimientos." />;
  }
  const product = filters.productId ? rows[0]?.product_name ?? "este producto" : undefined;
  const last = rows.at(-1);
  const nextHref = () => {
    const sp = new URLSearchParams();
    if (filters.type) sp.set("tipo", filters.type);
    if (filters.productId) sp.set("producto", filters.productId);
    sp.set("antes", last!.created_at!); sp.set("antesId", last!.id!);
    return `/inventario/movimientos?${sp.toString()}`;
  };
  return (
    <section className="min-w-0 rounded-2xl border bg-surface shadow-soft">
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <UrlSelect param="tipo" label="Tipo de movimiento" options={MOVEMENT_FILTERS} className="h-8 w-52" reset={["antes", "antesId"]} />
        {product && (
          <Link href={filters.type ? `/inventario/movimientos?tipo=${filters.type}` : "/inventario/movimientos"}
            className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-sm hover:bg-muted">
            {product} <X className="size-3.5 text-muted-foreground" />
          </Link>
        )}
        {filters.before && <Link href="/inventario/movimientos" className="text-sm text-muted-foreground hover:text-foreground">← Más recientes</Link>}
      </div>
      <MovementTable rows={rows} tz={ctx.timezone} showCost={can(ctx.grants, "inventory.costs")}
        emptyText={filters.type || filters.productId ? "No hay movimientos con estos filtros." : "Cuando registres compras, ventas, ajustes o traslados, aparecerán aquí."} />
      {rows.length === PAGE && (
        <div className="border-t px-4 py-3 text-right"><Link href={nextHref()} className={buttonVariants({ variant: "outline", size: "sm" })}>Más antiguos →</Link></div>
      )}
    </section>
  );
}
