import { HeartPulse, SearchX, ShoppingBag, UserPlus, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Kpi } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import { PatientSearch } from "@/modules/patients/components/patient-search";
import { PersonRowActions } from "@/modules/patients/components/person-row-actions";
import { RelationBadge } from "@/modules/patients/components/relation-badge";
import { getPeopleSummary, listPatients } from "@/modules/patients/repositories/patients";
import { patientListParams, relationOf, type PatientListParams } from "@/modules/patients/schemas";
import { RetryError } from "@/modules/dashboard/components/retry-error";
import { requirePermission, type AppContext } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Clientes y pacientes" };

const FILTERS = [
  { key: "todos", label: "Todos", count: "total" },
  { key: "clientes", label: "Clientes", count: "customers" },
  { key: "pacientes", label: "Pacientes", count: "patients" },
  { key: "ambos", label: "Clientes y pacientes", count: "both" },
  { key: "inactivos", label: "Inactivos", count: "inactive" },
] as const;

export default async function PeoplePage(props: PageProps<"/pacientes">) {
  const ctx = await requirePermission("patients.read");
  const sp = await props.searchParams;
  const params = patientListParams.parse({
    q: typeof sp.q === "string" ? sp.q : undefined,
    cursor: typeof sp.cursor === "string" ? sp.cursor : undefined,
    tipo: typeof sp.tipo === "string" ? sp.tipo : undefined,
  });
  const canCreate = can(ctx.grants, "patients.create");

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Clientes y pacientes" description="Gestiona las personas y sus relaciones con tu óptica"
        actions={canCreate && <Link href="/pacientes/nuevo" className={buttonVariants()}><UserPlus /> Nuevo registro</Link>} />
      <Suspense key={`${params.tipo}:${params.q ?? ""}:${params.cursor ?? ""}`} fallback={<DirectorySkeleton />}>
        <Directory ctx={ctx} params={params} canCreate={canCreate} />
      </Suspense>
    </div>
  );
}

async function Directory({ ctx, params, canCreate }: { ctx: AppContext; params: PatientListParams; canCreate: boolean }) {
  const db = await createClient();
  let summary, list;
  try {
    [summary, list] = await Promise.all([getPeopleSummary(db, ctx.tenant.id), listPatients(db, ctx.tenant.id, params)]);
  } catch {
    return <RetryError message="No pudimos cargar el directorio." />;
  }
  const { rows, nextCursor } = list;
  const canEdit = can(ctx.grants, "patients.update");
  const canToggle = can(ctx.grants, "patients.delete");
  const filter = FILTERS.find((f) => f.key === params.tipo)!;

  const hrefWith = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: params.q, tipo: params.tipo === "todos" ? undefined : params.tipo, ...patch })) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/pacientes?${s}` : "/pacientes";
  };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi icon={ShoppingBag} tone="blue" label="Clientes" value={summary.customers.toLocaleString("es-CO")} note="Compran productos o servicios" />
        <Kpi icon={HeartPulse} tone="green" label="Pacientes" value={summary.patients.toLocaleString("es-CO")} note="Reciben atención optométrica" />
        <Kpi icon={UsersRound} tone="violet" label="Clientes y pacientes" value={summary.both.toLocaleString("es-CO")}
          note={`${plural(summary.total, "persona activa", "personas activas")} en total`} />
      </div>

      {summary.total + summary.inactive === 0 ? (
        <div className="rounded-2xl border bg-surface shadow-soft">
          <EmptyState icon={UsersRound} title="Aún no tienes personas registradas"
            description="Registra a tu primer cliente o paciente. Solo necesitas su documento y nombre."
            action={canCreate && <Link href="/pacientes/nuevo" className={buttonVariants()}><UserPlus /> Crear el primer registro</Link>} />
        </div>
      ) : (
        <section className="min-w-0 rounded-2xl border bg-surface shadow-soft">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
            <nav aria-label="Filtrar por relación" className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
              {FILTERS.map((f) => (
                <Link key={f.key} href={hrefWith({ tipo: f.key === "todos" ? undefined : f.key, cursor: undefined })}
                  aria-current={params.tipo === f.key ? "page" : undefined}
                  className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-sm whitespace-nowrap",
                    params.tipo === f.key ? "bg-surface font-medium shadow-soft" : "text-muted-foreground hover:text-foreground")}>
                  {f.label}<span className="text-xs text-muted-foreground tabular">{summary[f.count]}</span>
                </Link>
              ))}
            </nav>
            <PatientSearch placeholder="Nombre, documento, teléfono o correo" label="Buscar personas" />
          </div>

          {rows.length === 0 ? (
            <EmptyState compact icon={SearchX}
              title={params.q ? `Sin resultados para “${params.q}”` : `No hay registros en “${filter.label}”`}
              description={params.q ? "Revisa la escritura o busca por documento, teléfono o correo." : "Prueba con otro filtro."}
              action={params.q
                ? <Link href={hrefWith({ q: undefined, cursor: undefined })} className={buttonVariants({ variant: "outline", size: "sm" })}>Limpiar búsqueda</Link>
                : canCreate && <Link href="/pacientes/nuevo" className={buttonVariants({ variant: "outline", size: "sm" })}>Nuevo registro</Link>} />
          ) : (
            <>
              {/* Desktop / tablet: table */}
              <table className="hidden w-full text-sm md:table">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Nombre</th><th className="px-4 py-2.5 font-medium">Documento</th>
                    <th className="px-4 py-2.5 font-medium">Teléfono</th><th className="hidden px-4 py-2.5 font-medium xl:table-cell">Correo</th>
                    <th className="px-4 py-2.5 font-medium">Relación</th><th className="px-4 py-2.5 font-medium">Estado</th><th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((p) => {
                    const rel = relationOf(p);
                    return (
                      <tr key={p.id} className="relative hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <Link href={`/pacientes/${p.id}`} className="flex items-center gap-3 font-medium after:absolute after:inset-0 hover:text-brand">
                            <Avatar className="size-8"><AvatarFallback className="text-xs">{initials(p.full_name)}</AvatarFallback></Avatar>
                            <span className="truncate">{p.full_name}</span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular">{p.document_type} {p.document_number}</td>
                        <td className="px-4 py-3 whitespace-nowrap tabular">{p.phone ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="hidden max-w-56 truncate px-4 py-3 xl:table-cell">{p.email ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3"><RelationBadge relation={rel} /></td>
                        <td className="px-4 py-3"><StatusBadge tone={p.is_active ? "success" : "neutral"}>{p.is_active ? "Activo" : "Inactivo"}</StatusBadge></td>
                        <td className="px-2 py-3 text-right"><PersonRowActions id={p.id} name={p.full_name} active={p.is_active} canEdit={canEdit} canToggle={canToggle} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Mobile: cards */}
              <ul className="divide-y md:hidden">
                {rows.map((p) => {
                  const rel = relationOf(p);
                  return (
                    <li key={p.id} className="relative flex items-start gap-3 p-4">
                      <Avatar className="size-9"><AvatarFallback className="text-xs">{initials(p.full_name)}</AvatarFallback></Avatar>
                      <div className="min-w-0 flex-1">
                        <Link href={`/pacientes/${p.id}`} className="block truncate font-medium after:absolute after:inset-0">{p.full_name}</Link>
                        <p className="truncate text-xs text-muted-foreground tabular">{p.document_type} {p.document_number}{p.phone ? ` · ${p.phone}` : ""}</p>
                        {p.email && <p className="truncate text-xs text-muted-foreground">{p.email}</p>}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <RelationBadge relation={rel} />
                          {!p.is_active && <StatusBadge tone="neutral">Inactivo</StatusBadge>}
                        </div>
                      </div>
                      <PersonRowActions id={p.id} name={p.full_name} active={p.is_active} canEdit={canEdit} canToggle={canToggle} />
                    </li>
                  );
                })}
              </ul>

              {(nextCursor || params.cursor) && (
                <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                  {params.cursor ? <Link href={hrefWith({ cursor: undefined })} className="text-muted-foreground hover:text-foreground">← Primera página</Link> : <span />}
                  {nextCursor && <Link href={hrefWith({ cursor: nextCursor })} className={buttonVariants({ variant: "outline", size: "sm" })}>Siguiente →</Link>}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}

function DirectorySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6" aria-busy="true" aria-label="Cargando registros">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[100px] rounded-2xl" />)}</div>
      <Skeleton className="h-[420px] rounded-2xl" />
    </div>
  );
}
