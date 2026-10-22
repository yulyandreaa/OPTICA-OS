import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AgendaAppointment } from "./types";

export function MonthView({ days, monthKey, todayKey, byDay, tz }: {
  days: string[]; monthKey: string; todayKey: string; byDay: Map<string, AgendaAppointment[]>; tz: string;
}) {
  const weekdays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const time = new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return (
    <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-xs text-muted-foreground">
        {weekdays.map((d) => <div key={d} className="px-3 py-2 font-medium">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const items = (byDay.get(d) ?? []).filter((a) => !["cancelled", "no_show"].includes(a.status));
          const inMonth = d.slice(0, 7) === monthKey.slice(0, 7);
          return (
            <Link key={d} href={`/agenda?view=day&date=${d}`}
              className={cn("min-h-28 border-r border-b p-2 transition-colors hover:bg-muted/40 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/25 text-muted-foreground")}>
              <span className={cn("inline-grid size-6 place-items-center rounded-full text-xs tabular", d === todayKey && "bg-brand font-semibold text-brand-foreground")}>
                {Number(d.slice(8))}
              </span>
              <ul className="mt-1 grid gap-0.5">
                {items.slice(0, 3).map((a) => (
                  <li key={a.id} className="flex items-center gap-1.5 truncate text-[11px]">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: a.type?.color }} />
                    <span className="text-muted-foreground tabular">{time.format(new Date(a.startsAt))}</span>
                    <span className="truncate">{a.patient?.name.split(" ")[0]}</span>
                  </li>
                ))}
                {items.length > 3 && <li className="text-[11px] font-medium text-muted-foreground">+{items.length - 3} más</li>}
              </ul>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
