import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/tenants/services/context";

/** Reads the session per request; see docs/adr/ADR-006-cache-components.md. */
export const instant = false;

export default async function Root() {
  const user = await getCurrentUser();
  redirect(user ? "/inicio" : "/login");
}
