import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { createClient } from "@/lib/supabase/server";
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
  return (
    <div className="grid gap-4">
      <Panel title="Sedes" description={max ? `${branches?.length ?? 0} de ${max} sedes incluidas en tu plan ${ctx.subscription?.planName}` : `${branches?.length ?? 0} sedes`} bodyClassName="p-0">
        <ul className="divide-y">
          {(branches ?? []).map((b) => (
            <li key={b.id} className="flex items-center gap-4 px-4 py-3">
              <div className="grid size-9 place-items-center rounded-lg bg-muted"><Building2 className="size-4 text-muted-foreground" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.name} <span className="font-mono text-xs text-muted-foreground">{b.code}</span></p>
                <p className="truncate text-xs text-muted-foreground">{[b.address, b.city, b.phone].filter(Boolean).join(" · ") || "Sin dirección"}</p>
              </div>
              {b.is_main && <StatusBadge tone="brand" dot={false}>Principal</StatusBadge>}
            </li>
          ))}
        </ul>
      </Panel>
      <div><BranchForm /></div>
    </div>
  );
}
