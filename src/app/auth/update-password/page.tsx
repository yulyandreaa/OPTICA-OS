import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/shared/logo";
import { UpdatePasswordForm } from "@/modules/auth/components/update-password-form";
import { getCurrentUser } from "@/modules/tenants/services/context";

/** Reads the session per request; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function UpdatePasswordPage() {
  if (!(await getCurrentUser())) redirect("/login?error=link");
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-8 px-6">
      <Logo />
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Crea una nueva contraseña</h1>
        <p className="text-sm text-muted-foreground">Usa una contraseña que no utilices en otros servicios.</p>
      </div>
      <UpdatePasswordForm />
    </main>
  );
}
