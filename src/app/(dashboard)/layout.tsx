import { Suspense, type CSSProperties, type ReactNode } from "react";
import { SidebarContent } from "@/components/app-shell/app-sidebar";
import { CommandBar } from "@/components/app-shell/command-bar";
import { ShellProvider, type ShellData } from "@/components/app-shell/shell-context";
import { Topbar } from "@/components/app-shell/topbar";
import { daysUntil } from "@/lib/time";
import { primaryRole, requireContext } from "@/modules/tenants/services/context";
import { ShellSkeleton } from "@/components/app-shell/shell-skeleton";

/**
 * Static shell first (instant), session-dependent chrome + page stream in behind Suspense.
 * Required by Cache Components: request data (cookies) must sit inside a boundary.
 */
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <DashboardShell>{children}</DashboardShell>
    </Suspense>
  );
}

async function DashboardShell({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const role = primaryRole(ctx);
  const trialDaysLeft = ctx.subscription?.status === "trialing" && ctx.subscription.trialEndsAt
    ? await daysUntil(ctx.subscription.trialEndsAt)
    : null;

  const shell: ShellData = {
    user: { id: ctx.user.id, fullName: ctx.user.fullName, email: ctx.user.email, isPlatformAdmin: ctx.user.isPlatformAdmin },
    tenant: { id: ctx.tenant.id, name: ctx.tenant.trade_name, slug: ctx.tenant.slug },
    memberships: ctx.memberships.map((m) => ({ id: m.id, name: m.trade_name })),
    branches: ctx.branches.map((b) => ({ id: b.id, name: b.name, city: b.city })),
    activeBranchId: ctx.activeBranchId,
    canSeeAllBranches: ctx.roles.some((r) => r.branchId === null),
    permissions: [...ctx.grants.keys()],
    roleName: ctx.roles.find((r) => r.code === role)?.name ?? "",
    trialDaysLeft,
    planName: ctx.subscription?.planName ?? null,
  };

  const brandStyle = ctx.tenant.brand_color ? ({ "--brand": ctx.tenant.brand_color } as CSSProperties) : undefined;

  return (
    <ShellProvider data={shell}>
      <div className="flex min-h-dvh" style={brandStyle}>
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r bg-sidebar lg:block">
          <SidebarContent />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
      <CommandBar />
    </ShellProvider>
  );
}
