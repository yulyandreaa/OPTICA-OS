import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/shared/logo";
import { OnboardingWizard } from "@/modules/onboarding/components/onboarding-wizard";
import { getAppContext, getCurrentUser } from "@/modules/tenants/services/context";

/** Reads the session per request; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

export const metadata: Metadata = { title: "Configura tu óptica" };

export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { new: createAnother } = await props.searchParams;
  if (!createAnother && (await getAppContext())) redirect("/inicio");

  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "";
  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 py-6 sm:px-10"><Logo /></header>
      <main className="mx-auto max-w-lg px-6 pt-6 pb-20"><OnboardingWizard defaultName={name} /></main>
    </div>
  );
}
