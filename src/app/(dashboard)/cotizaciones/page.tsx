import { FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { QUOTE_STATUS } from "@/modules/sales/constants";
import { listQuotes } from "@/modules/sales/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Cotizaciones" };

export default async function QuotesPage() {
  const ctx = await requirePermission("quotes.read");
  const quotes = await listQuotes(await createClient(), ctx.tenant.id, ctx.activeBranchId);
  const open = quotes.filter((q) => ["sent", "viewed"].includes(q.status));
  return (
    <>
      <PageHeader title="Cotizaciones" description={`${open.length} abiertas por ${formatMoney(open.reduce((a, q) => a + Number(q.total), 0))}`}
        actions={can(ctx.grants, "quotes.create") && <Link href="/cotizaciones/nueva" className={buttonVariants()}><Plus /> Nueva cotización</Link>} />
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {quotes.length === 0 ? <EmptyState icon={FileText} title="Sin cotizaciones" description="Cotiza montura, lentes y tratamientos desde la fórmula del paciente." /> : (
          <ul className="divide-y">
            {quotes.map((q) => {
              const st = QUOTE_STATUS[q.status] ?? QUOTE_STATUS.draft!;
              const expired = ["sent", "viewed"].includes(q.status) && new Date(`${q.valid_until}T23:59:59`) < new Date();
              return (
                <li key={q.id} className="relative flex items-center gap-4 px-4 py-3 hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <Link href={`/cotizaciones/${q.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">{q.patient?.full_name}</Link>
                    <p className="text-xs text-muted-foreground"><span className="font-mono">{q.number}</span> · {formatDate(q.created_at, ctx.timezone)} · vence {formatDate(`${q.valid_until}T12:00:00Z`, "UTC")} · {q.seller?.full_name}</p>
                  </div>
                  <span className="text-sm font-medium tabular">{formatMoney(q.total)}</span>
                  <StatusBadge tone={expired ? "danger" : st.tone}>{expired ? "Vencida" : st.label}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
