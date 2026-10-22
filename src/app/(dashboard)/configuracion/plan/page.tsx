import { Check } from "lucide-react";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Plan" };

export default async function PlanPage() {
  const ctx = await requirePermission("settings.manage");
  const db = await createClient();
  const { data: plans } = await db.from("plans").select("id, code, name, description, price_monthly, plan_features(feature_code, limit_value, features(name, kind))").eq("is_public", true).order("sort_order");
  const sub = ctx.subscription;
  return (
    <div className="grid gap-4">
      {sub && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface p-5 shadow-soft">
          <div>
            <p className="text-sm text-muted-foreground">Plan actual</p>
            <p className="text-lg font-semibold">{sub.planName}</p>
          </div>
          {sub.status === "trialing" && sub.trialEndsAt
            ? <StatusBadge tone="brand">Prueba hasta el {formatDate(sub.trialEndsAt, ctx.timezone)}</StatusBadge>
            : <StatusBadge tone={sub.status === "active" ? "success" : "warning"}>{sub.status}</StatusBadge>}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(plans ?? []).map((p) => (
          <article key={p.id} className={cn("flex flex-col gap-4 rounded-xl border bg-surface p-5 shadow-soft", p.code === sub?.planCode && "border-brand ring-3 ring-brand/15")}>
            <div>
              <h3 className="font-semibold">{p.name}</h3>
              <p className="text-sm text-muted-foreground">{p.description}</p>
            </div>
            <p className="text-2xl font-semibold tabular">{p.price_monthly > 0 ? <>{formatMoney(p.price_monthly)}<span className="text-sm font-normal text-muted-foreground">/mes</span></> : "A la medida"}</p>
            <ul className="grid gap-1.5 text-sm">
              {p.plan_features.map((f) => (
                <li key={f.feature_code} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />
                  {f.features?.kind === "limit" ? `${f.limit_value ?? "Ilimitadas"} ${f.features.name.toLowerCase().replace(" incluidas", "").replace(" incluidos", "")}` : f.features?.name}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">El cobro de la suscripción se integrará mediante PaymentProvider (Wompi / Stripe). Los límites se aplican en la base de datos.</p>
    </div>
  );
}
