import { KIND_DEFAULTS, type Kind, type Unit } from "../constants";
import type { ProductDetail } from "../repositories";

export type VariantValues = {
  id?: string; sku: string; barcode: string; color_name: string; color_hex: string; image_url: string;
  attributes: Record<string, string>; price: string; cost: string; is_active: boolean;
};
type StockCell = { quantity: string; lot_code: string; expires_on: string };
export type ProductFormValues = {
  category_id: string; brand: string; name: string; model: string; collection: string; description: string;
  tax_rate: string; is_stocked: boolean; unit: Unit; default_min_stock: string; track_lots: boolean; is_active: boolean;
  attributes: Record<string, string | string[]>;
  variants: VariantValues[];
  /** Initial stock while creating, keyed by `${variant index}:${branch id}`. */
  initial: Record<string, StockCell>;
};

export const EMPTY_VARIANT: VariantValues = { sku: "", barcode: "", color_name: "", color_hex: "", image_url: "", attributes: {}, price: "", cost: "", is_active: true };

/** A stored COP amount as the money inputs hold it. */
export function moneyField(n: number | null | undefined) {
  return n === null || n === undefined ? "" : String(Math.round(Number(n)));
}

export function emptyProduct(category?: { id: string; kind: Kind }): ProductFormValues {
  const d = KIND_DEFAULTS[category?.kind ?? "frame"];
  return {
    category_id: category?.id ?? "", brand: "", name: "", model: "", collection: "", description: "", tax_rate: "19",
    is_stocked: d.is_stocked, unit: d.unit, default_min_stock: "1", track_lots: d.track_lots, is_active: true,
    attributes: {}, variants: [{ ...EMPTY_VARIANT }], initial: {},
  };
}

/** Saved product → form values; `originalCosts` lets the form send a cost only when it was edited. */
export function productToValues(p: ProductDetail, canCosts: boolean): { values: ProductFormValues; originalCosts: Record<number, string> } {
  const originalCosts: Record<number, string> = {};
  const variants = p.variants.map((v, i) => {
    const cost = canCosts ? moneyField(p.costs.get(v.id)?.avg_cost) : "";
    originalCosts[i] = cost;
    return {
      id: v.id, sku: v.sku, barcode: v.barcode ?? "", color_name: v.color_name ?? "", color_hex: v.color_hex ?? "", image_url: v.image_url ?? "",
      attributes: Object.fromEntries(Object.entries((v.attributes ?? {}) as Record<string, unknown>).map(([k, x]) => [k, String(x ?? "")])),
      price: moneyField(v.price), cost, is_active: v.is_active,
    };
  });
  const attrs = (p.attributes ?? {}) as Record<string, unknown>;
  return {
    originalCosts,
    values: {
      category_id: p.category.id, brand: p.brand?.name ?? "", name: p.name, model: p.model ?? "", collection: p.collection ?? "",
      description: p.description ?? "", tax_rate: String(Number(p.tax_rate)), is_stocked: p.is_stocked, unit: p.unit as Unit,
      default_min_stock: String(Number(p.default_min_stock)), track_lots: p.track_lots, is_active: p.is_active,
      attributes: Object.fromEntries(Object.entries(attrs).filter(([, x]) => typeof x === "string" || Array.isArray(x)).map(([k, x]) => [k, x as string | string[]])),
      variants, initial: {},
    },
  };
}
