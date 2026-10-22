import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/modules/auth/components/login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <div className="grid gap-8">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Bienvenido de nuevo</h1>
        <p className="text-sm text-muted-foreground">Ingresa para gestionar tu óptica.</p>
      </div>
      <Suspense><LoginForm /></Suspense>
      <p className="text-sm text-muted-foreground">
        ¿Aún no tienes cuenta? <Link href="/register" className="font-medium text-foreground underline-offset-4 hover:underline">Crea tu óptica gratis</Link>
      </p>
      {process.env.APP_ENV !== "production" && (
        <div className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Demo:</span> owner@novavision.demo · NovaVision2026!
        </div>
      )}
    </div>
  );
}
