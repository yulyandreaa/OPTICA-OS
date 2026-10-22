"use client";
import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { acceptInvitationAction } from "../actions";

export function AcceptInvitationButton({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button size="lg" disabled={pending} onClick={() => startTransition(async () => {
        const res = await acceptInvitationAction(token);
        if (res && !res.ok) setError(res.error);
      })}>
        {pending && <Loader2 className="animate-spin" />} Unirme al equipo
      </Button>
    </div>
  );
}
