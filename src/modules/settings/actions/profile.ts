"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/modules/tenants/services/context";

const schema = z.object({
  fullName: z.string().trim().min(3, "Escribe tu nombre").max(120),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
});

export async function updateProfileAction(input: z.input<typeof schema>): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Tu sesión expiró.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const db = await createClient();
  const { error } = await db.from("profiles").update({ full_name: parsed.data.fullName, phone: parsed.data.phone }).eq("id", user.id);
  if (error) return fromError("profile.update", error);
  revalidatePath("/", "layout");
  return ok(undefined, "Perfil actualizado");
}
