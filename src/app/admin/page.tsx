import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { auditPlatformAccess, getPlatformOverview, requirePlatformAdmin } from "@/modules/platform/services";

/** Reads the session per request; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

export const metadata: Metadata = { title: "Super admin", robots: { index: false } };

const TONE = { trialing: "brand", active: "success", past_due: "warning", suspended: "danger", cancelled: "danger" } as const;

export default async function AdminPage() {
  const user = await requirePlatformAdmin();
  await auditPlatformAccess(user.id, "platform.overview.view");
  const { rows, stats } = await getPlatformOverview();

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center justify-between border-b bg-surface px-6">
        <div className="flex items-center gap-3"><Logo /><StatusBadge tone="danger" dot={false}>Plataforma</StatusBadge></div>
        <Link href="/inicio" className="text-sm text-muted-foreground hover:text-foreground">Volver a la app</Link>
      </header>
      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Métricas SaaS</h1>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="MRR" value={formatMoney(stats.mrr)} />
          <StatCard label="ARR" value={formatMoney(stats.arr)} />
          <StatCard label="ARPU" value={formatMoney(stats.arpu)} />
          <StatCard label="Ópticas" value={stats.tenants} />
          <StatCard label="En prueba" value={stats.trialing} />
          <StatCard label="Pago vencido" value={stats.pastDue} />
        </div>
        <section className="overflow-hidden rounded-xl border bg-surface shadow-soft">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2.5 font-medium">Óptica</th><th className="px-4 py-2.5 font-medium">Plan</th><th className="px-4 py-2.5 font-medium">Estado</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Alta</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3"><p className="font-medium">{t.trade_name}</p><p className="text-xs text-muted-foreground">/{t.slug}{t.city ? ` · ${t.city}` : ""}</p></td>
                  <td className="px-4 py-3">{t.subscription?.plan?.name ?? "—"}</td>
                  <td className="px-4 py-3">{t.subscription && <StatusBadge tone={TONE[t.subscription.status as keyof typeof TONE] ?? "neutral"}>{t.subscription.status}</StatusBadge>}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{formatDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-muted-foreground">El acceso a esta página queda auditado. Este panel no consulta historias clínicas ni datos de pacientes.</p>
      </main>
    </div>
  );
}
