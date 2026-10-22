import type { Tone } from "@/components/shared/status-badge";

export const APPOINTMENT_STATUS = {
  scheduled: { label: "Agendada", tone: "neutral" },
  confirmed: { label: "Confirmada", tone: "brand" },
  checked_in: { label: "Llegó", tone: "warning" },
  waiting: { label: "En espera", tone: "warning" },
  in_consultation: { label: "En consulta", tone: "brand" },
  completed: { label: "Atendida", tone: "success" },
  cancelled: { label: "Cancelada", tone: "danger" },
  no_show: { label: "No asistió", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export type AppointmentStatus = keyof typeof APPOINTMENT_STATUS;

/** Allowed transitions — the patient journey: llegó → sala de espera → consulta → atendida. */
export const NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ["confirmed", "checked_in", "cancelled", "no_show"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["waiting", "in_consultation", "cancelled"],
  waiting: ["in_consultation", "cancelled"],
  in_consultation: ["completed"],
  completed: [],
  cancelled: ["scheduled"],
  no_show: ["scheduled"],
};

export function statusMeta(status: string) {
  return APPOINTMENT_STATUS[status as AppointmentStatus] ?? APPOINTMENT_STATUS.scheduled;
}

export function canTransition(from: string, to: string) {
  return (NEXT_STATUSES[from as AppointmentStatus] ?? []).includes(to as AppointmentStatus);
}
