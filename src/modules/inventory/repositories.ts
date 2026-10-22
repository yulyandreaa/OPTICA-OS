import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { FrameModel } from "./catalog/demo-catalog";
import type { Kind } from "./constants";
import { LIST_PAGE_SIZE, type ListParams } from "./schemas";

/** Showcase models from the real catalog: products flagged `attributes.showcase` with photographed variants. */
export async function showcaseCatalog(db: ServerSupabase, tenantId: string): Promise<{ catalog: FrameModel[]; skuToVariant: Record<string, string> }> {
  const { data } = await db.from("products")
    .select("id, name, model, collection, description, attributes, category:product_categories(code), variants:product_variants(id, sku, color_name, color_hex, image_url, stage_top, stage_bottom, price, is_active)")
    .eq("tenant_id", tenantId).eq("is_active", true).order("created_at");
  const skuToVariant: Record<string, string> = {};
  const catalog = (data ?? []).flatMap((p) => {
    const a = p.attributes as { showcase?: boolean; shape?: string; material?: string; lens?: number; bridge?: number; temple?: number; tags?: string[] };
    const variants = (p.variants ?? []).filter((v) => v.is_active && v.image_url);
    for (const v of variants) skuToVariant[v.sku] = v.id;
    if (!a.showcase || variants.length === 0) return [];
    return [{
      slug: p.id, name: p.name, collection: p.collection ?? "", category: p.category?.code === "sunglasses" ? "Sol" : "Oftálmica",
      shape: a.shape ?? "", material: a.material ?? "", description: p.description ?? "", sku: p.model ?? variants[0]!.sku,
      size: { lens: a.lens ?? 0, bridge: a.bridge ?? 0, temple: a.temple ?? 0 }, price: Number(variants[0]!.price), tags: a.tags ?? [],
      colors: variants.map((v) => ({ key: v.sku, name: v.color_name ?? "", swatch: v.color_hex ?? "#888888", image: v.image_url!, stage: [v.stage_top ?? "#dcdcde", v.stage_bottom ?? "#ced0d2"] as [string, string] })),
    } satisfies FrameModel];
  });
  return { catalog, skuToVariant };
}

export type BranchStock = { branch_id: string; name: string; quantity: number; min: number };

/** inventory_list row (the generated types mark every column of a set-returning function as nullable). */
export type InventoryRow = {
  variant_id: string; product_id: string; product_name: string; model: string | null; brand: string | null; category: string;
  category_kind: string; sku: string; barcode: string | null; color_name: string | null; color_hex: string | null; attributes: Record<string, string>;
  image_url: string | null; unit: string; is_stocked: boolean; track_lots: boolean; price: number; cost: number | null;
  quantity: number | null; min_quantity: number | null; in_transit: number | null; branches: BranchStock[];
  stock_status: "ok" | "low" | "out" | "na"; is_active: boolean; next_expiry: string | null; total_count: number;
};

/** One row per variant, filtered and paginated in the database (inventory_list). */
export async function listInventory(db: ServerSupabase, tenantId: string, branchId: string | null, p: ListParams) {
  const { data, error } = await db.rpc("inventory_list", {
    p_tenant: tenantId, p_branch: branchId ?? undefined, p_query: p.q, p_category: p.categoria, p_brand: p.marca,
    p_status: p.estado === "activos" ? "active" : p.estado === "inactivos" ? "inactive" : "all",
    p_availability: p.disponibilidad === "todas" ? undefined : p.disponibilidad,
    p_limit: LIST_PAGE_SIZE, p_offset: (p.pagina - 1) * LIST_PAGE_SIZE,
  });
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({ ...r, branches: r.branches ?? [] })) as unknown as InventoryRow[];
  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}

export type InventorySummary = {
  active_refs: number; stocked_refs: number; units: number; in_transit: number; low: number; out: number;
  can_see_costs: boolean; value: number | null; uncosted: number | null; expiring: number; expired: number; transfers_in_transit: number;
};
export async function inventorySummary(db: ServerSupabase, tenantId: string, branchId: string | null) {
  const { data, error } = await db.rpc("inventory_summary", { p_tenant: tenantId, p_branch: branchId ?? undefined });
  if (error) throw error;
  return data as unknown as InventorySummary;
}

export async function listCategories(db: ServerSupabase, tenantId: string) {
  const { data } = await db.from("product_categories").select("id, name, kind, is_active, sort_order")
    .eq("tenant_id", tenantId).order("sort_order").order("name");
  return (data ?? []).map((c) => ({ ...c, kind: c.kind as Kind }));
}
export type Category = Awaited<ReturnType<typeof listCategories>>[number];

export async function listBrands(db: ServerSupabase, tenantId: string) {
  const { data } = await db.from("brands").select("id, name").eq("tenant_id", tenantId).order("name");
  return data ?? [];
}

/** Product with its variants, costs (only rows the caller may read), stock per branch and open lots. */
export async function getProduct(db: ServerSupabase, tenantId: string, id: string) {
  const { data: product, error } = await db.from("products")
    .select("id, name, model, collection, description, tax_rate, is_stocked, unit, default_min_stock, track_lots, attributes, is_active, created_at, updated_at, category:product_categories(id, name, kind), brand:brands(id, name), variants:product_variants(id, sku, barcode, color_name, color_hex, image_url, attributes, price, is_active, created_at)")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!product) return null;
  const variants = [...(product.variants ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ids = variants.map((v) => v.id);
  const [costs, levels, lots, transit] = await Promise.all([
    db.from("variant_costs").select("variant_id, avg_cost, last_cost").in("variant_id", ids),
    db.from("inventory_levels").select("branch_id, variant_id, quantity, min_quantity").in("variant_id", ids),
    db.from("inventory_lots").select("id, branch_id, variant_id, lot_code, expires_on, quantity").in("variant_id", ids).gt("quantity", 0).order("expires_on", { nullsFirst: false }),
    db.from("inventory_transfers").select("to_branch_id, items:inventory_transfer_items(variant_id, quantity)").eq("tenant_id", tenantId).eq("status", "in_transit"),
  ]);
  return {
    ...product, category: { ...product.category!, kind: product.category!.kind as Kind }, variants,
    costs: new Map((costs.data ?? []).map((c) => [c.variant_id, c])),
    levels: levels.data ?? [], lots: lots.data ?? [],
    inTransit: (transit.data ?? []).flatMap((t) => t.items.filter((i) => ids.includes(i.variant_id))
      .map((i) => ({ variant_id: i.variant_id, quantity: Number(i.quantity), to_branch_id: t.to_branch_id }))),
  };
}
export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

export async function movementHistory(db: ServerSupabase, tenantId: string, o: {
  branchId?: string | null; productId?: string; variantId?: string; type?: string; before?: { at: string; id: string }; limit?: number;
}) {
  const { data, error } = await db.rpc("inventory_movement_history", {
    p_tenant: tenantId, p_branch: o.branchId ?? undefined, p_product: o.productId, p_variant: o.variantId, p_type: o.type || undefined,
    p_before: o.before?.at, p_before_id: o.before?.id, p_limit: o.limit ?? 50,
  });
  if (error) throw error;
  return data ?? [];
}
export type MovementRow = Awaited<ReturnType<typeof movementHistory>>[number];

export async function listTransfers(db: ServerSupabase, tenantId: string, o: { status?: string; branchId?: string | null } = {}) {
  let q = db.from("inventory_transfers")
    .select("id, number, status, notes, created_at, sent_at, received_at, cancelled_at, cancel_reason, from_branch_id, to_branch_id, from:branches!inventory_transfers_from_branch_id_tenant_id_fkey(name), to:branches!inventory_transfers_to_branch_id_tenant_id_fkey(name), items:inventory_transfer_items(quantity, variant:product_variants(sku, color_name, attributes, product:products(id, name)))")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(60);
  if (o.status) q = q.eq("status", o.status);
  if (o.branchId) q = q.or(`from_branch_id.eq.${o.branchId},to_branch_id.eq.${o.branchId}`);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
