import { Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { NewSupplierDialog } from "@/modules/purchases/components/purchase-forms";
import { PO_STATUS } from "@/modules/purchases/constants";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Compras" };


export default async function PurchasesPage() {
  const ctx = await requirePermission("purchases.read");
  const db = await createClient();
  const [{ data: orders }, { data: suppliers }] = await Promise.all([
    db.from("purchase_orders").select("id, number, status, total, expected_at, created_at, supplier:suppliers(name), branch:branches(name)").eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(50),
    can(ctx.grants, "suppliers.read") ? db.from("suppliers").select("id, name, tax_id, contact_name, phone, email, brands, payment_terms, lead_time_days").eq("tenant_id", ctx.tenant.id).order("name") : Promise.resolve({ data: [] }),
  ]);
  return (
    <>
      <PageHeader title="Compras" description="Órdenes de compra y proveedores. Al recibir, el stock sube con movimientos auditados."
        actions={<>{can(ctx.grants, "suppliers.manage") && <NewSupplierDialog />}{can(ctx.grants, "purchases.create") && <Link href="/compras/nueva" className={buttonVariants()}><Plus /> Orden de compra</Link>}</>} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Órdenes de compra" bodyClassName="p-0">
          {(orders ?? []).length === 0 ? <EmptyState icon={Truck} title="Sin órdenes de compra" compact /> : (
            <ul className="divide-y">{(orders ?? []).map((o) => (
              <li key={o.id} className="relative flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <Link href={`/compras/${o.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">{o.supplier?.name}</Link>
                  <p className="text-xs text-muted-foreground"><span className="font-mono">{o.number}</span> · {o.branch?.name} · {formatDate(o.created_at, ctx.timezone)}{o.expected_at ? ` · llega ${formatDate(`${o.expected_at}T12:00:00Z`, "UTC", { day: "numeric", month: "short" })}` : ""}</p>
                </div>
                <span className="text-sm tabular">{formatMoney(o.total)}</span>
                <StatusBadge tone={PO_STATUS[o.status]?.tone}>{PO_STATUS[o.status]?.label}</StatusBadge>
              </li>))}
            </ul>
          )}
        </Panel>
        <Panel title="Proveedores" bodyClassName="p-0">
          <ul className="divide-y">{(suppliers ?? []).map((s) => (
            <li key={s.id} className="px-4 py-3">
              <p className="text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted-foreground">{[s.tax_id && `NIT ${s.tax_id}`, s.contact_name, s.phone].filter(Boolean).join(" · ")}</p>
              <p className="text-xs text-muted-foreground">{s.brands.join(", ")}{s.payment_terms ? ` · ${s.payment_terms}` : ""}{s.lead_time_days !== null ? ` · ${s.lead_time_days} días` : ""}</p>
            </li>))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
