"use client";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useOptimistic, useRef, useState } from "react";
import { toast } from "sonner";
import { TONE_TEXT } from "@/components/shared/status-badge";
import { minutesInTz } from "@/lib/format";
import { cn } from "@/lib/utils";
import { rescheduleAppointmentAction } from "../actions";
import { statusMeta } from "../utils/status";
import { AppointmentSheet } from "./appointment-sheet";
import { NewAppointmentDialog, type NewAppointmentPrefill } from "./new-appointment-dialog";
import type { AgendaAppointment, AgendaColumn, AgendaOption, AgendaTypeOption } from "./types";

const HOUR_PX = 64;
const SNAP = 15;

interface Props {
  view: "day" | "week";
  columns: AgendaColumn[];
  appointments: AgendaAppointment[];
  tz: string;
  startHour: number;
  endHour: number;
  canCreate: boolean;
  canUpdate: boolean;
  types: AgendaTypeOption[];
  specialists: AgendaOption[];
  branches: AgendaOption[];
  defaultBranchId: string | null;
  openNew?: NewAppointmentPrefill | null;
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function toHHMM(minutes: number) { return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`; }
function fmtHour(h: number) { return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "a. m." : "p. m."}`; }

/** Assigns side-by-side lanes to overlapping appointments within a column. */
function layoutLanes(items: { id: string; start: number; end: number }[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<string, { lane: number; lanes: number }>();
  let cluster: typeof sorted = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    const assigned = cluster.map((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); } else laneEnds[lane] = it.end;
      return { id: it.id, lane };
    });
    for (const a of assigned) result.set(a.id, { lane: a.lane, lanes: laneEnds.length });
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return result;
}

export function AgendaBoard(props: Props) {
  const { columns, tz, startHour, endHour, view } = props;
  const router = useRouter();
  const [optimistic, applyMove] = useOptimistic(
    props.appointments,
    (state, move: { id: string; startsAt: string; endsAt: string; specialistId: string | null }) =>
      state.map((a) => (a.id === move.id ? { ...a, ...move } : a)),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<NewAppointmentPrefill | null>(props.openNew ?? null);
  const [dropHint, setDropHint] = useState<{ col: string; minutes: number } | null>(null);
  const dragRef = useRef<{ id: string; grabOffset: number; duration: number } | null>(null);
  const [dragDuration, setDragDuration] = useState<number | null>(null);
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNowMinutes(minutesInTz(new Date(), tz));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [tz]);

  const totalMinutes = (endHour - startHour) * 60;
  const pxPerMin = HOUR_PX / 60;

  const byColumn = useMemo(() => {
    const map = new Map<string, (AgendaAppointment & { start: number; end: number })[]>();
    for (const a of optimistic) {
      const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(a.startsAt));
      const col = columns.find((c) => (view === "day" ? (c.specialistId ?? "none") === (a.specialistId ?? "none") : c.dateKey === dateKey));
      if (!col) continue;
      const start = minutesInTz(a.startsAt, tz);
      const end = Math.max(start + 10, start + (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000);
      map.set(col.key, [...(map.get(col.key) ?? []), { ...a, start, end }]);
    }
    return map;
  }, [optimistic, columns, tz, view]);

  function minutesFromEvent(e: React.DragEvent | React.MouseEvent, el: HTMLElement) {
    const y = e.clientY - el.getBoundingClientRect().top;
    return Math.round(y / pxPerMin / SNAP) * SNAP + startHour * 60;
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>, col: AgendaColumn) {
    e.preventDefault();
    setDropHint(null);
    setDragDuration(null);
    const drag = dragRef.current;
    if (!drag) return;
    const minutes = Math.max(startHour * 60, minutesFromEvent(e, e.currentTarget) - drag.grabOffset);
    const snapped = Math.round(minutes / SNAP) * SNAP;
    const appt = optimistic.find((a) => a.id === drag.id);
    if (!appt) return;
    const specialistId = view === "day" ? col.specialistId : appt.specialistId;
    const time = toHHMM(snapped);
    // Optimistic position: compute UTC from the column date + local time offset of the original.
    const offsetMs = new Date(appt.startsAt).getTime() - (Date.parse(`${new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(appt.startsAt))}T00:00:00Z`) + minutesInTz(appt.startsAt, tz) * 60_000);
    const startsAt = new Date(Date.parse(`${col.dateKey}T00:00:00Z`) + snapped * 60_000 + offsetMs);
    startTransition(async () => {
      applyMove({ id: appt.id, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + drag.duration * 60_000).toISOString(), specialistId });
      const res = await rescheduleAppointmentAction({ id: appt.id, date: col.dateKey, time, specialistId });
      if (!res.ok) toast.error(res.error);
      else toast.success(`Cita movida a las ${time}`);
      router.refresh();
    });
  }

  const selectedAppt = optimistic.find((a) => a.id === selected) ?? null;

  return (
    <>
      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        <div className="overflow-x-auto">
          <div className="min-w-fit" style={{ minWidth: 64 + columns.length * (view === "day" ? 200 : 140) }}>
            {/* Column headers */}
            <div className="sticky top-0 z-20 grid border-b bg-surface" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(0, 1fr))` }}>
              <div />
              {columns.map((c) => (
                <div key={c.key} className="border-l px-3 py-2.5">
                  <p className={cn("truncate text-sm font-medium", c.isToday && view === "week" && "text-brand")}>{c.label}</p>
                  {c.sublabel && <p className="truncate text-xs text-muted-foreground">{c.sublabel}</p>}
                </div>
              ))}
            </div>

            {/* Time grid */}
            <div className="relative grid max-h-[calc(100dvh-260px)] overflow-y-auto" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(0, 1fr))` }}>
              <div className="relative" style={{ height: totalMinutes * pxPerMin }}>
                {Array.from({ length: endHour - startHour }, (_, i) => (
                  <span key={i} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground tabular" style={{ top: i * HOUR_PX }}>
                    {i === 0 ? "" : fmtHour(startHour + i)}
                  </span>
                ))}
              </div>

              {columns.map((col) => {
                const items = byColumn.get(col.key) ?? [];
                const lanes = layoutLanes(items.map((a) => ({ id: a.id, start: a.start, end: a.end })));
                return (
                  <div
                    key={col.key}
                    className={cn("relative border-l", props.canCreate && "cursor-cell")}
                    style={{ height: totalMinutes * pxPerMin }}
                    onDragOver={(e) => {
                      if (!props.canUpdate) return;
                      e.preventDefault();
                      const m = minutesFromEvent(e, e.currentTarget) - (dragRef.current?.grabOffset ?? 0);
                      setDropHint({ col: col.key, minutes: Math.round(m / SNAP) * SNAP });
                    }}
                    onDragLeave={() => setDropHint((h) => (h?.col === col.key ? null : h))}
                    onDrop={(e) => onDrop(e, col)}
                    onClick={(e) => {
                      if (!props.canCreate || e.target !== e.currentTarget) return;
                      const m = Math.floor((minutesFromEvent(e, e.currentTarget) - SNAP / 2) / SNAP) * SNAP;
                      setPrefill({ date: col.dateKey, time: toHHMM(Math.max(startHour * 60, m)), specialistId: col.specialistId ?? undefined });
                    }}
                  >
                    {/* hour lines */}
                    {Array.from({ length: endHour - startHour }, (_, i) => (
                      <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: i * HOUR_PX }}>
                        <div className="absolute inset-x-0 border-t border-dashed border-border/40" style={{ top: HOUR_PX / 2 }} />
                      </div>
                    ))}
                    {/* off-hours shading */}
                    {col.working.length > 0 && offHours(col.working, startHour * 60, endHour * 60).map(([s, e]) => (
                      <div key={s} className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--muted)_6px,var(--muted)_7px)] opacity-70"
                        style={{ top: (s - startHour * 60) * pxPerMin, height: (e - s) * pxPerMin }} />
                    ))}
                    {/* now line */}
                    {col.isToday && nowMinutes !== null && nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60 && (
                      <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-brand" style={{ top: (nowMinutes - startHour * 60) * pxPerMin }}>
                        <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-brand" />
                      </div>
                    )}
                    {/* drop hint */}
                    {dropHint?.col === col.key && dragDuration !== null && (
                      <div className="pointer-events-none absolute inset-x-1 z-10 rounded-md border-2 border-dashed border-brand/60 bg-brand-soft/60"
                        style={{ top: (dropHint.minutes - startHour * 60) * pxPerMin, height: dragDuration * pxPerMin }}>
                        <span className="px-1.5 text-[11px] font-medium text-brand">{toHHMM(dropHint.minutes)}</span>
                      </div>
                    )}
                    {/* appointments */}
                    {items.map((a) => {
                      const lane = lanes.get(a.id) ?? { lane: 0, lanes: 1 };
                      const meta = statusMeta(a.status);
                      const height = Math.max(22, (a.end - a.start) * pxPerMin - 2);
                      const draggable = props.canUpdate && !["completed", "cancelled", "no_show", "in_consultation"].includes(a.status);
                      const muted = ["cancelled", "no_show"].includes(a.status);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          draggable={draggable}
                          onDragStart={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            dragRef.current = { id: a.id, grabOffset: Math.round((e.clientY - rect.top) / pxPerMin), duration: a.end - a.start };
                            setDragDuration(a.end - a.start);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", a.id);
                          }}
                          onDragEnd={() => { dragRef.current = null; setDragDuration(null); setDropHint(null); }}
                          onClick={() => setSelected(a.id)}
                          className={cn(
                            "group absolute z-[5] overflow-hidden rounded-md border px-2 py-1 text-left text-xs shadow-soft transition-shadow outline-none hover:shadow-lift focus-visible:ring-3 focus-visible:ring-ring/50",
                            draggable && "cursor-grab active:cursor-grabbing",
                            muted && "opacity-55",
                          )}
                          style={{
                            top: (a.start - startHour * 60) * pxPerMin + 1,
                            height,
                            left: `calc(${(lane.lane / lane.lanes) * 100}% + 3px)`,
                            width: `calc(${100 / lane.lanes}% - 6px)`,
                            background: `color-mix(in oklch, ${a.type?.color ?? "#64748b"} 11%, var(--surface))`,
                            borderColor: `color-mix(in oklch, ${a.type?.color ?? "#64748b"} 30%, transparent)`,
                          }}
                        >
                          <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: a.type?.color }} />
                          <span className={cn("block truncate font-medium", muted && "line-through")}>{a.patient?.name ?? "Paciente"}</span>
                          {height > 34 && (
                            <span className="block truncate text-muted-foreground">
                              {toHHMM(a.start)} · {a.type?.name}
                            </span>
                          )}
                          {height > 52 && <span className={cn("mt-1 inline-flex items-center gap-1 text-[10px] font-medium", TONE_TEXT[meta.tone])}>
                            <span className="size-1.5 rounded-full bg-current" />{meta.label}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <AppointmentSheet appointment={selectedAppt} tz={tz} onClose={() => setSelected(null)} />
      <NewAppointmentDialog
        key={prefill ? JSON.stringify(prefill) : "closed"}
        prefill={prefill}
        onClose={() => setPrefill(null)}
        types={props.types}
        specialists={props.specialists}
        branches={props.branches}
        defaultBranchId={props.defaultBranchId}
      />
    </>
  );
}

function offHours(working: [number, number][], dayStart: number, dayEnd: number): [number, number][] {
  const sorted = [...working].sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let cursor = dayStart;
  for (const [s, e] of sorted) {
    if (s > cursor) gaps.push([cursor, Math.min(s, dayEnd)]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < dayEnd) gaps.push([cursor, dayEnd]);
  return gaps.filter(([s, e]) => e > s);
}
