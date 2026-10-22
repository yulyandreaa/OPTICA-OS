import {
  BarChart3, Boxes, CalendarDays, ClipboardList, FileText, FlaskConical, Home, Kanban, Receipt,
  Settings, ShieldCheck, ShoppingBag, Stethoscope, Truck, Users, UsersRound, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/modules/authz/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  /** Roadmap phase in which the module ships; omitted = available now. */
  phase?: number;
}

export const NAV_MAIN: NavItem[] = [
  { href: "/inicio", label: "Inicio", icon: Home, permission: "dashboard.view" },
  { href: "/pacientes", label: "Pacientes", icon: UsersRound, permission: "patients.read" },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, permission: "appointments.read" },
  { href: "/consultas", label: "Consultas", icon: Stethoscope, permission: "medical_records.read" },
  { href: "/ventas", label: "Ventas", icon: ShoppingBag, permission: "sales.read" },
  { href: "/cotizaciones", label: "Cotizaciones", icon: FileText, permission: "quotes.read" },
  { href: "/ordenes", label: "Órdenes", icon: FlaskConical, permission: "lab_orders.read" },
  { href: "/inventario", label: "Inventario", icon: Boxes, permission: "inventory.read" },
  { href: "/compras", label: "Compras", icon: Truck, permission: "purchases.read" },
  { href: "/crm", label: "CRM", icon: Kanban, permission: "crm.read" },
  { href: "/reportes", label: "Reportes", icon: BarChart3, permission: "reports.read" },
];

export const NAV_ADMIN: NavItem[] = [
  { href: "/facturacion", label: "Facturación", icon: Receipt, permission: "billing.read" },
  { href: "/rips", label: "RIPS", icon: ClipboardList, permission: "rips.read" },
  { href: "/equipo", label: "Equipo", icon: Users, permission: "team.read" },
  { href: "/configuracion", label: "Configuración", icon: Settings, permission: "settings.manage" },
];

export const NAV_PLATFORM: NavItem = { href: "/admin", label: "Super admin", icon: ShieldCheck, permission: "dashboard.view" };
