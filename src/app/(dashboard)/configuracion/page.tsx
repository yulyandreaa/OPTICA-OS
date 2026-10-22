import type { Metadata } from "next";
import { TenantForm } from "@/modules/settings/components/tenant-form";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.manage");
  return <TenantForm tenant={ctx.tenant} />;
}
