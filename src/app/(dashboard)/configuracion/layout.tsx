import { PageHeader } from "@/components/shared/page-header";
import { SettingsNav } from "@/modules/settings/components/settings-nav";
import { requireContext } from "@/modules/tenants/services/context";

export default async function SettingsLayout({ children }: LayoutProps<"/configuracion">) {
  await requireContext();
  return (
    <>
      <PageHeader title="Configuración" description="Tu empresa, sedes, agenda e integraciones." />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
