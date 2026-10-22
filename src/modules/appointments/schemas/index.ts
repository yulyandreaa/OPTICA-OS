import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida");

export const createAppointmentSchema = z.object({
  patientId: z.uuid("Selecciona un paciente"),
  typeId: z.uuid("Selecciona el tipo de cita"),
  specialistId: z.uuid().optional().or(z.literal("")).transform((v) => v || null),
  branchId: z.uuid().optional().or(z.literal("")).transform((v) => v || null),
  date: dateKey,
  time,
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
});
export type CreateAppointmentInput = z.input<typeof createAppointmentSchema>;

export const rescheduleSchema = z.object({
  id: z.uuid(),
  date: dateKey,
  time,
  specialistId: z.uuid().nullable().optional(),
});
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

export const statusSchema = z.object({
  id: z.uuid(),
  status: z.enum(["scheduled", "confirmed", "checked_in", "waiting", "in_consultation", "completed", "cancelled", "no_show"]),
  reason: z.string().trim().max(500).optional(),
});
export type StatusInput = z.infer<typeof statusSchema>;

export const agendaParams = z.object({
  view: z.enum(["day", "week", "month"]).default("day"),
  date: dateKey.optional(),
  specialist: z.uuid().optional(),
});
