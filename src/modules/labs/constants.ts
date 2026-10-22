import type { Tone } from "@/components/shared/status-badge";

export const LAB_FLOW = ["pending", "sent", "accepted", "in_process", "quality_control", "ready", "received", "delivered"] as const;
export type LabStatus = (typeof LAB_FLOW)[number] | "cancelled";

export const LAB_STATUS: Record<LabStatus, { label: string; tone: Tone; patientLabel: string }> = {
  pending: { label: "Por enviar", tone: "neutral", patientLabel: "Pedido recibido" },
  sent: { label: "Enviada al laboratorio", tone: "brand", patientLabel: "En laboratorio" },
  accepted: { label: "Aceptada por laboratorio", tone: "brand", patientLabel: "En laboratorio" },
  in_process: { label: "En producción", tone: "brand", patientLabel: "En laboratorio" },
  quality_control: { label: "Control de calidad", tone: "warning", patientLabel: "Control de calidad" },
  ready: { label: "Lista en laboratorio", tone: "success", patientLabel: "Control de calidad" },
  received: { label: "Recibida en óptica", tone: "success", patientLabel: "Lista para recoger" },
  delivered: { label: "Entregada", tone: "neutral", patientLabel: "Entregada" },
  cancelled: { label: "Cancelada", tone: "danger", patientLabel: "Cancelada" },
};

export const QC_ITEMS = [
  { key: "formula", label: "Fórmula verificada con lensómetro" },
  { key: "centering", label: "Centrado óptico (DP)" },
  { key: "height", label: "Altura de montaje" },
  { key: "frame", label: "Montura ajustada y sin daños" },
  { key: "treatment", label: "Tratamientos correctos" },
  { key: "physical", label: "Estado físico de los lentes (rayas, burbujas)" },
] as const;

export function nextStatus(s: string): LabStatus | null {
  const i = LAB_FLOW.indexOf(s as (typeof LAB_FLOW)[number]);
  return i >= 0 && i < LAB_FLOW.length - 1 ? LAB_FLOW[i + 1]! : null;
}

/** Patient-facing tracker steps (e-commerce style). */
export const TRACK_STEPS = ["Pedido recibido", "En laboratorio", "Control de calidad", "Lista para recoger", "Entregada"] as const;
export function trackStep(status: string) {
  return TRACK_STEPS.indexOf(LAB_STATUS[status as LabStatus]?.patientLabel as (typeof TRACK_STEPS)[number]);
}
