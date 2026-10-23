import type { Tone } from "@/components/shared/status-badge";

/** Methods a payment can be registered with. "credit" only labels old rows: an unpaid balance is not a payment. */
export const PAYMENT_METHODS = {
  cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", nequi: "Nequi", daviplata: "Daviplata", wompi: "Wompi",
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
export const PAYMENT_METHOD_LABEL: Record<string, string> = { ...PAYMENT_METHODS, credit: "Crédito" };

/** Commercial status of a sale: what happened to the operation. */
export const SALE_STATUS: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "Registrada", tone: "success" },
  partially_returned: { label: "Devolución parcial", tone: "warning" },
  returned: { label: "Devuelta", tone: "danger" },
  voided: { label: "Anulada", tone: "danger" },
};

/** Payment status of a sale: how much of it has been collected. Independent from the commercial status. */
export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente de pago", tone: "warning" },
  partial: { label: "Pago parcial", tone: "warning" },
  paid: { label: "Pagada", tone: "success" },
  refunded: { label: "Reembolsada", tone: "neutral" },
  partially_refunded: { label: "Reembolso parcial", tone: "neutral" },
};

export const QUOTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  sent: { label: "Enviada", tone: "brand" },
  viewed: { label: "Vista", tone: "brand" },
  accepted: { label: "Aceptada", tone: "success" },
  converted: { label: "Convertida en venta", tone: "success" },
  expired: { label: "Vencida", tone: "danger" },
  rejected: { label: "Rechazada", tone: "danger" },
};

/** A sent, viewed, draft or accepted quote past its date is expired even before anyone records it. */
export function quoteStatus(status: string, validUntil: string, todayKey: string) {
  return ["draft", "sent", "viewed", "accepted"].includes(status) && validUntil < todayKey ? "expired" : status;
}

/** Mirrors the DB math (IVA-inclusive prices) for live totals in the UI; the database stays authoritative. */
export function lineTotals(qty: number, unitPrice: number, discount: number, taxRate: number) {
  const total = Math.round((qty * unitPrice - discount) * 100) / 100;
  const tax = Math.round((total - total / (1 + taxRate / 100)) * 100) / 100;
  return { total, tax };
}
