import type { Tone } from "@/components/shared/status-badge";

export const PO_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "neutral" }, sent: { label: "Enviada", tone: "brand" }, approved: { label: "Aprobada", tone: "brand" },
  partially_received: { label: "Recibida parcial", tone: "warning" }, received: { label: "Recibida", tone: "success" }, cancelled: { label: "Cancelada", tone: "danger" },
};
