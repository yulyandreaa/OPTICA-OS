import { ChevronLeft, ChevronRight, FilePlus2, FileText, Percent, Plus, Receipt, SearchX, ShoppingBag, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Kpi } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatMoney, formatTime, localDateKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import { PeriodFilter } from "@/modules/dashboard/components/period-filter";
import { RetryError } from "@/modules/dashboard/components/retry-error";
import { resolvePeriod, type Period } from "@/modules/dashboard/period";
import { SalesFilters } from "@/modules/sales/components/sales-filters";
import { PAYMENT_STATUS, QUOTE_STATUS, SALE_STATUS } from "@/modules/sales/constants";
import { OPS_PAGE_SIZE, opsQuery, parseOpsParams, TABS, type OpsParams } from "@/modules/sales/list-params";
import { listOperations, listSellers, salesOverview, type OperationRow } from "@/modules/sales/repositories";
import { requirePermission, type AppContext } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Ventas y cotizaciones" };

export default async function SalesPage(props: PageProps<"/ventas">) {
  const ctx = await requirePermission("sales.read");
  const sp = await props.searchParams;
  const params = parseOpsParams(sp);
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const period = resolvePeriod({ periodo: str("periodo"), desde: str("desde"), hasta: str("hasta") }, localDateKey(new Date(), ctx.timezone));
  // An explicit ?sede= wins over the top-bar branch; "todas" only for people who can see every branch.
  const allBranches = ctx.roles.some((r) => r.branchId === null);
  const branchId = params.sede === "todas" && allBranches ? null
    : params.sede && ctx.branches.some((b) => b.id === params.sede) ? params.sede : ctx.activeBranchId;
  const canQuotes = can(ctx.grants, "quotes.read");
  const tabs = TABS.filter((t) => t.key !== "cotizaciones" || canQuotes);
  const periodQuery = { periodo: str("periodo"), desde: str("desde"), hasta: str("hasta") };

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Ventas y cotizaciones" description="Gestiona tus ventas, prepara cotizaciones y consulta el historial comercial"
        actions={<>
          {can(ctx.grants, "quotes.create") && <Link href="/cotizaciones/nueva" className={buttonVariants({ variant: "outline" })}><FilePlus2 /> Nueva cotización</Link>}
          {can(ctx.grants, "sales.create") && <Link href="/ventas/nueva" className={buttonVariants()}><Plus /> Nueva venta</Link>}
        </>} />
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <PeriodFilter value={period.key} from={period.from} to={period.to} keepParams />
        <span className="text-sm text-muted-foreground">{period.label}</span>
      </div>

      <Suspense key={`${branchId}:${period.from}:${period.to}`} fallback={<KpiSkeleton />}>
        <Overview ctx={ctx} period={period} branchId={branchId} canQuotes={canQuotes} />
      </Suspense>

      <section className="min-w-0 rounded-2xl border bg-surface shadow-soft">
        <nav aria-label="Tipo de operación" className="-mb-px overflow-x-auto border-b px-2">
          <ul className="flex min-w-max gap-1">
            {tabs.map((t) => (
              <li key={t.key}>
                <Link href={`/ventas${opsQuery({ ...periodQuery, tab: t.key, q: params.q, asesor: params.asesor, sede: params.sede })}`}
                  aria-current={params.tab === t.key ? "page" : undefined}
                  className={cn("inline-flex h-11 items-center border-b-2 px-3 text-sm transition-colors",
                    params.tab === t.key ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Suspense key={JSON.stringify({ params, branchId, p: period.from + period.to })} fallback={<ListSkeleton />}>
          <OperationsList ctx={ctx} params={params} period={period} branchId={branchId} periodQuery={periodQuery} />
        </Suspense>
      </section>
    </div>
  );
}

async function Overview({ ctx, period, branchId, canQuotes }: { ctx: AppContext; period: Period; branchId: string | null; canQuotes: boolean }) {
  let o;
  try {
    o = await salesOverview(await createClient(), ctx.tenant.id, period.from, period.to, branchId);
  } catch {
    return <RetryError message="No pudimos calcular los indicadores de ventas." />;
  }
  const rate = o.issued_quotes > 0 ? Math.round((o.converted_quotes / o.issued_quotes) * 100) : null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi icon={TrendingUp} tone="green" label="Ventas netas" value={formatMoney(o.net_sales)}
        note={o.sales_count ? "Sin IVA, con descuentos" : "Sin ventas en el período"} />
      <Kpi icon={ShoppingBag} tone="blue" label="Ventas registradas" value={o.sales_count.toLocaleString("es-CO")}
        note={o.voided_count ? `${o.voided_count} anuladas o devueltas aparte` : "Sin anuladas ni devueltas"} />
      <Kpi icon={FileText} tone="violet" label="Cotizaciones abiertas" value={canQuotes ? o.open_quotes.toLocaleString("es-CO") : "—"}
        note={!canQuotes ? "Requiere permiso para ver cotizaciones" : o.open_quotes ? `${formatMoney(o.open_quotes_total)} por cerrar` : "Ninguna por cerrar"} />
      <Kpi icon={Percent} tone="orange" label="Conversión" value={canQuotes && rate !== null ? `${rate} %` : "—"}
        note={!canQuotes ? "Requiere permiso para ver cotizaciones" : o.issued_quotes
          ? `${o.converted_quotes} de ${o.issued_quotes} emitidas`
          : "Sin cotizaciones emitidas"} />
    </div>
  );
}

async function OperationsList({ ctx, params, period, branchId, periodQuery }: {
  ctx: AppContext; params: OpsParams; period: Period; branchId: string | null; periodQuery: Record<string, string | undefined>;
}) {
  const db = await createClient();
  const kind = TABS.find((t) => t.key === params.tab)!.kind;
  let list, sellers;
  try {
    [list, sellers] = await Promise.all([
      listOperations(db, ctx.tenant.id, {
        kind, from: period.from, to: period.to, branchId, query: params.q, status: params.estado, payment: params.pago, seller: params.asesor,
        limit: OPS_PAGE_SIZE, offset: (params.pagina - 1) * OPS_PAGE_SIZE,
      }),
      listSellers(db, ctx.tenant.id),
    ]);
  } catch {
    return <div className="p-4"><RetryError message="No pudimos cargar las operaciones." /></div>;
  }
  const { rows, total } = list;
  const filtered = !!(params.q || params.estado || params.pago || params.asesor);
  const filters = (
    <SalesFilters tab={params.tab} branches={ctx.branches} sellers={sellers}
      branchValue={params.sede === "todas" || (!params.sede && !ctx.activeBranchId) ? "todas" : branchId ?? "todas"} allowAllBranches={ctx.roles.some((r) => r.branchId === null)} />
  );

  if (rows.length === 0) {
    const what = params.tab === "cotizaciones" ? "cotizaciones" : params.tab === "ventas" ? "ventas" : params.tab === "anulaciones" ? "devoluciones ni anulaciones" : "operaciones";
    return (
      <>
        {filters}
        {filtered ? (
          <EmptyState compact icon={SearchX} title={params.q ? `Sin resultados para “${params.q}”` : "Ninguna operación coincide con los filtros"}
            description="Prueba con el número, el documento del cliente o el nombre del producto, o quita algún filtro."
            action={<Link href={`/ventas${opsQuery({ ...periodQuery, tab: params.tab })}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Quitar filtros</Link>} />
        ) : (
          <EmptyState compact icon={params.tab === "cotizaciones" ? FileText : Receipt} title={`No hay ${what} en ${period.label.toLowerCase()}`}
            description={params.tab === "anulaciones" ? "Aquí aparecerán las ventas anuladas o devueltas." : "Elige otro período arriba o registra una nueva operación."}
            action={params.tab !== "anulaciones" && (
              <div className="flex flex-wrap justify-center gap-2">
                {params.tab !== "ventas" && can(ctx.grants, "quotes.create") && <Link href="/cotizaciones/nueva" className={buttonVariants({ variant: "outline", size: "sm" })}><FilePlus2 /> Nueva cotización</Link>}
                {params.tab !== "cotizaciones" && can(ctx.grants, "sales.create") && <Link href="/ventas/nueva" className={buttonVariants({ size: "sm" })}><Plus /> Nueva venta</Link>}
              </div>
            )} />
        )}
      </>
    );
  }

  const tz = ctx.timezone;
  const showBranch = !branchId && ctx.branches.length > 1;
  const from = (params.pagina - 1) * OPS_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  const pageHref = (page: number) => `/ventas${opsQuery({ ...periodQuery, ...params, pagina: page })}`;

  return (
    <>
      {filters}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Operación</th>
              <th className="px-4 py-2.5 font-medium">Cliente</th>
              {showBranch && <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Sede</th>}
              <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Asesor</th>
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
              <th className="px-4 py-2.5 font-medium">Estado</th>
              <th className="px-4 py-2.5 font-medium">Pago</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={`${r.kind}:${r.id}`} className="hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <Link href={hrefOf(r)} className="font-mono text-xs font-medium text-brand hover:underline">{r.number}</Link>
                  <p className="text-xs text-muted-foreground">
                    {r.kind === "sale" ? "Venta" : "Cotización"} · {formatDate(r.created_at, tz, { day: "numeric", month: "short" })} · {formatTime(r.created_at, tz)}
                  </p>
                </td>
                <td className="max-w-56 px-4 py-2.5">
                  {r.customer_name ? (
                    <><span className="block truncate">{r.customer_name}</span><span className="block truncate text-xs text-muted-foreground">{r.customer_document}</span></>
                  ) : <span className="text-muted-foreground">Cliente de mostrador</span>}
                </td>
                {showBranch && <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">{r.branch_name}</td>}
                <td className="hidden max-w-40 truncate px-4 py-2.5 text-muted-foreground lg:table-cell">{r.seller_name ?? "—"}</td>
                <td className="px-4 py-2.5 text-right font-medium tabular">
                  {formatMoney(r.total)}
                  {r.kind === "sale" && Number(r.balance) > 0 && r.status !== "voided" && r.status !== "returned" && (
                    <span className="block text-xs font-normal text-muted-foreground">Saldo {formatMoney(r.balance)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5"><CommercialBadge r={r} /></td>
                <td className="px-4 py-2.5"><PaymentCell r={r} tz={tz} /></td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={hrefOf(r)} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Abrir ${r.number}`}>Ver</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y md:hidden">
        {rows.map((r) => (
          <li key={`${r.kind}:${r.id}`}>
            <Link href={hrefOf(r)} className="grid gap-1.5 px-4 py-3 hover:bg-muted/40">
              <span className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-medium text-brand">{r.number}</span>
                <span className="font-medium tabular">{formatMoney(r.total)}</span>
              </span>
              <span className="truncate text-sm">{r.customer_name ?? "Cliente de mostrador"}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <CommercialBadge r={r} /><PaymentCell r={r} tz={tz} />
              </span>
              <span className="text-xs text-muted-foreground">
                {r.kind === "sale" ? "Venta" : "Cotización"} · {formatDate(r.created_at, tz, { day: "numeric", month: "short" })} · {r.seller_name ?? ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground tabular">Mostrando {from + 1}–{from + rows.length} de {total.toLocaleString("es-CO")}</p>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            {params.pagina > 1
              ? <Link href={pageHref(params.pagina - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}><ChevronLeft /> Anterior</Link>
              : <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}><ChevronLeft /> Anterior</span>}
            <span className="tabular text-muted-foreground">Página {params.pagina} de {pages}</span>
            {params.pagina < pages
              ? <Link href={pageHref(params.pagina + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Siguiente <ChevronRight /></Link>
              : <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>Siguiente <ChevronRight /></span>}
          </div>
        )}
      </div>
    </>
  );
}

const hrefOf = (r: OperationRow) => (r.kind === "quote" ? `/cotizaciones/${r.id}` : r.status === "draft" ? `/ventas/nueva?borrador=${r.id}` : `/ventas/${r.id}`);

/** Commercial status only: what happened to the sale or quote (never mixed with payment or lab status). */
function CommercialBadge({ r }: { r: OperationRow }) {
  const st = r.kind === "sale" ? SALE_STATUS[r.status] : QUOTE_STATUS[r.status];
  return st ? <StatusBadge tone={st.tone}>{st.label}</StatusBadge> : <StatusBadge>{r.status}</StatusBadge>;
}

/** Payment status for sales; for quotes, when they expire (a quote has no payments). */
function PaymentCell({ r, tz }: { r: OperationRow; tz: string }) {
  if (r.kind === "quote") {
    if (!r.valid_until || ["converted", "rejected", "expired"].includes(r.status)) return <span className="text-xs text-muted-foreground">—</span>;
    return <span className="text-xs text-muted-foreground">Vence {formatDate(`${r.valid_until}T12:00:00`, tz, { day: "numeric", month: "short" })}</span>;
  }
  if (r.status === "draft") return <span className="text-xs text-muted-foreground">Sin confirmar</span>;
  if (r.status === "voided" || r.status === "returned") {
    return r.payment_status === "pending" ? <span className="text-xs text-muted-foreground">—</span> : <StatusBadge tone={PAYMENT_STATUS[r.payment_status!]?.tone}>{PAYMENT_STATUS[r.payment_status!]?.label}</StatusBadge>;
  }
  const p = PAYMENT_STATUS[r.payment_status ?? "pending"] ?? PAYMENT_STATUS.pending!;
  return <StatusBadge tone={p.tone} dot={false}>{p.label}</StatusBadge>;
}

function KpiSkeleton() {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />)}</div>;
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 p-4" aria-label="Cargando operaciones">
      <Skeleton className="h-9 w-full max-w-md" />
      {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
    </div>
  );
}
