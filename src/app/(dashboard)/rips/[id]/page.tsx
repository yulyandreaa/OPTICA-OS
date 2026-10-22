import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { DownloadJson, SubmitRips } from "@/modules/rips/components";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "RIPS" };

export default async function RipsDetail(props: PageProps<"/rips/[id]">) {
  const { id } = await props.params;
  const ctx = await requirePermission("rips.read");
  const { data: s } = await (await createClient()).from("rips_submissions").select("*").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  if (!s) notFound();
  const v = s.validation as { errors?: { path: string; message: string; recordId?: string }[]; warnings?: { path: string; message: string }[] };
  const period = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${s.period_start}T12:00:00Z`));
  const preview = JSON.stringify(s.payload, (k, val) => (k === "_recordId" ? undefined : val), 2);
  return (
    <>
      <PageHeader eyebrow={<Link href="/rips" className="hover:text-foreground">RIPS</Link>} title={<span className="capitalize">{period}</span>}
        description={`${s.records_count} consultas · esquema ${s.schema_version}${s.provider_ref ? ` · ref. ${s.provider_ref}` : ""}`}
        actions={<><DownloadJson filename={`RIPS-${s.period_start.slice(0, 7)}.json`} json={s.payload} />
          {can(ctx.grants, "rips.manage") && s.status !== "submitted" && <SubmitRips id={s.id} disabled={s.status !== "validated"} />}</>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid content-start gap-4">
          <Panel title="Validación">
            {(v.errors ?? []).length === 0 ? <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> Sin errores estructurales.</p> : (
              <ul className="grid gap-2">{v.errors!.slice(0, 50).map((e, i) => (
                <li key={i} className="flex gap-2 text-sm"><XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <span>{e.message}{e.recordId && <> · <Link href={`/consultas/${e.recordId}`} className="text-brand hover:underline">ver consulta</Link></>}<span className="block font-mono text-[10px] text-muted-foreground">{e.path}</span></span></li>))}
              </ul>
            )}
          </Panel>
          {(v.warnings ?? []).length > 0 && (
            <Panel title="Advertencias">
              <ul className="grid gap-2">{v.warnings!.slice(0, 20).map((w, i) => <li key={i} className="flex gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-[oklch(0.6_0.13_70)]" />{w.message}</li>)}</ul>
            </Panel>
          )}
        </div>
        <Panel title="JSON" bodyClassName="p-0">
          <pre className="max-h-[560px] overflow-auto bg-muted/40 p-4 font-mono text-[11px] leading-relaxed">{preview.length > 40000 ? `${preview.slice(0, 40000)}\n…` : preview}</pre>
        </Panel>
      </div>
    </>
  );
}
