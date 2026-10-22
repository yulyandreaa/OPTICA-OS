import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { ripsConfigFrom } from "@/modules/rips/config";
import { GenerateRips, RipsConfigForm } from "@/modules/rips/components";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "RIPS" };
const STATUS: Record<string, { label: string; tone: Tone }> = {
  generated: { label: "Generado", tone: "neutral" }, validating: { label: "Validando", tone: "warning" }, validated: { label: "Validado", tone: "success" },
  rejected: { label: "Con errores", tone: "danger" }, submitted: { label: "Enviado", tone: "brand" }, draft: { label: "Borrador", tone: "neutral" },
};

export default async function RipsPage() {
  const ctx = await requirePermission("rips.read");
  await connection();
  const { data } = await (await createClient()).from("rips_submissions")
    .select("id, period_start, period_end, status, records_count, errors_count, warnings_count, created_at, submitted_at").eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(30);
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { value: d.toISOString().slice(0, 7), label: new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" }).format(d) };
  });
  return (
    <>
      <PageHeader title="RIPS / FEV Salud" description="Generados desde las consultas firmadas. Estructura base de la Resolución 2275 de 2023: valida los códigos con tu proveedor tecnológico." />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-4">
          {can(ctx.grants, "rips.manage") && <Panel title="Generar RIPS"><GenerateRips months={months} /></Panel>}
          <Panel title="Historial" bodyClassName="p-0">
            {(data ?? []).length === 0 ? <EmptyState icon={ClipboardList} title="Aún no has generado RIPS" compact /> : (
              <ul className="divide-y">{(data ?? []).map((s) => (
                <li key={s.id} className="relative flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <Link href={`/rips/${s.id}`} className="font-medium capitalize after:absolute after:inset-0">{new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${s.period_start}T12:00:00Z`))}</Link>
                    <p className="text-xs text-muted-foreground">{s.records_count} consultas · {s.errors_count} errores · {s.warnings_count} advertencias · {formatDate(s.created_at, ctx.timezone)}</p>
                  </div>
                  <StatusBadge tone={STATUS[s.status]?.tone}>{STATUS[s.status]?.label}</StatusBadge>
                </li>))}
              </ul>
            )}
          </Panel>
        </div>
        <Panel title="Configuración" description="Códigos del prestador. Las URL de Minsalud solo se configuran por variables de entorno.">
          {can(ctx.grants, "settings.manage") ? <RipsConfigForm config={ripsConfigFrom(ctx.tenant.settings, ctx.tenant.tax_id)} /> : <p className="text-sm text-muted-foreground">Solo un administrador puede cambiar la configuración.</p>}
        </Panel>
      </div>
    </>
  );
}
