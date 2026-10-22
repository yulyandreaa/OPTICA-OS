import {
  CalendarDays, ChartNoAxesCombined, ClipboardList, Glasses, LayoutDashboard, Package, Settings, ShieldCheck,
  ShoppingCart, Stethoscope, Users, UsersRound, Wallet, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/modules/authz/permissions";

export interface NavLeaf {
  href: string;
  label: string;
  permission: Permission;
}

export interface NavItem extends NavLeaf {
  icon: LucideIcon;
  /** Roadmap phase in which the module ships; omitted = available now. */
  phase?: number;
  /** Sub-pages shown under the item while its section is open. */
  children?: NavLeaf[];
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/inicio", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
      {
        href: "/pacientes", label: "Clientes y pacientes", icon: UsersRound, permission: "patients.read",
        children: [
          { href: "/pacientes", label: "Directorio", permission: "patients.read" },
          { href: "/crm", label: "Seguimiento (CRM)", permission: "crm.read" },
        ],
      },
      {
        href: "/inventario", label: "Inventario", icon: Package, permission: "inventory.read",
        children: [
          { href: "/inventario", label: "Productos y stock", permission: "inventory.read" },
          { href: "/compras", label: "Compras y proveedores", permission: "purchases.read" },
        ],
      },
      {
        href: "/ventas", label: "Ventas y cotizaciones", icon: ShoppingCart, permission: "sales.read",
        children: [
          { href: "/ventas", label: "Ventas", permission: "sales.read" },
          { href: "/ventas/pos", label: "Punto de venta", permission: "pos.use" },
          { href: "/cotizaciones", label: "Cotizaciones", permission: "quotes.read" },
          { href: "/facturacion", label: "Facturación", permission: "billing.read" },
        ],
      },
      { href: "/caja", label: "Caja y cartera", icon: Wallet, permission: "cash.manage", phase: 1 },
      { href: "/ordenes", label: "Órdenes ópticas", icon: Glasses, permission: "lab_orders.read" },
      { href: "/reportes", label: "Reportes", icon: ChartNoAxesCombined, permission: "reports.read" },
      { href: "/equipo", label: "Equipo y permisos", icon: Users, permission: "team.read" },
      { href: "/configuracion", label: "Configuración", icon: Settings, permission: "settings.manage" },
    ],
  },
  {
    label: "Atención clínica",
    items: [
      { href: "/agenda", label: "Agenda", icon: CalendarDays, permission: "appointments.read" },
      { href: "/consultas", label: "Consultas e historia clínica", icon: Stethoscope, permission: "medical_records.read" },
      { href: "/rips", label: "RIPS", icon: ClipboardList, permission: "rips.read" },
    ],
  },
];

export const NAV_PLATFORM: NavItem = { href: "/admin", label: "Super admin", icon: ShieldCheck, permission: "dashboard.view" };
