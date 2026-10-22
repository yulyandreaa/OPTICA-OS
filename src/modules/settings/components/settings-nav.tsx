"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShell } from "@/components/app-shell/shell-context";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/configuracion", label: "General", permission: "settings.manage" },
  { href: "/configuracion/sedes", label: "Sedes", permission: "branches.manage" },
  { href: "/configuracion/agenda", label: "Horarios de agenda", permission: "schedules.manage" },
  { href: "/configuracion/integraciones", label: "Integraciones", permission: "integrations.manage" },
  { href: "/configuracion/plan", label: "Plan y facturación", permission: "settings.manage" },
];

export function SettingsNav() {
  const pathname = usePathname();
  const shell = useShell();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Configuración">
      {ITEMS.filter((i) => shell.can(i.permission)).map((i) => (
        <Link key={i.href} href={i.href} aria-current={pathname === i.href ? "page" : undefined}
          className={cn("rounded-lg px-3 py-1.5 text-sm whitespace-nowrap", pathname === i.href ? "bg-surface font-medium shadow-soft ring-1 ring-border" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
