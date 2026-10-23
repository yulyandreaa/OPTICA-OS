import { CheckCircle2, FlaskConical, Plus, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { INVOICE_STATUS } from "@/modules/billing/constants";
import { LAB_STATUS, type LabStatus } from "@/modules/labs/constants";
import { AddPaymentForm, CreateLabOrderButton, IssueInvoiceButton } from "@/modules/sales/components/sale-actions";
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS, SALE_STATUS } from "@/modules/sales/constants";
import { getSale } from "@/modules/sales/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Venta" };


export default async function SalePage(props: PageProps<"/ventas/[id]">) {
  const { id } = await props.params;
  const ctx = await requirePermission("sales.read");
  const data = await getSale(await createClient(), ctx.tenant.id, id);
  if (!data) notFound();
  if (data.sale.status === "draft") redirect(`/ventas/nueva?borrador=${id}`);
  const { sale, items, payments, orders, invoices } = data;
  const justRegistered = (await props.searchParams).registrada === "1";
  const st = SALE_STATUS[sale.status] ?? SALE_STATUS.completed!;
  const pay = PAYMENT_STATUS[sale.payment_status] ?? PAYMENT_STATUS.pending!;
  const tz = ctx.timezone;
  const hasLens = items.some((i) => i.category === "Lentes oftálmicos");
  const activeInvoice = invoices.find((i) => i.status === "accepted" || i.status === "processing");

  return (
    <>
      {justRegistered && (
        <div role="status" className="mb-4 flex flex-col gap-3 rounded-2xl border border-success/30 bg-success/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <span><b>Venta {sale.number} registrada.</b>{" "}
              {Number(sale.balance) > 0 ? `Queda un saldo de ${formatMoney(sale.balance)}${sale.due_date ? ` con fecha límite ${formatDate(`${sale.due_date}T12:00:00`, tz, { day: "numeric", month: "long" })}` : ""}.` : "Quedó pagada."}
              {hasLens && !orders.length && " Lleva lentes: crea la orden óptica para enviarlos al laboratorio."}</span>
          </p>
          <Link href="/ventas/nueva" className={buttonVariants({ variant: "outline", size: "sm" })}><Plus /> Otra venta</Link>
        </div>
      )}
      <PageHeader eyebrow={<Link href="/ventas" className="hover:text-foreground">Ventas</Link>}
        title={<span className="flex items-center gap-3"><span className="font-mono">{sale.number}</span><StatusBadge tone={st.tone}>{st.label}</StatusBadge><StatusBadge tone={pay.tone}>{pay.label}</StatusBadge></span>}
        description={`${formatDate(sale.created_at, tz, { dateStyle: "long" })} · ${formatTime(sale.created_at, tz)} · ${sale.branch?.name} · ${sale.seller?.full_name}`}
        actions={sale.patient && <Link href={`/pacientes/${sale.patient.id}?tab=compras`} className="text-sm text-muted-foreground hover:text-foreground">{sale.patient.full_name} →</Link>} />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="grid content-start gap-4">
          <Panel title="Productos" bodyClassName="p-0">
            <ul className="divide-y">
              {items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="size-9 shrink-0 rounded-lg border bg-cover bg-center" style={{ backgroundImage: i.variant?.image_url ? `url(${i.variant.image_url})` : undefined, backgroundColor: i.variant?.color_hex ?? "var(--muted)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.description}</p>
                    <p className="text-xs text-muted-foreground">{i.category} · {i.quantity} × {formatMoney(i.unit_price)}{Number(i.discount) > 0 ? ` − ${formatMoney(i.discount)}` : ""}</p>
                  </div>
                  <p className="text-sm font-medium tabular">{formatMoney(i.line_total)}</p>
                </li>
              ))}
            </ul>
            <dl className="grid gap-1 border-t px-4 py-3 text-sm">
              {Number(sale.discount_total) > 0 && <div className="flex justify-between text-muted-foreground"><dt>Descuentos</dt><dd className="tabular">−{formatMoney(sale.discount_total)}</dd></div>}
              <div className="flex justify-between text-muted-foreground"><dt>IVA incluido</dt><dd className="tabular">{formatMoney(sale.tax_total)}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular">{formatMoney(sale.total)}</dd></div>
            </dl>
          </Panel>

          <Panel title="Pagos" description={Number(sale.balance) > 0 ? `Saldo pendiente ${formatMoney(sale.balance)}` : "Pagada en su totalidad"}>
            <ul className="mb-3 grid gap-2">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between text-sm"><span>{PAYMENT_METHOD_LABEL[p.method] ?? p.method} · <span className="text-muted-foreground">{formatDate(p.created_at, tz)}</span></span><span className="tabular">{formatMoney(p.amount)}</span></li>
              ))}
              {payments.length === 0 && <li className="text-sm text-muted-foreground">Sin pagos registrados.</li>}
            </ul>
            {Number(sale.balance) > 0 && can(ctx.grants, "sales.create") && <AddPaymentForm saleId={sale.id} balance={Number(sale.balance)} />}
          </Panel>
        </div>

        <div className="grid content-start gap-4">
          <Panel title="Laboratorio" action={<FlaskConical className="size-4 text-muted-foreground" />}>
            {orders.length > 0 ? (
              <ul className="grid gap-2">{orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between text-sm">
                  <Link href={`/ordenes/${o.id}`} className="font-mono hover:underline">{o.number}</Link>
                  <StatusBadge tone={LAB_STATUS[o.status as LabStatus].tone}>{LAB_STATUS[o.status as LabStatus].label}</StatusBadge>
                </li>))}
              </ul>
            ) : hasLens && sale.patient && can(ctx.grants, "lab_orders.create") ? <CreateLabOrderButton saleId={sale.id} />
              : <p className="text-sm text-muted-foreground">{hasLens ? "Asocia un paciente a la venta para enviar los lentes al laboratorio." : "Esta venta no requiere laboratorio."}</p>}
          </Panel>

          <Panel title="Factura electrónica" action={<Receipt className="size-4 text-muted-foreground" />}>
            {invoices.length > 0 && (
              <ul className="mb-3 grid gap-2">{invoices.map((i) => (
                <li key={i.id} className="grid gap-0.5 text-sm">
                  <div className="flex items-center justify-between"><span className="font-mono">{i.number ?? "Sin número"}</span><StatusBadge tone={INVOICE_STATUS[i.status]?.tone}>{INVOICE_STATUS[i.status]?.label ?? i.status}</StatusBadge></div>
                  {i.cufe && <p className="truncate font-mono text-[10px] text-muted-foreground" title={i.cufe}>CUFE {i.cufe}</p>}
                  {i.error_message && <p className="text-xs text-destructive">{i.error_message}</p>}
                </li>))}
              </ul>
            )}
            {!activeInvoice && can(ctx.grants, "billing.issue") && (sale.status === "completed" && sale.payment_status === "paid"
              ? <IssueInvoiceButton saleId={sale.id} retry={invoices.length > 0} />
              : <p className="text-sm text-muted-foreground">Se factura cuando la venta esté pagada.</p>)}
          </Panel>
        </div>
      </div>
    </>
  );
}
