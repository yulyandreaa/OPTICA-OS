import { z } from "zod";

export const OPS_PAGE_SIZE = 25;

/** Tabs of "Ventas y cotizaciones" → the `p_kind` of sales_operations. */
export const TABS = [
  { key: "todas", label: "Todas las operaciones", kind: "all" },
  { key: "ventas", label: "Ventas", kind: "sale" },
  { key: "cotizaciones", label: "Cotizaciones", kind: "quote" },
  { key: "anulaciones", label: "Devoluciones y anulaciones", kind: "void" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

/** Status options per tab. Quote "expired" includes quotes past their date that nobody closed. */
export const STATUS_OPTIONS: Record<TabKey, { key: string; label: string }[]> = {
  todas: [],
  ventas: [
    { key: "completed", label: "Registrada" }, { key: "partially_returned", label: "Devolución parcial" },
    { key: "returned", label: "Devuelta" }, { key: "voided", label: "Anulada" },
  ],
  cotizaciones: [
    { key: "draft", label: "Borrador" }, { key: "sent", label: "Enviada" }, { key: "accepted", label: "Aceptada" },
    { key: "converted", label: "Convertida en venta" }, { key: "rejected", label: "Rechazada" }, { key: "expired", label: "Vencida" },
  ],
  anulaciones: [
    { key: "voided", label: "Anulada" }, { key: "returned", label: "Devuelta" }, { key: "partially_returned", label: "Devolución parcial" },
  ],
};

export const PAYMENT_OPTIONS = [
  { key: "pending", label: "Pendiente de pago" }, { key: "partial", label: "Pago parcial" }, { key: "paid", label: "Pagada" },
] as const;

const uuid = z.uuid().optional().catch(undefined);
const schema = z.object({
  tab: z.enum(["todas", "ventas", "cotizaciones", "anulaciones"]).catch("todas"),
  q: z.string().trim().max(80).optional().catch(undefined),
  estado: z.string().max(30).optional().catch(undefined),
  pago: z.enum(["pending", "partial", "paid"]).optional().catch(undefined),
  asesor: uuid,
  sede: z.union([z.uuid(), z.literal("todas")]).optional().catch(undefined), // absent = the branch chosen in the top bar
  pagina: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type OpsParams = z.infer<typeof schema>;

/** Search params → validated filters. Unknown or stale values fall back to "no filter" instead of failing. */
export function parseOpsParams(sp: Record<string, string | string[] | undefined>): OpsParams {
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] !== "" ? (sp[k] as string) : undefined);
  const v = schema.parse({ tab: one("tab") ?? "todas", q: one("q"), estado: one("estado"), pago: one("pago"), asesor: one("asesor"), sede: one("sede"), pagina: one("pagina") ?? 1 });
  // A status from another tab (or payment on quotes) would silently empty the list.
  if (v.estado && !STATUS_OPTIONS[v.tab].some((o) => o.key === v.estado)) v.estado = undefined;
  if (v.tab === "cotizaciones") v.pago = undefined;
  return v;
}

/** Same filters as a query string (period params are carried separately by the page). */
export function opsQuery(p: Partial<OpsParams> & { periodo?: string; desde?: string; hasta?: string }) {
  const sp = new URLSearchParams();
  for (const [k, val] of Object.entries(p)) {
    if (val === undefined || val === null || val === "") continue;
    if (k === "tab" && val === "todas") continue;
    if (k === "pagina" && Number(val) <= 1) continue;
    sp.set(k, String(val));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
