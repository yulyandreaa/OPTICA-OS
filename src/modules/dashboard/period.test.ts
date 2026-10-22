import { describe, expect, it } from "vitest";
import { bucketFor, percentChange, resolvePeriod } from "./period";
import { canCompare, kpiDeltas, marginState, parseSummary } from "./services/summary";

describe("resolvePeriod", () => {
  const today = "2026-10-22";

  it("por defecto es el mes actual comparado con los mismos días del mes anterior", () => {
    const p = resolvePeriod({}, today);
    expect(p).toMatchObject({ key: "mes", from: "2026-10-01", to: "2026-10-22", prevFrom: "2026-09-01", prevTo: "2026-09-22", bucket: "day" });
  });

  it("hoy se compara con ayer", () => {
    expect(resolvePeriod({ periodo: "hoy" }, today)).toMatchObject({ from: today, to: today, prevFrom: "2026-10-21", prevTo: "2026-10-21" });
  });

  it("últimos 7 días incluyen hoy y se comparan con los 7 anteriores", () => {
    expect(resolvePeriod({ periodo: "7d" }, today)).toMatchObject({ from: "2026-10-16", to: today, prevFrom: "2026-10-09", prevTo: "2026-10-15" });
  });

  it("mes anterior es el mes completo y se compara con el mes previo", () => {
    expect(resolvePeriod({ periodo: "mes_anterior" }, "2026-03-15")).toMatchObject({ from: "2026-02-01", to: "2026-02-28", prevFrom: "2026-01-01", prevTo: "2026-01-31" });
  });

  it("el 31 de marzo se compara hasta el último día de febrero", () => {
    expect(resolvePeriod({}, "2026-03-31")).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28" });
  });

  it("un rango personalizado se compara con una ventana igual justo antes", () => {
    const p = resolvePeriod({ periodo: "rango", desde: "2026-06-01", hasta: "2026-08-31" }, today);
    expect(p).toMatchObject({ from: "2026-06-01", to: "2026-08-31", prevFrom: "2026-03-01", prevTo: "2026-05-31", bucket: "week" });
  });

  it("un rango inválido o en el futuro vuelve al mes actual", () => {
    expect(resolvePeriod({ periodo: "rango", desde: "2026-10-10", hasta: "2026-10-01" }, today).key).toBe("mes");
    expect(resolvePeriod({ periodo: "rango", desde: "2026-10-10", hasta: "2026-12-01" }, today).key).toBe("mes");
    expect(resolvePeriod({ periodo: "rango", desde: "x", hasta: "y" }, today).key).toBe("mes");
  });

  it("permite cambiar la agrupación solo a opciones coherentes con el rango", () => {
    expect(resolvePeriod({ agrupar: "week" }, today).bucket).toBe("week");
    expect(resolvePeriod({ periodo: "hoy", agrupar: "month" }, today)).toMatchObject({ bucket: "day", allowedBuckets: ["day"] });
  });

  it("la granularidad se adapta al rango", () => {
    expect([bucketFor(1), bucketFor(31), bucketFor(32), bucketFor(120), bucketFor(121)]).toEqual(["day", "day", "week", "week", "month"]);
  });
});

describe("percentChange", () => {
  it("no inventa comparaciones sin base", () => {
    expect(percentChange(500, 0)).toBeNull();
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });
});

describe("marginState", () => {
  const base = {
    current: { net_sales: 0, gross_sales: 0, sales_count: 0, margin: 0, costed_net: 0, items_net: 0, uncosted_lines: 0, collected: 0, payments_count: 0, voided_count: 0, voided_net: 0 },
    previous: { net_sales: 0, sales_count: 0, margin: 0, costed_net: 0, items_net: 0, collected: 0 },
    first_sale_day: null as string | null,
    receivables: { total: 0, count: 0, overdue_total: 0, overdue_count: 0 },
    series: [], by_branch: [], by_category: [], top_products: [], by_seller: [],
    alerts: { low_stock: 0, out_of_stock: 0, late_lab_orders: 0, low_stock_by_category: [], late_orders: [], overdue: [] },
  };
  const with_ = (current: Partial<typeof base.current>, previous: Partial<typeof base.previous> = {}) =>
    parseSummary({ ...base, current: { ...base.current, ...current }, previous: { ...base.previous, ...previous } });

  it("sin ventas no hay margen", () => {
    expect(marginState(with_({})).status).toBe("empty");
  });

  it("sin costos registrados muestra no disponible", () => {
    expect(marginState(with_({ items_net: 1000, uncosted_lines: 3 }))).toEqual({ status: "no_costs", uncostedLines: 3 });
  });

  it("con costos parciales calcula solo sobre lo costeado y no compara", () => {
    const m = marginState(with_({ items_net: 1000, costed_net: 600, margin: 300, uncosted_lines: 2 }, { items_net: 500, costed_net: 500, margin: 100 }));
    expect(m).toMatchObject({ status: "partial", pct: 50, coverage: 0.6, delta: null });
  });

  it("con costos completos compara puntos porcentuales", () => {
    const m = marginState(with_({ items_net: 1000, costed_net: 1000, margin: 450 }, { items_net: 800, costed_net: 800, margin: 320 }));
    expect(m).toMatchObject({ status: "ok", pct: 45, delta: 5 });
  });
});

describe("canCompare", () => {
  const s = (first: string | null, prevSales = 5) => parseSummary({
    current: { net_sales: 900, gross_sales: 0, sales_count: 9, margin: 0, costed_net: 0, items_net: 0, uncosted_lines: 0, collected: 0, payments_count: 0, voided_count: 0, voided_net: 0 },
    previous: { net_sales: 10, sales_count: prevSales, margin: 0, costed_net: 0, items_net: 0, collected: 0 },
    first_sale_day: first, receivables: { total: 0, count: 0, overdue_total: 0, overdue_count: 0 },
    series: [], by_branch: [], by_category: [], top_products: [], by_seller: [],
    alerts: { low_stock: 0, out_of_stock: 0, late_lab_orders: 0, low_stock_by_category: [], late_orders: [], overdue: [] },
  });

  it("no compara si el historial empieza después del inicio del período anterior (evita +4000%)", () => {
    expect(canCompare(s("2026-09-20"), { prevFrom: "2026-09-01" })).toBe(false);
    expect(kpiDeltas(s("2026-09-20"), false)).toEqual({ netSales: null, collected: null });
  });

  it("compara si el historial cubre el período anterior", () => {
    expect(canCompare(s("2026-08-01"), { prevFrom: "2026-09-01" })).toBe(true);
    expect(canCompare(s(null), { prevFrom: "2026-09-01" })).toBe(false);
  });

  it("no compara contra un período anterior con muy pocas ventas", () => {
    expect(canCompare(s("2025-01-01", 1), { prevFrom: "2026-09-01" })).toBe(false);
  });
});
