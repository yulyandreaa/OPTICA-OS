import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Building2 } from "lucide-react";
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
  const branches = ctx.branches.filter((b) => can(ctx.grants, "sales.create", b.id)).map((b) => ({ id: b.id, name: b.name }));
  const header = <PageHeader eyebrow={<Link href="/ventas" className="hover:text-foreground">Ventas y cotizaciones</Link>} title={str("borrador") ? "Continuar venta" : "Nueva venta"}
    description="Elige la sede y el cliente, agrega productos y continúa al pago." />;
  if (!branches.length) {
    return <>{header}<div className="rounded-2xl border bg-surface shadow-soft"><EmptyState icon={Building2} title="No tienes una sede donde vender" description="Pide al administrador que te asigne una sede con permiso de ventas." /></div></>;
  }

  const db = await createClient();
  const uuid = /^[0-9a-f-]{36}$/i;
  const draftId = str("borrador");
  const draft = draftId && uuid.test(draftId) ? await getSaleDraft(db, ctx.tenant.id, draftId) : null;
  if (draftId && !draft) notFound();
  const customerId = str("cliente");
  const { data: customer } = customerId && uuid.test(customerId) && !draft
    ? await db.from("patients").select("id, full_name, document_type, document_number, phone, email").eq("tenant_id", ctx.tenant.id).eq("id", customerId).is("deleted_at", null).maybeSingle()
    : { data: null };
  // Choosing another seller is for whoever manages the team; everyone else sells as themselves.
  const sellers = can(ctx.grants, "team.read") ? await listSellers(db, ctx.tenant.id) : [{ id: ctx.user.id, name: ctx.user.fullName }];
  const requested = str("sede");
  const initialBranchId = branches.find((b) => b.id === requested)?.id ?? branches.find((b) => b.id === ctx.activeBranchId)?.id ?? branches[0]!.id;

  return (
    <>
      {header}
      <NewSale key={draft?.id ?? "new"} branches={branches} initialBranchId={initialBranchId} sellers={sellers} me={ctx.user.id}
        discountBranches={branches.filter((b) => can(ctx.grants, "sales.discount", b.id)).map((b) => b.id)}
        canCreateCustomer={can(ctx.grants, "patients.create")} initialCustomer={customer ?? null}
        draft={draft ? { ...draft, sellerId: draft.sellerId ?? ctx.user.id, branchId: branches.some((b) => b.id === draft.branchId) ? draft.branchId : initialBranchId } : null} />
    </>
  );
}
