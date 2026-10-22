import { z } from "zod";
import type { Period } from "../period";
import { percentChange } from "../period";

const num = z.coerce.number();

const summarySchema = z.object({
  current: z.object({
    net_sales: num, gross_sales: num, sales_count: num, margin: num, costed_net: num, items_net: num,
    uncosted_lines: num, collected: num, payments_count: num, voided_count: num, voided_net: num,
  }),
  previous: z.object({ net_sales: num, sales_count: num, margin: num, costed_net: num, items_net: num, collected: num }),
  first_sale_day: z.string().nullable(),
  receivables: z.object({ total: num, count: num, overdue_total: num, overdue_count: num }),
  series: z.array(z.object({ bucket: z.string(), net: num, count: num, prev_bucket: z.string().nullable(), prev_net: num })),
  by_branch: z.array(z.object({ branch_id: z.string(), name: z.string(), net: num, count: num, prev_net: num, prev_count: num })),
  by_category: z.array(z.object({ category: z.string(), net: num })),
  top_products: z.array(z.object({ description: z.string(), quantity: num, net: num, image_url: z.string().nullable() })),
  by_seller: z.array(z.object({ seller_id: z.string(), name: z.string().nullable(), net: num, count: num })),
  alerts: z.object({
    low_stock: num, out_of_stock: num, late_lab_orders: num,
    low_stock_by_category: z.array(z.object({ category: z.string(), count: num })),
    late_orders: z.array(z.object({ id: z.string(), number: z.string(), days_late: num })),
    overdue: z.array(z.object({ sale_id: z.string(), number: z.string(), customer: z.string().nullable(), balance: num })),
  }),
});
export type DashboardSummary = z.infer<typeof summarySchema>;

export function parseSummary(data: unknown): DashboardSummary {
  return summarySchema.parse(data);
}

export type MarginState =
  | { status: "empty" }
  | { status: "no_costs"; uncostedLines: number }
  | { status: "ok" | "partial"; value: number; pct: number; coverage: number; uncostedLines: number; delta: number | null };

const marginPct = (margin: number, costedNet: number) => (costedNet > 0 ? (margin / costedNet) * 100 : null);

/** Below this many sales a % change is noise (e.g. +4650% over a single old sale). */
export const MIN_COMPARABLE_SALES = 3;

/**
 * The previous period is a fair baseline only if sales history already existed when it started
 * and it has enough sales to make a percentage meaningful.
 */
export function canCompare(s: DashboardSummary, period: Pick<Period, "prevFrom">) {
  return s.first_sale_day !== null && s.first_sale_day <= period.prevFrom && s.previous.sales_count >= MIN_COMPARABLE_SALES;
}

/**
 * Gross margin is only computed over lines with a recorded cost. If some sold lines lack a cost the
 * result is "partial" and says which share of sales it covers; it is never extrapolated.
 * The delta compares margin percentage points, and only when both periods have full cost coverage.
 */
export function marginState(s: DashboardSummary, comparable = true): MarginState {
  const c = s.current;
  if (c.items_net <= 0) return { status: "empty" };
  if (c.costed_net <= 0) return { status: "no_costs", uncostedLines: c.uncosted_lines };
  const coverage = c.costed_net / c.items_net;
  const pct = marginPct(c.margin, c.costed_net)!;
  const full = coverage >= 0.999;
  const prevPct = comparable && s.previous.items_net > 0 && s.previous.costed_net / s.previous.items_net >= 0.999 ? marginPct(s.previous.margin, s.previous.costed_net) : null;
  return {
    status: full ? "ok" : "partial", value: c.margin, pct, coverage, uncostedLines: c.uncosted_lines,
    delta: full && prevPct !== null ? Math.round(pct - prevPct) : null,
  };
}

export function kpiDeltas(s: DashboardSummary, comparable = true) {
  if (!comparable) return { netSales: null, collected: null };
  return {
    netSales: percentChange(s.current.net_sales, s.previous.net_sales),
    collected: percentChange(s.current.collected, s.previous.collected),
  };
}

export const summaryArgs = (tenantId: string, period: Period, branchId: string | null) => ({
  p_tenant: tenantId, p_from: period.from, p_to: period.to, p_prev_from: period.prevFrom, p_prev_to: period.prevTo,
  p_branch: branchId ?? undefined, p_bucket: period.bucket,
});
