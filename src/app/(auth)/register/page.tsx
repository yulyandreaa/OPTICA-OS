import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RegisterForm } from "@/modules/auth/components/register-form";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function RegisterPage() {
  return (
    <div className="grid gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Crea tu óptica</h1>
        <p className="text-sm text-muted-foreground">En menos de 3 minutos estarás atendiendo pacientes.</p>
      </div>
      <Suspense><RegisterForm /></Suspense>
      <p className="text-sm text-muted-foreground">
        ¿Ya tienes cuenta? <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Ingresa</Link>
      </p>
    </div>
  );
}
