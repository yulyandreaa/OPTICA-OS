import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { publicEnv } from "@/lib/env";
import { formatDate, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { QuoteActions } from "@/modules/sales/components/sale-actions";
import { QUOTE_STATUS } from "@/modules/sales/constants";
import { getQuote } from "@/modules/sales/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Cotización" };

export default async function QuotePage(props: PageProps<"/cotizaciones/[id]">) {
  const { id } = await props.params;
  const ctx = await requirePermission("quotes.read");
  const data = await getQuote(await createClient(), ctx.tenant.id, id);
  if (!data) notFound();
  const { quote: q, items } = data;
  const st = QUOTE_STATUS[q.status] ?? QUOTE_STATUS.draft!;
  const url = `${publicEnv().NEXT_PUBLIC_APP_URL}/quote/${q.public_token}`;
  return (
    <>
      <PageHeader eyebrow={<Link href="/cotizaciones" className="hover:text-foreground">Cotizaciones</Link>}
        title={<span className="flex items-center gap-3">{q.patient?.full_name}<StatusBadge tone={st.tone}>{st.label}</StatusBadge></span>}
        description={`${q.number} · válida hasta ${formatDate(`${q.valid_until}T12:00:00Z`, "UTC")} · ${q.seller?.full_name}${q.viewed_at ? ` · vista el ${formatDate(q.viewed_at, ctx.timezone)}` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Detalle" bodyClassName="p-0">
          <ul className="divide-y">{items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3">
              <span className="size-9 shrink-0 rounded-lg border bg-cover bg-center" style={{ backgroundImage: i.variant?.image_url ? `url(${i.variant.image_url})` : undefined, backgroundColor: i.variant?.color_hex ?? "var(--muted)" }} />
              <p className="min-w-0 flex-1 truncate text-sm">{i.description} <span className="text-muted-foreground">× {i.quantity}</span></p>
              <span className="text-sm tabular">{formatMoney(i.line_total)}</span>
            </li>))}
          </ul>
          <div className="flex justify-between border-t px-4 py-3 text-base font-semibold"><span>Total</span><span className="tabular">{formatMoney(q.total)}</span></div>
        </Panel>
        <Panel title="Acciones">
          {q.sale_id ? <Link href={`/ventas/${q.sale_id}`} className="text-sm text-brand hover:underline">Ver la venta generada →</Link> : (
            <QuoteActions quoteId={q.id} total={Number(q.total)} publicUrl={url} phone={q.patient?.whatsapp ?? q.patient?.phone ?? null}
              firstName={q.patient?.full_name.split(" ")[0] ?? ""} convertible={can(ctx.grants, "sales.create") && ["sent", "viewed", "accepted"].includes(q.status)} />
          )}
        </Panel>
      </div>
    </>
  );
}
