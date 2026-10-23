/**
 * Inventario: catalog with variants, protected costs, stock that never goes negative, idempotent movements,
 * weighted average cost, lots (first expiry, first out), transfers send → receive and company isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, connect, createAuthUser, expectDenied, type Db } from "./helpers";

const suffix = `in${Date.now().toString(36)}`;

describe("inventario", () => {
  let db: Db;
  let owner: string, sales: string, outsider: string;
  let tenant: string, main: string, north: string, frames: string, contacts: string;
  let frame: string, frameBlack: string, frameRed: string, lens: string;

  const one = async <T,>(uid: string | null, sql: string, params: unknown[] = []) =>
    asUser(db, uid, async () => (await db.query<T>(sql, params)).rows[0]!, { commit: true });
  const level = async (branch: string, variant: string) =>
    Number((await db.query<{ q: string }>(`select quantity as q from public.inventory_levels where branch_id = $1 and variant_id = $2`, [branch, variant])).rows[0]?.q ?? 0);
  const movement = (uid: string, p: Record<string, unknown>) =>
    one<{ id: string | null }>(uid, `select public.record_movement($1) as id`, [{ tenant_id: tenant, ...p }]).then((r) => r.id);
  const save = (uid: string, p: Record<string, unknown>) =>
    one<{ id: string }>(uid, `select public.save_product($1) as id`, [{ tenant_id: tenant, tax_rate: 19, is_stocked: true, unit: "unidad", default_min_stock: 1, ...p }]).then((r) => r.id);

  beforeAll(async () => {
    db = await connect();
    owner = await createAuthUser(db, `o-${suffix}@t.dev`, "Dueña");
    sales = await createAuthUser(db, `s-${suffix}@t.dev`, "Asesor");
    outsider = await createAuthUser(db, `x-${suffix}@t.dev`, "Otra");
    tenant = (await one<{ id: string }>(owner, `select public.create_tenant('Inv Optica', 'Inv SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Bogotá', null, null) as id`, [suffix])).id;
    await one(outsider, `select public.create_tenant('Otra', 'Otra SAS', $1, 'NIT', null, null, null, 'optometry', 'Centro', 'Cali', null, null) as id`, [`${suffix}-x`]);
    main = (await db.query<{ id: string }>(`select id from public.branches where tenant_id = $1 and is_main`, [tenant])).rows[0]!.id;
    north = (await one<{ id: string }>(owner, `insert into public.branches (tenant_id, name, code) values ($1, 'Norte', 'NOR') returning id`, [tenant])).id;
    await db.query(`insert into public.tenant_members (tenant_id, user_id, status, joined_at) values ($1, $2, 'active', now())`, [tenant, sales]);
    await db.query(`insert into public.user_roles (tenant_id, user_id, role_id) select $1, $2, id from public.roles where code = 'SALES_REP' and tenant_id is null`, [tenant, sales]);
    const cat = async (code: string) => (await db.query<{ id: string }>(`select id from public.product_categories where tenant_id = $1 and code = $2`, [tenant, code])).rows[0]!.id;
    frames = await cat("frames");
    contacts = await cat("contact_lenses");
  });
  afterAll(async () => { await db?.end(); });

  it("crea un producto con variantes, SKU automático, costo y existencia inicial en una sola operación", async () => {
    frame = await save(owner, {
      category_id: frames, brand: "Nova", name: "Aurora", model: "AU-52", idempotency_key: `p-${suffix}`,
      attributes: { material: "Acetato", frame_type: "completa" },
      variants: [
        { color_name: "Negro", attributes: { size: "52-18-140" }, price: 300000, cost: 100000 },
        { sku: "aur-rojo", color_name: "Rojo", attributes: { size: "52-18-140" }, price: 300000, cost: 120000 },
      ],
      initial_stock: [{ variant: 0, branch_id: main, quantity: 4 }, { variant: 1, branch_id: north, quantity: 2 }],
    });
    const again = await save(owner, { category_id: frames, name: "Aurora", idempotency_key: `p-${suffix}`, variants: [{ price: 1 }] });
    expect(again).toBe(frame);
    const vs = (await db.query<{ id: string; sku: string; color_name: string }>(`select id, sku, color_name from public.product_variants where product_id = $1 order by color_name`, [frame])).rows;
    expect(vs.map((v) => v.sku)).toEqual(["MON-000001", "AUR-ROJO"]);
    frameBlack = vs[0]!.id; frameRed = vs[1]!.id;
    expect(await level(main, frameBlack)).toBe(4);
    expect(await level(north, frameRed)).toBe(2);
    const m = await one<{ type: string; notes: string; created_by: string }>(owner, `select type, notes, created_by from public.inventory_movements where variant_id = $1`, [frameBlack]);
    expect(m).toMatchObject({ type: "initial", created_by: owner });
  });

  it("no permite variantes duplicadas ni SKU repetido", async () => {
    const dupVariant = await expectDenied(db, owner, `select public.save_product($1)`, [{ tenant_id: tenant, category_id: frames, name: "Doble", tax_rate: 19,
      variants: [{ color_name: "Azul", price: 1 }, { color_name: "azul", price: 1 }] }]);
    expect(dupVariant).toMatch(/product_variants_attrs_uq/);
    const dupSku = await expectDenied(db, owner, `select public.save_product($1)`, [{ tenant_id: tenant, category_id: frames, name: "Otra", tax_rate: 19,
      variants: [{ sku: "AUR-ROJO", price: 1 }] }]);
    expect(dupSku).toMatch(/product_variants_tenant_id_sku_key/);
  });

  it("editar el producto no cambia el stock y el asesor no puede crear ni ajustar", async () => {
    await save(owner, { id: frame, category_id: frames, brand: "nova", name: "Aurora Plus",
      variants: [{ id: frameBlack, sku: "MON-000001", color_name: "Negro", attributes: { size: "52-18-140" }, price: 320000 },
                 { id: frameRed, sku: "AUR-ROJO", color_name: "Rojo", attributes: { size: "52-18-140" }, price: 320000 }] });
    expect(await level(main, frameBlack)).toBe(4);
    const brands = await one<{ n: number }>(owner, `select count(*)::int as n from public.brands where tenant_id = $1`, [tenant]);
    expect(brands.n).toBe(1); // "nova" reuses "Nova"
    expect(await expectDenied(db, sales, `select public.save_product($1)`, [{ tenant_id: tenant, category_id: frames, name: "X", variants: [{ price: 1 }] }])).toMatch(/FORBIDDEN/);
    expect(await expectDenied(db, sales, `select public.record_movement($1)`, [{ tenant_id: tenant, branch_id: main, variant_id: frameBlack, type: "adjustment", quantity: 5, notes: "regalo" }])).toMatch(/FORBIDDEN/);
  });

  it("el asesor ve el catálogo y el stock, pero nunca los costos", async () => {
    const asSales = <T,>(sql: string, params: unknown[]) => asUser(db, sales, async () => (await db.query<T>(sql, params)).rows);
    expect(await asSales(`select * from public.variant_costs where variant_id = $1`, [frameBlack])).toHaveLength(0);
    expect(await asSales(`select * from public.inventory_movements where variant_id = $1`, [frameBlack])).toHaveLength(0);
    const list = await asSales<{ cost: string | null; quantity: string }>(`select cost, quantity from public.inventory_list($1, $2) where variant_id = $3`, [tenant, main, frameBlack]);
    expect(list[0]).toMatchObject({ cost: null });
    expect(Number(list[0]!.quantity)).toBe(4);
    const history = await asSales<{ unit_cost: string | null }>(`select unit_cost from public.inventory_movement_history($1, null, $2)`, [tenant, frame]);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((h) => h.unit_cost === null)).toBe(true);
    const summary = (await asSales<{ r: { value: number | null; can_see_costs: boolean } }>(`select public.inventory_summary($1) as r`, [tenant]))[0]!.r;
    expect(summary).toMatchObject({ value: null, can_see_costs: false });
    expect(await expectDenied(db, sales, `select public.save_product($1)`, [{ tenant_id: tenant, id: frame, category_id: frames, name: "Aurora", variants: [{ id: frameBlack, price: 1, cost: 1 }] }])).toMatch(/FORBIDDEN/);
  });

  it("el resumen cuenta referencias, unidades y valor al costo sin duplicar sedes", async () => {
    const r = (await one<{ r: Record<string, number> }>(owner, `select public.inventory_summary($1) as r`, [tenant])).r;
    expect(r).toMatchObject({ active_refs: 2, units: 6, value: 4 * 100000 + 2 * 120000, uncosted: 0 });
    const north_ = (await one<{ r: Record<string, number> }>(owner, `select public.inventory_summary($1, $2) as r`, [tenant, north])).r;
    expect(north_).toMatchObject({ units: 2, out: 1 }); // the black frame has no units in Norte
  });

  it("ningún movimiento deja el stock negativo y los reintentos no duplican", async () => {
    expect(await expectDenied(db, owner, `select public.record_movement($1)`, [{ tenant_id: tenant, branch_id: main, variant_id: frameBlack, type: "damage", quantity: 5, notes: "Golpe" }])).toMatch(/STOCK_INSUFFICIENT/);
    const key = `adj-${suffix}`;
    const a = await movement(owner, { branch_id: main, variant_id: frameBlack, type: "damage", quantity: 1, notes: "Varilla rota", idempotency_key: key });
    const b = await movement(owner, { branch_id: main, variant_id: frameBlack, type: "damage", quantity: 1, notes: "Varilla rota", idempotency_key: key });
    expect(b).toBe(a);
    expect(await level(main, frameBlack)).toBe(3);
  });

  it("el conteo físico registra solo la diferencia", async () => {
    expect(await movement(owner, { branch_id: main, variant_id: frameBlack, type: "count", counted: 3, notes: "Conteo mensual" })).toBeNull();
    await movement(owner, { branch_id: main, variant_id: frameBlack, type: "count", counted: 5, notes: "Conteo mensual" });
    expect(await level(main, frameBlack)).toBe(5);
    const m = await one<{ quantity: string; notes: string }>(owner, `select quantity, notes from public.inventory_movements where variant_id = $1 order by created_at desc limit 1`, [frameBlack]);
    expect(Number(m.quantity)).toBe(2);
    expect(m.notes).toMatch(/Conteo físico: 5 contadas, había 3/);
  });

  it("la compra recibida recalcula el costo promedio ponderado", async () => {
    // Black frame: 5 units at 100000 company-wide; receive 5 at 130000 → (5·100000 + 5·130000) / 10 = 115000
    const supplier = (await one<{ id: string }>(owner, `insert into public.suppliers (tenant_id, name) values ($1, 'Prov') returning id`, [tenant])).id;
    const po = (await one<{ id: string }>(owner, `insert into public.purchase_orders (tenant_id, branch_id, supplier_id, number, status) values ($1, $2, $3, '', 'approved') returning id`, [tenant, main, supplier])).id;
    const item = (await one<{ id: string }>(owner, `insert into public.purchase_order_items (tenant_id, purchase_order_id, variant_id, quantity, unit_cost) values ($1, $2, $3, 5, 130000) returning id`, [tenant, po, frameBlack])).id;
    expect(await level(main, frameBlack)).toBe(5); // an order alone doesn't add stock
    const items = [{ item_id: item, quantity: 5 }];
    await one(owner, `select public.receive_purchase_order($1, $2, $3)`, [po, items, `rcv-${suffix}`]);
    await one(owner, `select public.receive_purchase_order($1, $2, $3)`, [po, items, `rcv-${suffix}`]); // retry
    expect(await level(main, frameBlack)).toBe(10);
    const c = await one<{ avg_cost: string; last_cost: string }>(owner, `select avg_cost, last_cost from public.variant_costs where variant_id = $1`, [frameBlack]);
    expect(Number(c.avg_cost)).toBe(115000);
    expect(Number(c.last_cost)).toBe(130000);
  });

  it("los lentes de contacto exigen lote y salen primero los que vencen antes", async () => {
    lens = await save(owner, { category_id: contacts, name: "AquaSoft mensual", track_lots: true, unit: "caja",
      variants: [{ attributes: { sphere: "-2.00", base_curve: "8.6", diameter: "14.2" }, price: 150000, cost: 60000 }] });
    const lv = (await db.query<{ id: string }>(`select id from public.product_variants where product_id = $1`, [lens])).rows[0]!.id;
    expect(await expectDenied(db, owner, `select public.record_movement($1)`, [{ tenant_id: tenant, branch_id: main, variant_id: lv, type: "initial", quantity: 2, notes: "Carga" }])).toMatch(/LOT_REQUIRED/);
    await movement(owner, { branch_id: main, variant_id: lv, type: "initial", quantity: 2, lot_code: "l-late", expires_on: "2030-01-01", notes: "Carga" });
    await movement(owner, { branch_id: main, variant_id: lv, type: "initial", quantity: 2, lot_code: "L-SOON", expires_on: "2028-01-01", notes: "Carga" });
    const sale = await one<{ id: string }>(owner, `select public.create_sale($1) as id`, [{ tenant_id: tenant, branch_id: main, items: [{ variant_id: lv, quantity: 3 }], payments: [{ method: "cash", amount: 450000 }] }]);
    const m = await one<{ lot_allocations: { lot_code: string; quantity: number }[]; unit_cost: string }>(owner,
      `select lot_allocations, unit_cost from public.inventory_movements where reference_id = $1`, [sale.id]);
    expect(m.lot_allocations.map((a) => [a.lot_code, Number(a.quantity)])).toEqual([["L-SOON", 2], ["L-LATE", 1]]);
    expect(Number(m.unit_cost)).toBe(60000);
    const lots = (await db.query<{ lot_code: string; quantity: string }>(`select lot_code, quantity from public.inventory_lots where variant_id = $1 order by lot_code`, [lv])).rows;
    expect(lots.map((l) => [l.lot_code, Number(l.quantity)])).toEqual([["L-LATE", 1], ["L-SOON", 0]]);
  });

  it("traslado: sale del origen, queda en tránsito, entra al destino y el total no cambia", async () => {
    const total = async () => Number((await db.query<{ q: string }>(`select sum(quantity) as q from public.inventory_levels where variant_id = $1`, [frameBlack])).rows[0]!.q);
    const before = await total();
    expect(await expectDenied(db, owner, `select public.create_transfer($1)`, [{ tenant_id: tenant, from_branch_id: main, to_branch_id: north, items: [{ variant_id: frameBlack, quantity: 99 }] }])).toMatch(/STOCK_INSUFFICIENT/);
    const payload = { tenant_id: tenant, from_branch_id: main, to_branch_id: north, idempotency_key: `tr-${suffix}`, items: [{ variant_id: frameBlack, quantity: 3 }] };
    const t = (await one<{ id: string }>(owner, `select public.create_transfer($1) as id`, [payload])).id;
    expect((await one<{ id: string }>(owner, `select public.create_transfer($1) as id`, [payload])).id).toBe(t);
    expect(await level(main, frameBlack)).toBe(7);
    expect(await level(north, frameBlack)).toBe(0);
    const s = (await one<{ r: Record<string, number> }>(owner, `select public.inventory_summary($1, $2) as r`, [tenant, north])).r;
    expect(s.in_transit).toBe(3);
    // Lines and status can't be changed by hand once sent.
    expect(await expectDenied(db, owner, `update public.inventory_transfer_items set quantity = 1 where transfer_id = $1`, [t])).toMatch(/TRANSFER_LOCKED/);
    expect(await expectDenied(db, owner, `update public.inventory_transfers set status = 'received' where id = $1`, [t])).toMatch(/TRANSFER_RPC_ONLY/);
    await one(owner, `select public.receive_transfer($1)`, [t]);
    await one(owner, `select public.receive_transfer($1)`, [t]); // retry
    expect(await level(north, frameBlack)).toBe(3);
    expect(await total()).toBe(before);
    expect(await expectDenied(db, owner, `select public.cancel_transfer($1)`, [t])).toMatch(/INVALID_TRANSITION/);
  });

  it("cancelar un traslado en tránsito devuelve las unidades al origen", async () => {
    const t = (await one<{ id: string }>(owner, `select public.create_transfer($1) as id`, [{ tenant_id: tenant, from_branch_id: north, to_branch_id: main, items: [{ variant_id: frameRed, quantity: 2 }] }])).id;
    expect(await level(north, frameRed)).toBe(0);
    await one(owner, `select public.cancel_transfer($1, 'Error de sede')`, [t]);
    expect(await level(north, frameRed)).toBe(2);
    const r = await one<{ status: string; cancel_reason: string }>(owner, `select status, cancel_reason from public.inventory_transfers where id = $1`, [t]);
    expect(r).toEqual({ status: "cancelled", cancel_reason: "Error de sede" });
  });

  it("filtra y busca por marca, SKU, disponibilidad y categoría", async () => {
    const ids = async (args: string, params: unknown[]) =>
      (await asUser(db, owner, async () => (await db.query<{ sku: string }>(`select sku from public.inventory_list($1, ${args})`, [tenant, ...params])).rows)).map((r) => r.sku).sort();
    expect(await ids(`null, 'nova'`, [])).toEqual(["AUR-ROJO", "MON-000001"]);
    expect(await ids(`null, 'aur-ro'`, [])).toEqual(["AUR-ROJO"]);
    expect(await ids(`$2, null, null, null, 'active', 'out'`, [main])).toEqual(["AUR-ROJO"]);
    expect(await ids(`null, null, $2`, [contacts])).toEqual(["LC-000001"]);
  });

  it("solo se elimina un producto sin historial; con historial se bloquea y queda auditado", async () => {
    const blank = await save(owner, { category_id: frames, name: "Borrable", variants: [{ color_name: "Gris", price: 1000 }] });
    expect((await one<{ h: boolean }>(owner, `select public.product_has_history($1, $2) as h`, [tenant, blank])).h).toBe(false);
    expect((await one<{ h: boolean }>(owner, `select public.product_has_history($1, $2) as h`, [tenant, frame])).h).toBe(true);
    expect(await expectDenied(db, sales, `select public.delete_product($1, $2)`, [tenant, blank])).toMatch(/FORBIDDEN/);
    expect(await expectDenied(db, outsider, `select public.delete_product($1, $2)`, [tenant, blank])).toMatch(/FORBIDDEN/);
    expect(await expectDenied(db, owner, `select public.delete_product($1, $2)`, [tenant, frame])).toMatch(/PRODUCT_HAS_HISTORY/);
    await one(owner, `select public.delete_product($1, $2)`, [tenant, blank]);
    expect((await db.query(`select 1 from public.product_variants where product_id = $1`, [blank])).rowCount).toBe(0);
    expect((await db.query(`select 1 from public.audit_logs where entity_id = $1 and action = 'delete'`, [blank])).rowCount).toBe(1);
  });

  it("otra empresa no ve ni mueve este inventario", async () => {
    const rows = await asUser(db, outsider, async () => (await db.query(`select * from public.inventory_list($1)`, [tenant])).rowCount);
    expect(rows).toBe(0);
    expect(await expectDenied(db, outsider, `select public.record_movement($1)`, [{ tenant_id: tenant, branch_id: main, variant_id: frameBlack, type: "loss", quantity: 1, notes: "robo" }])).toMatch(/FORBIDDEN/);
    expect(await expectDenied(db, outsider, `select public.create_transfer($1)`, [{ tenant_id: tenant, from_branch_id: main, to_branch_id: north, items: [{ variant_id: frameBlack, quantity: 1 }] }])).toMatch(/FORBIDDEN/);
    const hist = await asUser(db, outsider, async () => (await db.query(`select * from public.inventory_movement_history($1)`, [tenant])).rowCount);
    expect(hist).toBe(0);
  });
});
