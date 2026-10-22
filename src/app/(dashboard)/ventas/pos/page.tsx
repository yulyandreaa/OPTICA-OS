import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { Pos } from "@/modules/sales/components/pos";
import { posCatalog } from "@/modules/sales/repositories";
import { getPatient } from "@/modules/patients/repositories/patients";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Punto de venta" };

export default async function PosPage(props: PageProps<"/ventas/pos">) {
  const ctx = await requirePermission("pos.use");
  const sp = await props.searchParams;
  const branchId = ctx.activeBranchId ?? ctx.branches[0]!.id;
  const db = await createClient();
  const patientId = typeof sp.paciente === "string" ? sp.paciente : null;
  const [catalog, patient] = await Promise.all([posCatalog(db, ctx.tenant.id, branchId), patientId ? getPatient(db, ctx.tenant.id, patientId) : null]);
  return (
    <>
      <PageHeader eyebrow={<Link href="/ventas" className="hover:text-foreground">Ventas</Link>} title="Punto de venta"
        description={`Sede ${ctx.branches.find((b) => b.id === branchId)?.name}. Los precios incluyen IVA.`} />
      <Pos mode="sale" catalog={catalog} canDiscount={can(ctx.grants, "sales.discount", branchId)}
        initialPatient={patient ? { id: patient.id, name: patient.full_name } : null} />
    </>
  );
}
