import type { Metadata } from "next";
import { Panel } from "@/components/shared/panel";
import { createClient } from "@/lib/supabase/server";
import { listSpecialists } from "@/modules/appointments/repositories/appointments";
import { ScheduleForm } from "@/modules/settings/components/schedule-form";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Horarios de agenda" };
const DAY = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default async function ScheduleSettingsPage() {
  const ctx = await requirePermission("schedules.manage");
  const db = await createClient();
  const [specialists, members] = await Promise.all([
    listSpecialists(db, ctx.tenant.id, null),
    db.from("tenant_members").select("user_id, profile:profiles!tenant_members_user_id_fkey(full_name, email)").eq("tenant_id", ctx.tenant.id).eq("status", "active"),
  ]);
  const branchName = new Map(ctx.branches.map((b) => [b.id, b.name]));
  return (
    <div className="grid gap-4">
      <ScheduleForm
        members={(members.data ?? []).map((m) => ({ id: m.user_id, name: m.profile?.full_name || m.profile?.email || "Usuario" }))}
        branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
      />
      <Panel title="Horarios configurados" description="Se usan en la agenda y en la página pública de reservas.">
        {specialists.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay horarios.</p> : (
          <ul className="grid gap-3 text-sm">
            {specialists.map((s) => {
              const byBranch = Map.groupBy(s.schedules, (x) => x.branchId);
              return (
                <li key={s.id} className="grid gap-1">
                  <p className="font-medium">{s.name}</p>
                  {[...byBranch.entries()].map(([branchId, rows]) => (
                    <p key={branchId} className="text-muted-foreground">
                      {branchName.get(branchId)}: {[...new Set(rows.map((r) => DAY[r.weekday]))].join(", ")} ·{" "}
                      {[...new Set(rows.map((r) => `${r.start}–${r.end}`))].join(" / ")}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
