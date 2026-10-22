"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** Serializable subset of AppContext available to client components of the shell. */
export interface ShellData {
  user: { id: string; fullName: string; email: string; isPlatformAdmin: boolean };
  tenant: { id: string; name: string; slug: string };
  memberships: { id: string; name: string }[];
  branches: { id: string; name: string; city: string | null }[];
  activeBranchId: string | null;
  canSeeAllBranches: boolean;
  permissions: string[];
  roleName: string;
  trialDaysLeft: number | null;
  planName: string | null;
}

interface ShellState extends ShellData {
  can: (permission: string) => boolean;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
}

const Ctx = createContext<ShellState | null>(null);

export function ShellProvider({ data, children }: { data: ShellData; children: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const value = useMemo<ShellState>(() => {
    const perms = new Set(data.permissions);
    return { ...data, can: (p) => perms.has(p), commandOpen, setCommandOpen };
  }, [data, commandOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}
