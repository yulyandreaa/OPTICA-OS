import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { ProductForm } from "@/modules/inventory/components/product-form";
import { listBrands, listCategories } from "@/modules/inventory/repositories";
import { emptyProduct } from "@/modules/inventory/utils/form-values";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  const ctx = await requirePermission("inventory.manage");
  const db = await createClient();
  const [categories, brands] = await Promise.all([listCategories(db, ctx.tenant.id), listBrands(db, ctx.tenant.id)]);
  const active = categories.filter((c) => c.is_active);
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1">
      <PageHeader eyebrow={<Link href="/inventario" className="hover:text-foreground">Inventario</Link>} title="Nuevo producto"
        description="El producto queda disponible en el catálogo de todas tus sedes; las existencias se llevan por sede." />
      <ProductForm defaults={emptyProduct(active[0])} categories={active} brands={brands.map((b) => b.name)}
        branches={ctx.branches.filter((b) => can(ctx.grants, "inventory.adjust", b.id))}
        canCosts={can(ctx.grants, "inventory.costs")} canAdjust={can(ctx.grants, "inventory.adjust")} canManageCategories />
    </div>
  );
}
