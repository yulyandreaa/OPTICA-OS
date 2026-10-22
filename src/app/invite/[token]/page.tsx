import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { AcceptInvitationButton } from "@/modules/team/components/accept-button";
import { hashToken } from "@/modules/team/utils";
import { getCurrentUser } from "@/modules/tenants/services/context";

/** Reads the session per request; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

export const metadata: Metadata = { title: "Invitación" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const db = await createClient();
  const { data } = await db.rpc("invitation_preview", { p_token_hash: hashToken(token) });
  const inv = data as { tenant: string; role: string; branch: string | null; email: string; status: string } | null;
  const user = await getCurrentUser();

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-8 px-6">
      <Logo />
      {!inv || inv.status !== "pending" ? (
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Invitación no disponible</h1>
          <p className="text-sm text-muted-foreground">{inv?.status === "expired" ? "Esta invitación expiró." : "El enlace no es válido o ya fue usado."} Pide a tu administrador una nueva.</p>
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Te invitaron a {inv.tenant}</h1>
            <p className="text-sm text-muted-foreground">Rol: <b className="text-foreground">{inv.role}</b>{inv.branch && <> · Sede {inv.branch}</>} · Para {inv.email}</p>
          </div>
          {user ? (
            <AcceptInvitationButton token={token} />
          ) : (
            <div className="grid gap-2">
              <Link href={`/register?next=/invite/${token}`} className={buttonVariants({ size: "lg" })}>Crear mi cuenta</Link>
              <Link href={`/login?next=/invite/${token}`} className={buttonVariants({ variant: "outline", size: "lg" })}>Ya tengo cuenta</Link>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
