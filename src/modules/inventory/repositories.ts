import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { FrameModel } from "./catalog/demo-catalog";

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

export async function stockOverview(db: ServerSupabase, tenantId: string, branchId: string | null, query?: string) {
  const { data } = await db.rpc("inventory_overview", { p_tenant: tenantId, p_branch: branchId ?? undefined, p_query: query ?? undefined });
  return data ?? [];
}

export async function recentMovements(db: ServerSupabase, tenantId: string, branchId: string | null) {
  let q = db.from("inventory_movements")
    .select("id, type, quantity, notes, reference_type, created_at, branch:branches(name), variant:product_variants(sku, color_name, product:products(name)), author:profiles(full_name)")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(80);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data } = await q;
  return data ?? [];
}

export async function listTransfers(db: ServerSupabase, tenantId: string) {
  const { data } = await db.from("inventory_transfers")
    .select("id, number, status, created_at, from:branches!inventory_transfers_from_branch_id_tenant_id_fkey(name), to:branches!inventory_transfers_to_branch_id_tenant_id_fkey(name), items:inventory_transfer_items(quantity, variant:product_variants(sku, product:products(name)))")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(30);
  return data ?? [];
}
