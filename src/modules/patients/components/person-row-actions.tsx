"use client";
import { Eye, Loader2, MoreHorizontal, Pencil, Power, PowerOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setPersonActiveAction } from "../actions";

/** Row actions: open, edit and (with patients.delete) deactivate / reactivate. */
export function PersonRowActions({ id, name, active, canEdit, canToggle }: { id: string; name: string; active: boolean; canEdit: boolean; canToggle: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toggle = () => {
    if (active && !window.confirm(`¿Desactivar a ${name}? Su historial se conserva y puedes reactivarlo cuando quieras.`)) return;
    startTransition(async () => {
      const res = await setPersonActiveAction(id, !active);
      if (!res.ok) toast.error(res.error);
      else { toast.success(res.message); router.refresh(); }
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Acciones para ${name}`} disabled={pending}
        className="relative z-10 grid size-8 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem render={<Link href={`/pacientes/${id}`} />}><Eye className="size-4" /> Ver ficha</DropdownMenuItem>
        {canEdit && <DropdownMenuItem render={<Link href={`/pacientes/${id}/editar`} />}><Pencil className="size-4" /> Editar</DropdownMenuItem>}
        {canToggle && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={toggle} variant={active ? "destructive" : "default"}>
              {active ? <><PowerOff className="size-4" /> Desactivar</> : <><Power className="size-4" /> Reactivar</>}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
