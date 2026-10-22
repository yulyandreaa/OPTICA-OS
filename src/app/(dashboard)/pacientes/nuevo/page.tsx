import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { PatientForm } from "@/modules/patients/components/patient-form";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Nuevo registro" };

export default async function NewPatientPage() {
  const ctx = await requirePermission("patients.create");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={<Link href="/pacientes" className="hover:text-foreground">Clientes y pacientes</Link>} title="Nuevo registro"
        description="Solo necesitas el documento y el nombre. Lo demás puede completarse después." />
      <PatientForm branches={ctx.branches} />
    </div>
  );
}
