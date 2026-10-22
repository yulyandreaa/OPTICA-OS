import "server-only";
import { z } from "zod";
import type { ServerSupabase } from "@/lib/supabase/server";

const metricsSchema = z.object({
  appointments_today: z.number(), completed_today: z.number(), waiting_now: z.number(), in_consultation_now: z.number(),
  unconfirmed_tomorrow: z.number(), consultations_month: z.number(), consultations_prev_month: z.number(),
  no_show_30d: z.number(), finished_30d: z.number(), cancelled_30d: z.number(), cancelled_prev_30d: z.number(),
  new_patients_month: z.number(), new_patients_prev_month: z.number(), patients_total: z.number(), online_bookings_month: z.number(),
});
export type DashboardMetrics = z.infer<typeof metricsSchema>;

export async function getDashboardMetrics(db: ServerSupabase, tenantId: string, branchId: string | null) {
  const { data, error } = await db.rpc("dashboard_metrics", { p_tenant: tenantId, p_branch: branchId ?? undefined });
  if (error) throw error;
  return metricsSchema.parse(data);
}

export async function getRecallOpportunities(db: ServerSupabase, tenantId: string) {
  const [list, count] = await Promise.all([
    db.rpc("recall_opportunities", { p_tenant: tenantId, p_limit: 5 }),
    db.rpc("recall_opportunities_count", { p_tenant: tenantId }),
  ]);
  return { items: list.data ?? [], total: count.data ?? 0 };
}

/** Percent change; null when there's no baseline (never invent a trend). */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Business Health Score (0–100) from the signals available today. Each component is explained,
 * and components without enough data are excluded instead of guessed.
 */
export function healthScore(m: DashboardMetrics) {
  const parts: { label: string; score: number; weight: number; insight: string }[] = [];
  const patientsDelta = delta(m.new_patients_month, m.new_patients_prev_month);
  if (patientsDelta !== null) {
    parts.push({ label: "Captación", weight: 0.35, score: clamp(60 + patientsDelta), insight: patientsDelta >= 0 ? `Pacientes nuevos +${patientsDelta}% vs. mes anterior` : `Pacientes nuevos ${patientsDelta}% vs. mes anterior` });
  }
  if (m.finished_30d >= 5) {
    const rate = m.no_show_30d / m.finished_30d;
    parts.push({ label: "Asistencia", weight: 0.35, score: clamp(100 - rate * 300), insight: `Inasistencia del ${Math.round(rate * 100)}% en 30 días` });
  }
  const cancelDelta = delta(m.cancelled_30d, m.cancelled_prev_30d);
  if (cancelDelta !== null) {
    parts.push({ label: "Cancelaciones", weight: 0.3, score: clamp(75 - cancelDelta / 2), insight: cancelDelta > 0 ? `Tus cancelaciones aumentaron ${cancelDelta}%` : `Cancelaciones ${cancelDelta}% vs. 30 días previos` });
  }
  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = Math.round(parts.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight);
  return { score, parts };
}

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }
