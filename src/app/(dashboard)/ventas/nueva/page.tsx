import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Building2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { NewSale } from "@/modules/sales/components/new-sale";
import { getSaleDraft, listSellers } from "@/modules/sales/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Nueva venta" };

export default async function NewSalePage(props: PageProps<"/ventas/nueva">) {
  const ctx = await requirePermission("sales.create");
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const allowed = ctx.branches.filter((b) => can(ctx.grants, "sales.create", b.id));
  const header = <PageHeader eyebrow={<Link href="/ventas" className="hover:text-foreground">Ventas y cotizaciones</Link>} title={str("borrador") ? "Continuar venta" : "Nueva venta"}
    description="Registra los productos y completa la información para continuar al pago." />;
  if (!allowed.length) {
    return <>{header}<div className="rounded-2xl border bg-surface shadow-soft"><EmptyState icon={Building2} title="No tienes una sede donde vender" description="Pide al administrador que te asigne una sede con permiso de ventas." /></div></>;
  }

  const db = await createClient();
  const { data: addresses } = await db.from("branches").select("id, address, city").in("id", allowed.map((b) => b.id));
  const branches = allowed.map((b) => {
    const a = addresses?.find((x) => x.id === b.id);
    return { id: b.id, name: b.name, address: [a?.address, a?.city].filter(Boolean).join(", ") || null };
  });
  const uuid = /^[0-9a-f-]{36}$/i;
  const draftId = str("borrador");
  const draft = draftId && uuid.test(draftId) ? await getSaleDraft(db, ctx.tenant.id, draftId) : null;
  if (draftId && !draft) notFound();
  const customerId = str("cliente");
  const { data: customer } = customerId && uuid.test(customerId) && !draft
    ? await db.from("patients").select("id, full_name, document_type, document_number, phone, email").eq("tenant_id", ctx.tenant.id).eq("id", customerId).is("deleted_at", null).maybeSingle()
    : { data: null };
  // Choosing another seller is for whoever manages the team; everyone else sells as themselves.
  const sellers = can(ctx.grants, "team.read") ? await listSellers(db, ctx.tenant.id) : [{ id: ctx.user.id, name: ctx.user.fullName, role: ctx.roles[0]?.name ?? null }];
  const today = formatDate(new Date().toISOString(), ctx.timezone, { day: "2-digit", month: "2-digit", year: "numeric" });
  const requested = str("sede");
  const initialBranchId = branches.find((b) => b.id === requested)?.id ?? branches.find((b) => b.id === ctx.activeBranchId)?.id ?? branches[0]!.id;

  return (
    <>
      {header}
      <NewSale key={draft?.id ?? "new"} branches={branches} initialBranchId={initialBranchId} sellers={sellers} me={ctx.user.id} today={today}
        canLabOrders={can(ctx.grants, "lab_orders.read")}
        discountBranches={branches.filter((b) => can(ctx.grants, "sales.discount", b.id)).map((b) => b.id)}
        canCreateCustomer={can(ctx.grants, "patients.create")} initialCustomer={customer ?? null}
        draft={draft ? { ...draft, sellerId: draft.sellerId ?? ctx.user.id, branchId: branches.some((b) => b.id === draft.branchId) ? draft.branchId : initialBranchId } : null} />
    </>
  );
}
