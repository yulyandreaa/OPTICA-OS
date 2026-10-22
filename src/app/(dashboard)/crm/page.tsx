import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatCard } from "@/components/shared/stat-card";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { nowMs } from "@/lib/time";
import { can } from "@/modules/authz/permissions";
import { NewLeadDialog, Pipeline, TaskList } from "@/modules/crm/components";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmPage() {
  const ctx = await requirePermission("crm.read");
  await connection();
  const db = await createClient();
  const [{ data: stages }, { data: leads }, { data: tasks }, { data: members }] = await Promise.all([
    db.from("pipeline_stages").select("id, name, is_won, is_lost, sort_order").eq("tenant_id", ctx.tenant.id).order("sort_order"),
    db.from("leads").select("id, stage_id, name, phone, source, interest, value, stage_changed_at, assignee:profiles!leads_assigned_profile_fkey(full_name)").eq("tenant_id", ctx.tenant.id).order("updated_at", { ascending: false }).limit(300),
    db.from("tasks").select("id, title, priority, due_at, assignee:profiles!tasks_assigned_profile_fkey(full_name)").eq("tenant_id", ctx.tenant.id).eq("status", "open").order("due_at", { nullsFirst: false }).limit(30),
    db.from("tenant_members").select("user_id, profile:profiles!tenant_members_user_id_fkey(full_name)").eq("tenant_id", ctx.tenant.id).eq("status", "active"),
  ]);
  const now = await nowMs();
  const won = stages?.find((s) => s.is_won)?.id;
  const lost = stages?.find((s) => s.is_lost)?.id;
  const open = (leads ?? []).filter((l) => l.stage_id !== won && l.stage_id !== lost);
  const closed = (leads ?? []).filter((l) => l.stage_id === won || l.stage_id === lost);
  const winRate = closed.length ? Math.round(((leads ?? []).filter((l) => l.stage_id === won).length / closed.length) * 100) : null;

  return (
    <>
      <PageHeader title="CRM comercial" description="Arrastra los leads entre etapas. De Instagram a paciente que regresa."
        actions={can(ctx.grants, "crm.manage") && stages?.[0] && <NewLeadDialog firstStageId={stages[0].id} />} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Leads abiertos" value={open.length} />
        <StatCard label="Valor en pipeline" value={formatMoney(open.reduce((a, l) => a + Number(l.value ?? 0), 0))} />
        <StatCard label="Tasa de cierre" value={winRate === null ? "—" : `${winRate}%`} hint="ganados / cerrados" />
      </div>
      <Pipeline stages={stages ?? []} leads={(leads ?? []).map((l) => ({
        id: l.id, stage_id: l.stage_id, name: l.name, phone: l.phone, source: l.source, interest: l.interest, value: l.value === null ? null : Number(l.value),
        days: Math.floor((now - new Date(l.stage_changed_at).getTime()) / 86_400_000), assignee: l.assignee?.full_name ?? null,
      }))} />
      <Panel title="Tareas" className="mt-4">
        <TaskList members={(members ?? []).filter((m) => m.user_id !== ctx.user.id).map((m) => ({ id: m.user_id, name: m.profile?.full_name ?? "" }))}
          tasks={(tasks ?? []).map((t) => ({
            id: t.id, title: t.title, priority: t.priority, due_at: t.due_at, assignee: t.assignee?.full_name ?? null,
            overdue: !!t.due_at && new Date(t.due_at).getTime() < now, dueLabel: t.due_at ? formatDate(t.due_at, ctx.timezone, { day: "numeric", month: "short" }) : null,
          }))} />
      </Panel>
    </>
  );
}
