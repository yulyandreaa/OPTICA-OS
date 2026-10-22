"use client";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchBranchAction } from "@/modules/tenants/actions";
import { useShell } from "./shell-context";

export function BranchSwitcher() {
  const shell = useShell();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = shell.branches.find((b) => b.id === shell.activeBranchId);

  const select = (id: string | null) =>
    startTransition(async () => {
      const res = await switchBranchAction(id);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });

  if (shell.branches.length <= 1 && !shell.canSeeAllBranches) {
    return active ? <span className="hidden items-center gap-1.5 text-sm text-muted-foreground md:flex"><Building2 className="size-4" />{active.name}</span> : null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-surface px-2.5 text-sm shadow-soft outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <Building2 className="size-4 text-muted-foreground" />
        <span className="max-w-36 truncate">{active?.name ?? "Todas las sedes"}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sede</DropdownMenuLabel>
          {shell.canSeeAllBranches && (
            <DropdownMenuItem onClick={() => select(null)}>
              Todas las sedes {!shell.activeBranchId && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        {shell.canSeeAllBranches && <DropdownMenuSeparator />}
        {shell.branches.map((b) => (
          <DropdownMenuItem key={b.id} onClick={() => select(b.id)}>
            <span className="truncate">{b.name}</span>
            {b.city && <span className="text-xs text-muted-foreground">{b.city}</span>}
            {b.id === shell.activeBranchId && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
