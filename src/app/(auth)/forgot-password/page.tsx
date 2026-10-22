import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/modules/auth/components/email-request-form";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function ForgotPasswordPage() {
  return (
    <div className="grid gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Recupera tu acceso</h1>
        <p className="text-sm text-muted-foreground">Te enviaremos un enlace para crear una nueva contraseña.</p>
      </div>
      <ForgotPasswordForm />
      <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">← Volver a ingresar</Link>
    </div>
  );
}
