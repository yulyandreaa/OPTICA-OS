import { ChevronRight, UserPlus, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { ageFrom, formatDate, initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { can } from "@/modules/authz/permissions";
import { PatientSearch } from "@/modules/patients/components/patient-search";
import { countPatients, listPatients } from "@/modules/patients/repositories/patients";
import { PATIENT_SOURCES, patientListParams } from "@/modules/patients/schemas";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Pacientes" };

const SEGMENTS = [
  { key: "all", label: "Todos" },
  { key: "new", label: "Nuevos (30 días)" },
] as const;

export default async function PatientsPage(props: PageProps<"/pacientes">) {
  const ctx = await requirePermission("patients.read");
  const sp = await props.searchParams;
  const params = patientListParams.parse({
    q: typeof sp.q === "string" ? sp.q : undefined,
    cursor: typeof sp.cursor === "string" ? sp.cursor : undefined,
    segment: typeof sp.segment === "string" ? sp.segment : undefined,
  });
  const db = await createClient();
  const [{ rows, nextCursor }, total] = await Promise.all([listPatients(db, ctx.tenant.id, params), countPatients(db, ctx.tenant.id)]);
  const canCreate = can(ctx.grants, "patients.create");

  const hrefWith = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: params.q, segment: params.segment === "all" ? undefined : params.segment, ...patch })) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `/pacientes?${s}` : "/pacientes";
  };

  return (
    <>
      <PageHeader
        title="Pacientes"
        description={`${total.toLocaleString("es-CO")} pacientes en ${ctx.tenant.trade_name}`}
        actions={canCreate && (
          <Link href="/pacientes/nuevo" className={buttonVariants()}><UserPlus /> Nuevo paciente</Link>
        )}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PatientSearch />
        <nav className="flex gap-1 rounded-lg bg-muted p-1" aria-label="Segmentos">
          {SEGMENTS.map((s) => (
            <Link key={s.key} href={hrefWith({ segment: s.key === "all" ? undefined : s.key, cursor: undefined })}
              className={cn("rounded-md px-3 py-1 text-sm transition-colors", params.segment === s.key ? "bg-surface font-medium shadow-soft" : "text-muted-foreground hover:text-foreground")}>
              {s.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {rows.length === 0 ? (
          params.q ? (
            <EmptyState icon={UsersRound} title={`No encontramos “${params.q}”`} description="Busca por nombre, número de documento o celular."
              action={canCreate && <Link href="/pacientes/nuevo" className={buttonVariants({ variant: "outline" })}><UserPlus /> Registrar paciente</Link>} />
          ) : (
            <EmptyState icon={UsersRound} title="Aún no tienes pacientes" description="Registra tu primer paciente o impórtalos desde tu sistema anterior."
              action={canCreate && <Link href="/pacientes/nuevo" className={buttonVariants()}><UserPlus /> Registrar paciente</Link>} />
          )
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Paciente</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Documento</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Contacto</th>
                <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Origen</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Registro</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const age = ageFrom(p.birth_date);
                return (
                  <tr key={p.id} className="group relative transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/pacientes/${p.id}`} className="flex items-center gap-3 after:absolute after:inset-0">
                        <Avatar className="size-8"><AvatarFallback className="bg-muted text-[11px]">{initials(p.full_name)}</AvatarFallback></Avatar>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.full_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {age !== null ? `${age} años` : "Edad sin registrar"}{p.city ? ` · ${p.city}` : ""}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground tabular md:table-cell">{p.document_type} {p.document_number}</td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="block tabular">{p.phone ?? "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.email}</span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground xl:table-cell">{p.source ? PATIENT_SOURCES[p.source as keyof typeof PATIENT_SOURCES] : "—"}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">{formatDate(p.created_at, ctx.timezone)}</td>
                    <td className="pr-3"><ChevronRight className="size-4 text-muted-foreground/50 group-hover:text-foreground" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(params.cursor || nextCursor) && (
        <div className="mt-4 flex justify-between">
          {params.cursor ? <Link href={hrefWith({ cursor: undefined })} className={buttonVariants({ variant: "ghost" })}>← Inicio</Link> : <span />}
          {nextCursor && <Link href={hrefWith({ cursor: nextCursor })} className={buttonVariants({ variant: "outline" })}>Siguientes →</Link>}
        </div>
      )}
    </>
  );
}
