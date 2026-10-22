import { Lock, Printer, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { ageFrom, formatDate, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { AmendDialog } from "@/modules/clinical/components/amend-dialog";
import { RecordEditor } from "@/modules/clinical/components/record-editor";
import { RxTable } from "@/modules/clinical/components/rx-table";
import { LENS_MATERIALS, LENS_TYPES, RECORD_STATUS, RECORD_TYPES, TREATMENTS, type Exam } from "@/modules/clinical/constants";
import { getAmendments, getRecord } from "@/modules/clinical/repositories";
import type { RecordInput } from "@/modules/clinical/schemas";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Historia clínica" };

export default async function RecordPage(props: PageProps<"/consultas/[id]">) {
  const { id } = await props.params;
  const ctx = await requirePermission("medical_records.read");
  const db = await createClient();
  const r = await getRecord(db, ctx.tenant.id, id);
  if (!r) notFound();
  const st = RECORD_STATUS[r.status as keyof typeof RECORD_STATUS];
  const tz = ctx.timezone;
  const age = ageFrom(r.patient?.birth_date);
  const header = (
    <PageHeader
      eyebrow={<Link href="/consultas" className="hover:text-foreground">Consultas</Link>}
      title={<span className="flex items-center gap-3">{r.patient?.full_name} <StatusBadge tone={st.tone}>{st.label}</StatusBadge></span>}
      description={`${r.number} · ${RECORD_TYPES[r.record_type as keyof typeof RECORD_TYPES]} · ${r.patient?.document_type} ${r.patient?.document_number}${age !== null ? ` · ${age} años` : ""} · ${r.professional?.full_name}`}
      actions={r.patient && <Link href={`/pacientes/${r.patient.id}?tab=historia`} className={buttonVariants({ variant: "outline" })}>Ver paciente</Link>}
    />
  );

  if (r.status === "draft") {
    const editable = r.professional_id === ctx.user.id && can(ctx.grants, "medical_records.create");
    if (!editable) {
      return <>{header}<Panel><p className="text-sm text-muted-foreground">Borrador en curso por {r.professional?.full_name}. Solo el profesional tratante puede editarlo.</p></Panel></>;
    }
    const initial: RecordInput = {
      record_type: r.record_type as RecordInput["record_type"],
      chief_complaint: r.chief_complaint ?? "", current_illness: r.current_illness ?? "", personal_history: r.personal_history ?? "",
      family_history: r.family_history ?? "", ocular_history: r.ocular_history ?? "", allergies: r.allergies ?? "", medications: r.medications ?? "",
      surgeries: r.surgeries ?? "", habits: r.habits ?? "", symptoms: r.symptoms ?? "", external_exam: r.external_exam ?? "", observations: r.observations ?? "",
      exam: (r.exam ?? {}) as RecordInput["exam"], diagnoses: (r.diagnoses ?? []) as RecordInput["diagnoses"],
      plan: r.plan ?? "", recommendations: r.recommendations ?? "", lens_recommendation: (r.lens_recommendation ?? {}) as RecordInput["lens_recommendation"],
    };
    return <>{header}<RecordEditor recordId={r.id} initial={initial} patientName={r.patient?.full_name ?? ""} canSign={can(ctx.grants, "medical_records.sign")} /></>;
  }

  const [amendments, { data: rx }] = await Promise.all([
    getAmendments(db, ctx.tenant.id, r.id),
    db.from("prescriptions").select("*").eq("tenant_id", ctx.tenant.id).eq("record_id", r.id).maybeSingle(),
  ]);
  const exam = (r.exam ?? {}) as Exam;
  const dx = (r.diagnoses ?? []) as { code: string; label: string }[];
  const lens = (r.lens_recommendation ?? {}) as { type?: string; material?: string; treatments?: string[] };
  const field = (label: string, value: string | null | undefined) => value ? (
    <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm whitespace-pre-line">{value}</dd></div>
  ) : null;

  return (
    <>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-success/25 bg-success-soft px-4 py-3 text-sm">
        <Lock className="size-4 text-success" />
        <span>Firmada el {r.signed_at && `${formatDate(r.signed_at, tz)} · ${formatTime(r.signed_at, tz)}`}. Contenido congelado.</span>
        <span className="font-mono text-xs text-muted-foreground" title="SHA-256 del contenido firmado">#{r.content_hash?.slice(0, 16)}</span>
        <div className="ml-auto flex gap-2">
          {rx && <Link href={`/print/formula/${rx.id}`} target="_blank" className={buttonVariants({ variant: "outline", size: "sm" })}><Printer /> Imprimir fórmula</Link>}
          {can(ctx.grants, "medical_records.amend") && <AmendDialog recordId={r.id} current={{ plan: r.plan, recommendations: r.recommendations, observations: r.observations }} />}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-4">
          {rx && (
            <Panel title={`Fórmula ${rx.number}`} description={`Válida hasta ${formatDate(rx.expires_at ?? rx.issued_at, tz)}`}>
              <RxTable rx={rx} />
              <p className="mt-3 text-xs text-muted-foreground">DP {rx.dp_binocular ?? "—"} mm{rx.height_od ? ` · Altura OD ${rx.height_od} / OI ${rx.height_oi}` : ""}</p>
            </Panel>
          )}
          <Panel title="Anamnesis y antecedentes">
            <dl className="grid gap-3 sm:grid-cols-2">
              {field("Motivo de consulta", r.chief_complaint)}{field("Enfermedad actual", r.current_illness)}{field("Síntomas", r.symptoms)}
              {field("Antecedentes personales", r.personal_history)}{field("Familiares", r.family_history)}{field("Oculares", r.ocular_history)}
              {field("Alergias", r.allergies)}{field("Medicamentos", r.medications)}{field("Cirugías", r.surgeries)}{field("Hábitos", r.habits)}
              {field("Examen externo", r.external_exam)}
            </dl>
          </Panel>
          <Panel title="Examen">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">AV SC lejos</dt><dd className="tabular">OD {exam.va?.od?.sc_far ?? "—"} · OI {exam.va?.oi?.sc_far ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">AV CC lejos</dt><dd className="tabular">OD {exam.va?.od?.cc_far ?? "—"} · OI {exam.va?.oi?.cc_far ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Cerca</dt><dd className="tabular">OD {exam.va?.od?.cc_near ?? "—"} · OI {exam.va?.oi?.cc_near ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Queratometría OD</dt><dd className="tabular">{exam.keratometry?.od ? `${exam.keratometry.od.k1} / ${exam.keratometry.od.k2} × ${exam.keratometry.od.axis}°` : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Queratometría OI</dt><dd className="tabular">{exam.keratometry?.oi ? `${exam.keratometry.oi.k1} / ${exam.keratometry.oi.k2} × ${exam.keratometry.oi.axis}°` : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">PIO</dt><dd className="tabular">OD {exam.iop?.od ?? "—"} · OI {exam.iop?.oi ?? "—"} mmHg</dd></div>
            </dl>
          </Panel>
        </div>
        <div className="grid content-start gap-4">
          <Panel title="Diagnóstico y plan">
            <ul className="mb-3 grid gap-1.5">{dx.map((d) => <li key={d.code} className="text-sm"><span className="font-mono text-xs text-muted-foreground">{d.code}</span> {d.label}</li>)}</ul>
            <dl className="grid gap-3">{field("Plan", r.plan)}{field("Recomendaciones", r.recommendations)}{field("Observaciones", r.observations)}</dl>
          </Panel>
          <Panel title="Recomendación de lentes">
            <p className="text-sm">{LENS_TYPES[lens.type as keyof typeof LENS_TYPES] ?? "—"} · {LENS_MATERIALS[lens.material as keyof typeof LENS_MATERIALS] ?? "—"}</p>
            <div className="mt-2 flex flex-wrap gap-1">{(lens.treatments ?? []).map((t) => <StatusBadge key={t} dot={false} tone="brand">{TREATMENTS[t as keyof typeof TREATMENTS] ?? t}</StatusBadge>)}</div>
          </Panel>
          <Panel title="Trazabilidad" action={<ShieldCheck className="size-4 text-muted-foreground" />}>
            {amendments.length === 0 ? <p className="text-sm text-muted-foreground">Sin enmiendas. Versión original.</p> : (
              <ol className="grid gap-3">
                {amendments.map((a) => (
                  <li key={a.id} className="rounded-lg bg-muted/60 p-3 text-sm">
                    <p className="font-medium">{a.reason}</p>
                    <p className="text-xs text-muted-foreground">{a.author?.full_name} · {formatDate(a.amended_at, tz)} {formatTime(a.amended_at, tz)} · <span className="font-mono">#{a.content_hash.slice(0, 10)}</span></p>
                    <p className="mt-1 text-xs text-muted-foreground">Campos: {Object.keys(a.changes as Record<string, unknown>).join(", ")}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
