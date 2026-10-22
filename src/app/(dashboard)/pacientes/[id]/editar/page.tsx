import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { PatientForm } from "@/modules/patients/components/patient-form";
import { getPatient } from "@/modules/patients/repositories/patients";
import { relationOf, type PatientFormInput } from "@/modules/patients/schemas";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Editar registro" };

export default async function EditPatientPage(props: PageProps<"/pacientes/[id]/editar">) {
  const { id } = await props.params;
  const ctx = await requirePermission("patients.update");
  const p = await getPatient(await createClient(), ctx.tenant.id, id);
  if (!p) notFound();

  const defaults: Partial<PatientFormInput> = {
    relation: relationOf(p), documentType: p.document_type as PatientFormInput["documentType"], documentNumber: p.document_number,
    firstName: p.first_name, middleName: p.middle_name ?? "", lastName: p.last_name, secondLastName: p.second_last_name ?? "",
    birthDate: p.birth_date ?? "", sex: (p.sex ?? "") as PatientFormInput["sex"], email: p.email ?? "", phone: p.phone ?? "",
    whatsapp: p.whatsapp ?? "", address: p.address ?? "", city: p.city ?? "", department: p.department ?? "", occupation: p.occupation ?? "",
    eps: p.eps ?? "", healthRegime: (p.health_regime ?? "") as PatientFormInput["healthRegime"],
    emergencyContactName: p.emergency_contact_name ?? "", emergencyContactPhone: p.emergency_contact_phone ?? "",
    contactPreference: p.contact_preference as PatientFormInput["contactPreference"], source: (p.source ?? "") as PatientFormInput["source"],
    homeBranchId: p.home_branch_id ?? "", notes: p.notes ?? "",
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow={<Link href={`/pacientes/${id}`} className="hover:text-foreground">← {p.full_name}</Link>} title="Editar registro" />
      <PatientForm patientId={id} defaults={defaults} branches={ctx.branches} />
    </div>
  );
}
