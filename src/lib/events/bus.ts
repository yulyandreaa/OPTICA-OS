/**
 * Lightweight in-process domain event bus (modular monolith). Modules publish facts; other modules react
 * without importing each other (avoids circular dependencies). Handlers that touch external services must
 * enqueue a job instead of doing I/O inline.
 */
export interface DomainEvents {
  PatientCreated: { tenantId: string; patientId: string };
  AppointmentBooked: { tenantId: string; appointmentId: string; source: string };
  AppointmentStatusChanged: { tenantId: string; appointmentId: string; from: string; to: string };
  ConsultationCompleted: { tenantId: string; appointmentId: string; patientId: string };
  SaleCompleted: { tenantId: string; saleId: string };
  LabOrderCreated: { tenantId: string; labOrderId: string };
  LabOrderReady: { tenantId: string; labOrderId: string };
  InvoiceAccepted: { tenantId: string; invoiceId: string };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void> | void;
const handlers = new Map<keyof DomainEvents, Handler<never>[]>();

export function subscribe<K extends keyof DomainEvents>(event: K, handler: Handler<K>) {
  handlers.set(event, [...(handlers.get(event) ?? []), handler as Handler<never>]);
}

export async function publish<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]) {
  const list = (handlers.get(event) ?? []) as Handler<K>[];
  const results = await Promise.allSettled(list.map(async (h) => h(payload))); // async wrapper also catches sync throws
  for (const r of results) {
    if (r.status === "rejected") console.error(JSON.stringify({ level: "error", scope: "events", event, tenantId: payload.tenantId, message: String(r.reason) }));
  }
}
