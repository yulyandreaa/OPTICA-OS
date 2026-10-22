import type { Tone } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/format";

/** Category kinds (product_categories.kind): each one decides which fields the product form shows. */
export const KINDS = ["frame", "ophthalmic_lens", "contact_lens", "supply", "service"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  frame: "Monturas", ophthalmic_lens: "Lentes oftálmicos", contact_lens: "Lentes de contacto", supply: "Accesorios e insumos", service: "Servicios",
};

export type FieldDef = { key: string; label: string; options?: readonly string[]; placeholder?: string; multi?: boolean };

/** Product-level attributes (products.attributes) per kind. */
export const PRODUCT_FIELDS: Record<Kind, FieldDef[]> = {
  frame: [
    { key: "frame_type", label: "Tipo de montura", options: ["Completa", "Semi al aire", "Al aire"] },
    { key: "material", label: "Material", options: ["Acetato", "Metal", "Titanio", "TR90", "Inyectado", "Madera", "Mixto"] },
    { key: "shape", label: "Forma", options: ["Redonda", "Cuadrada", "Rectangular", "Ovalada", "Cat-eye", "Aviador", "Hexagonal", "Mariposa"] },
    { key: "gender", label: "Público", options: ["Unisex", "Mujer", "Hombre", "Niños"] },
  ],
  ophthalmic_lens: [
    { key: "design", label: "Diseño", options: ["Monofocal", "Bifocal", "Progresivo", "Ocupacional", "Otro"] },
    { key: "material", label: "Material", options: ["CR-39", "Policarbonato", "Trivex", "Alto índice", "Vidrio"] },
    { key: "index", label: "Índice de refracción", options: ["1.50", "1.53", "1.56", "1.59", "1.60", "1.67", "1.74"] },
    { key: "treatments", label: "Tratamientos", multi: true, options: ["Antirreflejo", "Filtro luz azul", "Fotocromático", "Polarizado", "Endurecido", "Protección UV", "Hidrofóbico"] },
  ],
  contact_lens: [
    { key: "lens_type", label: "Tipo de lente", options: ["Esférico", "Tórico", "Multifocal", "Cosmético", "Rígido gas permeable"] },
    { key: "replacement", label: "Reemplazo", options: ["Diario", "Quincenal", "Mensual", "Trimestral", "Anual"] },
    { key: "pack_size", label: "Unidades por caja", placeholder: "6" },
  ],
  supply: [],
  service: [],
};

/** Variant-level attributes (product_variants.attributes) per kind; color is a column of its own. */
export const VARIANT_FIELDS: Record<Kind, FieldDef[]> = {
  frame: [{ key: "size", label: "Calibre", placeholder: "52-18-140" }],
  ophthalmic_lens: [],
  contact_lens: [
    { key: "sphere", label: "Esfera", placeholder: "-2.00" },
    { key: "cylinder", label: "Cilindro", placeholder: "-0.75" },
    { key: "axis", label: "Eje", placeholder: "180" },
    { key: "addition", label: "Adición", placeholder: "+1.50" },
    { key: "base_curve", label: "Curva base", placeholder: "8.6" },
    { key: "diameter", label: "Diámetro", placeholder: "14.2" },
  ],
  supply: [{ key: "presentation", label: "Presentación", placeholder: "360 ml" }],
  service: [],
};

/** Whether variants of this kind usually carry a color (frames, cosmetic contacts, accessories). */
export const KIND_HAS_COLOR: Record<Kind, boolean> = { frame: true, ophthalmic_lens: false, contact_lens: true, supply: true, service: false };

/** Defaults when the category changes in the form. Lenses are fabricated per order (the Rx lives in the optical order). */
export const KIND_DEFAULTS: Record<Kind, { is_stocked: boolean; track_lots: boolean; unit: Unit }> = {
  frame: { is_stocked: true, track_lots: false, unit: "unidad" },
  ophthalmic_lens: { is_stocked: false, track_lots: false, unit: "par" },
  contact_lens: { is_stocked: true, track_lots: true, unit: "caja" },
  supply: { is_stocked: true, track_lots: false, unit: "unidad" },
  service: { is_stocked: false, track_lots: false, unit: "unidad" },
};

export const UNITS = ["unidad", "par", "caja", "frasco", "blister"] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_LABEL: Record<Unit, string> = { unidad: "Unidad", par: "Par", caja: "Caja", frasco: "Frasco", blister: "Blíster" };

export const TAX_RATES = [
  { value: 19, label: "IVA 19 %" }, { value: 5, label: "IVA 5 %" }, { value: 0, label: "Excluido o exento (0 %)" },
] as const;

export const STOCK_STATUS: Record<string, { label: string; tone: Tone }> = {
  ok: { label: "Disponible", tone: "success" },
  low: { label: "Stock bajo", tone: "warning" },
  out: { label: "Agotado", tone: "danger" },
  na: { label: "Sin inventario", tone: "neutral" },
};

export const AVAILABILITY = [
  { key: "todas", label: "Toda disponibilidad" },
  { key: "available", label: "Con existencias" },
  { key: "low", label: "Stock bajo" },
  { key: "out", label: "Agotados" },
] as const;

export const MOVEMENT_LABEL: Record<string, string> = {
  initial: "Carga inicial", purchase: "Entrada por compra", sale: "Salida por venta", return: "Devolución",
  adjustment: "Ajuste", transfer_out: "Traslado · salida", transfer_in: "Traslado · entrada", damage: "Daño", loss: "Pérdida",
};

export const MOVEMENT_FILTERS = [
  { key: "", label: "Todos los tipos" }, { key: "initial", label: "Carga inicial" }, { key: "purchase", label: "Compras" },
  { key: "sale", label: "Ventas" }, { key: "return", label: "Devoluciones" }, { key: "adjustment", label: "Ajustes y conteos" },
  { key: "damage_loss", label: "Daños y pérdidas" }, { key: "transfer", label: "Traslados" },
] as const;

/** What the "Registrar movimiento" form can record by hand (sales, purchases and transfers have their own flows). */
export const MANUAL_MOVEMENTS = [
  { key: "count", label: "Conteo físico", hint: "Escribe cuántas unidades contaste; el sistema registra solo la diferencia." },
  { key: "adjustment", label: "Ajuste", hint: "Suma o resta unidades por una corrección justificada." },
  { key: "initial", label: "Carga inicial", hint: "Existencias con las que empiezas a usar el sistema." },
  { key: "damage", label: "Daño", hint: "Producto roto o defectuoso que sale del inventario." },
  { key: "loss", label: "Pérdida", hint: "Faltante o robo." },
] as const;
export type ManualMovement = (typeof MANUAL_MOVEMENTS)[number]["key"];

export const TRANSFER_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "Por enviar", tone: "neutral" }, approved: { label: "Por enviar", tone: "neutral" },
  in_transit: { label: "En tránsito", tone: "brand" }, received: { label: "Recibido", tone: "success" }, cancelled: { label: "Cancelado", tone: "danger" },
};

/** Days ahead that count as "por vencer" (same window as inventory_summary). */
export const EXPIRY_WINDOW_DAYS = 60;

/** "Negro · 52-18-140" / "Esf -2.00 · CB 8.6 · Ø 14.2": what distinguishes a variant inside its product. */
export function variantLabel(v: { color_name?: string | null; attributes?: unknown }) {
  const a = (v.attributes && typeof v.attributes === "object" ? v.attributes : {}) as Record<string, unknown>;
  const parts = [
    v.color_name,
    a.size && `Cal. ${a.size}`,
    a.sphere && `Esf ${a.sphere}`, a.cylinder && `Cil ${a.cylinder}`, a.axis && `Eje ${a.axis}`, a.addition && `Add ${a.addition}`,
    a.base_curve && `CB ${a.base_curve}`, a.diameter && `Ø ${a.diameter}`, a.presentation,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function formatQty(n: number | string | null | undefined) {
  return Number(n ?? 0).toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

/** Calendar date (YYYY-MM-DD, e.g. a lot's expiry) without shifting it through a timezone. */
export function formatDay(key: string) {
  return formatDate(`${key}T12:00:00Z`, "UTC", { day: "numeric", month: "short", year: "numeric" });
}
