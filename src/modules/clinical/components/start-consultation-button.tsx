"use client";
import { Loader2, Stethoscope } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startConsultationAction } from "../actions";

export function StartConsultationButton({ patientId, appointmentId, label = "Iniciar consulta", size = "default", variant = "default" }: {
  patientId: string; appointmentId?: string | null; label?: string; size?: "default" | "sm"; variant?: "default" | "outline";
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button size={size} variant={variant} disabled={pending} onClick={() => startTransition(async () => {
      const res = await startConsultationAction({ patientId, appointmentId });
      if (res && !res.ok) toast.error(res.error);
    })}>
      {pending ? <Loader2 className="animate-spin" /> : <Stethoscope />} {label}
    </Button>
  );
}
