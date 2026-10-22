"use client";
import { Loader2, Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setPersonActiveAction } from "../actions";

export function PersonActiveButton({ id, name, active }: { id: string; name: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const onClick = () => {
    if (active && !window.confirm(`¿Desactivar a ${name}? Su historial se conserva y puedes reactivarlo cuando quieras.`)) return;
    startTransition(async () => {
      const res = await setPersonActiveAction(id, !active);
      if (!res.ok) toast.error(res.error);
      else { toast.success(res.message); router.refresh(); }
    });
  };
  return (
    <Button variant="outline" onClick={onClick} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : active ? <PowerOff /> : <Power />}
      {active ? "Desactivar" : "Reactivar"}
    </Button>
  );
}
