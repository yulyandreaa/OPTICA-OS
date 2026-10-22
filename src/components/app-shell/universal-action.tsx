"use client";
import { CalendarPlus, ClipboardPlus, FilePlus2, FlaskConical, ListTodo, Plus, ShoppingCart, Truck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useShell } from "./shell-context";

export const UNIVERSAL_ACTIONS = [
  { label: "Paciente", href: "/pacientes/nuevo", icon: UserPlus, permission: "patients.create", shortcut: "P" },
  { label: "Cita", href: "/agenda?nueva=1", icon: CalendarPlus, permission: "appointments.create", shortcut: "C" },
  { label: "Consulta", href: "/consultas", icon: ClipboardPlus, permission: "medical_records.create" },
  { label: "Venta", href: "/ventas/pos", icon: ShoppingCart, permission: "pos.use", shortcut: "V" },
  { label: "Cotización", href: "/cotizaciones/nueva", icon: FilePlus2, permission: "quotes.create" },
  { label: "Compra", href: "/compras/nueva", icon: Truck, permission: "purchases.create" },
  { label: "Orden de laboratorio", href: "/ordenes", icon: FlaskConical, permission: "lab_orders.create" },
  { label: "Tarea", href: "/crm", icon: ListTodo, permission: "tasks.manage" },
] as const;

export function UniversalAction() {
  const shell = useShell();
  const router = useRouter();
  const actions = UNIVERSAL_ACTIONS.filter((a) => shell.can(a.permission));
  if (actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" className="h-8 gap-1.5 px-3" />}>
        <Plus className="size-4" /> <span className="hidden sm:inline">Nuevo</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Crear</DropdownMenuLabel>
          {actions.map((a) => (
            <DropdownMenuItem key={a.label} onClick={() => router.push(a.href)}>
              <a.icon className="size-4" /> {a.label}
              {"shortcut" in a && <DropdownMenuShortcut>⇧{a.shortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
