"use client";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { LogoMark } from "@/components/shared/logo";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { switchTenantAction } from "@/modules/tenants/actions";
import { NAV_ADMIN, NAV_MAIN, NAV_PLATFORM, type NavItem } from "./nav-config";
import { useShell } from "./shell-context";

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const shell = useShell();
  const main = NAV_MAIN.filter((i) => shell.can(i.permission));
  const admin = NAV_ADMIN.filter((i) => shell.can(i.permission));

  return (
    <div className="flex h-full flex-col gap-4 px-3 py-3">
      <TenantSwitcher />
      <nav aria-label="Principal" className="grid gap-0.5">
        {main.map((item) => <NavLink key={item.href} item={item} onNavigate={onNavigate} />)}
      </nav>
      {admin.length > 0 && (
        <nav aria-label="Administración" className="grid gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Administración</p>
          {admin.map((item) => <NavLink key={item.href} item={item} onNavigate={onNavigate} />)}
        </nav>
      )}
      <div className="mt-auto grid gap-2">
        {shell.user.isPlatformAdmin && <NavLink item={NAV_PLATFORM} onNavigate={onNavigate} />}
        {shell.trialDaysLeft !== null && (
          <Link href="/configuracion/plan" className="rounded-xl border bg-surface p-3 text-xs shadow-soft transition-colors hover:border-foreground/15">
            <p className="font-medium">Prueba {shell.planName} · {shell.trialDaysLeft} días</p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(6, (shell.trialDaysLeft / 14) * 100)}%` }} />
            </div>
            <p className="mt-2 text-muted-foreground">Elige tu plan cuando quieras.</p>
          </Link>
        )}
      </div>
    </div>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
        active ? "bg-surface font-medium text-foreground shadow-soft ring-1 ring-border" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <item.icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-foreground")} strokeWidth={1.85} />
      <span className="truncate">{item.label}</span>
      {item.phase && <span className="ml-auto text-[10px] text-muted-foreground/70">pronto</span>}
    </Link>
  );
}

function TenantSwitcher() {
  const shell = useShell();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const switchTo = (id: string) =>
    startTransition(async () => {
      const res = await switchTenantAction(id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <LogoMark className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{shell.tenant.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{shell.roleName}</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Empresas</DropdownMenuLabel>
          {shell.memberships.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => m.id !== shell.tenant.id && switchTo(m.id)}>
              <span className="truncate">{m.name}</span>
              {m.id === shell.tenant.id && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/onboarding?new=1")}>
          <Plus className="size-4" /> Crear otra empresa
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
