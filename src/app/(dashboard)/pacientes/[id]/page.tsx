import {
  CalendarDays, CalendarPlus, Clock3, FileHeart, Mail, MapPin, MessageCircle, Pencil, Phone,
  Receipt, ShieldCheck, ShoppingBag, Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { formatAge, formatDate, formatTime, initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { cn } from "@/lib/utils";
import { statusMeta } from "@/modules/appointments/utils/status";
import { can, type Permission } from "@/modules/authz/permissions";
import { PersonActiveButton } from "@/modules/patients/components/person-active-button";
import { RelationBadge } from "@/modules/patients/components/relation-badge";
import {
  getPatient, getPatientAppointments, getPatientConsents, getPatientTimeline,
} from "@/modules/patients/repositories/patients";
import { CONTACT_PREFERENCES, HEALTH_REGIMES, PATIENT_SOURCES, relationOf } from "@/modules/patients/schemas";
import { requirePermission } from "@/modules/tenants/services/context";
import { StartConsultationButton } from "@/modules/clinical/components/start-consultation-button";
import { RxTable } from "@/modules/clinical/components/rx-table";
import { RECORD_STATUS, RECORD_TYPES, LENS_TYPES } from "@/modules/clinical/constants";
import { listPatientPrescriptions } from "@/modules/clinical/repositories";
import { PAYMENT_METHOD_LABEL, SALE_STATUS, QUOTE_STATUS } from "@/modules/sales/constants";
import { LAB_STATUS, type LabStatus } from "@/modules/labs/constants";
import { INVOICE_STATUS } from "@/modules/billing/constants";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Ficha de la persona" };

/**
 * Tabs only appear when the user holds the permission behind them. Clinical tabs additionally need the
 * person to be a patient: commercial users never see clinical sections, not even as "no access".
 */
const TABS = [
  { key: "resumen", label: "Información personal" },
  { key: "compras", label: "Compras y pagos", permission: "sales.read" },
  { key: "cotizaciones", label: "Cotizaciones", permission: "quotes.read" },
  { key: "facturas", label: "Facturas", permission: "billing.read" },
  { key: "ordenes", label: "Órdenes ópticas", permission: "lab_orders.read" },
  { key: "citas", label: "Citas", permission: "appointments.read", clinical: true },
  { key: "historia", label: "Historia clínica", permission: "medical_records.read", clinical: true },
  { key: "formulas", label: "Fórmulas", permission: "prescriptions.read", clinical: true },
  { key: "documentos", label: "Documentos", phase: 11 },
  { key: "conversaciones", label: "Conversaciones", phase: 9 },
  { key: "actividad", label: "Actividad" },
] as const satisfies readonly { key: string; label: string; permission?: Permission; clinical?: boolean; phase?: number }[];

const UPCOMING_TAB_COPY: Record<string, { icon: typeof FileHeart; text: string }> = {
  documentos: { icon: FileHeart, text: "Consentimientos firmados, exámenes y adjuntos en almacenamiento privado con enlaces temporales." },
  conversaciones: { icon: MessageCircle, text: "Conversaciones de WhatsApp y correo con el paciente, cuando conectes WhatsApp Cloud API." },
};

export default async function PatientPage(props: PageProps<"/pacientes/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const ctx = await requirePermission("patients.read");
  const db = await createClient();
  const patient = await getPatient(db, ctx.tenant.id, id);
  if (!patient) notFound();
  const visibleTabs = TABS.filter((t) => (!("permission" in t) || can(ctx.grants, t.permission)) && (!("clinical" in t) || patient.is_patient));
  const tab = visibleTabs.find((t) => t.key === sp.tab)?.key ?? "resumen";
  const showClinicalAdmin = patient.is_patient && can(ctx.grants, "medical_records.read");

  const canReadAppts = can(ctx.grants, "appointments.read") && patient.is_patient;
  const [appointments, timeline, consents] = await Promise.all([
    canReadAppts ? getPatientAppointments(db, ctx.tenant.id, id) : Promise.resolve([]),
    getPatientTimeline(db, ctx.tenant.id, id),
    getPatientConsents(db, ctx.tenant.id, id),
  ]);

  const tabData = await loadTab(db, ctx, id, tab);
  const now = await nowMs();
  const upcoming = appointments.filter((a) => new Date(a.starts_at).getTime() >= now && !["cancelled", "no_show"].includes(a.status)).reverse();
  const lastVisit = appointments.find((a) => a.status === "completed");
  const age = formatAge(patient.birth_date);
  const tz = ctx.timezone;
  const whatsapp = patient.whatsapp ?? patient.phone;
  const tabHref = (key: string) => (key === "resumen" ? `/pacientes/${id}` : `/pacientes/${id}?tab=${key}`);

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="size-14 border"><AvatarFallback className="bg-brand-soft text-lg font-medium text-brand">{initials(patient.full_name)}</AvatarFallback></Avatar>
          <div className="min-w-0">
            <Link href="/pacientes" className="text-xs text-muted-foreground hover:text-foreground">Clientes y pacientes</Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{patient.full_name}</h1>
              <RelationBadge relation={relationOf(patient)} />
              {!patient.is_active && <StatusBadge tone="neutral">Inactivo</StatusBadge>}
            </div>
            <p className="text-sm text-muted-foreground tabular">
              {patient.document_type} {patient.document_number}{age && ` · ${age}`}{patient.home_branch && ` · ${patient.home_branch.name}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {whatsapp && (
            <a href={`https://wa.me/${whatsapp.replace(/\D/g, "").replace(/^(?!57)(\d{10})$/, "57$1")}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
              <MessageCircle /> WhatsApp
            </a>
          )}
          {can(ctx.grants, "patients.update") && <Link href={`/pacientes/${id}/editar`} className={buttonVariants({ variant: "outline" })}><Pencil /> Editar</Link>}
          {can(ctx.grants, "patients.delete") && <PersonActiveButton id={id} name={patient.full_name} active={patient.is_active} />}
          {patient.is_active && can(ctx.grants, "quotes.create") && <Link href={`/cotizaciones/nueva?paciente=${id}`} className={buttonVariants({ variant: "outline" })}><Receipt /> Cotizar</Link>}
          {patient.is_active && can(ctx.grants, "sales.create") && <Link href={`/ventas/nueva?cliente=${id}`} className={buttonVariants({ variant: "outline" })}><ShoppingBag /> Vender</Link>}
          {patient.is_active && can(ctx.grants, "medical_records.create") && <StartConsultationButton variant="outline" patientId={id} />}
          {patient.is_active && can(ctx.grants, "appointments.create") && <Link href={`/agenda?nueva=1&paciente=${id}`} className={buttonVariants()}><CalendarPlus /> Agendar cita</Link>}
        </div>
      </div>

      {!patient.is_active && (
        <p className="rounded-xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          Registro inactivo{patient.deactivated_at ? ` desde el ${formatDate(patient.deactivated_at, tz)}` : ""}. Su historial se conserva; para venderle o agendarle, reactívalo.
        </p>
      )}

      {/* Tabs */}
      <nav className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0" aria-label="Secciones de la ficha">
        <ul className="flex min-w-max gap-1">
          {visibleTabs.map((t) => (
            <li key={t.key}>
              <Link href={tabHref(t.key)} aria-current={tab === t.key ? "page" : undefined}
                className={cn("inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
                  tab === t.key ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
                {t.key === "citas" && appointments.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular">{appointments.length}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Identity column */}
        <div className="grid content-start gap-4">
          <Panel title="Contacto">
            <dl className="grid gap-3 text-sm">
              <InfoRow icon={Phone} label="Celular" value={patient.phone} />
              <InfoRow icon={Mail} label="Correo" value={patient.email} />
              <InfoRow icon={MapPin} label="Dirección" value={[patient.address, patient.city].filter(Boolean).join(", ") || null} />
              <InfoRow icon={MessageCircle} label="Prefiere" value={CONTACT_PREFERENCES[patient.contact_preference as keyof typeof CONTACT_PREFERENCES]} />
            </dl>
          </Panel>
          <Panel title="Datos personales">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field label="Nacimiento" value={patient.birth_date ? `${formatDate(`${patient.birth_date}T12:00:00Z`, tz)} · ${age}` : null} />
              {showClinicalAdmin && <Field label="Sexo" value={{ M: "Masculino", F: "Femenino", I: "Indeterminado" }[patient.sex ?? ""] ?? null} />}
              {showClinicalAdmin && <Field label="EPS" value={patient.eps} />}
              {showClinicalAdmin && <Field label="Régimen" value={patient.health_regime ? HEALTH_REGIMES[patient.health_regime as keyof typeof HEALTH_REGIMES] : null} />}
              <Field label="Ocupación" value={patient.occupation} />
              <Field label="Origen" value={patient.source ? PATIENT_SOURCES[patient.source as keyof typeof PATIENT_SOURCES] : null} />
              <Field label="Emergencia" value={patient.emergency_contact_name ? `${patient.emergency_contact_name} · ${patient.emergency_contact_phone ?? ""}` : null} className="col-span-2" />
            </dl>
          </Panel>
          <Panel title="Consentimientos" action={<ShieldCheck className="size-4 text-muted-foreground" />}>
            {consents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin consentimientos registrados.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {consents.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span>{{ data_processing: "Tratamiento de datos", marketing: "Comunicaciones", clinical: "Clínico", telemedicine: "Telemedicina" }[c.consent_type]}</span>
                    <StatusBadge tone={c.granted && !c.revoked_at ? "success" : "danger"}>v{c.version}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Main column */}
        <div className="grid content-start gap-4">
          {tab === "resumen" && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {canReadAppts && <MiniStat label="Próxima cita" value={upcoming[0] ? `${formatDate(upcoming[0].starts_at, tz, { day: "numeric", month: "short" })} · ${formatTime(upcoming[0].starts_at, tz)}` : "Sin agendar"} />}
                {canReadAppts && <MiniStat label="Última consulta" value={lastVisit ? formatDate(lastVisit.starts_at, tz) : "Sin consultas"} />}
                <MiniStat label="Registrado desde" value={formatDate(patient.created_at, tz, { month: "long", year: "numeric" })} />
              </div>
              {lastVisit && now - new Date(lastVisit.starts_at).getTime() > 365 * 86_400_000 && (
                <div className="flex items-start gap-3 rounded-xl border border-brand/20 bg-brand-soft p-4 text-sm">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />
                  <p><b>Oportunidad:</b> han pasado más de 12 meses desde su última consulta. Es buen momento para invitarlo a un control visual.</p>
                </div>
              )}
              {patient.notes && <Panel title="Notas internas"><p className="text-sm whitespace-pre-line text-muted-foreground">{patient.notes}</p></Panel>}
              <Panel title="Actividad reciente" action={<Link href={tabHref("actividad")} className="text-xs text-muted-foreground hover:text-foreground">Ver todo</Link>}>
                <Timeline items={timeline.slice(0, 6)} tz={tz} />
              </Panel>
            </>
          )}

          {tab === "citas" && (
            <Panel title="Citas" bodyClassName="p-0">
              {appointments.length === 0 ? (
                <EmptyState icon={CalendarDays} title="Sin citas todavía" compact
                  action={can(ctx.grants, "appointments.create") && <Link href={`/agenda?nueva=1&paciente=${id}`} className={buttonVariants({ size: "sm" })}>Agendar cita</Link>} />
              ) : (
                <ul className="divide-y">
                  {appointments.map((a) => {
                    const meta = statusMeta(a.status);
                    return (
                      <li key={a.id} className="flex items-center gap-4 px-4 py-3">
                        <span className="h-9 w-1 rounded-full" style={{ background: a.type?.color ?? "var(--border)" }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{a.type?.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatDate(a.starts_at, tz, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {formatTime(a.starts_at, tz)}
                            {a.specialist && ` · ${a.specialist.full_name}`}{a.branch && ` · ${a.branch.name}`}
                          </p>
                        </div>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          {tab === "actividad" && <Panel title="Actividad"><Timeline items={timeline} tz={tz} /></Panel>}
          {tabData}

          {UPCOMING_TAB_COPY[tab] && (() => {
            const copy = UPCOMING_TAB_COPY[tab]!;
            const phase = TABS.find((t) => t.key === tab && "phase" in t);
            return (
              <Panel>
                <EmptyState icon={copy.icon} title="Este módulo llega muy pronto" description={copy.text}
                  action={phase && "phase" in phase && <StatusBadge tone="brand" dot={false}>Fase {phase.phase} del roadmap</StatusBadge>} />
              </Panel>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className={cn("truncate", !value && "text-muted-foreground")}>{value || "—"}</dd>
      </div>
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string | null | undefined; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", !value && "text-muted-foreground")}>{value || "—"}</dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-surface p-4 shadow-soft">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function Timeline({ items, tz }: { items: { id: string; title: string; occurred_at: string; actor: { full_name: string } | null }[]; tz: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Sin actividad registrada.</p>;
  return (
    <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
      {items.map((i) => (
        <li key={i.id} className="relative flex gap-3 pl-6">
          <span className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-surface bg-brand ring-1 ring-border" />
          <div className="min-w-0">
            <p className="text-sm">{i.title}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="size-3" /> {formatDate(i.occurred_at, tz, { day: "numeric", month: "short", year: "numeric" })} · {formatTime(i.occurred_at, tz)}
              {i.actor?.full_name && ` · ${i.actor.full_name}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}


type Ctx = Awaited<ReturnType<typeof requirePermission>>;

/** Loads and renders the commercial / clinical tabs of the 360° profile (only what the user may read). */
async function loadTab(db: Awaited<ReturnType<typeof createClient>>, ctx: Ctx, patientId: string, tab: string) {
  const tz = ctx.timezone;
  const t = ctx.tenant.id;
  const row = (href: string, title: React.ReactNode, sub: React.ReactNode, right: React.ReactNode, key: string) => (
    <li key={key} className="relative flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
      <div className="min-w-0 flex-1"><Link href={href} className="block truncate text-sm font-medium after:absolute after:inset-0">{title}</Link><p className="truncate text-xs text-muted-foreground">{sub}</p></div>
      {right}
    </li>
  );
  const empty = (title: string) => <Panel><EmptyState icon={FileHeart} title={title} compact /></Panel>;

  if (tab === "historia") {
    if (!can(ctx.grants, "medical_records.read")) return empty("No tienes acceso a la historia clínica");
    const { data } = await db.from("medical_records").select("id, number, status, record_type, chief_complaint, created_at, professional:profiles!medical_records_professional_profile_fkey(full_name)").eq("tenant_id", t).eq("patient_id", patientId).order("created_at", { ascending: false });
    if (!data?.length) return empty("Sin historias clínicas");
    return <Panel title="Historia clínica" bodyClassName="p-0"><ul className="divide-y">{data.map((r) => {
      const st = RECORD_STATUS[r.status as keyof typeof RECORD_STATUS];
      return row(`/consultas/${r.id}`, `${RECORD_TYPES[r.record_type as keyof typeof RECORD_TYPES]} · ${r.chief_complaint ?? "Sin motivo"}`, `${r.number} · ${formatDate(r.created_at, tz)} · ${r.professional?.full_name ?? ""}`, <StatusBadge tone={st.tone}>{st.label}</StatusBadge>, r.id);
    })}</ul></Panel>;
  }
  if (tab === "formulas") {
    if (!can(ctx.grants, "prescriptions.read")) return empty("No tienes acceso a las fórmulas");
    const rx = await listPatientPrescriptions(db, t, patientId);
    if (!rx.length) return empty("Sin fórmulas emitidas");
    return <>{rx.map((r, i) => (
      <Panel key={r.id} title={`${r.number}${i === 0 ? " · vigente" : ""}`} description={`${formatDate(r.issued_at, tz)} · ${r.professional?.full_name ?? ""} · ${LENS_TYPES[r.lens_type as keyof typeof LENS_TYPES] ?? "—"}`}
        action={<Link href={`/print/formula/${r.id}`} target="_blank" className="text-xs text-muted-foreground hover:text-foreground">Imprimir</Link>}>
        <RxTable rx={r} />
      </Panel>))}</>;
  }
  if (tab === "compras") {
    if (!can(ctx.grants, "sales.read")) return empty("No tienes acceso a ventas");
    const { data } = await db.from("sales").select("id, number, status, total, balance, created_at").eq("tenant_id", t).eq("patient_id", patientId).order("created_at", { ascending: false });
    if (!data?.length) return empty("Sin compras todavía");
    // Same rule as the dashboard: cancelled and returned sales don't count as purchases or debt.
    const valid = data.filter((s) => s.status === "completed" || s.status === "partially_returned");
    const total = valid.reduce((a, s) => a + Number(s.total), 0);
    const balance = valid.reduce((a, s) => a + Number(s.balance), 0);
    const { data: payments } = await db.from("payments").select("id, method, amount, created_at, sale:sales!inner(id, number, patient_id)")
      .eq("tenant_id", t).eq("sale.patient_id", patientId).order("created_at", { ascending: false }).limit(20);
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat label="Total comprado" value={formatMoney(total)} />
          <MiniStat label="Saldo pendiente" value={formatMoney(balance)} />
          <MiniStat label="Compras" value={String(valid.length)} />
        </div>
        <Panel title="Compras" bodyClassName="p-0"><ul className="divide-y">{data.map((s) =>
          row(`/ventas/${s.id}`, <span className="font-mono">{s.number}</span>, `${formatDate(s.created_at, tz)}${Number(s.balance) > 0 && s.status !== "voided" && s.status !== "returned" ? ` · saldo ${formatMoney(s.balance)}` : ""}`,
            <span className="flex items-center gap-3"><span className="text-sm tabular">{formatMoney(s.total)}</span><StatusBadge tone={SALE_STATUS[s.status]?.tone}>{SALE_STATUS[s.status]?.label}</StatusBadge></span>, s.id))}</ul></Panel>
        <Panel title="Pagos recibidos" description="Últimos 20" bodyClassName="p-0">
          {!payments?.length ? <p className="px-4 py-6 text-sm text-muted-foreground">Sin pagos registrados.</p> : (
            <ul className="divide-y">{payments.map((p) =>
              row(`/ventas/${p.sale.id}`, PAYMENT_METHOD_LABEL[p.method] ?? p.method, `${formatDate(p.created_at, tz)} · venta ${p.sale.number}`,
                <span className="text-sm font-medium tabular">{formatMoney(p.amount)}</span>, p.id))}</ul>
          )}
        </Panel>
      </>
    );
  }
  if (tab === "cotizaciones") {
    if (!can(ctx.grants, "quotes.read")) return empty("No tienes acceso a cotizaciones");
    const { data } = await db.from("quotes").select("id, number, status, total, created_at, valid_until").eq("tenant_id", t).eq("patient_id", patientId).order("created_at", { ascending: false });
    if (!data?.length) return empty("Sin cotizaciones");
    return <Panel title="Cotizaciones" bodyClassName="p-0"><ul className="divide-y">{data.map((q) =>
      row(`/cotizaciones/${q.id}`, <span className="font-mono">{q.number}</span>, `${formatDate(q.created_at, tz)} · vence ${formatDate(`${q.valid_until}T12:00:00Z`, "UTC")}`,
        <span className="flex items-center gap-3"><span className="text-sm tabular">{formatMoney(q.total)}</span><StatusBadge tone={QUOTE_STATUS[q.status]?.tone}>{QUOTE_STATUS[q.status]?.label}</StatusBadge></span>, q.id))}</ul></Panel>;
  }
  if (tab === "ordenes") {
    if (!can(ctx.grants, "lab_orders.read")) return empty("No tienes acceso a órdenes");
    const { data } = await db.from("lab_orders").select("id, number, status, frame_description, lens_description, created_at").eq("tenant_id", t).eq("patient_id", patientId).order("created_at", { ascending: false });
    if (!data?.length) return empty("Sin órdenes de laboratorio");
    return <Panel title="Órdenes de laboratorio" bodyClassName="p-0"><ul className="divide-y">{data.map((o) =>
      row(`/ordenes/${o.id}`, `${o.frame_description ?? "Montura propia"} · ${o.lens_description ?? "Lentes"}`, `${o.number} · ${formatDate(o.created_at, tz)}`,
        <StatusBadge tone={LAB_STATUS[o.status as LabStatus].tone}>{LAB_STATUS[o.status as LabStatus].label}</StatusBadge>, o.id))}</ul></Panel>;
  }
  if (tab === "facturas") {
    if (!can(ctx.grants, "billing.read")) return empty("No tienes acceso a facturación");
    const { data: sales } = await db.from("sales").select("id").eq("tenant_id", t).eq("patient_id", patientId);
    const ids = (sales ?? []).map((s) => s.id);
    if (!ids.length) return empty("Sin facturas");
    const { data } = await db.from("invoices").select("id, number, status, total, issued_at, created_at, sale_id").eq("tenant_id", t).in("sale_id", ids).order("created_at", { ascending: false });
    if (!data?.length) return empty("Sin facturas");
    return <Panel title="Facturas" bodyClassName="p-0"><ul className="divide-y">{data.map((i) =>
      row(`/ventas/${i.sale_id}`, <span className="font-mono">{i.number ?? "Sin número"}</span>, formatDate(i.issued_at ?? i.created_at, tz),
        <span className="flex items-center gap-3"><span className="text-sm tabular">{formatMoney(i.total)}</span><StatusBadge tone={INVOICE_STATUS[i.status]?.tone}>{INVOICE_STATUS[i.status]?.label}</StatusBadge></span>, i.id))}</ul></Panel>;
  }
  return null;
}
