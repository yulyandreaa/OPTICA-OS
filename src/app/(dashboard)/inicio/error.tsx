"use client";
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomeError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-surface px-6 py-16 text-center shadow-soft">
      <AlertCircle className="size-6 text-destructive" />
      <p className="text-sm font-medium">No pudimos cargar el resumen del negocio.</p>
      <Button variant="outline" size="sm" onClick={reset}><RotateCw /> Reintentar</Button>
    </div>
  );
}
