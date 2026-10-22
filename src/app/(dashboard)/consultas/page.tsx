import { ClipboardList, Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { addDaysKey, formatDate, formatTime, zonedTimeToUtc } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { listAppointments } from "@/modules/appointments/repositories/appointments";
import { todayKey } from "@/modules/appointments/utils/agenda";
import { can } from "@/modules/authz/permissions";
import { StartConsultationButton } from "@/modules/clinical/components/start-consultation-button";
import { RECORD_STATUS, RECORD_TYPES } from "@/modules/clinical/constants";
import { listRecords } from "@/modules/clinical/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Consultas" };

export default async function ConsultationsPage(props: PageProps<"/consultas">) {
  const ctx = await requirePermission("medical_records.read");
  await connection();
  const sp = await props.searchParams;
  const status = typeof sp.estado === "string" ? sp.estado : undefined;
  const mine = sp.mias === "1";
  const db = await createClient();
  const today = todayKey(ctx.timezone);
  const canCreate = can(ctx.grants, "medical_records.create");

  const [records, appts] = await Promise.all([
    listRecords(db, ctx.tenant.id, { status, professionalId: mine ? ctx.user.id : undefined }),
    canCreate ? listAppointments(db, ctx.tenant.id, {
      branchId: ctx.activeBranchId, fromUtc: zonedTimeToUtc(today, "00:00", ctx.timezone), toUtc: zonedTimeToUtc(addDaysKey(today, 1), "00:00", ctx.timezone),
      specialistId: ctx.user.id,
    }) : Promise.resolve([]),
  ]);
  const waiting = appts.filter((a) => ["checked_in", "waiting", "in_consultation", "confirmed", "scheduled"].includes(a.status));
  const filters = [{ k: undefined, l: "Todas" }, { k: "draft", l: "Borradores" }, { k: "signed", l: "Firmadas" }, { k: "amended", l: "Enmendadas" }];

  return (
    <>
      <PageHeader title="Consultas" description="Historias clínicas, refracción y fórmulas. Las firmadas quedan congeladas y auditadas." />

      {canCreate && (
        <Panel title="Mis pacientes de hoy" description={waiting.length ? `${waiting.length} por atender` : "Sin pacientes pendientes"} className="mb-6" bodyClassName="p-0">
          {waiting.length === 0 ? <EmptyState icon={Stethoscope} title="No tienes pacientes pendientes 🎉" compact /> : (
            <ul className="divide-y">
              {waiting.map((a) => (
                <li key={a.id} className="flex items-center gap-4 px-4 py-3">
                  <span className="w-20 text-sm font-medium tabular">{formatTime(a.starts_at, ctx.timezone)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.patient?.full_name}</p>
                    <p className="text-xs text-muted-foreground">{a.type?.name}</p>
                  </div>
                  {a.patient && <StartConsultationButton size="sm" patientId={a.patient.id} appointmentId={a.id} label={a.status === "in_consultation" ? "Continuar" : "Atender"} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="flex gap-1 rounded-lg bg-muted p-1">
          {filters.map((f) => (
            <Link key={f.l} href={`/consultas?${new URLSearchParams({ ...(f.k ? { estado: f.k } : {}), ...(mine ? { mias: "1" } : {}) })}`}
              className={cn("rounded-md px-3 py-1 text-sm", status === f.k ? "bg-surface font-medium shadow-soft" : "text-muted-foreground hover:text-foreground")}>{f.l}</Link>
          ))}
        </nav>
        <Link href={`/consultas?${new URLSearchParams({ ...(status ? { estado: status } : {}), ...(mine ? {} : { mias: "1" }) })}`}
          className={cn("rounded-full border px-3 py-1 text-xs", mine ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground")}>Solo mis consultas</Link>
      </div>

      <Panel bodyClassName="p-0">
        {records.length === 0 ? <EmptyState icon={ClipboardList} title="No hay historias con este filtro" /> : (
          <ul className="divide-y">
            {records.map((r) => {
              const st = RECORD_STATUS[r.status as keyof typeof RECORD_STATUS];
              return (
                <li key={r.id} className="relative flex items-center gap-4 px-4 py-3 hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <Link href={`/consultas/${r.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">{r.patient?.full_name}</Link>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{r.number}</span> · {RECORD_TYPES[r.record_type as keyof typeof RECORD_TYPES]} · {r.chief_complaint ?? "Sin motivo"} · {r.professional?.full_name}
                    </p>
                  </div>
                  <span className="hidden text-xs text-muted-foreground sm:block">{formatDate(r.created_at, ctx.timezone)}</span>
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
