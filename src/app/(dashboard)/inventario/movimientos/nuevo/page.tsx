import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { can } from "@/modules/authz/permissions";
import { searchVariantsAction } from "@/modules/inventory/actions";
import { MovementForm } from "@/modules/inventory/components/movement-form";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Registrar movimiento" };

export default async function NewMovementPage(props: PageProps<"/inventario/movimientos/nuevo">) {
  const ctx = await requirePermission("inventory.adjust");
  const sp = await props.searchParams;
  const branches = ctx.branches.filter((b) => can(ctx.grants, "inventory.adjust", b.id));
  const branchId = branches.find((b) => b.id === ctx.activeBranchId)?.id ?? branches[0]?.id;
  let initialVariant;
  if (branchId && typeof sp.variante === "string") {
    const db = await createClient();
    const { data } = await db.from("product_variants").select("sku").eq("tenant_id", ctx.tenant.id).eq("id", sp.variante).maybeSingle();
    if (data) [initialVariant] = await searchVariantsAction(data.sku, branchId, sp.variante);
  }
  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1">
      <PageHeader eyebrow={<Link href="/inventario" className="hover:text-foreground">Inventario</Link>} title="Registrar movimiento"
        description="Conteos, ajustes, cargas iniciales, daños y pérdidas. Cada movimiento queda auditado y no se puede borrar." />
      {branchId ? <MovementForm branches={branches} defaultBranchId={branchId} initialVariant={initialVariant} canCosts={can(ctx.grants, "inventory.costs")} />
        : <p className="text-sm text-muted-foreground">No tienes sedes donde registrar movimientos.</p>}
    </div>
  );
}
