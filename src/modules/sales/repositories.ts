import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";

/** `status` filters by payment: "pending" = with balance (pending or partial), "paid" = fully paid. Voided sales never count as debt. */
export async function listSales(db: ServerSupabase, tenantId: string, opts: { branchId: string | null; status?: string; createdBefore?: Date; limit?: number }) {
  let q = db.from("sales")
    .select("id, number, status, payment_status, total, paid_total, balance, created_at, patient:patients(id, full_name), seller:profiles!sales_seller_profile_fkey(full_name), branch:branches(name)")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(opts.limit ?? 60);
  if (opts.branchId) q = q.eq("branch_id", opts.branchId);
  if (opts.status === "pending") q = q.in("payment_status", ["pending", "partial"]).in("status", ["completed", "partially_returned"]);
  else if (opts.status === "paid") q = q.eq("payment_status", "paid");
  if (opts.createdBefore) q = q.lt("created_at", opts.createdBefore.toISOString()).gt("balance", 0);
  const { data } = await q;
  return data ?? [];
}

export async function getSale(db: ServerSupabase, tenantId: string, id: string) {
  const [{ data: sale }, { data: items }, { data: payments }, { data: orders }, { data: invoices }] = await Promise.all([
    db.from("sales").select("*, patient:patients(id, full_name, document_type, document_number, phone, email), seller:profiles!sales_seller_profile_fkey(full_name), branch:branches(name)")
      .eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    db.from("sale_items").select("id, description, category, quantity, unit_price, discount, tax_rate, line_total, tax_amount, variant:product_variants(image_url, color_hex, sku)")
      .eq("tenant_id", tenantId).eq("sale_id", id).order("sort_order"),
    db.from("payments").select("id, method, amount, reference, created_at").eq("tenant_id", tenantId).eq("sale_id", id).order("created_at"),
    db.from("lab_orders").select("id, number, status").eq("tenant_id", tenantId).eq("sale_id", id),
    db.from("invoices").select("id, number, status, cufe, issued_at, error_message").eq("tenant_id", tenantId).eq("sale_id", id).order("created_at", { ascending: false }),
  ]);
  return sale ? { sale, items: items ?? [], payments: payments ?? [], orders: orders ?? [], invoices: invoices ?? [] } : null;
}

export async function listQuotes(db: ServerSupabase, tenantId: string, branchId: string | null) {
  let q = db.from("quotes")
    .select("id, number, status, total, valid_until, created_at, public_token, patient:patients(id, full_name), seller:profiles!quotes_seller_profile_fkey(full_name)")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(60);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data } = await q;
  return data ?? [];
}

export async function getQuote(db: ServerSupabase, tenantId: string, id: string) {
  const [{ data: quote }, { data: items }] = await Promise.all([
    db.from("quotes").select("*, patient:patients(id, full_name, phone, whatsapp), seller:profiles!quotes_seller_profile_fkey(full_name), branch:branches(name)").eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    db.from("quote_items").select("id, description, quantity, unit_price, discount, line_total, variant:product_variants(image_url, color_hex)").eq("tenant_id", tenantId).eq("quote_id", id).order("sort_order"),
  ]);
  return quote ? { quote, items: items ?? [] } : null;
}

export interface PosProduct {
  variantId: string; productId: string; name: string; color: string | null; colorHex: string | null; sku: string; barcode: string | null;
  price: number; taxRate: number; category: string; categoryCode: string; image: string | null; stocked: boolean; stock: number | null;
}

/** Sellable catalog for the POS with stock at the given branch. */
export async function posCatalog(db: ServerSupabase, tenantId: string, branchId: string): Promise<PosProduct[]> {
  const [{ data: variants }, { data: levels }] = await Promise.all([
    db.from("product_variants")
      .select("id, sku, barcode, color_name, color_hex, image_url, price, product:products(id, name, tax_rate, is_stocked, is_active, category:product_categories(name, code))")
      .eq("tenant_id", tenantId).eq("is_active", true).order("sku").limit(500),
    db.from("inventory_levels").select("variant_id, quantity").eq("tenant_id", tenantId).eq("branch_id", branchId),
  ]);
  const stock = new Map((levels ?? []).map((l) => [l.variant_id, Number(l.quantity)]));
  const order = ["frames", "ophthalmic_lenses", "sunglasses", "contact_lenses", "solutions", "accessories", "services", "other"];
  return (variants ?? []).flatMap((v) => v.product && v.product.is_active ? [{
    variantId: v.id, productId: v.product.id, name: v.product.name, color: v.color_name, colorHex: v.color_hex, sku: v.sku, barcode: v.barcode,
    price: Number(v.price), taxRate: Number(v.product.tax_rate), category: v.product.category?.name ?? "Otros", categoryCode: v.product.category?.code ?? "other",
    image: v.image_url, stocked: v.product.is_stocked, stock: v.product.is_stocked ? stock.get(v.id) ?? 0 : null,
  }] : []).sort((a, b) => order.indexOf(a.categoryCode) - order.indexOf(b.categoryCode) || Number(!a.image) - Number(!b.image) || a.name.localeCompare(b.name, "es"));
}

export type SalesOverview = {
  net_sales: number; gross_sales: number; discounts: number; sales_count: number; voided_count: number; balance_due: number;
  open_quotes: number; open_quotes_total: number; draft_quotes: number; issued_quotes: number; converted_quotes: number;
};

/** Indicators of "Ventas y cotizaciones" (definitions in docs/sales-metrics.md). */
export async function salesOverview(db: ServerSupabase, tenantId: string, from: string, to: string, branchId: string | null) {
  const { data, error } = await db.rpc("sales_overview", { p_tenant: tenantId, p_from: from, p_to: to, p_branch: branchId ?? undefined });
  if (error) throw error;
  const o = data as Record<string, number | string>;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)])) as SalesOverview;
}

export type OperationRow = {
  kind: "sale" | "quote"; id: string; number: string; created_at: string; customer_id: string | null; customer_name: string | null;
  customer_document: string | null; branch_name: string | null; seller_name: string | null; total: number; balance: number | null;
  status: string; payment_status: string | null; valid_until: string | null; items_count: number;
};

/** Sales and quotes in one list, newest first, with the total count for pagination. */
export async function listOperations(db: ServerSupabase, tenantId: string, f: {
  kind: string; from?: string; to?: string; branchId?: string | null; query?: string; status?: string; payment?: string; seller?: string; limit: number; offset: number;
}) {
  const { data, error } = await db.rpc("sales_operations", {
    p_tenant: tenantId, p_kind: f.kind, p_from: f.from, p_to: f.to, p_branch: f.branchId ?? undefined, p_query: f.query,
    p_status: f.status, p_payment: f.payment, p_seller: f.seller, p_limit: f.limit, p_offset: f.offset,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as (OperationRow & { total_count: number })[];
  return { rows: rows as OperationRow[], total: Number(rows[0]?.total_count ?? 0) };
}

/** People who can appear as the seller of an operation: active members with permission to sell. */
export async function listSellers(db: ServerSupabase, tenantId: string) {
  const { data } = await db.from("tenant_members").select("user_id, profile:profiles!tenant_members_user_id_fkey(full_name, email)").eq("tenant_id", tenantId).eq("status", "active");
  return (data ?? []).map((m) => ({ id: m.user_id, name: m.profile?.full_name || m.profile?.email || "Sin nombre" }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** A draft sale with each line as the sale form needs it: current catalog data and the variant's units in the draft's branch. */
export async function getSaleDraft(db: ServerSupabase, tenantId: string, id: string) {
  const { data: sale } = await db.from("sales")
    .select("id, number, status, branch_id, seller_id, notes, patient:patients(id, full_name, document_type, document_number, phone, email)")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (!sale || sale.status !== "draft") return null;
  const { data: items } = await db.from("sale_items")
    .select("quantity, discount, variant:product_variants(id, sku, barcode, color_name, color_hex, attributes, image_url, price, product:products(id, name, model, unit, tax_rate, is_stocked, brand:brands(name), category:product_categories(name, kind)))")
    .eq("sale_id", id).order("sort_order");
  const variantIds = (items ?? []).flatMap((i) => (i.variant ? [i.variant.id] : []));
  const { data: levels } = variantIds.length
    ? await db.from("inventory_levels").select("variant_id, quantity").eq("branch_id", sale.branch_id).in("variant_id", variantIds)
    : { data: [] };
  const stock = new Map((levels ?? []).map((l) => [l.variant_id, Number(l.quantity)]));
  const lines = (items ?? []).flatMap((i) => {
    const v = i.variant;
    if (!v?.product) return [];
    const attrs = (v.attributes ?? {}) as Record<string, string>;
    return [{
      quantity: Number(i.quantity), discount: Number(i.discount),
      product: {
        variantId: v.id, productId: v.product.id, name: v.product.name, detail: [v.color_name, ...Object.values(attrs)].filter(Boolean).join(" · "),
        brand: v.product.brand?.name ?? null, model: v.product.model, sku: v.sku, barcode: v.barcode, image: v.image_url, colorHex: v.color_hex,
        kind: v.product.category?.kind ?? "supply", category: v.product.category?.name ?? "", price: Number(v.price), taxRate: Number(v.product.tax_rate),
        stocked: v.product.is_stocked, available: v.product.is_stocked ? stock.get(v.id) ?? 0 : null, unit: v.product.unit,
      },
    }];
  });
  return {
    id: sale.id, number: sale.number, branchId: sale.branch_id, sellerId: sale.seller_id, notes: sale.notes ?? "",
    customer: sale.patient ? { id: sale.patient.id, full_name: sale.patient.full_name, document_type: sale.patient.document_type,
      document_number: sale.patient.document_number, phone: sale.patient.phone, email: sale.patient.email } : null,
    lines,
  };
}
