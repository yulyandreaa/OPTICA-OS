import { Plus, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { addDaysKey, formatDate, formatMoney, formatTime, localDateKey, zonedTimeToUtc } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import { PAYMENT_STATUS, SALE_STATUS } from "@/modules/sales/constants";
import { listSales } from "@/modules/sales/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Ventas" };

export default async function SalesPage(props: PageProps<"/ventas">) {
  const ctx = await requirePermission("sales.read");
  await connection();
  const sp = await props.searchParams;
  const status = typeof sp.estado === "string" ? sp.estado : undefined;
  const db = await createClient();
  const today = localDateKey(new Date(), ctx.timezone);
  // "Cartera vencida" (dashboard alert): balance pending on sales older than 30 days.
  const overdue = sp.vencidas === "1";
  const sales = await listSales(db, ctx.tenant.id, {
    branchId: ctx.activeBranchId, status, limit: 80,
    createdBefore: overdue ? zonedTimeToUtc(addDaysKey(today, -30), "00:00", ctx.timezone) : undefined,
  });
  const todays = sales.filter((s) => localDateKey(new Date(s.created_at), ctx.timezone) === today && s.status !== "voided");
  const totalToday = todays.reduce((a, s) => a + Number(s.total), 0);
  const pending = sales.filter((s) => s.status === "completed" || s.status === "partially_returned").reduce((a, s) => a + Number(s.balance), 0);

  return (
    <>
      <PageHeader title="Ventas" description={ctx.branches.find((b) => b.id === ctx.activeBranchId)?.name ?? "Todas las sedes"}
        actions={can(ctx.grants, "pos.use") && <Link href="/ventas/pos" className={buttonVariants()}><Plus /> Nueva venta</Link>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Ventas hoy" value={formatMoney(totalToday)} hint={`${todays.length} ventas`} />
        <StatCard label="Ticket promedio hoy" value={todays.length ? formatMoney(totalToday / todays.length) : "—"} />
        <StatCard label="Saldos por cobrar" value={formatMoney(pending)} hint="en las últimas ventas" />
      </div>
      <nav className="mb-3 flex w-fit gap-1 rounded-lg bg-muted p-1">
        {[[undefined, "Todas"], ["pending", "Con saldo"], ["paid", "Pagadas"]].map(([k, l]) => (
          <Link key={l} href={k ? `/ventas?estado=${k}` : "/ventas"} className={cn("rounded-md px-3 py-1 text-sm", status === k ? "bg-surface font-medium shadow-soft" : "text-muted-foreground")}>{l}</Link>
        ))}
      </nav>
      {overdue && (
        <p className="mb-3 flex items-center gap-2 text-sm">
          Mostrando saldos de ventas con más de 30 días ({sales.length}).
          <Link href="/ventas?estado=pending" className="text-muted-foreground underline hover:text-foreground">Ver todos los saldos</Link>
        </p>
      )}
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {sales.length === 0 ? <EmptyState icon={ShoppingBag} title="Aún no hay ventas" description="Registra la primera desde el punto de venta."
          action={<Link href="/ventas/pos" className={buttonVariants()}>Abrir POS</Link>} /> : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2.5 font-medium">Venta</th><th className="px-4 py-2.5 font-medium">Paciente</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Asesor</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th><th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Saldo</th><th className="px-4 py-2.5 font-medium">Estado</th></tr>
            </thead>
            <tbody className="divide-y">
              {sales.map((s) => {
                // A voided or returned sale shows that; otherwise what matters in the list is the payment.
                const st = s.status === "completed" ? PAYMENT_STATUS[s.payment_status] ?? PAYMENT_STATUS.pending! : SALE_STATUS[s.status] ?? SALE_STATUS.completed!;
                return (
                  <tr key={s.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3"><Link href={`/ventas/${s.id}`} className="font-mono text-xs font-medium text-brand hover:underline">{s.number}</Link>
                      <p className="text-xs text-muted-foreground">{formatDate(s.created_at, ctx.timezone, { day: "numeric", month: "short" })} · {formatTime(s.created_at, ctx.timezone)}</p></td>
                    <td className="px-4 py-3">{s.patient?.full_name ?? <span className="text-muted-foreground">Cliente de mostrador</span>}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{s.seller?.full_name}</td>
                    <td className="px-4 py-3 text-right font-medium tabular">{formatMoney(s.total)}</td>
                    <td className="hidden px-4 py-3 text-right tabular sm:table-cell">{Number(s.balance) > 0 ? formatMoney(s.balance) : "—"}</td>
                    <td className="px-4 py-3"><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
