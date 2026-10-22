"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAppContext } from "@/modules/tenants/services/context";
import { can } from "@/modules/authz/permissions";

export interface SearchHit {
  type: "patient" | "appointment";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const querySchema = z.string().trim().min(2).max(80);

/** Global search. Every query runs through RLS with the user's session; tenant is resolved server-side. */
export async function globalSearchAction(raw: string): Promise<SearchHit[]> {
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await getAppContext();
  if (!ctx) return [];
  const q = parsed.data.replace(/[%_,()]/g, " ");
  const supabase = await createClient();
  const hits: SearchHit[] = [];

  if (can(ctx.grants, "patients.read")) {
    const digits = q.replace(/\D/g, "");
    let query = supabase
      .from("patients")
      .select("id, full_name, document_type, document_number, phone")
      .eq("tenant_id", ctx.tenant.id)
      .is("deleted_at", null)
      .limit(6);
    query = digits.length >= 4
      ? query.or(`document_number.ilike.${digits}%,phone.ilike.%${digits}%`)
      : query.ilike("full_name", `%${q}%`);
    const { data } = await query;
    for (const p of data ?? []) {
      hits.push({
        type: "patient", id: p.id, title: p.full_name, href: `/pacientes/${p.id}`,
        subtitle: `${p.document_type} ${p.document_number}${p.phone ? ` · ${p.phone}` : ""}`,
      });
    }
  }
  return hits;
}
