import { Boxes } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { LiveShowcase } from "@/modules/inventory/components/live-showcase";
import { showcaseCatalog } from "@/modules/inventory/repositories";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Vitrina" };

export default async function ShowcasePage() {
  const ctx = await requirePermission("inventory.read");
  const db = await createClient();
  const { catalog, skuToVariant } = await showcaseCatalog(db, ctx.tenant.id);
  return (
    <>
      <PageHeader eyebrow={<Link href="/inventario" className="hover:text-foreground">Inventario</Link>} title="Vitrina" description="Tus monturas con foto, como las ve el cliente" />
      {catalog.length === 0
        ? <EmptyState icon={Boxes} title="Tu vitrina está vacía" description="Los productos con fotos marcados como “vitrina” aparecen aquí." />
        : <LiveShowcase catalog={catalog} skuToVariant={skuToVariant} />}
    </>
  );
}
