import { z } from "zod";
import { UNITS } from "./constants";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");
const money = (label: string) => z.number({ error: `Escribe ${label}` }).min(0, `${label[0]!.toUpperCase()}${label.slice(1)} no puede ser negativo`).max(999_999_999);

export const variantSchema = z.object({
  id: z.uuid().optional(),
  sku: z.string().trim().max(40).regex(/^[A-Za-z0-9._-]*$/, "Usa solo letras, números, punto o guion").optional(),
  barcode: z.string().trim().max(40).regex(/^[A-Za-z0-9-]*$/, "Usa solo letras, números o guion").optional(),
  color_name: optionalText(60),
  color_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  image_url: z.url("Escribe un enlace completo (https://…)").optional().or(z.literal("")),
  attributes: z.record(z.string(), z.string().trim().max(40)),
  price: money("el precio"),
  /** Sent only by users with inventory.costs, and only when it changed. */
  cost: money("el costo").optional(),
  is_active: z.boolean(),
});

export const initialStockSchema = z.object({
  variant: z.number().int().min(0),
  branch_id: z.uuid(),
  quantity: z.number().int("Usa números enteros").min(0, "No puede ser negativo").max(99_999),
  lot_code: optionalText(60),
  expires_on: isoDate.optional().or(z.literal("")),
});

export const productSchema = z.object({
  id: z.uuid().optional(),
  category_id: z.uuid("Elige la categoría"),
  brand: optionalText(80),
  name: z.string().trim().min(2, "Escribe el nombre del producto").max(160),
  model: optionalText(80),
  collection: optionalText(80),
  description: optionalText(1000),
  tax_rate: z.union([z.literal(0), z.literal(5), z.literal(19)]),
  is_stocked: z.boolean(),
  unit: z.enum(UNITS),
  default_min_stock: z.number({ error: "Escribe el stock mínimo" }).int("Usa números enteros").min(0).max(99_999),
  track_lots: z.boolean(),
  is_active: z.boolean(),
  attributes: z.record(z.string(), z.union([z.string().trim().max(60), z.array(z.string().max(40)).max(12)]).nullable()),
  variants: z.array(variantSchema).min(1, "Agrega al menos una variante").max(60, "Máximo 60 variantes por producto"),
  initial_stock: z.array(initialStockSchema),
  idempotency_key: z.string().max(80).optional(),
}).superRefine((p, ctx) => {
  const keys = new Map<string, number>();
  const skus = new Map<string, number>();
  p.variants.forEach((v, i) => {
    const key = JSON.stringify([(v.color_name ?? "").toLowerCase(), Object.entries(v.attributes).filter(([, x]) => x).sort()]);
    if (keys.has(key)) ctx.addIssue({ code: "custom", path: ["variants", i, "color_name"], message: `Repite la variante ${keys.get(key)! + 1}` });
    else keys.set(key, i);
    const sku = (v.sku ?? "").toUpperCase();
    if (sku && skus.has(sku)) ctx.addIssue({ code: "custom", path: ["variants", i, "sku"], message: `SKU repetido en la variante ${skus.get(sku)! + 1}` });
    else if (sku) skus.set(sku, i);
  });
  p.initial_stock.forEach((s, i) => {
    if (s.variant >= p.variants.length) ctx.addIssue({ code: "custom", path: ["initial_stock", i, "variant"], message: "Variante no válida" });
    if (p.track_lots && s.quantity > 0 && !s.lot_code) ctx.addIssue({ code: "custom", path: ["initial_stock", i, "lot_code"], message: "Indica el lote" });
  });
});
export type ProductInput = z.infer<typeof productSchema>;

export const movementSchema = z.object({
  branch_id: z.uuid("Elige la sede"),
  variant_id: z.uuid("Elige el producto"),
  type: z.enum(["count", "adjustment", "initial", "damage", "loss"]),
  quantity: z.number().int("Usa números enteros").min(-99_999).max(99_999).optional(),
  counted: z.number().int("Usa números enteros").min(0, "No puede ser negativo").max(99_999).optional(),
  lot_code: optionalText(60),
  expires_on: isoDate.optional().or(z.literal("")),
  unit_cost: money("el costo").optional(),
  notes: z.string().trim().min(3, "Explica el motivo").max(300),
  idempotency_key: z.string().max(80),
}).superRefine((m, ctx) => {
  if (m.type === "count") {
    if (m.counted === undefined) ctx.addIssue({ code: "custom", path: ["counted"], message: "Escribe cuántas unidades contaste" });
  } else if (!m.quantity) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "La cantidad no puede ser cero" });
  } else if (m.type !== "adjustment" && m.quantity < 0) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "Escribe una cantidad positiva" });
  }
});
export type MovementInput = z.infer<typeof movementSchema>;

export const transferSchema = z.object({
  from_branch_id: z.uuid("Elige la sede de origen"),
  to_branch_id: z.uuid("Elige la sede de destino"),
  notes: optionalText(300),
  items: z.array(z.object({ variant_id: z.uuid(), quantity: z.number().int("Usa números enteros").positive("Debe ser mayor que cero").max(99_999) }))
    .min(1, "Agrega al menos un producto"),
  idempotency_key: z.string().max(80),
}).refine((t) => t.from_branch_id !== t.to_branch_id, { message: "Elige una sede de destino distinta al origen", path: ["to_branch_id"] });
export type TransferInput = z.infer<typeof transferSchema>;

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre").max(60),
  kind: z.enum(["frame", "ophthalmic_lens", "contact_lens", "supply", "service"]),
});

const PAGE_SIZE = 25;
export const listParams = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  categoria: z.uuid().optional().catch(undefined),
  marca: z.uuid().optional().catch(undefined),
  estado: z.enum(["activos", "inactivos", "todos"]).catch("activos"),
  disponibilidad: z.enum(["todas", "available", "low", "out"]).catch("todas"),
  pagina: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type ListParams = z.infer<typeof listParams>;
export const LIST_PAGE_SIZE = PAGE_SIZE;

/** Search params → list params. Accepts the dashboard's older ?filtro=bajo|agotado links. */
export function parseListParams(sp: Record<string, string | string[] | undefined>): ListParams {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const legacy = one("filtro") === "bajo" ? "low" : one("filtro") === "agotado" ? "out" : undefined;
  return listParams.parse({
    q: one("q") || undefined, categoria: one("categoria"), marca: one("marca"), estado: one("estado"),
    disponibilidad: one("disponibilidad") ?? legacy, pagina: one("pagina"),
  });
}
