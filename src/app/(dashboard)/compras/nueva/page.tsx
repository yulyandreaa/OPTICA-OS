import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { NewPurchaseForm } from "@/modules/purchases/components/purchase-forms";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Nueva orden de compra" };

export default async function NewPurchasePage() {
  const ctx = await requirePermission("purchases.create");
  const db = await createClient();
  const [{ data: suppliers }, { data: variants }] = await Promise.all([
    db.from("suppliers").select("id, name").eq("tenant_id", ctx.tenant.id).eq("is_active", true).order("name"),
    db.from("product_variants").select("id, sku, color_name, costs:variant_costs(avg_cost, last_cost), product:products(name, is_stocked)").eq("tenant_id", ctx.tenant.id).eq("is_active", true).order("sku"),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow={<Link href="/compras" className="hover:text-foreground">Compras</Link>} title="Nueva orden de compra" description={`Para la sede ${ctx.branches.find((b) => b.id === ctx.activeBranchId)?.name ?? ctx.branches[0]?.name}`} />
      <NewPurchaseForm suppliers={suppliers ?? []}
        variants={(variants ?? []).filter((v) => v.product?.is_stocked).map((v) => ({ id: v.id, label: `${v.product?.name} ${v.color_name ?? ""} · ${v.sku}`, cost: Math.round(Number(v.costs[0]?.last_cost ?? v.costs[0]?.avg_cost ?? 0)) }))} />
    </div>
  );
}
