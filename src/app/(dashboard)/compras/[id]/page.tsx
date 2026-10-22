import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { PurchaseStatusButtons, ReceiveForm } from "@/modules/purchases/components/purchase-forms";
import { requirePermission } from "@/modules/tenants/services/context";
import { PO_STATUS } from "@/modules/purchases/constants";

export const metadata: Metadata = { title: "Orden de compra" };

export default async function PurchasePage(props: PageProps<"/compras/[id]">) {
  const { id } = await props.params;
  const ctx = await requirePermission("purchases.read");
  const db = await createClient();
  const [{ data: po }, { data: items }] = await Promise.all([
    db.from("purchase_orders").select("*, supplier:suppliers(name, contact_name, phone, email), branch:branches(name)").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle(),
    db.from("purchase_order_items").select("id, quantity, received_quantity, unit_cost, variant:product_variants(sku, color_name, product:products(name))").eq("tenant_id", ctx.tenant.id).eq("purchase_order_id", id),
  ]);
  if (!po) notFound();
  const receivable = ["sent", "approved", "partially_received"].includes(po.status) && can(ctx.grants, "purchases.approve");
  return (
    <>
      <PageHeader eyebrow={<Link href="/compras" className="hover:text-foreground">Compras</Link>}
        title={<span className="flex items-center gap-3">{po.supplier?.name}<StatusBadge tone={PO_STATUS[po.status]?.tone}>{PO_STATUS[po.status]?.label}</StatusBadge></span>}
        description={`${po.number} · ${po.branch?.name} · ${formatDate(po.created_at, ctx.timezone)}`}
        actions={<PurchaseStatusButtons id={po.id} status={po.status} canApprove={can(ctx.grants, "purchases.approve")} />} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Productos" bodyClassName="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Producto</th><th className="px-4 py-2 text-right font-medium">Pedido</th><th className="px-4 py-2 text-right font-medium">Recibido</th><th className="px-4 py-2 text-right font-medium">Costo</th></tr></thead>
            <tbody className="divide-y">{(items ?? []).map((i) => (
              <tr key={i.id}><td className="px-4 py-2.5">{i.variant?.product?.name} {i.variant?.color_name} <span className="font-mono text-xs text-muted-foreground">{i.variant?.sku}</span></td>
                <td className="px-4 py-2.5 text-right tabular">{Number(i.quantity)}</td><td className="px-4 py-2.5 text-right tabular">{Number(i.received_quantity)}</td><td className="px-4 py-2.5 text-right tabular">{formatMoney(i.unit_cost)}</td></tr>))}
            </tbody>
          </table>
          <div className="flex justify-between border-t px-4 py-3 font-semibold"><span>Total</span><span className="tabular">{formatMoney(po.total)}</span></div>
        </Panel>
        <Panel title="Recepción">
          {receivable ? <ReceiveForm id={po.id} items={(items ?? []).map((i) => ({ id: i.id, label: `${i.variant?.product?.name} ${i.variant?.color_name ?? ""}`, pending: Number(i.quantity) - Number(i.received_quantity) }))} />
            : <p className="text-sm text-muted-foreground">{po.status === "received" ? "Mercancía recibida completa. El stock ya está actualizado." : po.status === "draft" ? "Envía la orden al proveedor para poder recibirla." : "Sin acciones disponibles."}</p>}
        </Panel>
      </div>
    </>
  );
}
