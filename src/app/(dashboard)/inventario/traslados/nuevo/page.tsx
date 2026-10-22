import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { searchVariantsAction } from "@/modules/inventory/actions";
import { TransferForm } from "@/modules/inventory/components/transfer-form";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Nuevo traslado" };

export default async function NewTransferPage(props: PageProps<"/inventario/traslados/nuevo">) {
  const ctx = await requirePermission("inventory.transfer");
  const sp = await props.searchParams;
  const origins = ctx.branches.filter((b) => can(ctx.grants, "inventory.transfer", b.id));
  const from = origins.find((b) => b.id === ctx.activeBranchId)?.id ?? origins[0]?.id;
  let initialVariant;
  if (from && typeof sp.variante === "string") {
    const db = await createClient();
    const { data } = await db.from("product_variants").select("sku").eq("tenant_id", ctx.tenant.id).eq("id", sp.variante).maybeSingle();
    if (data) [initialVariant] = await searchVariantsAction(data.sku, from, sp.variante);
  }
  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1">
      <PageHeader eyebrow={<Link href="/inventario/traslados" className="hover:text-foreground">Traslados</Link>} title="Trasladar entre sedes"
        description="El total de unidades de la empresa no cambia: solo se mueven de una sede a otra." />
      {ctx.branches.length < 2 || !from
        ? <p className="text-sm text-muted-foreground">Necesitas al menos dos sedes, y permiso de traslados en una de ellas, para trasladar mercancía.</p>
        : <TransferForm origins={origins} destinations={ctx.branches} defaultFrom={from} initialVariant={initialVariant} />}
    </div>
  );
}
