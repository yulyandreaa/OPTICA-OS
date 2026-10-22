import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/modules/settings/components/profile-form";
import { requireContext } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Mi perfil" };

export default async function ProfilePage() {
  const ctx = await requireContext();
  const { data } = await (await createClient()).from("profiles").select("phone").eq("id", ctx.user.id).single();
  return (
    <>
      <PageHeader title="Mi perfil" description={ctx.roles.map((r) => r.name).join(" · ")} />
      <div className="grid gap-4">
        <ProfileForm fullName={ctx.user.fullName} email={ctx.user.email} phone={data?.phone ?? null} />
        <Link href="/auth/update-password" className="text-sm text-muted-foreground hover:text-foreground">Cambiar contraseña →</Link>
      </div>
    </>
  );
}
