import type { Tone } from "@/components/shared/status-badge";

export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "neutral" },
  processing: { label: "En proceso", tone: "warning" },
  accepted: { label: "Aceptada DIAN", tone: "success" },
  rejected: { label: "Rechazada", tone: "danger" },
  cancelled: { label: "Anulada", tone: "danger" },
};
