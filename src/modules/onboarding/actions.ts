"use server";
import { revalidatePath } from "next/cache";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { nitCheckDigit } from "@/modules/tenants/utils/nit";
import { onboardingSchema, type OnboardingInput } from "./schemas";

export async function createTenantAction(input: OnboardingInput): Promise<ActionResult<{ tenantId: string }>> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const v = parsed.data;
  if (v.taxIdType === "NIT" && v.taxId && v.taxDv && nitCheckDigit(v.taxId) !== v.taxDv) {
    return fail("El dígito de verificación no corresponde al NIT.", { taxDv: ["DV incorrecto"] });
  }
  if (!(await rateLimit("onboarding:create", 5, 60_000))) return fail("Demasiados intentos. Espera un momento.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_tenant", {
    p_trade_name: v.tradeName,
    p_legal_name: v.legalName,
    p_slug: v.slug,
    p_tax_id_type: v.taxIdType,
    p_tax_id: v.taxId,
    p_tax_dv: v.taxDv,
    p_tax_regime: v.taxRegime,
    p_specialty: v.specialty,
    p_branch_name: v.branchName,
    p_branch_city: v.branchCity,
    p_branch_address: v.branchAddress ?? "",
    p_branch_phone: v.branchPhone ?? "",
  });
  if (error) return fromError("onboarding.create_tenant", error);
  revalidatePath("/", "layout");
  return ok({ tenantId: data });
}

export async function checkSlugAction(slug: string): Promise<boolean> {
  if (!/^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])$/.test(slug)) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("slug_available", { p_slug: slug });
  return data === true;
}
