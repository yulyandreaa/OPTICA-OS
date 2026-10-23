import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { createClient } from "@/lib/supabase/server";
import { BranchActions, type BranchDeleteImpact } from "@/modules/settings/components/branch-actions";
import { BranchForm } from "@/modules/settings/components/branch-form";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Sedes" };

export default async function BranchesPage() {
  const ctx = await requirePermission("branches.manage");
  const db = await createClient();
  const [{ data: branches }, { data: limit }] = await Promise.all([
    db.from("branches").select("id, name, code, city, address, phone, is_main, status").eq("tenant_id", ctx.tenant.id).is("deleted_at", null).order("is_main", { ascending: false }).order("name"),
    db.from("plans").select("plan_features(feature_code, limit_value)").eq("code", ctx.subscription?.planCode ?? "PRO").maybeSingle()
      .then((r) => ({ data: r.data?.plan_features.find((f) => f.feature_code === "MAX_BRANCHES") ?? null })),
  ]);
  const max = limit?.limit_value ?? null;
  const list = branches ?? [];
  const single = list.length <= 1;
  // What deleting each branch would move or cancel, so the confirmation says it before the click.
  const impacts = new Map(single ? [] : await Promise.all(list.map(async (b) => {
    const { data } = await db.rpc("branch_delete_impact", { p_tenant: ctx.tenant.id, p_branch: b.id });
    return [b.id, (data as BranchDeleteImpact | null) ?? null] as const;
  })));
  return (
    <div className="grid gap-4">
      <Panel title="Sedes" description={max ? `${list.length} de ${max} sedes incluidas en tu plan ${ctx.subscription?.planName}` : list.length === 1 ? "1 sede" : `${list.length} sedes`} bodyClassName="p-0">
        <ul className="divide-y">
          {list.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="grid size-9 place-items-center rounded-lg bg-muted"><Building2 className="size-4 text-muted-foreground" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.code}</span></p>
                <p className="truncate text-xs text-muted-foreground">{[b.address, b.city, b.phone].filter(Boolean).join(" · ") || "Sin dirección"}</p>
              </div>
              {b.is_main && <StatusBadge tone="brand" dot={false}>Principal</StatusBadge>}
              <BranchActions branch={b} isMain={b.is_main} single={single} impact={impacts.get(b.id) ?? null} />
            </li>
          ))}
        </ul>
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {single
            ? "Tienes una sola sede y es tu sede principal. Si abres otra, aquí podrás elegir cuál es la principal o eliminar las que ya no uses."
            : "La sede principal aparece primero en las listas y es con la que empiezan los usuarios."}
        </p>
      </Panel>
      <div><BranchForm /></div>
    </div>
  );
}
