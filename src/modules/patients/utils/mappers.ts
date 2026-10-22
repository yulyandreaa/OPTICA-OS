import type { TablesInsert } from "@/lib/supabase/database.types";
import type { PatientInput } from "../schemas";

/** Form → DB row. tenant_id is always injected server-side from the session context. */
export function toPatientRow(v: PatientInput): Omit<TablesInsert<"patients">, "tenant_id"> {
  return {
    document_type: v.documentType,
    document_number: v.documentNumber.toUpperCase(),
    first_name: v.firstName,
    middle_name: v.middleName,
    last_name: v.lastName,
    second_last_name: v.secondLastName,
    birth_date: v.birthDate,
    sex: v.sex,
    email: v.email,
    phone: v.phone,
    whatsapp: v.whatsapp ?? v.phone,
    address: v.address,
    city: v.city,
    department: v.department,
    occupation: v.occupation,
    eps: v.eps,
    health_regime: v.healthRegime,
    emergency_contact_name: v.emergencyContactName,
    emergency_contact_phone: v.emergencyContactPhone,
    contact_preference: v.contactPreference,
    source: v.source,
    home_branch_id: v.homeBranchId,
    notes: v.notes,
  };
}
