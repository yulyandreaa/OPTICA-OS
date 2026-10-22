export interface AgendaAppointment {
  id: string;
  branchId: string;
  startsAt: string;
  endsAt: string;
  status: string;
  notes: string | null;
  specialistId: string | null;
  patient: { id: string; name: string; phone: string | null; document: string } | null;
  type: { id: string; name: string; color: string } | null;
  specialistName: string | null;
  branchName: string | null;
}

export interface AgendaColumn {
  key: string;
  label: string;
  sublabel?: string;
  dateKey: string;
  specialistId: string | null;
  /** Working windows in local minutes [start, end) — used to shade off-hours. */
  working: [number, number][];
  isToday?: boolean;
}

export interface AgendaOption { id: string; name: string }
export interface AgendaTypeOption extends AgendaOption { color: string; duration: number }
