import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getPatient } from "@/modules/patients/repositories/patients";
import { Pos } from "@/modules/sales/components/pos";
import { posCatalog } from "@/modules/sales/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Nueva cotización" };

export default async function NewQuotePage(props: PageProps<"/cotizaciones/nueva">) {
  const ctx = await requirePermission("quotes.create");
  const sp = await props.searchParams;
  const branchId = ctx.activeBranchId ?? ctx.branches[0]!.id;
  const db = await createClient();
  const patientId = typeof sp.paciente === "string" ? sp.paciente : null;
  const [catalog, patient] = await Promise.all([posCatalog(db, ctx.tenant.id, branchId), patientId ? getPatient(db, ctx.tenant.id, patientId) : null]);
  return (
    <>
      <PageHeader eyebrow={<Link href="/cotizaciones" className="hover:text-foreground">Cotizaciones</Link>} title="Nueva cotización" description="Vigencia de 15 días. El paciente la verá en un enlace seguro." />
      <Pos mode="quote" catalog={catalog} canDiscount={can(ctx.grants, "sales.discount", branchId)} initialPatient={patient ? { id: patient.id, name: patient.full_name } : null}
        initialVariantId={typeof sp.variante === "string" ? sp.variante : null} />
    </>
  );
}
