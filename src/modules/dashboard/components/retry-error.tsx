"use client";
import { AlertCircle, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function RetryError({ message }: { message: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-surface px-6 py-10 text-center shadow-soft">
      <AlertCircle className="size-6 text-destructive" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{message}</p>
        <p className="text-sm text-muted-foreground">Revisa tu conexión e inténtalo de nuevo.</p>
      </div>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        <RotateCw className={pending ? "animate-spin" : undefined} /> Reintentar
      </Button>
    </div>
  );
}
