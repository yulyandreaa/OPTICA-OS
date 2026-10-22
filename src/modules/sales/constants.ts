import type { Tone } from "@/components/shared/status-badge";

export const PAYMENT_METHODS = {
  cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", nequi: "Nequi", daviplata: "Daviplata", wompi: "Wompi", credit: "Crédito",
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const SALE_STATUS: Record<string, { label: string; tone: Tone }> = {
  partial: { label: "Con saldo", tone: "warning" },
  paid: { label: "Pagada", tone: "success" },
  cancelled: { label: "Anulada", tone: "danger" },
  returned: { label: "Devuelta", tone: "danger" },
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

/** Mirrors the DB math (IVA-inclusive prices) for live totals in the UI; the database stays authoritative. */
export function lineTotals(qty: number, unitPrice: number, discount: number, taxRate: number) {
  const total = Math.round((qty * unitPrice - discount) * 100) / 100;
  const tax = Math.round((total - total / (1 + taxRate / 100)) * 100) / 100;
  return { total, tax };
}
