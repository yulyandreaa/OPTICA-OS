"use client";
import { Bell, LogOut, Menu, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { initials } from "@/lib/format";
import { signOutAction } from "@/modules/auth/actions";
import { SidebarContent } from "./app-sidebar";
import { BranchSwitcher } from "./branch-switcher";
import { SearchTrigger } from "./command-bar";
import { useShell } from "./shell-context";
import { UniversalAction } from "./universal-action";

export function Topbar() {
  const shell = useShell();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú" onClick={() => setMobileOpen(true)}>
        <Menu />
      </Button>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Menú</SheetTitle>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1"><SearchTrigger /></div>

      <div className="flex items-center gap-2">
        <BranchSwitcher />
        <UniversalAction />
        <Button variant="ghost" size="icon" aria-label="Notificaciones" className="relative">
          <Bell />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40" aria-label="Cuenta">
            <Avatar className="size-8 border">
              <AvatarFallback className="bg-brand-soft text-xs font-medium text-brand">{initials(shell.user.fullName)}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-medium text-foreground">{shell.user.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">{shell.user.email}</p>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/perfil" />}><UserRound className="size-4" /> Mi perfil</DropdownMenuItem>
            {shell.can("settings.manage") && (
              <DropdownMenuItem render={<Link href="/configuracion" />}><Settings className="size-4" /> Configuración</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOutAction()}><LogOut className="size-4" /> Cerrar sesión</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
