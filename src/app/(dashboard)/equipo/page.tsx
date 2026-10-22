import { Mail, Users } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDate, initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { InviteDialog } from "@/modules/team/components/invite-dialog";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Equipo" };

export default async function TeamPage() {
  const ctx = await requirePermission("team.read");
  const db = await createClient();
  const canManage = can(ctx.grants, "team.manage");

  const [members, userRoles, roles, invitations] = await Promise.all([
    db.from("tenant_members").select("user_id, status, job_title, joined_at, profile:profiles!tenant_members_user_id_fkey(full_name, email)").eq("tenant_id", ctx.tenant.id).order("created_at"),
    db.from("user_roles").select("user_id, branch_id, role:roles(name)").eq("tenant_id", ctx.tenant.id),
    db.from("roles").select("id, name, code").or(`tenant_id.is.null,tenant_id.eq.${ctx.tenant.id}`).order("name"),
    canManage
      ? db.from("invitations").select("id, email, status, expires_at, role:roles(name)").eq("tenant_id", ctx.tenant.id).eq("status", "pending").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; status: string; expires_at: string; role: { name: string } | null }[] }),
  ]);

  const branchName = new Map(ctx.branches.map((b) => [b.id, b.name]));
  const rolesByUser = new Map<string, string[]>();
  for (const ur of userRoles.data ?? []) {
    const label = `${ur.role?.name ?? ""}${ur.branch_id ? ` · ${branchName.get(ur.branch_id) ?? "otra sede"}` : ""}`;
    rolesByUser.set(ur.user_id, [...(rolesByUser.get(ur.user_id) ?? []), label]);
  }
  const active = (members.data ?? []).filter((m) => m.status === "active").length;

  return (
    <>
      <PageHeader title="Equipo" description={`${active} usuarios activos`}
        actions={canManage && <InviteDialog roles={(roles.data ?? []).filter((r) => r.code !== "PATIENT")} branches={ctx.branches} />} />
      <div className="grid gap-6">
        <Panel bodyClassName="p-0">
          <ul className="divide-y">
            {(members.data ?? []).map((m) => (
              <li key={m.user_id} className="flex items-center gap-4 px-4 py-3">
                <Avatar className="size-9"><AvatarFallback className="bg-muted text-xs">{initials(m.profile?.full_name || m.profile?.email || "?")}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.profile?.full_name || m.profile?.email}{m.user_id === ctx.user.id && <span className="text-muted-foreground"> · tú</span>}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.profile?.email}</p>
                </div>
                <div className="hidden flex-wrap justify-end gap-1 md:flex">
                  {(rolesByUser.get(m.user_id) ?? []).map((r) => <StatusBadge key={r} dot={false}>{r}</StatusBadge>)}
                </div>
                {m.status !== "active" && <StatusBadge tone="danger">Desactivado</StatusBadge>}
              </li>
            ))}
          </ul>
        </Panel>

        {canManage && (
          <Panel title="Invitaciones pendientes" bodyClassName="p-0">
            {(invitations.data ?? []).length === 0 ? (
              <EmptyState icon={Users} title="Sin invitaciones pendientes" description="Invita a tus optómetras, asesores y recepción." compact />
            ) : (
              <ul className="divide-y">
                {(invitations.data ?? []).map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <Mail className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{i.email}</span>
                    <span className="text-xs text-muted-foreground">{i.role?.name} · vence {formatDate(i.expires_at, ctx.timezone)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
