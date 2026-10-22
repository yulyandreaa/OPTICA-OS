import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { addDaysKey, formatDate, zonedTimeToUtc } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { WaitingRoom } from "@/modules/appointments/components/waiting-room";
import { listAppointments } from "@/modules/appointments/repositories/appointments";
import { toAgendaAppointment, todayKey } from "@/modules/appointments/utils/agenda";
import { can } from "@/modules/authz/permissions";
import { requirePermission } from "@/modules/tenants/services/context";

export const metadata: Metadata = { title: "Sala de espera" };

export default async function WaitingRoomPage() {
  const ctx = await requirePermission("appointments.read");
  await connection(); // reads the clock (today, greeting)
  const today = todayKey(ctx.timezone);
  const rows = await listAppointments(await createClient(), ctx.tenant.id, {
    branchId: ctx.activeBranchId,
    fromUtc: zonedTimeToUtc(today, "00:00", ctx.timezone),
    toUtc: zonedTimeToUtc(addDaysKey(today, 1), "00:00", ctx.timezone),
  });
  const items = rows
    .filter((r) => !["cancelled", "no_show", "completed"].includes(r.status))
    .map((r) => ({ ...toAgendaAppointment(r), checkedInAt: r.checked_in_at, startedAt: r.started_at }));

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/agenda" className="hover:text-foreground">Agenda</Link>}
        title="Sala de espera"
        description={`${formatDate(new Date(), ctx.timezone, { weekday: "long", day: "numeric", month: "long" })} · ${ctx.branches.find((b) => b.id === ctx.activeBranchId)?.name ?? "Todas las sedes"}`}
        actions={<Link href="/agenda" className={buttonVariants({ variant: "outline" })}>Ver agenda</Link>}
      />
      <WaitingRoom appointments={items} tz={ctx.timezone} canUpdate={can(ctx.grants, "appointments.update", ctx.activeBranchId)} />
    </>
  );
}
