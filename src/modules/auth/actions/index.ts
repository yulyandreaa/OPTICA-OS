"use server";
import { redirect } from "next/navigation";
import { fail, fromError, fromZod, ok, type ActionResult } from "@/lib/action";
import { publicEnv } from "@/lib/env";
import { humanizeError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import {
  emailOnlySchema, signInSchema, signUpSchema, updatePasswordSchema,
  type EmailOnlyInput, type SignInInput, type SignUpInput, type UpdatePasswordInput,
} from "../schemas";

const TOO_MANY = "Demasiados intentos. Espera un minuto e inténtalo de nuevo.";

export async function signInAction(input: SignInInput): Promise<ActionResult<{ next: string }>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  if (!(await rateLimit("auth:signin", 10, 60_000))) return fail(TOO_MANY);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return fail(humanizeError(error));
  return ok({ next: safeNext(parsed.data.next) });
}

export async function signUpAction(input: SignUpInput): Promise<ActionResult<{ needsConfirmation: boolean; next: string }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  if (!(await rateLimit("auth:signup", 5, 60_000))) return fail(TOO_MANY);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(safeNext(parsed.data.next, "/onboarding"))}`,
    },
  });
  if (error) return fail(humanizeError(error));
  return ok({ needsConfirmation: !data.session, next: safeNext(parsed.data.next, "/onboarding") });
}

export async function sendMagicLinkAction(input: EmailOnlyInput): Promise<ActionResult> {
  const parsed = emailOnlySchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  if (!(await rateLimit("auth:magic", 3, 60_000))) return fail(TOO_MANY);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false, emailRedirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/inicio` },
  });
  // Don't reveal whether the account exists.
  if (error && !/signups not allowed|not found/i.test(error.message)) return fromError("auth.magic", error);
  return ok(undefined, "Si el correo está registrado, te enviamos un enlace de acceso.");
}

export async function requestPasswordResetAction(input: EmailOnlyInput): Promise<ActionResult> {
  const parsed = emailOnlySchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  if (!(await rateLimit("auth:reset", 3, 60_000))) return fail(TOO_MANY);

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/update-password`,
  });
  return ok(undefined, "Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.");
}

export async function updatePasswordAction(input: UpdatePasswordInput): Promise<ActionResult> {
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fromError("auth.update_password", error);
  return ok(undefined, "Contraseña actualizada.");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
