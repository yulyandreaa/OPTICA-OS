import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { ProductForm } from "@/modules/inventory/components/product-form";
import { getProduct, listBrands, listCategories } from "@/modules/inventory/repositories";
import { productToValues } from "@/modules/inventory/utils/form-values";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditProductPage(props: PageProps<"/inventario/[id]/editar">) {
  const ctx = await requirePermission("inventory.manage");
  const { id } = await props.params;
  const db = await createClient();
  const [product, categories, brands] = await Promise.all([
    getProduct(db, ctx.tenant.id, id).catch(() => null), listCategories(db, ctx.tenant.id), listBrands(db, ctx.tenant.id),
  ]);
  if (!product) notFound();
  const canCosts = can(ctx.grants, "inventory.costs");
  const { values, originalCosts } = productToValues(product, canCosts);
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1">
      <PageHeader eyebrow={<Link href={`/inventario/${id}`} className="hover:text-foreground">{product.name}</Link>} title="Editar producto"
        description="Editar el producto no cambia sus existencias: para eso registra un movimiento." />
      <ProductForm productId={id} defaults={values} originalCosts={originalCosts}
        categories={categories.filter((c) => c.is_active || c.id === product.category.id)} brands={brands.map((b) => b.name)}
        branches={[]} canCosts={canCosts} canAdjust={false} canManageCategories />
    </div>
  );
}
