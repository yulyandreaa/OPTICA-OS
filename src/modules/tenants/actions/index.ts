"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "../services/context";

const uuid = z.uuid();

/** The DB trigger `guard_profile_context` rejects tenants the user doesn't belong to. */
export async function switchTenantAction(tenantId: string): Promise<ActionResult> {
  const parsed = uuid.safeParse(tenantId);
  const user = await getCurrentUser();
  if (!parsed.success || !user) return fail("Empresa no válida");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ active_tenant_id: parsed.data }).eq("id", user.id);
  if (error) return fromError("tenants.switch", error);
  revalidatePath("/", "layout");
  return ok(undefined);
}

export async function switchBranchAction(branchId: string | null): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || (branchId !== null && !uuid.safeParse(branchId).success)) return fail("Sede no válida");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ active_branch_id: branchId }).eq("id", user.id);
  if (error) return fromError("tenants.switch_branch", error);
  revalidatePath("/", "layout");
  return ok(undefined);
}
