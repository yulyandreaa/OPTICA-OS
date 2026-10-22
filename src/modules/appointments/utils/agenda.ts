import { addDaysKey, localDateKey, minutesInTz, weekdayOfKey, zonedTimeToUtc } from "@/lib/format";
import type { AppointmentRow } from "../repositories/appointments";
import type { AgendaAppointment } from "../components/types";

export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 20;

export function toAgendaAppointment(a: AppointmentRow): AgendaAppointment {
  return {
    id: a.id, branchId: a.branch_id, startsAt: a.starts_at, endsAt: a.ends_at, status: a.status, notes: a.notes, specialistId: a.specialist_id,
    patient: a.patient ? { id: a.patient.id, name: a.patient.full_name, phone: a.patient.phone, document: `${a.patient.document_type} ${a.patient.document_number}` } : null,
    type: a.type ? { id: a.type.id, name: a.type.name, color: a.type.color } : null,
    specialistName: a.specialist?.full_name ?? null,
    branchName: a.branch?.name ?? null,
  };
}

/** Monday-based week start for a date key. */
export function weekStart(dateKey: string) {
  const dow = weekdayOfKey(dateKey);
  return addDaysKey(dateKey, dow === 0 ? -6 : 1 - dow);
}

export function rangeFor(view: "day" | "week" | "month", dateKey: string, tz: string) {
  if (view === "day") return { from: zonedTimeToUtc(dateKey, "00:00", tz), to: zonedTimeToUtc(addDaysKey(dateKey, 1), "00:00", tz), days: [dateKey] };
  if (view === "week") {
    const start = weekStart(dateKey);
    const days = Array.from({ length: 7 }, (_, i) => addDaysKey(start, i));
    return { from: zonedTimeToUtc(start, "00:00", tz), to: zonedTimeToUtc(addDaysKey(start, 7), "00:00", tz), days };
  }
  const first = `${dateKey.slice(0, 8)}01`;
  const gridStart = weekStart(first);
  const days = Array.from({ length: 42 }, (_, i) => addDaysKey(gridStart, i));
  return { from: zonedTimeToUtc(gridStart, "00:00", tz), to: zonedTimeToUtc(addDaysKey(gridStart, 42), "00:00", tz), days };
}

export function shiftDate(view: "day" | "week" | "month", dateKey: string, dir: 1 | -1) {
  if (view === "day") return addDaysKey(dateKey, dir);
  if (view === "week") return addDaysKey(dateKey, 7 * dir);
  const [y, m] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return d.toISOString().slice(0, 10);
}

export function todayKey(tz: string) {
  return localDateKey(new Date(), tz);
}

export function hhmmToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export { minutesInTz };
