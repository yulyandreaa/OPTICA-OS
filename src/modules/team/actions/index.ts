"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { publicEnv } from "@/lib/env";
import { humanizeError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/authz/permissions";
import { getAppContext } from "@/modules/tenants/services/context";
import { hashToken } from "../utils";


const inviteSchema = z.object({
  email: z.email("Correo no válido").trim().toLowerCase(),
  roleId: z.uuid("Selecciona un rol"),
  branchId: z.uuid().optional().or(z.literal("")).transform((v) => v || null),
});

/** Creates an invitation and returns a one-time link. Only the hash is stored. */
export async function inviteMemberAction(input: z.input<typeof inviteSchema>): Promise<ActionResult<{ link: string }>> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "team.manage")) return fail("No tienes permiso para invitar usuarios.");
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  if (parsed.data.branchId && !ctx.branches.some((b) => b.id === parsed.data.branchId)) return fail("Sede no válida.");

  const token = randomBytes(24).toString("base64url");
  const db = await createClient();
  const { data: role } = await db.from("roles").select("code, is_assignable").eq("id", parsed.data.roleId).single();
  if (!role?.is_assignable) return fail("Ese rol no está disponible. Elige Administrador o Asesor comercial.");
  if (role?.code === "OWNER" && !ctx.roles.some((r) => r.code === "OWNER")) return fail("Solo un administrador puede invitar a otro administrador.");

  const { error } = await db.from("invitations").insert({
    tenant_id: ctx.tenant.id, email: parsed.data.email, role_id: parsed.data.roleId, branch_id: parsed.data.branchId,
    token_hash: hashToken(token), invited_by: ctx.user.id,
  });
  if (error) return fromError("team.invite", error);
  // Email delivery goes through NotificationProvider (Phase 9); for now the admin shares the link.
  revalidatePath("/equipo");
  return ok({ link: `${publicEnv().NEXT_PUBLIC_APP_URL}/invite/${token}` }, "Invitación creada");
}

export async function revokeInvitationAction(id: string): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "team.manage")) return fail("No tienes permiso.");
  const db = await createClient();
  const { error } = await db.from("invitations").update({ status: "revoked" }).eq("tenant_id", ctx.tenant.id).eq("id", id);
  if (error) return fromError("team.revoke", error);
  revalidatePath("/equipo");
  return ok(undefined, "Invitación revocada");
}

export async function setMemberStatusAction(userId: string, status: "active" | "disabled"): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx || !can(ctx.grants, "team.manage")) return fail("No tienes permiso.");
  if (userId === ctx.user.id) return fail("No puedes desactivar tu propia cuenta.");
  const db = await createClient();
  const { error } = await db.from("tenant_members").update({ status }).eq("tenant_id", ctx.tenant.id).eq("user_id", userId);
  if (error) return fromError("team.status", error);
  revalidatePath("/equipo");
  return ok(undefined, status === "active" ? "Usuario reactivado" : "Usuario desactivado");
}

export async function acceptInvitationAction(token: string) {
  const db = await createClient();
  const { error } = await db.rpc("accept_invitation", { p_token_hash: hashToken(token) });
  if (error) {
    const msg = error.message.includes("EMAIL_MISMATCH") ? "Esta invitación fue enviada a otro correo. Ingresa con esa cuenta."
      : error.message.includes("EXPIRED") ? "La invitación expiró. Pide una nueva."
      : error.message.includes("INVALID") ? "La invitación ya fue usada o fue revocada."
      : humanizeError(error);
    return { ok: false as const, error: msg };
  }
  redirect("/inicio");
}
